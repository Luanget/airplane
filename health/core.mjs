/** Airplane Health — deterministic domain logic. No third-party libraries. */
export const APP_SCHEMA = 'airplane-health-v1';
export const DEFAULT_SETTINGS = Object.freeze({
  calorieTarget: 2000, proteinMin: 100, proteinMax: 160,
  fatMin: 40, sodiumTarget: 2000, baselineTdee: 2200,
  cycleDays: 6, cycleTarget: 3500, cycleAnchor: '2026-01-01'
});
export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'sodium'];
const NUTRIENT_KEYS = {kcal:'kcal', protein:'蛋白质(g)', carbs:'碳水(g)', fat:'脂肪(g)', sodium:'钠(mg)'};
const val = x => (typeof x === 'number' || typeof x === 'string' && x.trim() ? Number(x) : null);
export const numeric = x => { const n = val(x); return n !== null && Number.isFinite(n) ? n : null; };
export const zero = x => numeric(x) ?? 0;
export const round = (v, digits=1) => Number((v || 0).toFixed(digits));
export const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
export const utcDay = s => Date.parse(`${s}T00:00:00Z`) / 86400000;
export function addDays(s,n){ return new Date((utcDay(s)+n)*86400000).toISOString().slice(0,10); }
export function newState(){ return {
  appType: APP_SCHEMA, settings:{...DEFAULT_SETTINGS}, importedAt:null, importInfo:null,
  legacy: { foods:[], weights:[], activities:[], inventory:[], daily:{}, energy:{}, rules:[], sourceSnapshot:null },
  local: { foods:[], weights:[], activities:[], stockMoves:[] }
}; }
export function isActualStatus(status){
 const s=String(status || '').trim();
 if (!s || /^(?:计划|取消|未吃|作废|superseded|已被|历史|待定|失效)/i.test(s)) return false;
 if (/计划已被|计划已取消|未实际|未确认|不计(?:入|算)|撤回/.test(s)) return false;
 return /^(?:已吃|已喝|实际|已确认|确认已吃|吃完|已进食)/.test(s);
}
export function allowWeight(row){
 if (!validDate(row.date)||numeric(row.kg)===null) return false;
 const t=String(row.trendStatus||'');
 return (/^(?:是|暂定纳入|纳入)/.test(t) && !/不纳入|排除|夜间/.test(t));
}
const common = row => ({ date:row['日期'] || null, original:row });
export function normalizeInventory(row,index){
 const standard = String(row['标准份量']||'');
 const unitText = String(row['库存单位']||'');
 const is100g = /(?:^|每|[^\d.])100\s*(?:g|克)(?!\s*\/包)/i.test(standard);
 const is100ml = /(?:^|每|[^\d.])100\s*(?:ml|毫升)/i.test(standard);
 const per100 = is100g || is100ml;
 const normalizedUnit = /^(?:g|克)/.test(unitText) ? 'g' : /^(?:mL|ml|毫升)/i.test(unitText) ? 'mL' : /^(?:个)/.test(unitText) ? '个' : /^(?:盒)/.test(unitText) ? '盒' : /^(?:完整袋|包)/.test(unitText) ? '包' : /^(?:份)/.test(unitText) ? '份' : '';
 return {id:String(row['食品ID']||`legacy-inventory-${index}`), name:String(row['名称']||'未命名食物'),
   unit:normalizedUnit || unitText || '单位未定', unitDescription:unitText,
   standard, nutritionBasis:per100?(is100ml?'per100ml':'per100g'):'perServing',
   qty:numeric(row['库存值']), pricePerUnit:numeric(row['单价(CNY)']),priceBasis:String(row['价格基准']||''),
   nutrition:{kcal:numeric(row.kcal),protein:numeric(row['P(g)']),carbs:numeric(row['C(g)']),fat:numeric(row['F(g)']),sodium:numeric(row['Na(mg)'])},
   note:String(row['备注']||''), active:row.active !== '否' && row.active !== false};
}
export function normalizeLedger(raw){
 if (!raw || !raw.tables || !Array.isArray(raw.tables.food_events) || !Array.isArray(raw.tables.weight_events) || !Array.isArray(raw.tables.food_inventory)) throw new Error('不是可识别的 health_tracker 主账 JSON（缺少必要表）');
 const result = newState();const t=raw.tables;
 for (const key of ['food_events','weight_events','food_inventory','daily_summaries','energy_balance','activity_events','rules']) {
  if (t[key] != null && (!Array.isArray(t[key]) || t[key].some(row=>!row || typeof row!=='object' || Array.isArray(row)))) throw Error('主账表格格式无效');
 }
 // Preserve the original source in the local/private backup for lossless archival.
 // Historical medical/audit/purchase details are not used by live UI calculations.
 result.legacy.sourceSnapshot = raw;
 result.importedAt=new Date().toISOString();
 result.importInfo={sourceVersion:String(raw.handoff_version||raw.schema_version||'unknown'),canonicalSource:String(raw.canonical_source||''),originalCounts:Object.fromEntries(['food_events','weight_events','activity_events','daily_summaries','energy_balance','food_inventory'].map(k=>[k, t[k]?.length || 0]))};
 result.legacy.foods=(t.food_events || []).map((r,i)=>({ id:`legacy-food-${i}`,date:String(r['日期']||''),time:String(r['时间']||''),meal:String(r['餐次']||''),name:String(r['食物/饮品']||''),foodId:String(r['食品ID']||''),portion:String(r['份量/重量']||''),status:String(r['状态']||''),actual:isActualStatus(r['状态'])&&validDate(String(r['日期']||'')),nutrition:Object.fromEntries(Object.entries(NUTRIENT_KEYS).map(([k,v])=>[k,numeric(r[v])])),cost:null,source:'legacy',qualityFlag:validDate(String(r['日期']||''))?null:'missing_date' }));
 result.legacy.weights=(t.weight_events||[]).map((r,i)=>({id:`legacy-weight-${i}`,date:String(r['日期']||''),kg:numeric(r['数值']),time:String(r['时间']||''),trendStatus:String(r['纳入趋势']||''),source:'legacy'})).filter(r=>validDate(r.date));
 result.legacy.activities=(t.activity_events||[]).map((r,i)=>({id:`legacy-activity-${i}`,date:String(r['日期']||''),name:String(r['项目']||r['类别']||''),km:numeric(r['距离(km)']),minutes:numeric(r['时长(min)']),kcal:numeric(r['活动消耗估计(kcal)']),status:String(r['状态']||''),source:'legacy',includedInBase:!/^(?:户外单车|夜骑|长骑)/.test(String(r['类别']||''))})).filter(r=>validDate(r.date));
 result.legacy.inventory=(t.food_inventory||[]).map(normalizeInventory).filter((item,index,items)=>items.findIndex(x=>x.id===item.id)===index);
 for (const r of t.daily_summaries||[]){const d=String(r['日期']||'');if (!validDate(d)) continue;result.legacy.daily[d]={
  date:d, nutrition:{kcal:numeric(r.kcal),protein:numeric(r['蛋白质(g)']),carbs:numeric(r['碳水(g)']),fat:numeric(r['脂肪(g)']),sodium:numeric(r['钠(mg)'])}, note:String(r['记录完整性']||'')
 }; }
 for (const r of t.energy_balance||[]){const d=String(r['饮食日期']||'');if (!validDate(d))continue;result.legacy.energy[d]={date:d,intake:numeric(r['摄入(kcal)']),tdee:numeric(r['估计总消耗(kcal)']),deficit:numeric(r['当日缺口(kcal)']),status:String(r['结算状态']||'')};}
 result.legacy.rules=(t.rules||[]).filter(r=>r['状态']==='active').map(r=>({key:r.Key,desc:r['说明'],value:r['当前值']}));
 const params=t.cycle_parameters ?? {};
 const findSetting=(...keys)=> {
  for (const key of keys) {
   const value=numeric(params[key] ?? result.legacy.rules.find(r=>r.key===key)?.value);
   if (value!==null && value>0) return value;
  }
  return null;
 };
 for (const [name,keys] of Object.entries({
   baselineTdee:['无运动基线TDEE','baselineTdee'],
   calorieTarget:['日摄入参考','日摄入参考(kcal)','每日摄入参考','每日摄入参考(kcal)','每日热量参考','热量目标','calorieTarget'],
   cycleTarget:['周期目标缺口','目标缺口(kcal)','cycleTarget', ...Object.keys(params).filter(k=>/^\d+天目标缺口/.test(k))]
 })) result.settings[name]=findSetting(...keys) ?? result.settings[name];
 const days=findSetting('周期天数','cycleDays');
 if (Number.isInteger(days) && days<=31) result.settings.cycleDays=days;
 const anchor=String(params['周期日期']||params['起始日期']||params.cycleAnchor||'').slice(0,10);if(validDate(anchor))result.settings.cycleAnchor=anchor;
 return result;
}
export function validateAppState(state){
 const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
 const rows = (list, check) => Array.isArray(list) && list.every(x => object(x) && check(x));
 const s = state?.settings, l = state?.legacy, m = state?.local;
 const nutrients = x => object(x) && NUTRIENTS.every(k => x[k] == null || Number.isFinite(x[k]));
 const food = x => typeof x.name === 'string' && typeof x.date === 'string' && nutrients(x.nutrition);
 const dated = x => validDate(x.date);
 const sku = x => typeof x.id === 'string' && typeof x.name === 'string' && typeof x.unit === 'string'
   && typeof x.standard === 'string' && typeof x.nutritionBasis === 'string' && nutrients(x.nutrition) && (x.qty === null || Number.isFinite(x.qty));
 return state?.appType === APP_SCHEMA && object(s) && object(l) && object(m)
   && validDate(s.cycleAnchor) && Number.isInteger(s.cycleDays) && s.cycleDays >= 1 && s.cycleDays <= 31
   && ['calorieTarget','baselineTdee','cycleTarget','proteinMin','proteinMax','fatMin','sodiumTarget'].every(k => Number.isFinite(s[k]) && s[k] >= 0)
   && (state.importedAt == null || typeof state.importedAt === 'string')
   && (state.importInfo == null || object(state.importInfo))
   && rows(l.foods, food) && rows(m.foods, x => food(x) && dated(x))
   && rows(l.weights, dated) && rows(m.weights, dated) && rows(l.activities, dated) && rows(m.activities, dated)
   && rows(l.inventory, sku) && rows(m.inventory ?? [], sku) && rows(m.stockMoves, x => dated(x) && Number.isFinite(x.delta))
   && rows(m.batches ?? [], x=>typeof x.id==='string' && typeof x.foodId==='string' && dated(x) && Number.isFinite(x.quantity) && x.quantity>0 && (x.costCents==null || Number.isSafeInteger(x.costCents) && x.costCents>=0))
   && rows(m.templates ?? [], x=>typeof x.name==='string' && Array.isArray(x.items) && x.items.every(food))
   && rows(m.purchases ?? [], x=>typeof x.id==='string' && dated(x) && Array.isArray(x.items) && Number.isSafeInteger(x.totalCents) && x.totalCents>=0)
   && (m.edits==null || object(m.edits) && ['foods','weights','activities'].every(k=>m.edits[k]==null || object(m.edits[k]) && Object.values(m.edits[k]).every(x=>x===null || object(x) && (k!=='foods' || food(x)) && dated(x))))
   && object(l.daily) && Object.values(l.daily).every(x => object(x?.nutrition))
   && object(l.energy) && Object.values(l.energy).every(object)
   && (state.revision === undefined || (Number.isSafeInteger(state.revision) && state.revision >= 0));
}
export function sampleNutrientSum(items){
 return Object.fromEntries(NUTRIENTS.map(k=>{
  const known=items.map(e=>numeric(e.nutrition?.[k])).filter(v=>v!==null);
  return [k,known.length?round(known.reduce((sum,v)=>sum+v,0),2):null];
 }));
}
export function events(state,key){
 const edits=state.local.edits?.[key] ?? {};
 return [...state.legacy[key].map(e=>Object.hasOwn(edits,e.id)?edits[e.id]:e).filter(Boolean),...state.local[key]];
}
const actualFood=e=>e.status==='actual' || (e.source==='legacy' && e.actual);
export function foodsForDay(state,date){return events(state,'foods').filter(e=>e.date===date&&actualFood(e));}
export function dayIntake(state,date){
 const legacy=state.legacy.foods.filter(e=>e.date===date&&e.actual);
 const summary={...state.legacy.daily[date]?.nutrition};
 summary.kcal??=state.legacy.energy[date]?.intake;
 const effective=foodsForDay(state,date);
 const originalIds=new Set(legacy.map(e=>e.id));
 const changes=effective.filter(e=>!originalIds.has(e.id) || Object.hasOwn(state.local.edits?.foods ?? {},e.id));
 const edits=state.local.edits?.foods ?? {};
 const removed=legacy.filter(e=>Object.hasOwn(edits,e.id));
 const summed=sampleNutrientSum(effective);
 const delta=sampleNutrientSum(changes);
 const subtract=sampleNutrientSum(removed);
 const incomplete=[];
 const totals=Object.fromEntries(NUTRIENTS.map(k=>{
  const base=numeric(summary[k]);
  if ((base===null ? effective : changes).some(e=>numeric(e.nutrition?.[k])===null) ||
      (base!==null && removed.some(e=>numeric(e.nutrition?.[k])===null))) incomplete.push(k);
  const adjusted=base===null?summed[k]:round(base+zero(delta[k])-zero(subtract[k]),2);
  if(adjusted!==null && adjusted<0){if(!incomplete.includes(k))incomplete.push(k);return [k,summed[k]];}
  return [k,adjusted];
 }));
 const costs=effective.map(e=>numeric(e.cost));
 return {reported:effective.length>0 || numeric(summary.kcal)!==null,totals,incomplete,
  cost:costs.some(x=>x!==null)?round(costs.reduce((a,b)=>a+zero(b),0),2):null,
  costPartial:costs.some(x=>x===null)};
}
export function mergedWeights(state){return events(state,'weights');}
export function latestWeights(state){
 const lastByDate=new Map();
 for (const w of mergedWeights(state)){
  if ((w.source==='legacy'&&allowWeight(w))||(w.source==='manual'&&w.isMorning)){lastByDate.set(w.date,w);}
 }
 return [...lastByDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function weightTrend(state){
 const all=latestWeights(state);const n=all.length;
 const last=all.slice(-7), previous=all.slice(-8,-1);
 const avg=arr=>arr.length?round(arr.reduce((s,x)=>s+x.kg,0)/arr.length,3):null;
 return {last:all[n-1]||null,points:all,last7:avg(last),previous7:previous.length===7?avg(previous):null,delta:previous.length===7?round(avg(last)-avg(previous),3):null};
}
export function energyForDay(state,date,today){
 const legacy=state.legacy.energy[date];
 const food=dayIntake(state,date);
 const activities=events(state,'activities').filter(e=>e.date===date&&!/计划|取消|作废/.test(e.status ?? ''));
 const totals=activities.filter(e=>e.energyKind==='total' && numeric(e.kcal)!==null);
 const deviceTotal=numeric(totals.at(-1)?.kcal);
 const extra=e=>!e.includedInBase && e.energyKind!=='total' && !/计划|取消|作废/.test(e.status ?? '')?zero(e.kcal):0;
 const importedTotal=numeric(legacy?.tdee);
 const previouslyIncluded=state.legacy.activities.filter(e=>e.date===date).reduce((sum,e)=>sum+extra(e),0);
 const currentExtra=activities.reduce((sum,e)=>sum+extra(e),0);
 const tdee=deviceTotal ?? (importedTotal===null? state.settings.baselineTdee+currentExtra : importedTotal+currentExtra-previouslyIncluded);
 const reported=food.totals.kcal!==null && !food.incomplete.includes('kcal') && !activities.some(e=>deviceTotal===null&&!e.includedInBase&&numeric(e.kcal)===null);
 const intake=food.totals.kcal;
 return {date,reported,closed:date<today&&reported,deficit:reported?round(tdee-intake,2):null,intake,tdee,
  source:deviceTotal!==null?'device_total':importedTotal!==null?'imported_energy_model':'base_tdee_estimate'};

}
export function cycleForDate(state,date,today){
 const settings=state.settings;const anchor=validDate(settings.cycleAnchor)?settings.cycleAnchor:'2026-01-01';const days=Math.max(1,Number(settings.cycleDays)||6);
 const numDays=utcDay(date)-utcDay(anchor);const shift=Math.floor(numDays/days)*days;const start=addDays(anchor,shift),end=addDays(start,days-1);
 const dates=Array.from({length:days},(_,i)=>addDays(start,i));const entries=dates.map(d=>energyForDay(state,d,today));const closed=entries.filter(e=>e.closed&&e.reported);
 const sum=round(closed.reduce((s,e)=>s+e.deficit,0),2);const goal=Number(settings.cycleTarget)||7700;
 return {start,end,dates,entries,closedDays:closed.length,days,unreported:entries.filter(e=>e.date<today&&!e.reported).length,
  deficit:sum,goal,progress:round(sum/goal*100,1),fatEquivalent:round(sum/7700,3),remaining:round(goal-sum,2)};
}
export function inventoryWithMoves(state){
 const adjusted=new Map();
 const opened=new Set();
 for(const move of state.local.stockMoves){
  if(move.opening)opened.add(move.foodId);
  adjusted.set(move.foodId,(adjusted.get(move.foodId)??0)+move.delta);
 }
 return [...state.legacy.inventory,...(state.local.inventory??[])].map(item=>({
  ...item,qty:item.qty===null&&!opened.has(item.id)?null:round(zero(item.qty)+(adjusted.get(item.id)??0),6)
 }));
}
export function batchBalances(state,foodId){
 const balances=new Map();
 for (const m of state.local.stockMoves) if (m.batchId) balances.set(m.batchId,(balances.get(m.batchId)??0)+m.delta);
 return (state.local.batches??[]).filter(b=>!foodId||b.foodId===foodId)
   .map(b=>({...b,remaining:round(balances.get(b.id)??0,6)}))
   .sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
}
export function makeId(prefix='local'){return prefix+'-'+crypto.randomUUID();}

function assertBalances(state,foodId) {
 const sku=inventoryWithMoves(state).find(x=>x.id===foodId);
 const batches=batchBalances(state,foodId);
 if (batches.some(b=>b.remaining<0) || sku?.qty!==null && sku?.qty < round(batches.reduce((n,b)=>n+b.remaining,0),6))
  throw Error('库存不足，或该批次已有消耗记录');
}
export function allocateStock(state,foodId,qty,batchId) {
 const sku=inventoryWithMoves(state).find(x=>x.id===foodId);
 if(!sku||sku.qty===null)throw Error('请先确认食品和库存实盘数量');
 if(qty>sku.qty+1e-6)throw Error('库存不足，当前剩余 '+sku.qty+' '+sku.unit);
 const allocations=[];
 let remaining=qty;
 const batches=batchBalances(state,foodId);
 // Previously imported stock has no batch date. Take it before dated lots.
 const loose=round(sku.qty-batches.reduce((n,b)=>n+b.remaining,0),6);
 if(!batchId && loose>0){
  const part=Math.min(remaining,loose);
  const unitPrice=numeric(sku.pricePerUnit);
  allocations.push({qty:part,costCents:unitPrice!==null&&sku.priceBasis===sku.unit?Math.round(part*unitPrice*100):null});
  remaining=round(remaining-part,6);
 }
 for(const b of batches){
  if(remaining<=0)break;
  if(b.remaining<=0 || batchId && b.id!==batchId)continue;
  const part=Math.min(remaining,b.remaining);
  // Allocate the remaining cost. Reversals return exactly the original cents.
  const allocated=state.local.stockMoves.filter(m=>m.batchId===b.id&&m.delta<0).reduce((n,m)=>n+(m.costCents??0),0);
  const cents=b.costCents==null?null:Math.round(part/b.remaining*(b.costCents-allocated));
  allocations.push({batchId:b.id,qty:part,costCents:cents});
  remaining=round(remaining-part,6);
 }
 if(remaining>1e-6)throw Error('选择的批次余量不足');
 return allocations;
}

export function addFood(state,fields,id) {
 const {date,meal,name,portion,cost,foodId,stockQty,batchId,status='actual',quality='label',uncertainty='',amount}=fields;
 if(!validDate(date)||!name?.trim()||!['actual','plan','cancelled'].includes(status))throw Error('请检查日期、食物名称和状态');
 const nutrition=Object.fromEntries(NUTRIENTS.map(k=>[k,numeric(fields[k])]));
 if(Object.values(nutrition).some(x=>x!==null&&x<0))throw Error('营养数值不能为负');
 const explicitCost=numeric(cost),qty=numeric(stockQty);
 if (explicitCost<0 || qty<0)throw Error('成本和份量不能为负');
 const previous=events(state,'foods').find(e=>e.id===id);
 if(id && !previous)throw Error('记录已更新，请刷新');
 const createdAt=previous?.createdAt ?? new Date().toISOString();
 const entry={id:id??makeId('food'),source:'manual',date,meal,name:name.trim(),portion:portion||'',status,nutrition,
  foodId:foodId||null,stockQty:qty,amount:numeric(amount),batchId:batchId||null,createdAt,quality,uncertainty,cost:explicitCost};
 const oldMoves=state.local.stockMoves;
 state.local.stockMoves=oldMoves.filter(m=>m.linkedFoodId!==entry.id);
 try{
  const affected=new Set(oldMoves.filter(m=>m.linkedFoodId===entry.id).map(m=>m.foodId));
  if(status==='actual'&&foodId&&qty>0){
   const parts=allocateStock(state,foodId,qty,batchId);
   const cents=parts.some(p=>p.costCents===null)?null:parts.reduce((sum,p)=>sum+p.costCents,0);
   entry.cost=explicitCost??(cents===null?null:cents/100);
   for(const part of parts)state.local.stockMoves.push({id:makeId('stock'),foodId,delta:-part.qty,batchId:part.batchId,
     date,linkedFoodId:entry.id,reason:'实际摄入',costCents:part.costCents,createdAt});
   affected.add(foodId);
  }
  for(const affectedId of affected)assertBalances(state,affectedId);
 }catch(err){state.local.stockMoves=oldMoves;throw err;}
 if(previous?.id.startsWith('legacy-food-'))saveLegacyEdit(state,'foods',previous.id,entry);
 else state.local.foods=[...state.local.foods.filter(e=>e.id!==entry.id),entry];
 return entry;
}
function saveLegacyEdit(state,key,id,entry) {
 ((state.local.edits??={})[key]??={})[id]=entry;
}
export function recordEvent(state,key,item,id) {
 if(id && !events(state,key).some(e=>e.id===id))throw Error('记录已更新，请刷新');
 const entry={...item,id:id??makeId(key),createdAt:new Date().toISOString(),source:'manual'};
 if(id && state.legacy[key].some(e=>e.id===id))saveLegacyEdit(state,key,id,entry);
 else state.local[key]=[...state.local[key].filter(e=>e.id!==entry.id),entry];
 return entry;
}
export function deleteEvent(state,key,id) {
 const moves=state.local.stockMoves.filter(m=>m.linkedFoodId===id);
 if(key==='foods'){
  const previous=state.local.stockMoves;
  state.local.stockMoves=previous.filter(m=>m.linkedFoodId!==id);
  try {for(const m of moves)assertBalances(state,m.foodId);}catch(err){state.local.stockMoves=previous;throw err;}
 }
 if(state.legacy[key].some(e=>e.id===id))saveLegacyEdit(state,key,id,null);
 else state.local[key]=state.local[key].filter(e=>e.id!==id);
}
export function localStockChange(state,{foodId,delta,date,reason,batchId,count=false}){
 const item=inventoryWithMoves(state).find(x=>x.id===foodId);
 const value=numeric(delta);
 if(!item||!validDate(date)||value===null || count&&value<0)throw Error('请检查库存变更字段');
 if(item.qty===null && !count)throw Error('请先登记实盘库存');
 const opening=item.qty===null;
 const knownMoves=opening?state.local.stockMoves.filter(m=>m.foodId===foodId).reduce((n,m)=>n+m.delta,0):0;
 const change=count?round(value-(item.qty??knownMoves),6):value;
 if(change===0&&!opening)throw Error('库存数量没有变化');
 const parts=change<0?allocateStock(state,foodId,-change,batchId).map(p=>({delta:-p.qty,batchId:p.batchId,costCents:p.costCents})): [{delta:change}];
 const actionId=makeId('movement');
 const moves=parts.map(p=>({...p,id:makeId('stock'),actionId,foodId,date,opening,reason:reason||(count?'盘点':'库存调整'),createdAt:new Date().toISOString()}));
 state.local.stockMoves.push(...moves);
 try {assertBalances(state,foodId);}catch(err){state.local.stockMoves.splice(-moves.length);throw err;}
 return moves[0];
}
export function suggestNutritionByInventory(item,amount){
 const a=numeric(amount);if(a===null||a<=0)return null;
 const multiplier=a/(item.basisAmount ?? (item.nutritionBasis.startsWith('per100') ? 100 : 1));
 return Object.fromEntries(NUTRIENTS.map(k=>[k,numeric(item.nutrition?.[k])===null ? null : round(item.nutrition[k]*multiplier,2)]));
}