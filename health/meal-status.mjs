import {NUTRIENTS,actualFood,currentCarbReference,dayIntake,events,importedDietTargets,numeric,round} from './core.mjs';
import {quantityInUnit} from './candidates.mjs';
import {managedFoodPackage} from './container-ledger.mjs';
import {eatingState,timelineGroup} from './presentation.mjs';

export const isMealPlan=row=>!actualFood(row)&&eatingState(row)!=='cancelled'&&/^(?:plan|计划)/i.test(row.status??'');

export function dietGoals(state){
 const {range,fromImport}=currentCarbReference(state);
 const {calorieTarget,proteinMin,proteinMax,fatMin,sodiumTarget}=
  fromImport?{...state.settings,...importedDietTargets(state.legacy.rules)}:state.settings;
 return {kcal:calorieTarget,kcalTolerance:Math.max(50,Math.round(calorieTarget*.05)),proteinMin,proteinMax,fatMin,
  carbs:range,sodiumTarget,fromImport};
}

const key=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const sameFood=(plan,actual,sku)=>{
 if(plan.foodId&&actual.foodId)return plan.foodId===actual.foodId;
 return !!key(actual.name)&&[plan.name,sku?.name,...(sku?.aliases??[])].some(name=>key(name)===key(actual.name));
};
const measure=row=>{
 if(row.amount>0&&row.amountUnit)return {amount:row.amount,unit:row.amountUnit};
 const parsed=String(row.portion??'').normalize('NFKC').match(/^\s*(\d+(?:\.\d+)?)\s*(g|克|ml|毫升|L|升|袋|包|份|个|盒|瓶|片)\s*$/i);
 if(!parsed||Number(parsed[1])<=0)return null;
 const unit=({克:'g',毫升:'mL',ml:'mL',升:'L',l:'L',g:'g'})[parsed[2].toLowerCase()]??parsed[2];
 return {amount:Number(parsed[1]),unit};
};
const convert=(sku,amount,from,to)=>from===to?amount:quantityInUnit(sku??{},amount,from,to);
const eps=1e-6;

// Derive fulfillment without editing imported plans, prior actuals or stock.
function mealPlanProgress(state,foods,actual){
 const catalog=new Map(state.legacy.inventory.map(row=>[row.id,row]));
 const plans=foods.filter(isMealPlan).map(row=>({row,qty:measure(row),sku:catalog.get(row.foodId),used:0,done:false,actualIds:[]}));
 for(const record of actual){
  const consumed=measure(record),meal=timelineGroup(record);
  const candidates=plans.filter(plan=>!plan.done&&timelineGroup(plan.row)===meal&&
   (!record.planId||record.planId===plan.row.id)&&sameFood(plan.row,record,plan.sku));
  const container=record.containerId??(candidates.some(plan=>plan.row.containerId)?managedFoodPackage(state,record.id)?.container?.id:null);
  const compatible=candidates.filter(plan=>!plan.row.containerId||plan.row.containerId===container);
  const measured=consumed?compatible.filter(plan=>plan.qty&&convert(plan.sku,consumed.amount,consumed.unit,plan.qty.unit)>0):[];
  const credit=(plan,amount)=>{
   plan.used=amount===null?plan.qty?.amount??0:round(plan.used+amount,6);
   plan.done=amount===null||plan.used>=plan.qty.amount-eps;plan.actualIds.push(record.id);
  };
  if(!measured.length){
   const plan=compatible[0];
   // A name match alone cannot satisfy a known quantity when the actual amount is missing.
   if(compatible.length===1&&(!plan.qty||record.planId===plan.row.id))credit(plan,null);
   continue;
  }
  let remaining=consumed.amount;
  const distance=plan=>Math.abs(convert(plan.sku,consumed.amount,consumed.unit,plan.qty.unit)-(plan.qty.amount-plan.used));
  // Prefer a known package, then an exact serving, before applying any surplus.
  measured.sort((a,b)=>Number(!!b.row.containerId)-Number(!!a.row.containerId)||distance(a)-distance(b));
  for(const plan of measured){
   const available=convert(plan.sku,remaining,consumed.unit,plan.qty.unit);
   const amount=Math.min(available,plan.qty.amount-plan.used);
   if(!(amount>eps))continue;
   credit(plan,amount);
   remaining-=remaining*amount/available;
   if(remaining<=eps)break;
  }
 }
 return plans.map(({row,qty,used,done,actualIds})=>{
  const fraction=done?0:qty?(qty.amount-used)/qty.amount:1;
  const remaining=done?null:used>0?{...row,amount:round(qty.amount-used,6),amountUnit:qty.unit,
   portion:round(qty.amount-used,6)+' '+qty.unit,cost:row.cost==null?null:round(row.cost*fraction,2),
   nutrition:Object.fromEntries(NUTRIENTS.map(n=>[n,numeric(row.nutrition?.[n])===null?null:round(row.nutrition[n]*fraction,2)]))}:row;
  return {row,remaining,actualIds,fulfilledAmount:qty?used:null,status:done?'executed':used>0?'partial':'pending'};
 });
}

function mealProjection(actual,remaining){
 const planned=Object.fromEntries(NUTRIENTS.map(n=>[n,remaining.every(row=>numeric(row.nutrition?.[n])!==null)?
  round(remaining.reduce((sum,row)=>sum+Number(row.nutrition[n]),0),2):null]));
 const projected=Object.fromEntries(NUTRIENTS.map(n=>[n,planned[n]==null||actual.incomplete.includes(n)||
  actual.reported&&actual.totals[n]==null?null:round((actual.totals[n]??0)+planned[n],2)]));
 return {planned,projected};
}

export function mealDay(state,date,{today,foods=events(state,'foods').filter(row=>row.date===date)}={}){
 const future=!!today&&date>today,actualRows=future?[]:foods.filter(actualFood);
 const actual=future?{reported:false,totals:Object.fromEntries(NUTRIENTS.map(key=>[key,null])),incomplete:[],
  cost:null,costPartial:false,costEstimated:false}:dayIntake(state,date);
 const plans=mealPlanProgress(state,foods,actualRows),remaining=plans.flatMap(plan=>plan.remaining?[plan.remaining]:[]);
 return {actual,actualRows,plans,remaining,...mealProjection(actual,remaining)};
}
