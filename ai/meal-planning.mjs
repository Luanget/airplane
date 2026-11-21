import {NUTRIENTS,actualFood,addFood,allocateStock,carbReference,dayIntake,deleteEvent,energyForDay,events,inventoryWithMoves,isOnHand,
 round,validDate} from '../health/core.mjs';
import {basis,quantityInUnit} from '../health/candidates.mjs';
import {packagesFor} from '../health/containers.mjs';
import {onShelf} from '../health/container-ledger.mjs';
import {same} from '../health/sync-source.mjs';

export const isMealPlan=row=>!actualFood(row)&&/^(?:plan|计划)/i.test(row.status??'');
const brief=row=>({id:row.id,date:row.date,meal:row.meal,name:row.name,foodId:row.foodId,
 containerId:row.containerId??null,amount:row.amount,unit:row.amountUnit??null,portion:row.portion,nutrition:row.nutrition,cost:row.cost});
const sum=(records,base=null)=>Object.fromEntries(NUTRIENTS.map(key=>{
 const values=[...(base?[base[key]]:[]),...records.map(row=>row.nutrition[key])];
 return [key,values.every(Number.isFinite)?round(values.reduce((a,b)=>a+b,0),2):null];
}));
const byMeal=foods=>Object.fromEntries([...new Set(foods.map(row=>row.meal))].map(meal=>{
 const items=foods.filter(row=>row.meal===meal);
 return [meal,{items,nutrition:sum(items),knownCost:round(items.reduce((n,row)=>n+(row.cost??0),0),2),
  allCostsKnown:items.every(row=>row.cost!=null)}];
}));
const label=value=>String(value??'').normalize('NFKC').toLowerCase().trim();

export function planningFacts(state,dates,today,habits){
 const inventory=inventoryWithMoves(state).filter(isOnHand).map(sku=>{
  const [targetAmount,targetUnit]=basis(sku);
  return {id:sku.id,name:sku.name,aliases:sku.aliases??[],quantity:sku.qty,unit:sku.grossStockOnly?'g 毛重':sku.unit,
   nutritionBasis:{amount:targetAmount,unit:targetUnit,nutrition:sku.nutrition},price:sku.packagePrice??(sku.pricePerUnit==null?null:{amount:sku.pricePerUnit,unit:sku.priceBasis}),
   containers:packagesFor(state,sku.id).filter(onShelf).map(row=>({id:row.id,kind:row.kind,status:row.status,netGrams:row.net,
    nominal:row.nominal??null,estimated:row.estimated===true,latestGross:row.gross,costCents:row.costCents??null}))};
 });
 const {calorieTarget,proteinMin,proteinMax,fatMin,sodiumTarget}=state.settings;
 const datesSet=[...new Set(dates)];
 return {revision:state.revision??0,inventory,habits,goals:{kcal:calorieTarget,proteinMin,proteinMax,fatMin,sodiumTarget,
  carbs:carbReference(state.settings)},days:datesSet.map(date=>{
  if(!validDate(date))throw Error('请指定日历日期 YYYY-MM-DD');
  const foods=events(state,'foods').filter(row=>row.date===date);
  return {date,actual:date<=today?foods.filter(actualFood).map(brief):[],existingPlans:foods.filter(isMealPlan).map(brief),
   actualTotals:date<=today?dayIntake(state,date).totals:null,energy:date<=today?energyForDay(state,date,today):null,
   activity:events(state,'activities').filter(row=>row.date===date).map(({name,kcal,minutes,km,energyKind,includedInBase})=>
    ({name,kcal,minutes,km,energyKind,includedInBase}))};
 })};
}

function measured(amount,unit,container){
 if(container?.stockMode==='portion'&&unit==='袋'&&amount===1)return {amount:container.net,unit:'g'};
 return {amount,unit};
}

export function evaluateMealPlan(state,{items,replaceIds=[]},today,habits=[]){
 const facts=planningFacts(state,items.map(row=>row.date),today,habits);
 const inventory=new Map(inventoryWithMoves(state).map(sku=>[sku.id,sku]));
 const stockUsed=new Map(),packagesUsed=new Map(),violations=[];
 const identify=(row,sku)=>{
  if(!sku||!isOnHand(sku)||sku.grossStockOnly&& !row.containerId)throw Error('食品 '+(sku?.name??row.foodId)+' 缺少可用库存或可核实的净重');
  const container=row.containerId?packagesFor(state,sku.id).find(item=>item.id===row.containerId&&onShelf(item)):null;
  if(row.containerId&&!container)throw Error('该包装不在可用库存');
  const sizing=measured(row.amount,row.unit,container);
  const [base,baseUnit]=basis(sku);
  const conversion=container?.nominal?{...sku,packageSize:container.nominal.value,packageUnit:container.nominal.unit}:sku;
  const count=quantityInUnit(conversion,sizing.amount,sizing.unit,baseUnit);
  const usage=quantityInUnit(conversion,sizing.amount,sizing.unit,sku.unit);
  if(count==null||usage==null||!(base>0)||!Number.isFinite(sizing.amount)||sizing.amount<=0)throw Error('食品 '+sku.name+' 的份量和库存或营养基准无法可靠换算');
  const nominal=container?.nominal;
  const packageUnit=container?.net!=null?'g':nominal?.unit;
  const packageSize=container?.net??(container?.status==='sealed'?nominal?.value:null);
  const packageUsage=container&&packageSize!=null?quantityInUnit(conversion,sizing.amount,sizing.unit,packageUnit):null;
  const packUsed=container?(packagesUsed.get(container.id)??0)+(packageUsage??0):0;
  if(container&&(!Number.isFinite(packageUsage)||packUsed>packageSize+1e-6))throw Error('分装或包装可用净重不足，或开封后净重不明');
  const total=round((stockUsed.get(sku.id)??0)+usage,6);
  if(total>sku.qty+1e-6)throw Error(sku.name+' 的合计用量 '+total+' '+sku.unit+' 超过可用库存 '+sku.qty+' '+sku.unit);
  stockUsed.set(sku.id,total);if(container)packagesUsed.set(container.id,packUsed);
  const nutrition=Object.fromEntries(NUTRIENTS.map(k=>[k,sku.nutrition[k]==null?null:round(sku.nutrition[k]*count/base,2)]));
  let cost=null;
  if(container?.costCents!=null&&packageSize>0)
   cost=round(container.costCents*packageUsage/packageSize/100,2);
  else if(!container){
   // Price incremental quantities so a second planned serving can cross a lot boundary.
   const costs=at=>at===0?0:allocateStock(state,sku.id,at,undefined,row.date).reduce((sum,part)=>
    sum===null||part.costCents===null?null:sum+part.costCents,0);
   try{
    const previous=costs(round(total-usage,6)),current=costs(total);
    if(previous!=null&&current!=null)cost=(current-previous)/100;
   }catch{/* Price remains unknown if no priced allocation is available. */}
  }
  return {...row,amount:sizing.amount,unit:sizing.unit,name:sku.name,nutrition,cost,portion:sizing.amount+' '+sizing.unit,
   nutritionBasis:{amount:base,unit:baseUnit},estimated:!!container?.estimated||!!nominal&&container?.net==null,stockQty:usage};
 };
 const proposed=[];
 // Reserve existing plans before evaluating additions. Existing plans stay visible
 // even when the catalog lacks a quantity that can be reserved.
 const existing=facts.days.flatMap(day=>day.existingPlans.filter(row=>!replaceIds.includes(row.id)));
 for(const row of existing){
  const samePack=items.some(part=>part.containerId&&part.containerId===row.containerId);
  if(!row.foodId||!row.amount||!row.unit)continue;
  try{identify(row,inventory.get(row.foodId));}
  catch(error){if(samePack)violations.push({date:row.date,id:row.id,reason:error.message});}
 }
 for(const [index,row] of items.entries()){
  try{proposed.push(identify(row,inventory.get(row.foodId)));}
  catch(error){violations.push({index,reason:error.message});}
 }
 const days=facts.days.map(day=>{
  const accepted=proposed.filter(row=>row.date===day.date);
  const plans=[...existing.filter(row=>row.date===day.date),...accepted];
  const all=[...day.actual,...plans];
  for(const habit of habits){
   const constraint=habit.constraint;
   if(!constraint||constraint.kind!=='food_meal_limit')continue;
   const limit=constraint.maxMeals;
   const meals=new Set(all.filter(row=>label(row.name).includes(label(constraint.food))).map(row=>row.meal));
   if(meals.size>limit)violations.push({date:day.date,habitId:habit.id,reason:constraint.food+' 出现在 '+meals.size+' 餐，当前偏好上限 '+limit+' 餐'});
  }
  const planned=sum(plans),projected=sum(plans,day.actual.length?day.actualTotals:null);
  const gap=(key,target)=>projected[key]==null||target==null?null:round(target-projected[key],2);
  return {...day,proposed:accepted,meals:byMeal(plans),planned,projected,
   gaps:{kcal:gap('kcal',facts.goals.kcal),proteinMin:gap('protein',facts.goals.proteinMin),
    proteinMax:gap('protein',facts.goals.proteinMax),fatMin:gap('fat',facts.goals.fatMin),
    carbMin:gap('carbs',facts.goals.carbs?.low),carbMax:gap('carbs',facts.goals.carbs?.high),sodiumLimit:gap('sodium',facts.goals.sodiumTarget)}};
 });
 return {feasible:violations.length===0,violations,goals:facts.goals,days,
  usedHabitIds:habits.map(row=>row.id),assumptions:'试算共用当前库存及目标日期已保存计划，未知营养和成本保留为空。'};
}

export function planOperation(state,args,{id,today,habits}){
 const next=structuredClone(state),active=events(next,'foods');
 const confirmed=active.filter(row=>args.replaceIds.includes(row.id));
 if(confirmed.length!==new Set(args.replaceIds).size||confirmed.some(row=>!isMealPlan(row)))throw Error('只可批量删除或替换已定位的计划');
 const evaluation=args.items.length?evaluateMealPlan(next,args,today,habits):null;
 if(evaluation&&!evaluation.feasible)return {evaluation};
 for(const row of confirmed)deleteEvent(next,'foods',row.id);
 const created=[];
 for(const row of evaluation?.days.flatMap(day=>day.proposed)??[]){
  const record=addFood(next,{...row,...row.nutrition,amountUnit:row.unit,status:'plan',stockQty:null},undefined,'meal-plan:'+id+':'+created.length);
  if(row.containerId)record.containerId=row.containerId;
  created.push(record);
 }
 return {next,evaluation,changes:{created,removed:confirmed}};
}

export function undoMealPlan(state,changes){
 const next=structuredClone(state),active=new Map(events(next,'foods').map(row=>[row.id,row]));
 if(changes.created.some(row=>!same(active.get(row.id),row))||changes.removed.some(row=>active.has(row.id)))
  throw Error('计划与保存回执不一致，请核对后再撤销');
 for(const row of changes.created)deleteEvent(next,'foods',row.id);
 for(const row of changes.removed){
  if(next.legacy.foods.some(old=>old.id===row.id))((next.local.edits??={}).foods??={})[row.id]=row;
  else next.local.foods.push(row);
 }
 return next;
}
