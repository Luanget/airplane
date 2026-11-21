import {normalizeClock} from '../calendar.mjs';
import {NUTRIENTS,addFood,changeFoodMeal,events,foodsForDay,isActualStatus,inventoryWithMoves,numeric,round,validDate} from './core.mjs';
import {quantityInUnit,resolveItem} from './candidates.mjs';
import {measuredGrams} from './inventory.mjs';

const normalize=s=>String(s??'').trim().toLowerCase();
export function matchFoodRecords(state,date,query=''){
 const term=normalize(query);
 return foodsForDay(state,date).filter(row=>normalize(row.name).includes(term))
  .sort((a,b)=>normalizeClock(a.time).localeCompare(normalizeClock(b.time)));
}

export function summarizeFoodHistory(state,date,query){
 const rows=matchFoodRecords(state,date,query);
 return {date,foods:rows.map(row=>({
  name:row.name,portion:String(row.portion??''),meal:String(row.meal??''),time:String(row.time??'')
 }))};
}

export function remainingGrossWeights(state){
 const latest=new Map();
 for(const row of events(state,'foods')){
  const grams=numeric(row.weighing?.after);
  if(!row.foodId||grams===null||row.status!=='actual'&&!isActualStatus(row.status))continue;
  const at=row.date+'T'+normalizeClock(row.time)+'/'+(row.createdAt??'');
  if(!latest.has(row.foodId)||at>=latest.get(row.foodId).at)latest.set(row.foodId,{grams,at});
 }
 return new Map([...latest].map(([id,{grams}])=>[id,grams]));
}

const unitOf=unit=>({克:'g',毫升:'mL',ml:'mL',g:'g',袋:'包'})[normalize(unit)]??unit;
export function recordedPortion(row){
 const match=/^\s*(\d+(?:\.\d+)?)\s*(g|ml|克|毫升|包|袋|个|份|盒|瓶)\s*(（(?:生重|熟重)）|\((?:生重|熟重)\))?\s*$/i.exec(row.portion??'');
 const amount=Number(match?.[1]);
 if(!Number.isFinite(amount)||amount<=0){
  if(numeric(row.amount)>0&&typeof row.amountUnit==='string')
   return {amount:row.amount,unit:unitOf(row.amountUnit),suffix:''};
  throw Error('原记录没有明确的数值份量，请补充原份量和单位');
 }
 return {amount,unit:unitOf(match[2]),suffix:match[3]??''};
}

// Reuse the manual edit path so the original entry's stock movements are
// replaced in the same saved revision as the entry itself.
export function reviseFoodPortion(current,{id,date,amount,unit,newMeal,weighing}){
 const row=validDate(date)?events(current,'foods').find(e=>e.id===id&&e.date===date):null;
 if(!row)throw Error('原记录已变更，请重新查询');
 const meal=newMeal??row.meal;
 if(amount==null&&!weighing){
  if(meal===row.meal)throw Error('请指定新份量或餐次');
  const next=structuredClone(current),after=changeFoodMeal(next,row,meal);
  return {next,before:row,after,stock:null};
 }
 const grams=weighing?measuredGrams(weighing):null;
 if(weighing)amount=grams;
 const measure=weighing?'g':unitOf(unit);
 if(!Number.isFinite(amount)||amount<0.001||amount>100000)throw Error('请填写有效的新份量');
 if(!measure)throw Error('请提供新份量的单位');
 const linked=current.local.stockMoves.filter(m=>m.linkedFoodId===id);
 const sku=inventoryWithMoves(current).find(s=>s.id===row.foodId);
 if(linked.length&&(!sku||linked.some(m=>m.foodId!==row.foodId||m.delta>=0)))
  throw Error('原记录的库存流水需要先核对');
 let before;
 try{before=recordedPortion(row);}catch(err){if(!weighing)throw err;}
 const equivalent=before?quantityInUnit(sku,amount,measure,before.unit):null;
 if(equivalent===null&&!weighing)throw Error('请使用原记录的单位 '+before.unit+'，克和毫升不自动换算');
 const ratio=equivalent===null?null:equivalent/before.amount;
 if(ratio===1&&meal===row.meal&&!weighing)throw Error('份量没有变化');
 const used=linked.reduce((sum,m)=>sum-m.delta,0);
 const qty=linked.length?(ratio===null?quantityInUnit(sku,amount,measure,sku.unit):round(used*ratio,6)):null;
 if(qty!==null&&!(qty>0))throw Error('更正后的库存份量过小');
 const estimate=ratio===null&&sku?resolveItem(current,{sku:sku.id,amount,unit:measure,weighing}):null;
 const nutrition=Object.fromEntries(NUTRIENTS.map(k=>{
  const value=numeric(row.nutrition?.[k]);return [k,ratio===null?estimate?.nutrition[k]??null:value===null?null:round(value*ratio,2)];
 }));
 const next=structuredClone(current);
 const updated=addFood(next,{...row,...nutrition,meal,status:isActualStatus(row.status)?'actual':row.status,
  portion:amount+' '+measure+(before?.suffix??''),amount,amountUnit:measure,weighing,
  stockQty:qty,cost:row.costSource==='inventory'?null:row.cost},id);
 updated.source=row.source;
 const after=sku?inventoryWithMoves(next).find(s=>s.id===sku.id):null;
 return {next,before:row,after:updated,stock:linked.length?{name:sku.name,unit:sku.unit,before:sku.qty,after:after.qty}:null};
}
