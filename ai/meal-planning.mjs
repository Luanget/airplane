import {NUTRIENTS,addFood,allocateStock,deleteEvent,energyForDay,events,foodsForDay,inventoryWithMoves,isOnHand,
 round,validDate} from '../health/core.mjs';
import {basis,quantityInUnit} from '../health/candidates.mjs';
import {packagesFor} from '../health/containers.mjs';
import {onShelf} from '../health/container-ledger.mjs';
import {dietGoals,isMealPlan,mealDay} from '../health/meal-status.mjs';
import {same} from '../health/sync-source.mjs';
import {foodClassification,foodGroupOf} from '../health/food-groups.mjs';
import {categoryReader} from '../health/food-categories.mjs';
import {recordedPortion} from '../health/food-history.mjs';

export {isMealPlan};
const brief=row=>({...foodClassification(row),id:row.id,date:row.date,meal:row.meal,name:row.name,foodId:row.foodId,
 containerId:row.containerId??null,amount:row.amount,unit:row.amountUnit??null,portion:row.portion,nutrition:row.nutrition,cost:row.cost,quality:row.quality,uncertainty:row.uncertainty,nutritionEstimate:row.nutritionEstimate});
const sum=records=>Object.fromEntries(NUTRIENTS.map(key=>{
 const values=records.map(row=>row.nutrition[key]);
 return [key,values.every(Number.isFinite)?round(values.reduce((a,b)=>a+b,0),2):null];
}));
const byMeal=foods=>Object.fromEntries([...new Set(foods.map(row=>row.meal))].map(meal=>{
 const items=foods.filter(row=>row.meal===meal);
 const priced=items.filter(row=>row.cost!=null);
 return [meal,{items,nutrition:sum(items),knownCost:priced.length?round(priced.reduce((n,row)=>n+row.cost,0),2):null,
  allCostsKnown:items.every(row=>row.cost!=null)}];
}));
const label=value=>String(value??'').normalize('NFKC').toLowerCase().trim();

function portionGrams(row,sku){
 try{
  const portion=recordedPortion({...row,amountUnit:row.amountUnit??row.unit});
  return quantityInUnit(sku,portion.amount,portion.unit,'g');
 }catch{return null;}
}

function intakeGrams(rows,inventory,group){
 let total=0,knownItems=0;
 const unmeasured=[],pending=[];
 for(const row of rows){
  const sku=inventory.get(row.foodId),classified=foodGroupOf(row,sku);
  if(!classified){pending.push(row.name);continue;}
  if(classified!==group)continue;
  const weight=portionGrams(row,sku);
  let grams=weight;
  if(group==='vegetable'){
   const known=row.vegetableGrams;
   const basis=row.vegetableBasis??sku?.vegetableBasis??(sku?.stage==='raw'&&sku?.stockStage==='raw'?'whole':null);
   grams=Number.isFinite(known)&&known>=0&&(weight===null||known<=weight+1e-6)?known:basis==='whole'?weight:null;
  }
  if(grams==null)unmeasured.push(row.name);
  else{total+=grams;knownItems++;}
 }
 const knownGrams=round(total,2),uncertain=unmeasured.length||pending.length;
 return {grams:uncertain?null:knownGrams,unmeasured,knownItems,
  ...(uncertain&&knownItems?{knownGrams}:{}),...(pending.length?{pending:[...new Set(pending)]}:{})};
}

export const vegetableIntake=(rows,inventory)=>intakeGrams(rows,inventory,'vegetable');
export const mushroomIntake=(rows,inventory)=>intakeGrams(rows,inventory,'mushroom');

export function planningGoals(state){
 const goals=dietGoals(state),custom=state.settings.vegetableTargetGrams;
 const maximumCarbs=Math.max(0,Math.floor((goals.kcal+goals.kcalTolerance-goals.proteinMin*4-goals.fatMin*9)/4));
 return {...goals,vegetableGrams:Number.isFinite(custom)&&custom>0?custom:500,
  carbTradeoff:goals.carbs?.low>maximumCarbs?{maximumCarbsWithPrimaryTargets:maximumCarbs}:null};
}

export function planningFacts(state,dates,today,habits){
 const category=categoryReader(state);
 const inventory=inventoryWithMoves(state).filter(isOnHand).map(sku=>{
  const [targetAmount,targetUnit]=basis(sku);
  return {id:sku.id,name:sku.name,aliases:sku.aliases??[],quantity:sku.qty,unit:sku.grossStockOnly?'g 毛重':sku.unit,
   ...foodClassification(sku),...category(sku),
   nutritionBasis:{amount:targetAmount,unit:targetUnit,nutrition:sku.nutrition},price:sku.packagePrice??(sku.pricePerUnit==null?null:{amount:sku.pricePerUnit,unit:sku.priceBasis}),
   containers:packagesFor(state,sku.id).filter(onShelf).map(row=>({id:row.id,kind:row.kind,status:row.status,netGrams:row.net,
    nominal:row.nominal??null,estimated:row.estimated===true,latestGross:row.gross,costCents:row.costCents??null}))};
 });
 const datesSet=[...new Set(dates)];
 return {revision:state.revision??0,inventory,habits,settingsPreferences:state.settings.preferences??null,goals:planningGoals(state),days:datesSet.map(date=>{
  if(!validDate(date))throw Error('请指定日历日期 YYYY-MM-DD');
  const {actual,actualRows,plans,planned,projected}=mealDay(state,date,{today});
  return {date,actual:actualRows.map(brief),existingPlans:plans.map(({row,remaining,status,actualIds,fulfilledAmount})=>
   ({...brief(row),covered:status==='executed',status,actualIds,fulfilledAmount,remaining:remaining?brief(remaining):null})),
   actualTotals:actual.totals,actualReported:actual.reported,actualIncomplete:actual.incomplete,
   actualCost:actual.cost,actualCostPartial:actual.costPartial,remainingPlanTotals:planned,currentProjection:projected,
   energy:date<=today?energyForDay(state,date,today):null,
   activity:events(state,'activities').filter(row=>row.date===date).map(({name,kcal,minutes,km,energyKind,includedInBase})=>
    ({name,kcal,minutes,km,energyKind,includedInBase}))};
 })};
}

function measured(amount,unit,container){
 if(container?.stockMode==='portion'&&unit==='袋'&&amount===1)return {amount:container.net,unit:'g'};
 return {amount,unit};
}

function targetChecks(projected,goals,vegetables){
 const bounds={kcal:[goals.kcal-goals.kcalTolerance,goals.kcal+goals.kcalTolerance],
  protein:[goals.proteinMin,goals.proteinMax],fat:[goals.fatMin,null],carbs:[goals.carbs?.low??null,goals.carbs?.high??null],
  sodium:[null,goals.sodiumTarget],vegetables:[goals.vegetableGrams,null]};
 return Object.fromEntries(Object.entries(bounds).map(([key,[min,max]])=>{
  const lowerBound=key==='vegetables'&&vegetables.grams===null&&vegetables.knownGrams>=min;
  const value=key==='vegetables'?(lowerBound?vegetables.knownGrams:vegetables.grams):projected[key];
  const status=min==null&&max==null?'no_target':value==null?'unknown':min!=null&&value<min?'below':max!=null&&value>max?'above':'within';
  const difference=status==='below'?round(min-value,2):status==='above'?round(value-max,2):status==='within'?0:null;
  return [key,{status,value,min,max,difference,...(lowerBound?{lowerBound:true}:{})}];
 }));
}

export function evaluateMealPlan(state,{items,replaceIds=[],appendTo=[],dates=[],exceptions=[]},today,habits=[]){
 const activePlans=events(state,'foods').filter(isMealPlan);
 const selected=[...replaceIds,...appendTo];
 const selectedPlans=activePlans.filter(row=>selected.includes(row.id));
 const facts=planningFacts(state,[...dates,...items.map(row=>row.date),...selectedPlans.map(row=>row.date)],today,habits);
 const inventory=new Map(inventoryWithMoves(state).map(sku=>[sku.id,sku]));
 const stockUsed=new Map(),packagesUsed=new Map(),violations=[];
 if(selectedPlans.length!==new Set(selected).size)violations.push({reason:'修改或追加前请查询并指定有效的原计划 ID。'});
 const identify=(row,sku)=>{
  if(!sku||!isOnHand(sku)||sku.grossStockOnly&& !row.containerId)throw Error('食品 '+(sku?.name??row.foodId)+' 缺少可用库存或可核实的净重');
  const container=row.containerId?packagesFor(state,sku.id).find(item=>item.id===row.containerId&&onShelf(item)):null;
  if(row.containerId&&!container)throw Error('该包装不在可用库存');
  const sizing=measured(row.amount,row.unit,container);
  const [base,baseUnit]=basis(sku);
  const conversion=container?.nominal?{...sku,standard:'',packageSize:container.nominal.value,packageUnit:container.nominal.unit}:sku;
  const count=quantityInUnit(conversion,sizing.amount,sizing.unit,baseUnit);
  const usage=quantityInUnit(conversion,sizing.amount,sizing.unit,sku.unit);
  if(usage==null||!Number.isFinite(sizing.amount)||sizing.amount<=0)throw Error('食品 '+sku.name+' 的份量和库存单位无法可靠换算');
  const nominal=container?.nominal;
  const packageUnit=container?.net!=null?'g':nominal?.unit;
  const packageSize=container?.net??(container?.status==='sealed'?nominal?.value:null);
  const packageUsage=container&&packageSize!=null?quantityInUnit(conversion,sizing.amount,sizing.unit,packageUnit):null;
  const packUsed=container?(packagesUsed.get(container.id)??0)+(packageUsage??0):0;
  if(container&&(!Number.isFinite(packageUsage)||packUsed>packageSize+1e-6))throw Error('分装或包装可用净重不足，或开封后净重不明');
  const total=round((stockUsed.get(sku.id)??0)+usage,6);
  if(total>sku.qty+1e-6)throw Error(sku.name+' 的合计用量 '+total+' '+sku.unit+' 超过可用库存 '+sku.qty+' '+sku.unit);
  stockUsed.set(sku.id,total);if(container)packagesUsed.set(container.id,packUsed);
  const estimate=row.estimate??row.nutritionEstimate;
  const estimatedAmount=estimate?quantityInUnit(conversion,sizing.amount,sizing.unit,estimate.unit):null;
  const estimatedKeys=[];
  const nutrition=Object.fromEntries(NUTRIENTS.map(key=>{
   if(sku.nutrition[key]!=null&&count!=null&&base>0)return [key,round(sku.nutrition[key]*count/base,2)];
   if(estimate&&estimatedAmount!=null&&estimate.amount>0&&Number.isFinite(estimate.nutrition?.[key])&&estimate.nutrition[key]>=0){
    estimatedKeys.push(key);
    return [key,round(estimate.nutrition[key]*estimatedAmount/estimate.amount,2)];
   }
   return [key,null];
  }));
  let cost=null;
  if(container?.costCents!=null&&packageSize>0)
   cost=round(Math.max(0,container.costCents-(container.spent??0)-(container.lossCost??0))*packageUsage/packageSize/100,2);
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
   nutritionBasis:{amount:base,unit:baseUnit},
   ...(estimatedKeys.length?{quality:'estimated',uncertainty:'通用估算 · '+estimate.source+' · '+estimate.uncertainty,
    nutritionEstimate:{...estimate,usedFor:estimatedKeys}}:{}),
   estimated:!!container?.estimated||!!nominal&&container?.net==null,stockQty:usage};
 };
 const proposed=[];
 // Reserve existing plans before evaluating additions. Existing plans stay visible
 // even when the catalog lacks a quantity that can be reserved.
 const existing=facts.days.flatMap(day=>day.existingPlans.flatMap(row=>row.remaining&&!replaceIds.includes(row.id)?[row.remaining]:[]));
 const originalMeals=new Set(facts.days.flatMap(day=>day.existingPlans.map(row=>row.date+'|'+row.meal)));
 const amendedMeals=new Set(selectedPlans.map(row=>row.date+'|'+row.meal));
 for(const row of existing){
  const samePack=items.some(part=>part.containerId&&part.containerId===row.containerId);
  if(!row.foodId||!row.amount||!row.unit)continue;
  try{identify(row,inventory.get(row.foodId));}
  catch(error){if(samePack)violations.push({date:row.date,id:row.id,reason:error.message});}
 }
 for(const [index,row] of items.entries()){
  const mealKey=row.date+'|'+row.meal;
  if(originalMeals.has(mealKey)&&!amendedMeals.has(mealKey)){
   violations.push({index,date:row.date,meal:row.meal,reason:'该餐已有保存计划。追加用 appendTo，替换个别项目用 replaceIds，请以用户要求为准。'});
   continue;
  }
  try{proposed.push(identify(row,inventory.get(row.foodId)));}
  catch(error){violations.push({index,reason:error.message});}
 }
 const days=facts.days.map(day=>{
  const accepted=proposed.filter(row=>row.date===day.date);
  const originals=activePlans.filter(row=>row.date===day.date&&!replaceIds.includes(row.id));
  const {remaining:plans,actualRows,planned,projected}=mealDay(state,day.date,{today,foods:[...foodsForDay(state,day.date),...originals,
   ...accepted.map((row,index)=>({...row,status:'plan',id:'proposed:'+index,amountUnit:row.unit}))]});
  const all=[...actualRows,...plans];
  const vegetables=vegetableIntake(all,inventory),mushrooms=mushroomIntake(all,inventory);
  for(const habit of habits){
   const constraint=habit.constraint;
   if(!constraint||constraint.kind!=='food_meal_limit'||exceptions.some(row=>row.habitId===habit.id&&row.date===day.date))continue;
   const limit=constraint.maxMeals;
   const meals=new Set(all.filter(row=>label(row.name).includes(label(constraint.food))).map(row=>row.meal));
   if(meals.size>limit)violations.push({date:day.date,habitId:habit.id,reason:constraint.food+' 出现在 '+meals.size+' 餐，当前偏好上限 '+limit+' 餐'});
  }
  const gap=(key,target)=>projected[key]==null||target==null?null:round(target-projected[key],2);
  const gaps={kcal:gap('kcal',facts.goals.kcal),proteinMin:gap('protein',facts.goals.proteinMin),
   proteinMax:gap('protein',facts.goals.proteinMax),fatMin:gap('fat',facts.goals.fatMin),
   carbMin:gap('carbs',facts.goals.carbs?.low),carbMax:gap('carbs',facts.goals.carbs?.high),sodiumLimit:gap('sodium',facts.goals.sodiumTarget)};
  const checks=targetChecks(projected,facts.goals,vegetables);
  const outside=Object.keys(checks).filter(key=>['below','above'].includes(checks[key].status));
  const unknown=Object.keys(checks).filter(key=>checks[key].status==='unknown');
  const priced=plans.filter(row=>row.cost!=null),knownPlannedCost=priced.length?round(priced.reduce((sum,row)=>sum+row.cost,0),2):null;
  const knownDayCost=knownPlannedCost==null&&day.actualCost==null?null:round((knownPlannedCost??0)+(day.actualCost??0),2);
  return {...day,proposed:accepted,meals:byMeal(plans),planned,projected,vegetables,mushrooms,gaps,
   targetsMet:Object.fromEntries(Object.entries(checks).map(([key,{status}])=>[key,
    ['unknown','no_target'].includes(status)?null:status==='within'])),
   nutritionCheck:{status:outside.length?'outside':unknown.length?'unknown':'within',checks,outside,unknown},
   cost:{knownPlannedCost,knownDayCost,complete:!day.actualCostPartial&&priced.length===plans.length}};
 });
 return {feasible:violations.length===0,violations,goals:facts.goals,days,usedHabitIds:habits.map(row=>row.id),
  assumptions:'feasible 仅检查库存和硬约束。全天方案的 nutritionCheck.status 若是 outside，按 checks 的差距调整后再试算。明确指定单餐、份量或不追求全天达标时按用户范围执行。未知营养与成本不会视为零。'};
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
  if(row.nutritionEstimate)record.nutritionEstimate=row.nutritionEstimate;
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
