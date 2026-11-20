import {normalizeClock} from '../calendar.mjs';
import {NUTRIENTS,addFood,foodsForDay,inventoryWithMoves,numeric,round,validDate} from './core.mjs';

export const FOOD_HISTORY_LIMIT=10;
const normalize=s=>String(s??'').trim().toLowerCase();
export function matchFoodRecords(state,date,query=''){
 const term=normalize(query);
 return foodsForDay(state,date).filter(row=>normalize(row.name).includes(term))
  .sort((a,b)=>normalizeClock(a.time).localeCompare(normalizeClock(b.time)));
}

export function summarizeFoodHistory(state,date,query){
 const rows=matchFoodRecords(state,date,query);
 return {date,foods:rows.slice(0,FOOD_HISTORY_LIMIT).map(row=>({
  name:row.name.slice(0,48),portion:String(row.portion??'').slice(0,40),
  meal:String(row.meal??'').slice(0,12),time:normalizeClock(row.time)
 })),more:rows.length>FOOD_HISTORY_LIMIT};
}

const unitOf=unit=>({克:'g',毫升:'mL',ml:'mL',g:'g',袋:'包'})[normalize(unit)]??unit;
export function recordedPortion(row){
 const match=/^\s*(\d+(?:\.\d+)?)\s*(g|ml|克|毫升|包|袋|个|份|盒|瓶)\s*(（(?:生重|熟重)）|\((?:生重|熟重)\))?\s*$/i.exec(row.portion??'');
 const amount=Number(match?.[1]);
 if(!Number.isFinite(amount)||amount<=0)throw Error('原记录没有明确的数值份量，请在健康页核对后修改');
 return {amount,unit:unitOf(match[2]),suffix:match[3]??''};
}

// Reuse the manual edit path so the original entry's stock movements are
// replaced in the same saved revision as the entry itself.
export function reviseFoodPortion(current,{id,date,amount,unit}){
 const row=validDate(date)?foodsForDay(current,date).find(e=>e.id===id):null;
 if(!row)throw Error('原记录已变更，请重新查询');
 const before=recordedPortion(row),measure=unitOf(unit);
 if(!Number.isFinite(amount)||amount<0.001||amount>100000)throw Error('请填写有效的新份量');
 if(before.unit!==measure)throw Error('请使用原记录的单位 '+before.unit+'，克和毫升不自动换算');
 if(amount===before.amount)throw Error('份量没有变化');
 const linked=current.local.stockMoves.filter(m=>m.linkedFoodId===id);
 const stock=linked.length?inventoryWithMoves(current).find(s=>s.id===row.foodId):null;
 if(linked.length&&(!stock||linked.some(m=>m.foodId!==row.foodId||m.delta>=0)))
  throw Error('原记录的库存流水需要先核对');
 const ratio=amount/before.amount;
 const used=linked.reduce((sum,m)=>sum-m.delta,0);
 const qty=stock?round(used*ratio,6):null;
 if(stock&&!(qty>0))throw Error('更正后的库存份量过小');
 const nutrition=Object.fromEntries(NUTRIENTS.map(k=>{
  const value=numeric(row.nutrition?.[k]);return [k,value===null?null:round(value*ratio,2)];
 }));
 const next=structuredClone(current);
 const updated=addFood(next,{...row,...nutrition,status:'actual',portion:amount+' '+measure+before.suffix,
  amount:row.amount>0?round(row.amount*ratio,6):amount,stockQty:qty,
  cost:row.costSource==='inventory'?null:row.cost},id);
 if(row.source==='confirmed-assistant')updated.source=row.source;
 const after=stock?inventoryWithMoves(next).find(s=>s.id===stock.id):null;
 return {next,before:row,after:updated,stock:stock?{name:stock.name,unit:stock.unit,before:stock.qty,after:after.qty}:null};
}
