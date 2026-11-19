/** Airplane Health — deterministic domain logic. No third-party libraries. */
export const APP_SCHEMA = 'airplane-health-v1';
export const DEFAULT_SETTINGS = Object.freeze({
  calorieTarget: 2000, proteinMin: 100, proteinMax: 160,
  fatMin: 40, sodiumTarget: 2000, baselineTdee: 2200,
  cycleDays: 7, cycleTarget: 3500, cycleAnchor: '2026-01-01'
});
export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'sodium'];
const NUTRIENT_KEYS = {kcal:'kcal', protein:'蛋白质(g)', carbs:'碳水(g)', fat:'脂肪(g)', sodium:'钠(mg)'};
const val = x => (x === null || x === undefined || x === '' ? null : Number(x));
export const numeric = x => { const n = val(x); return n !== null && Number.isFinite(n) ? n : null; };
export const zero = x => numeric(x) ?? 0;
export const round = (v, digits=1) => Number((v || 0).toFixed(digits));
export const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
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
 const is100g = /(?:每)?100\s*g|100g/.test(standard) && !/100g\/包/.test(standard);
 const is100ml = /100\s*m[Ll]|100毫升/.test(standard);
 const per100 = is100g || is100ml;
 const normalizedUnit = /^(?:g|克)/.test(unitText) ? 'g' : /^(?:mL|ml|毫升)/i.test(unitText) ? 'mL' : /^(?:个)/.test(unitText) ? '个' : /^(?:盒)/.test(unitText) ? '盒' : /^(?:完整袋|包)/.test(unitText) ? '包' : /^(?:份)/.test(unitText) ? '份' : '';
 return {id:String(row['食品ID']||`legacy-inventory-${index}`), name:String(row['名称']||'未命名食物'),
   unit:normalizedUnit || unitText || '单位未定', unitDescription:unitText,
   standard, nutritionBasis:per100?(is100ml?'per100ml':'per100g'):'perServing',
   qty:numeric(row['库存值']), pricePerUnit:numeric(row['单价(CNY)']),priceBasis:String(row['价格基准']||''),
   nutrition:{kcal:zero(row.kcal),protein:zero(row['P(g)']),carbs:zero(row['C(g)']),fat:zero(row['F(g)']),sodium:zero(row['Na(mg)'])},
   note:String(row['备注']||''), active:row.active !== '否'};
}
export function normalizeLedger(raw){
 if (!raw || !raw.tables || !Array.isArray(raw.tables.food_events) || !Array.isArray(raw.tables.weight_events) || !Array.isArray(raw.tables.food_inventory)) throw new Error('不是可识别的 health_tracker 主账 JSON（缺少必要表）');
 const result = newState();const t=raw.tables;
 // Preserve the original source in the local/private backup for lossless archival.
 // Historical medical/audit/purchase details are not used by live UI calculations.
 result.legacy.sourceSnapshot = raw;
 result.importedAt=new Date().toISOString();
 result.importInfo={sourceVersion:String(raw.handoff_version||raw.schema_version||'unknown'),canonicalSource:String(raw.canonical_source||''),originalCounts:Object.fromEntries(['food_events','weight_events','activity_events','daily_summaries','energy_balance','food_inventory'].map(k=>[k, t[k]?.length || 0]))};
 result.legacy.foods=(t.food_events || []).map((r,i)=>({ id:`legacy-food-${i}`,date:String(r['日期']||''),time:String(r['时间']||''),meal:String(r['餐次']||''),name:String(r['食物/饮品']||''),foodId:String(r['食品ID']||''),portion:String(r['份量/重量']||''),status:String(r['状态']||''),actual:isActualStatus(r['状态'])&&validDate(String(r['日期']||'')),nutrition:Object.fromEntries(Object.entries(NUTRIENT_KEYS).map(([k,v])=>[k,zero(r[v])])),cost:null,source:'legacy',qualityFlag:validDate(String(r['日期']||''))?null:'missing_date' }));
 result.legacy.weights=(t.weight_events||[]).map((r,i)=>({id:`legacy-weight-${i}`,date:String(r['日期']||''),kg:numeric(r['数值']),time:String(r['时间']||''),trendStatus:String(r['纳入趋势']||''),source:'legacy'})).filter(r=>validDate(r.date));
 result.legacy.activities=(t.activity_events||[]).map((r,i)=>({id:`legacy-activity-${i}`,date:String(r['日期']||''),name:String(r['项目']||r['类别']||''),km:numeric(r['距离(km)']),minutes:numeric(r['时长(min)']),kcal:numeric(r['活动消耗估计(kcal)']),status:String(r['状态']||''),source:'legacy',includedInBase:!/^(?:户外单车|夜骑|长骑)/.test(String(r['类别']||''))})).filter(r=>validDate(r.date));
 result.legacy.inventory=(t.food_inventory||[]).map(normalizeInventory);
 for (const r of t.daily_summaries||[]){const d=String(r['日期']||'');if (!validDate(d)) continue;result.legacy.daily[d]={
  date:d, nutrition:{kcal:numeric(r.kcal),protein:numeric(r['蛋白质(g)']),carbs:numeric(r['碳水(g)']),fat:numeric(r['脂肪(g)']),sodium:numeric(r['钠(mg)'])}, note:String(r['记录完整性']||'')
 }; }
 for (const r of t.energy_balance||[]){const d=String(r['饮食日期']||'');if (!validDate(d))continue;result.legacy.energy[d]={date:d,intake:numeric(r['摄入(kcal)']),tdee:numeric(r['估计总消耗(kcal)']),deficit:numeric(r['当日缺口(kcal)']),status:String(r['结算状态']||'')};}
 result.legacy.rules=(t.rules||[]).filter(r=>r['状态']==='active').map(r=>({key:r.Key,desc:r['说明'],value:r['当前值']}));
 if (numeric(t.cycle_parameters?.['无运动基线TDEE']))result.settings.baselineTdee=Number(t.cycle_parameters['无运动基线TDEE']);
 if (numeric(t.cycle_parameters?.['6天目标缺口']))result.settings.cycleTarget=Number(t.cycle_parameters['6天目标缺口']);
 if (numeric(t.cycle_parameters?.['周期天数']))result.settings.cycleDays=Number(t.cycle_parameters['周期天数']);
 const anchor=String(t.cycle_parameters?.['周期日期']||'').slice(0,10);if(validDate(anchor))result.settings.cycleAnchor=anchor;
 return result;
}
export function validateAppState(state){
 return state?.appType===APP_SCHEMA && state?.legacy && state?.local && Array.isArray(state.local.foods) && Array.isArray(state.legacy.inventory);
}
export function sampleNutrientSum(items){return Object.fromEntries(NUTRIENTS.map(k=>[k,round(items.reduce((s,e)=>s+zero(e?.nutrition?.[k]),0),2)]));}
export function foodsForDay(state,date){return [...state.legacy.foods.filter(e=>e.actual && e.date===date),...state.local.foods.filter(e=>e.status==='actual'&&e.date===date)];}
export function dayIntake(state,date){
 const manual=state.local.foods.filter(e=>e.status==='actual'&&e.date===date);
 const legacy=state.legacy.daily[date]?.nutrition;
 const legacyFoods=state.legacy.foods.filter(e=>e.actual&&e.date===date);
 const legacyTotals=legacy && numeric(legacy.kcal)!==null ? legacy : sampleNutrientSum(legacyFoods);
 const totals=sampleNutrientSum(manual);
 const result=Object.fromEntries(NUTRIENTS.map(k=>[k,(numeric(legacyTotals[k])===null && !manual.length) ? null : round(zero(legacyTotals[k])+zero(totals[k]),2)]));
 const reported = numeric(legacy?.kcal)!==null || legacyFoods.length>0 || manual.length>0;
 return {reported,totals:result,legacySource:numeric(legacy?.kcal)!==null?'daily_summary':'item_sum',manualCount:manual.length};
}
export function mergedWeights(state){return [...state.legacy.weights,...state.local.weights];}
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
 const hasManual=state.local.foods.some(e=>e.date===date&&e.status==='actual') || state.local.activities.some(e=>e.date===date);
 const legacy=state.legacy.energy[date];const hasLegacy=!!legacy&&numeric(legacy.intake)!==null;
 const food=dayIntake(state,date);
 if(!food.reported && !hasLegacy)return {date,reported:false,closed:false,deficit:null,intake:null,tdee:null,source:'missing'};
 const manualAdditional=state.local.activities.filter(e=>e.date===date&&!e.includedInBase).reduce((s,e)=>s+zero(e.kcal),0);
 const intake=food.reported?zero(food.totals.kcal):zero(legacy?.intake);
 const tdee=(hasLegacy?zero(legacy.tdee):zero(state.settings.baselineTdee)) + manualAdditional;
 return {date,reported:true,closed:date<today,intake,tdee,deficit:round(tdee-intake,2),source:hasLegacy?'imported_energy_model':'base_tdee_estimate',hasManual};
}
export function cycleForDate(state,date,today){
 const settings=state.settings;const anchor=validDate(settings.cycleAnchor)?settings.cycleAnchor:'2026-01-01';const days=Math.max(1,Number(settings.cycleDays)||6);
 const numDays=utcDay(date)-utcDay(anchor);const shift=Math.floor(numDays/days)*days;const start=addDays(anchor,shift),end=addDays(start,days-1);
 const dates=Array.from({length:days},(_,i)=>addDays(start,i));const entries=dates.map(d=>energyForDay(state,d,today));const closed=entries.filter(e=>e.closed&&e.reported);
 const sum=round(closed.reduce((s,e)=>s+e.deficit,0),2);const goal=Number(settings.cycleTarget)||7700;
 return {start,end,dates,entries,closedDays:closed.length,days,unreported:entries.filter(e=>e.closed&&!e.reported).length,
  deficit:sum,goal,progress:round(sum/goal*100,1),fatEquivalent:round(sum/7700,3),remaining:round(goal-sum,2)};
}
export function inventoryWithMoves(state){
 const adjusted=new Map();for(const m of state.local.stockMoves){if(!adjusted.has(m.foodId)) adjusted.set(m.foodId,0);adjusted.set(m.foodId,adjusted.get(m.foodId)+zero(m.delta));}
 return state.legacy.inventory.map(i=>({...i,qty:i.qty===null?null:round(i.qty+(adjusted.get(i.id)||0),3)}));
}
export function makeId(prefix='local'){return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;}
export function addFood(state,{date,meal,name,portion,kcal,protein,carbs,fat,sodium,cost,foodId,stockQty,status='actual'}){
 if(!validDate(date)||!name?.trim()) throw new Error('请输入有效日期和食物名称');
 for(const x of [kcal,protein,carbs,fat,sodium]) if(numeric(x)===null||Number(x)<0) throw new Error('热量与营养数值必须是非负数字');
 const entry={id:makeId('food'),source:'manual',date,meal, name:name.trim(),portion:portion||'',status,
 nutrition:{kcal:+kcal,protein:+protein,carbs:+carbs,fat:+fat,sodium:+sodium},cost:numeric(cost),foodId:foodId||null,createdAt:new Date().toISOString()};
 const qty=numeric(stockQty);
 if(status==='actual'&&foodId&&qty!==null&&qty>0){
   const item=inventoryWithMoves(state).find(x=>x.id===foodId);
   if(!item)throw new Error('找不到库存商品');
   if(item.qty!==null && item.qty + 1e-5 < qty)throw new Error(`库存不足：仅剩${item.qty} ${item.unit}`);
   state.local.stockMoves.push({id:makeId('stock'),foodId,delta:-qty,reason:`进食：${name}`,date,linkedFoodId:entry.id,createdAt:new Date().toISOString()});
 }
 state.local.foods.push(entry);
 return entry;
}
export function localStockChange(state,{foodId,delta,date,reason}){
 const item=inventoryWithMoves(state).find(x=>x.id===foodId);if(!item)throw new Error('未知食品');
 if(numeric(delta)===null||Number(delta)===0)throw new Error('请输入非零库存变化');
 if(item.qty!==null && item.qty+Number(delta)<-1e-6)throw new Error('不能扣减超过现有库存');
 const e={id:makeId('stock'),foodId,delta:+delta,date,reason:reason||'手动盘点修正',createdAt:new Date().toISOString()};
 state.local.stockMoves.push(e);return e;
}
export function suggestNutritionByInventory(item,amount){
 const a=numeric(amount);if(a===null||a<=0)return null;
 const multiplier=item.nutritionBasis.startsWith('per100') ? a/100 : a;
 return Object.fromEntries(NUTRIENTS.map(k=>[k,round(zero(item.nutrition?.[k])*multiplier,2)]));
}