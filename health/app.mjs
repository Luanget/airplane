import {bindDayPicker,displayDay,localDate as dateNow,localClock,normalizeClock,syncCalendarFields} from '../calendar.mjs';
import {attachShopping} from './shopping.mjs';
import {attachPurchases} from './purchase-ui.mjs';
import {attachCombinedBackup,combinedBackup} from './backup.mjs';
import {addBatch,convertCookingWeight,displayStockQuantity,measuredGrams,saveSku,splitBatch,stockAlerts,stockMeasure,storedStockQuantity} from './inventory.mjs';
import {units} from './contract.mjs';
import {quantityInUnit,basis,packageInfo} from './candidates.mjs';
import {shellGlyphs} from '../shell.mjs';
import {checkForAppUpdate} from '../updates.mjs';
import {newState,normalizeLedger,validateAppState,DEFAULT_SETTINGS,numeric,makeId,addFood,localStockChange,dayIntake,energyForDay,cycleForDate,weightTrend,foodsForDay,inventoryWithMoves,suggestNutritionByInventory,validDate,NUTRIENTS,events,recordEvent,deleteEvent,batchBalances,addDays,isStockReference,importedDietTargets,carbReference} from './core.mjs';
import {readState,saveState,exportState} from './storage.mjs';
import {mealOrder,timelineGroup,eatingState,stockName,stockUnit,stockGroups} from './presentation.mjs';
import {renderWeightChart} from './weight-chart.mjs';
const $=id=>document.getElementById(id);
const E=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=(v,d=0)=> v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
let state=newState(), selectedDate=dateNow(),tab='overview',toastHandle;
let renderedDiet=null,renderedMonth='';
const editing={};
const dirtyEntries=new Set();
let activeEntryType='food';
let updatePurchases=()=>{},updateShopping=()=>{};
let importPreview=null,importVersion=0;
const settingKeys=['calorieTarget','baselineTdee','cycleTarget','cycleDays','cycleAnchor','proteinMin','proteinMax','fatMin','sodiumTarget'];
function toast(message){
 const t=$('toast'),sheet=Array.from(document.querySelectorAll('.health-sheet[open]')).at(-1);
 (sheet??document.body).append(t);t.textContent=String(message);t.hidden=false;
 clearTimeout(toastHandle);toastHandle=setTimeout(()=>{t.hidden=true;},3500);
}
function text(id,value){$(id).textContent=String(value);}
function switchTab(next){
 if(next!=='trends'&&location.hash==='#trends')history.replaceState(null,'',location.pathname+location.search);
 tab=next;
 document.querySelectorAll('[data-tab]').forEach(x=>{
  const current=x.dataset.tab===next||next==='trends'&&x.dataset.tab==='overview';
  x.classList.toggle('active',current);
  if(current)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');
 });
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==`view-${next}`));
 render();window.scrollTo({top:0,behavior:'instant'});
}
function render(){
 if(tab==='overview')renderOverview();
 if(tab==='inventory'){updatePurchases();updateShopping();renderInventory();}
 if(tab==='trends')renderTrends();
 if($('health-settings-sheet').open)renderSettings();
 syncCalendarFields();
}
function selectEntry(type){
 activeEntryType=type;
 document.querySelectorAll('[data-entry]').forEach(b=>{
  const selected=b.dataset.entry===type;
  b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));
 });
 document.querySelectorAll('[data-entry-panel]').forEach(panel=>panel.hidden=panel.dataset.entryPanel!==type);
 syncEntryMode();
}
function syncEntryMode(){
 const editingRow=!!editing[activeEntryType];
 text('health-entry-title',editingRow?'编辑记录':'记一笔');
 $('delete-health-entry').hidden=!editingRow;
 $('confirm-delete-health').hidden=true;
 $('meal-templates').hidden=!!editing.food||!(state.local.templates?.length);
}
function openEntry(){
 for(const type of Object.keys(historyTypes)){
  const form=$(`${type}-form`);
  if(editing[type])resetEditor(form,type);
  if(!dirtyEntries.has(type)){
   form.elements.date.value=selectedDate;form.elements.time.value=selectedDate===dateNow()?localClock():'';
  }
 }
 selectEntry(activeEntryType);syncCalendarFields($('health-entry'));$('health-entry').showModal();
}
function openSettings(){
 $('template-settings').elements.date.value=selectedDate;
 renderSettings();syncCalendarFields($('health-settings-sheet'));$('health-settings-sheet').showModal();
}
function progress(id,val){$(id).style.width=`${Math.max(0,Math.min(100,Number(val)||0))}%`;}
function carbLabel(settings){
 const target=carbReference(settings);
 return target?(target.low===target.high?target.low:target.low+'–'+target.high)+' g':'';
}
function renderOverview(){
 const today=dateNow(),intake=dayIntake(state,selectedDate),cals=intake.totals.kcal,known=intake.reported;
 const goal=state.settings.calorieTarget,energy=energyForDay(state,selectedDate,today);
 $('report-date').value=selectedDate;
 text('today-status',selectedDate<today?(energy.closed?'已结算':known?'数据待补':'缺少记录'):selectedDate===today?'当天待结算':'未来日期');
 text('hero-calories',known?fmt(cals,1):'—'); text('hero-goal',`目标 ${fmt(goal)} kcal`);
 syncCalendarFields($('report-date').parentElement);
 text('hero-remaining',cals!==null&&!intake.incomplete.includes('kcal')?(goal-cals>=0?`剩余 ${fmt(goal-cals,1)} kcal`:`超出 ${fmt(cals-goal,1)} kcal`):'摄入数据待补');progress('cal-progress',known?cals/goal*100:0);
 for (const [id,key,unit] of [['protein-stat','protein','g'],['fat-stat','fat','g'],['carbs-stat','carbs','g'],['sodium-stat','sodium','mg']])text(id,intake.totals[key]===null?'—':`${fmt(intake.totals[key],1)} ${unit}`);
 text('protein-goal',`目标 ${state.settings.proteinMin}–${state.settings.proteinMax}g`);text('fat-goal',`目标 ≥${state.settings.fatMin}g`);text('sodium-goal',`参考 ${state.settings.sodiumTarget} mg`);
 const diet=importedDietTargets(state.legacy.rules);
 const fromImport=Object.keys(diet).length&&!state.settings.dietCustomized&&
  ['calorieTarget','proteinMin','proteinMax','fatMin'].every(key=>state.settings[key]===DEFAULT_SETTINGS[key]);
 const carbs=carbLabel(fromImport?{...state.settings,...diet}:state.settings);
 text('carbs-goal',carbs?(fromImport?'按主账约 ':'普通日约 ')+carbs:'请核对营养目标');
 const weights=weightTrend(state);text('weight-stat',weights.last?`${fmt(weights.last.kg,1)} kg`:'—');text('weight-date',weights.last?displayDay(weights.last.date):'尚未录入');text('weight-average',weights.last7!==null?`${fmt(weights.last7,1)} kg`:'—');text('weight-trend',weights.delta!==null?`滚动变化 ${weights.delta>=.05?'+':''}${fmt(weights.delta,1)} kg`:'需至少8次有效晨重');
 renderWeightChart($('weight-chart'),$('weight-chart-value'),weights.points.slice(-14));
 text('cycle-title',state.settings.cycleDays===6?'六天减脂周期':state.settings.cycleDays+' 天减脂周期');
 const cycle=cycleForDate(state,selectedDate,today);text('cycle-range',`${displayDay(cycle.start)} — ${displayDay(cycle.end)} · ${cycle.closedDays}/${cycle.days}天已封账`);text('cycle-deficit',`${fmt(cycle.deficit)} kcal`);progress('cycle-progress',cycle.progress);text('cycle-pct',`目标完成 ${fmt(cycle.progress,1)}% / ${fmt(cycle.goal)} kcal`);text('cycle-equivalent',`理论脂肪当量 ${fmt(cycle.fatEquivalent,3)} kg`);text('cycle-note',cycle.unreported?`有 ${cycle.unreported} 天缺少有效进食记录，未按零摄入推算；消耗和外食热量均为估算。`:'已过日期根据现有记录自动封账。可补报更正，估算并不等于实测。');
 renderTimeline();
}
function setDateDefaults(){document.querySelectorAll('form input[name=date]').forEach(el=>{if(!el.value)el.value=dateNow();});}
const historyTypes={food:'foods',weight:'weights',activity:'activities'};
function renderTimeline(){
 const month=selectedDate.slice(0,7);
 if(renderedDiet===state&&renderedMonth===month)return;
 renderedDiet=state;renderedMonth=month;
 text('health-history-period',month.slice(0,4)+'年'+Number(month.slice(5))+'月');
 $('local-events').innerHTML=[...monthGroups(['food'],month)].map(([date,rows])=>{
  const meals=new Map();
  for(const row of rows){
   const label=timelineGroup(row);
   if(!meals.has(label))meals.set(label,[]);
   meals.get(label).push(row);
  }
  return `<div class="day-group"><div class="day-head">${dayLabel(date)}</div>${mealOrder.filter(label=>meals.has(label)).map(label=>
   `<section class="meal-group" aria-label="${label}"><h3>${label}</h3><div class="card transaction-list">${meals.get(label).map(dietRow).join('')}</div></section>`
  ).join('')}</div>`;
 }).join('')||'<div class="card event-empty health-ledger-empty">本月暂无饮食</div>';
}
function dayLabel(date){return date?displayDay(date):'日期待补';}
function monthGroups(types,month){
 const entries=types.flatMap(type=>events(state,historyTypes[type])
  .filter(e=>String(e.date??'').startsWith(month)||!validDate(e.date)&&month===dateNow().slice(0,7))
  .map(e=>({...e,type}))).sort((a,b)=>
  String(b.date??'').localeCompare(String(a.date??''))||normalizeClock(b.time).localeCompare(normalizeClock(a.time))
  ||String(b.createdAt??'').localeCompare(String(a.createdAt??'')));
 const groups=new Map();
 for(const row of entries){
  const date=validDate(row.date)?row.date:'';
  if(!groups.has(date))groups.set(date,[]);
  groups.get(date).push(row);
 }
 return groups;
}
function dietRow(row){
 const status=eatingState(row);
 const badge={plan:'计划',cancelled:'已取消',unknown:'待确认'}[status];
 const nutrients=[['kcal','','kcal'],['protein','蛋白','g'],['fat','脂肪','g'],['carbs','碳水','g'],['sodium','钠','mg']];
 const values=status==='actual'?nutrients.map(([key,label,unit])=>{
  const amount=row.nutrition?.[key];
  const output=amount==null?'—':fmt(amount,1)+' '+unit;
  return `<span>${label?label+' ':''}${output}</span>`;
 }).join(''):'';
 return `<button type="button" class="tx-row tx-row-interactive health-tx-row diet-row" data-edit-id="${E(row.id)}" data-type="food">
  <span class="diet-main"><span class="tx-title">${E(row.name)}</span>${badge?`<span class="diet-status">${badge}</span>`:''}</span>
  ${values?`<span class="diet-nutrients">${values}</span>`:''}
 </button>`;
}
function timelineRow(row){
 const {type}=row,weight=type==='weight';
 const title=weight?(row.isMorning||/^(是|纳入|暂定纳入)/.test(row.trendStatus??'')?'晨重':'称重'):row.name;
 const icon=weight?'chart':'activity';
 const kcal=row.nutrition?.kcal??row.kcal;
 const amount=weight?fmt(row.kg,1)+' kg':kcal==null?'':fmt(kcal,1)+' kcal';
 return `<button type="button" class="tx-row tx-row-interactive health-tx-row" data-edit-id="${E(row.id)}" data-type="${type}">
  <span class="category-symbol"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shellGlyphs[icon]}</svg></span>
  <span class="tx-main"><span class="tx-title">${E(title)}</span></span>
  <span class="health-tx-value"><span class="tx-money">${E(amount)}</span><span class="tx-time">${normalizeClock(row.time)}</span></span>
 </button>`;
}
function editEvent(type,id){
 const row=events(state,historyTypes[type]).find(e=>e.id===id);
 if(!row)return;
 const form=$(`${type}-form`);
 editing[type]=id;
 form.reset();
 if(type==='food'){
  const picker=form.elements.foodId,original=inventoryWithMoves(state).find(item=>item.id===row.foodId);
  if(original&&![...picker.options].some(option=>option.value===original.id))
   picker.add(new Option(original.name,original.id));
  const status=eatingState(row);
  fillForm(form,{...row,...row.nutrition,status:status==='unknown'?'cancelled':status});
  setFoodUnit(original,row.amountUnit??(row.amount&&original?basis(original)[1]:foodEntryUnit(original)));
  if(original)form.elements.stockQty.value=displayStockQuantity(original,row.stockQty)??'';
  updateBatches();
  form.elements.batchId.value=row.batchId??'';
  $('food-editing').hidden=$('cancel-food-edit').hidden=false;showFoodSummary();
 }else {
  fillForm(form,row);
  if(type==='weight')form.elements.isMorning.checked=!!(row.isMorning??/^(是|纳入|暂定纳入)/.test(row.trendStatus??''));
  if(type==='activity')form.elements.includedInBase.checked=!!row.includedInBase;
 }
 selectEntry(type);
 syncCalendarFields(form);
 if(!$('health-entry').open)$('health-entry').showModal();
}
function fillForm(form,fields){
 for(const [key,value] of Object.entries(fields)){
  const el=form.elements.namedItem(key);
  if(el&&el.type!=='checkbox')el.value=el.type==='time'?normalizeClock(value):value??'';
 }
}
function renderTrends(){
 const today=dateNow(), cycle=cycleForDate(state,today,today);
 const points=weightTrend(state).points;
 renderWeightChart($('weight-detail-chart'),$('weight-detail-value'),points);
 $('body-events').innerHTML=[...monthGroups(['weight','activity'],selectedDate.slice(0,7))].map(([date,rows])=>
  `<div class="day-group"><div class="day-head">${dayLabel(date)}</div>${rows.map(timelineRow).join('')}</div>`
 ).join('')||'<p class="muted">本月暂无称重或运动。</p>';
 const kilos=new Map(points.map(e=>[e.date,e.kg]));
 $('trend-days').innerHTML=`<p>本周期缺口 ${fmt(cycle.deficit)} kcal · 已结算 ${cycle.closedDays}/${cycle.days} 天</p>`+Array.from({length:14},(_,i)=>{
  const date=addDays(today,-i),intake=dayIntake(state,date),e=energyForDay(state,date,today);
  return `<div class="event-row"><div class="event-main"><strong>${displayDay(date)} · 晨重 ${fmt(kilos.get(date),2)} kg</strong><small>摄入 ${intake.incomplete.includes('kcal')?'≥ ':''}${fmt(intake.totals.kcal)} kcal · 蛋白质 ${fmt(intake.totals.protein,1)} g · 碳水 ${fmt(intake.totals.carbs,1)} g · 脂肪 ${fmt(intake.totals.fat,1)} g · 钠 ${fmt(intake.totals.sodium)} mg</small><small>${e.closed?'缺口 '+fmt(e.deficit)+' kcal':date===today?'待结算':'待补数据'} · 饮食成本 ${intake.cost===null?'未知':(intake.costPartial?'已知部分 ':'')+'¥'+fmt(intake.cost,2)}</small></div></div>`;
 }).join('');
}
function renderInventory(){
 const filter=$('inventory-search').value.trim().toLowerCase(),stock=inventoryWithMoves(state);
 const list=stock.filter(i=>i.active&&i.qty!==0&&!isStockReference(i)&&(i.name.toLowerCase().includes(filter)||i.id.toLowerCase().includes(filter)));
 const groups=stockGroups(list),known=groups.filter(g=>g.rows.some(i=>i.qty!==null)),unknown=groups.filter(g=>g.rows.every(i=>i.qty===null));
 function renderGroups(entries){
  const button=(row,label,secondary='')=>`<button type="button" class="inv-row inventory-food" data-sku-edit="${E(row.id)}" aria-label="${E(label)}">
   <span class="stock-name"><strong>${E(label)}</strong>${secondary?`<small>${E(secondary)}</small>`:''}</span>
   ${row.qty===null?(secondary?'<span class="stock-qty">数量未知</span>':''):`<span class="stock-qty ${row.qty<0?'low':''}">${fmtStock(row)}</span>`}</button>`;
  return entries.map(({name,rows})=>rows.length===1?button(rows[0],name):
   `<details class="stock-group"><summary><strong>${E(name)}</strong><small>${rows.length} 条记录</small></summary>
    ${rows.map(row=>button(row,row.name,row.standard)).join('')}</details>`).join('');
 }
 $('inventory-list').innerHTML=renderGroups(known)||'<div class="event-empty">没有匹配的在库食品</div>';
 $('unknown-stock').hidden=!unknown.length;
 text('unknown-stock-title','数量未记录 · '+unknown.length+' 项');
 $('unknown-stock-list').innerHTML=renderGroups(unknown);
 const batches=batchBalances(state), byId=new Map(stock.map(s=>[s.id,s]));
 const alerts=stockAlerts(state,dateNow());
 const alertText=[...alerts.low.filter(s=>s.qty>0).map(s=>stockName(s)+' 库存偏低'),...alerts.expiry.map(b=>byId.get(b.foodId)?.name+' 到期 '+displayDay(b.expires))].join(' · ');
 $('stock-alerts').textContent=alertText;$('stock-alerts').hidden=!alertText;
 $('batch-list').innerHTML=batches.filter(b=>b.remaining>0).map(b=>`<p>${E(byId.get(b.foodId)?.name)} · ${E(displayDay(b.date))} · ${fmtStock(byId.get(b.foodId),b.remaining)} · ${b.costCents===null?'成本未知':('批次成本 ¥'+fmt(b.costCents/100,2))}${b.parent?' · 分装':''}</p>`).join('');
 $('stock-history').innerHTML=state.local.stockMoves.slice(-40).reverse().map(m=>`<div class="event-row"><span>${E(displayDay(m.date))}${normalizeClock(m.time)?' '+normalizeClock(m.time):''} · ${E(byId.get(m.foodId)?.name)} · ${E(m.reason)}</span><strong>${m.delta>0?'+':''}${fmtStock(byId.get(m.foodId),m.delta)}</strong></div>`).join('');

}
function fmtStock(sku,quantity=sku?.qty){
 const value=displayStockQuantity(sku,quantity),unit=stockUnit(stockMeasure(sku).unit);
 return value==null?'—':Number(value.toFixed(3))+' '+E(unit);
}
function renderSettings(){
 const s=state.settings, form=$('settings-form');for(const k of settingKeys)form.elements[k].value=s[k];form.elements.preferences.value=s.preferences??'';
 const imported=importedDietTargets(state.legacy.rules);
 $('diet-reference').hidden=!Object.entries(imported).some(([key,value])=>s[key]!==value);
 const proposed={...s,...imported};
 text('diet-reference-text',`普通日 ${proposed.calorieTarget} kcal · 蛋白质 ${proposed.proteinMin}–${proposed.proteinMax} g · 脂肪至少 ${proposed.fatMin} g · 碳水约 ${carbLabel(proposed)||'待核对'}`);
 const l=state.legacy;text('import-status',state.importInfo?`已导入：${state.importInfo.sourceVersion} · ${state.importedAt?.slice(0,10)}\n饮食 ${l.foods.length} 条 / 体重 ${l.weights.length} 条 / 运动 ${l.activities.length} 条 / 库存 ${l.inventory.length} 项；当前应用新增饮食 ${state.local.foods.length} 条。`:'当前使用本机健康账本。');$('import-status').style.whiteSpace='pre-line';
}
function rebuildFoodSelection(){
 const inv=inventoryWithMoves(state).filter(i=>i.active&&!isStockReference(i)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 const opts=inv.map(i=>`<option value="${E(i.id)}">${E(i.name)} · ${E(i.standard)}</option>`).join('');
 const catalog=$('inventory-catalog'),currentSku=$('sku-form').elements.id.value;
 catalog.innerHTML='<option value="">新食品</option>'+inv.map(i=>
  `<option value="${E(i.id)}">${E(stockName(i))} · ${i.qty===0?'已用完':i.qty===null?'数量未记录':E(stockUnit(stockMeasure(i).unit))}</option>`).join('');
 catalog.value=currentSku;
 for(const el of document.querySelectorAll('#food-select,#stock-food-select,[data-stock-options]')){
  const selected=el.value;
  el.innerHTML=(el.id==='food-select'?'<option value="">自定义食物</option>':'')+opts;
  if([...el.options].some(o=>o.value===selected))el.value=selected;
 }
 const batchOptions=batchBalances(state).filter(b=>b.remaining>0).map(b=>`<option value="${E(b.id)}">${E(inv.find(i=>i.id===b.foodId)?.name)} · ${E(displayDay(b.date))} · 余 ${fmt(b.remaining,3)}</option>`).join('');
 for(const el of document.querySelectorAll('[data-batch-options]'))el.innerHTML=batchOptions;
 $('meal-templates').hidden=!!editing.food||!(state.local.templates?.length);
 $('meal-template').innerHTML=(state.local.templates??[]).map(t=>`<option value="${E(t.id)}">${E(t.name)}</option>`).join('');
 updateBatches();
 updateStockInputLabels();
}
function updateBatches(){
 const form=$('food-form'),selected=form.elements.batchId.value;
 const edited=events(state,'foods').find(e=>e.id===editing.food);
 form.elements.batchId.innerHTML='<option value="">自动扣减</option>'+batchBalances(state,form.elements.foodId.value).filter(b=>b.foodId===form.elements.foodId.value&&(b.remaining>0||b.id===edited?.batchId))
  .map(b=>`<option value="${E(b.id)}">${E(displayDay(b.date))} · 余 ${fmtStock(inventoryWithMoves(state).find(i=>i.id===b.foodId),b.remaining)}</option>`).join('');
 if([...form.elements.batchId.options].some(o=>o.value===selected))form.elements.batchId.value=selected;
}
async function commit(next,message,snapshot){state=await saveState(next,state.revision ?? 0,globalThis.airplaneAccount,snapshot);rebuildFoodSelection();render();toast(message);}
async function removeEditedEvent(){
 const type=activeEntryType,id=editing[type],button=$('apply-delete-health');
 if(!id||button.disabled)return;
 button.disabled=true;
 try{
  const next=structuredClone(state);
  deleteEvent(next,historyTypes[type],id);
  await commit(next,'记录已删除');
  resetEditor($(`${type}-form`),type);$('health-entry').close();
 }catch(err){toast(err.message);}
 finally{button.disabled=false;}
}
function resetEditor(form,type){
 delete editing[type];dirtyEntries.delete(type);form.reset();setDateDefaults();
 if(type==='food'){$('food-editing').hidden=$('cancel-food-edit').hidden=true;setFoodUnit(null);showFoodSummary();}
 syncEntryMode();
}
function showFoodSummary(){
 const f=$('food-form');
 const kcal=numeric(f.elements.kcal.value),quantity=numeric(f.elements.stockQty.value);
 const item=inventoryWithMoves(state).find(x=>x.id===f.elements.foodId.value);
 const parts=[];
 if(kcal!==null)parts.push('热量 '+fmt(kcal,1)+' kcal');
 if(item&&quantity>0&&f.elements.status.value==='actual')parts.push('扣库 '+Number(quantity.toFixed(3))+' '+stockUnit(stockMeasure(item).unit));
 const output=$('food-summary');
 output.textContent=parts.join(' · ');output.hidden=!parts.length;
}
function foodEntryUnit(sku){
 if(!sku)return '';
 const measure=stockMeasure(sku);
 return measure.unit==='个'&&quantityInUnit(sku,1,'个',basis(sku)[1])!==null?'个':basis(sku)[1];
}
function setFoodUnit(sku,unit=foodEntryUnit(sku)){
 const amount=$('food-form').elements.amount;
 amount.dataset.unit=unit;
 text('food-amount-label',unit?'份量（'+unit+'）':'份量');
 const stock=stockUnit(stockMeasure(sku).unit);
 text('food-stock-label',stock?'库存扣减数量（'+stock+'）':'库存扣减数量');
}
function applyAmount(syncPortion=false){
 const form=$('food-form'),sku=inventoryWithMoves(state).find(s=>s.id===form.elements.foodId.value);
 if(!sku)return;
 const quantity=numeric(form.elements.amount.value),unit=form.elements.amount.dataset.unit||foodEntryUnit(sku);
 if(syncPortion)form.elements.portion.value=quantity===null?'':quantity+' '+unit;
 const nutrition=suggestNutritionByInventory(sku,quantityInUnit(sku,quantity,unit,basis(sku)[1]));
 if(!nutrition){
  if(syncPortion)for(const key of NUTRIENTS)form.elements[key].value='';
  form.elements.stockQty.value='';showFoodSummary();return;
 }
 fillForm(form,nutrition);
 const stockQty=quantityInUnit(sku,quantity,unit,sku.unit);
 form.elements.stockQty.value=displayStockQuantity(sku,stockQty)??'';showFoodSummary();
}
function stockSku(id){return inventoryWithMoves(state).find(row=>row.id===id);}
function updateStockInputLabels(){
 const batch=batchBalances(state).find(row=>row.id===$('split-form').elements.batchId.value);
 for(const [id,foodId] of [
  ['stock-amount-label',$('stock-food-select').value],['batch-amount-label',$('batch-form').elements.foodId.value],
  ['split-amount-label',batch?.foodId]
 ]){
  const label=$(id),unit=stockUnit(stockMeasure(stockSku(foodId)).unit);
  label.textContent=label.dataset.label+(unit?'（'+unit+'）':'');
 }
}
function download(name,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function backup(){download(`airplane-health-backup-${dateNow()}.json`,exportState(state));}
function clearHealthImport(){
 importVersion++;importPreview=null;$('import-preview').hidden=true;
}
async function previewHealthImport(file,kind){
 clearHealthImport();
 const version=importVersion;
 try{
  const raw=JSON.parse(await file.text());
  if(version!==importVersion)return;
  if(kind==='ledger'&&JSON.stringify(state.legacy.sourceSnapshot)===JSON.stringify(raw)){toast('这份主账已导入');return;}
  const imported=kind==='backup'?raw:normalizeLedger(raw);
  if(!validateAppState(imported))throw Error('文件结构不正确');
  importPreview={imported,kind,revision:state.revision??0};
  const panel=$('import-preview');
  panel.querySelector('[data-import-summary]').textContent=
   `${file.name} · 饮食 ${events(imported,'foods').length} 条 · 体重 ${events(imported,'weights').length} 条 · 库存 ${inventoryWithMoves(imported).length} 项`;
  panel.hidden=false;panel.scrollIntoView({block:'nearest'});
 }catch(err){if(version===importVersion)toast('导入失败：'+err.message);}
}
async function applyHealthImport(){
 const button=$('apply-health-import'),cancel=$('cancel-health-import');
 if(button.disabled||!importPreview)return;
 const {imported,kind,revision}=importPreview;
 button.disabled=true;cancel.disabled=true;
 try{
  if(revision!==(state.revision??0))throw Error('账本已变更，请重新预览文件');
  await commit(imported,kind==='backup'?'健康备份恢复成功':'历史健康数据已导入',combinedBackup(state,null));
  clearHealthImport();$('health-settings-sheet').close();switchTab('overview');
 }catch(err){toast('导入失败：'+err.message);}
 finally{button.disabled=false;cancel.disabled=false;}
}
function bindForm(type,update,message){
 const form=$(`${type}-form`);
 form.onsubmit=async e=>{
  e.preventDefault();
  const button=form.querySelector('[type=submit]');
  if(button.disabled)return;
  button.disabled=true;
  try{
   const next=structuredClone(state);
   update(next,Object.fromEntries(new FormData(form)),form);
   await commit(next,message);
   resetEditor(form,type);
   if(historyTypes[type])$('health-entry').close();
  }catch(err){toast(err.message);}
  finally{button.disabled=false;}
 };
}
function attach(){
 const setState=next=>{state=next;rebuildFoodSelection();render();};
 const purchases=attachPurchases({getState:()=>state,commit,setState,notify:toast,switchTab,today:dateNow});
 window.addEventListener('airplane:health-saved',e=>setState(e.detail));
 updatePurchases=purchases.render;
 updateShopping=attachShopping({getState:()=>state,commit,notify:toast,today:dateNow,openOrder:purchases.openOrder});
 attachCombinedBackup({getState:()=>state,setState:next=>{state=next;rebuildFoodSelection();render();},notify:toast,download});
 for(const select of document.querySelectorAll('[data-units]'))select.innerHTML=units.map(u=>`<option>${E(u)}</option>`).join('');
 document.querySelector('[data-nutrients]').innerHTML=NUTRIENTS.map((k,i)=>`<label>${['热量 kcal','蛋白质 g','碳水 g','脂肪 g','钠 mg'][i]}<input type="number" name="${k}" min="0" step="any"></label>`).join('');

 $('add-health').onclick=openEntry;
 for(const type of Object.keys(historyTypes)) $(`${type}-form`).addEventListener('input',()=>dirtyEntries.add(type));
 $('health-settings').onclick=openSettings;
 document.querySelectorAll('[data-entry]').forEach(b=>b.onclick=()=>selectEntry(b.dataset.entry));
 document.querySelectorAll('.health-sheet').forEach(d=>d.addEventListener('close',()=>{
  const t=$('toast');
  if(d.contains(t))document.body.append(t);
 }));
 $('check-update').onclick=()=>{
  $('health-settings-sheet').close();
  checkForAppUpdate(true);
 };
 document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
 const writeDay=bindDayPicker(document.querySelector('.day-picker'),date=>{
  selectedDate=date;writeDay(date);render();
 });
 writeDay(selectedDate);
 $('inventory-search').addEventListener('input',()=>renderInventory());
 function selectTrendView(){
  if(location.hash==='#trends')switchTab('trends');
  else if(tab==='trends')switchTab('overview');
 }
 window.addEventListener('hashchange',selectTrendView);
 selectTrendView();
 $('health-trend-back').onclick=e=>{e.preventDefault();switchTab('overview');};
 $('local-events').onclick=$('body-events').onclick=e=>{
  const row=e.target.closest('[data-edit-id]');
  if(row)editEvent(row.dataset.type,row.dataset.editId);
 };
 $('delete-health-entry').onclick=()=>{
  $('delete-health-entry').hidden=true;
  $('confirm-delete-health').hidden=false;
  $('confirm-delete-health').scrollIntoView({block:'nearest'});
 };
 $('cancel-delete-health').onclick=syncEntryMode;
 $('apply-delete-health').onclick=removeEditedEvent;
 $('cancel-food-edit').onclick=()=>resetEditor($('food-form'),'food');
 $('food-select').onchange=()=>{
  const form=$('food-form'),sku=inventoryWithMoves(state).find(s=>s.id===form.elements.foodId.value);
  form.elements.stockQty.value='';updateBatches();
  if(!sku){setFoodUnit(null);showFoodSummary();return;}
  const [amount,basisUnit]=basis(sku),unit=foodEntryUnit(sku);
  const initial=unit===basisUnit?amount:1;
  fillForm(form,{name:sku.name,amount:initial});
  setFoodUnit(sku,unit);
  applyAmount(true);
 };
 $('food-form').oninput=showFoodSummary;
 $('food-form').elements.amount.oninput=()=>applyAmount(true);
 $('apply-weight').onclick=()=>{
  const form=$('food-form'),fields=Object.fromEntries(new FormData(form));
  try{
   const sku=inventoryWithMoves(state).find(s=>s.id===fields.foodId);
   const batch=batchBalances(state).find(b=>b.id===fields.batchId);
   const grams=measuredGrams(fields)??numeric(fields.amount);
   if(!(grams>0)||sku&&basis(sku)[1]!=='g')throw Error('请填写有效称重。此换算要求食品营养按克计');
   const stage=sku?.stage??'raw';
   const amount=convertCookingWeight(grams,fields.measuredStage,stage,numeric(fields.raw)??batch?.raw,numeric(fields.cooked)??batch?.cooked);
   setFoodUnit(sku,'g');
   fillForm(form,{amount,portion:`${grams} g（${fields.measuredStage==='cooked'?'熟重':'生重'}）`});
   applyAmount();
   if(sku?.unit==='g') form.elements.stockQty.value=convertCookingWeight(grams,fields.measuredStage,sku.stockStage??stage,numeric(fields.raw)??batch?.raw,numeric(fields.cooked)??batch?.cooked);
   showFoodSummary();
  }catch(err){toast(err.message);}
 };
 $('template-settings').onsubmit=async event=>{
  event.preventDefault();
  const {date,name}=Object.fromEntries(new FormData(event.target)),meal=$('template-meal').value;
  const items=foodsForDay(state,date).filter(e=>e.meal===meal);
  if(!items.length){toast('所选日期和餐次没有实际记录');return;}
  const next=structuredClone(state);
  (next.local.templates??=[]).push({id:makeId('meal'),name:name.trim()||meal,items});
  try{await commit(next,'已保存餐食模板');}catch(err){toast(err.message);}
 };
 $('use-template').onclick=async()=>{
  const form=$('food-form'),t=(state.local.templates??[]).find(t=>t.id===$('meal-template').value);
  const button=$('use-template');
  if(!t||button.disabled)return;
  button.disabled=true;
  const {date,time,meal,status}=Object.fromEntries(new FormData(form)),next=structuredClone(state);
  try{
   for(const item of t.items)addFood(next,{...item,...item.nutrition,date,time,meal,status,batchId:null,cost:null});
   await commit(next,'已录入餐食模板');
   $('health-entry').close();
  }catch(err){toast(err.message);}
  finally{button.disabled=false;}
 };
 bindForm('food',(next,d,form)=>addFood(next,{
  ...d,amountUnit:form.elements.amount.dataset.unit,stockQty:storedStockQuantity(stockSku(d.foodId),d.stockQty)
 },editing.food),'饮食已保存');
 bindForm('weight',(next,d,f)=>{
  const kg=numeric(d.kg);
  if(!validDate(d.date)||!(kg>=20&&kg<=500))throw Error('请填写有效体重');
  recordEvent(next,'weights',{date:d.date,time:normalizeClock(d.time),kg,isMorning:f.elements.isMorning.checked},editing.weight);
 },'体重已保存');
 bindForm('activity',(next,d,f)=>{
  if(!validDate(d.date)||!d.name?.trim())throw Error('请填写运动日期和名称');
  recordEvent(next,'activities',{...d,time:normalizeClock(d.time),km:numeric(d.km),kcal:numeric(d.kcal),minutes:numeric(d.minutes),
   includedInBase:d.energyKind!=='total'&&f.elements.includedInBase.checked},editing.activity);
 },'运动已保存');
 for(const select of [$('stock-food-select'),$('batch-form').elements.foodId,$('split-form').elements.batchId])
  select.addEventListener('change',updateStockInputLabels);
 bindForm('stock',(next,d,f)=>localStockChange(next,{...d,delta:storedStockQuantity(stockSku(d.foodId),d.delta),count:f.elements.count.checked}),'库存变化已保存');
 bindForm('sku',(next,d)=>saveSku(next,d),'食品已保存');
 bindForm('batch',(next,d)=>addBatch(next,{...d,quantity:storedStockQuantity(stockSku(d.foodId),d.quantity),expires:d.expires||null,raw:numeric(d.raw),cooked:numeric(d.cooked),
  costCents:numeric(d.cost)===null?null:Math.round(+d.cost*100)}),'批次已入库');
 bindForm('split',(next,d)=>{
  const lot=batchBalances(next).find(row=>row.id===d.batchId);
  splitBatch(next,{...d,quantity:storedStockQuantity(stockSku(lot?.foodId),d.quantity)});
 },'分装已完成');
 $('sku-form').addEventListener('reset',()=>$('sku-form').querySelectorAll('option[data-legacy-unit]').forEach(option=>option.remove()));
 $('new-sku').onclick=()=>$('sku-form').reset();
 function revealSku(){
  $('inventory-tools').open=true;$('sku-panel').open=true;
  $('sku-panel').scrollIntoView({block:'start'});
 }
 $('add-stock-food').onclick=()=>{$('sku-form').reset();revealSku();};
 function selectSku(id){
  const row=inventoryWithMoves(state).find(s=>s.id===id);
  const [basisAmount,basisUnit]=basis(row);
  const form=$('sku-form');
  form.reset();
  for(const [key,value] of [['unit',row.unit],['basisUnit',basisUnit]]){
   const select=form.elements[key];
   if(![...select.options].some(option=>option.value===value)){
    const option=new Option(stockUnit(value),value);option.dataset.legacyUnit='';select.add(option);
   }
  }
  const measure=stockMeasure(row),pack=packageInfo(row);
  fillForm(form,{...row,...row.nutrition,price:row.priceBasis===row.unit?row.pricePerUnit:null,basisAmount,basisUnit,
   piecesPerPack:measure.unit!==row.unit?measure.factor:null,
   packageSize:pack.pack===row.unit?pack.size:row.packageSize,packageUnit:pack.pack===row.unit?pack.measure:row.packageUnit});
  $('inventory-catalog').value=id;
  revealSku();
 }
 function editStock(event){
  const id=event.target.closest('[data-sku-edit]')?.dataset.skuEdit;
  if(id)selectSku(id);
 }
 $('inventory-list').onclick=$('unknown-stock-list').onclick=editStock;
 $('inventory-catalog').onchange=e=>{if(e.target.value)selectSku(e.target.value);else $('sku-form').reset();};
 $('apply-diet-reference').onclick=async()=>{
  const next=structuredClone(state);
  Object.assign(next.settings,importedDietTargets(state.legacy.rules));
  try{await commit(next,'已采用主账营养目标');}catch(err){toast(err.message);}
 };
 $('settings-form').onsubmit=async e=>{
  e.preventDefault();const fields=Object.fromEntries(new FormData(e.target)),next=structuredClone(state);
  if(+fields.proteinMin>+fields.proteinMax){toast('蛋白质下限不能大于上限');return;}
  for(const k of settingKeys)next.settings[k]=k==='cycleAnchor'?fields[k]:Number(fields[k]);
  if(['calorieTarget','proteinMin','proteinMax','fatMin'].some(k=>next.settings[k]!==state.settings[k]))next.settings.dietCustomized=true;
  next.settings.preferences=fields.preferences.trim();
  try{await commit(next,'参数已更新');}catch(err){toast(err.message);}
 };
 $('choose-import').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',e=>{if(e.target.files[0])void previewHealthImport(e.target.files[0],'ledger');e.target.value='';});
 $('choose-restore').addEventListener('click',()=>$('restore-file').click());$('restore-file').addEventListener('change',e=>{if(e.target.files[0])void previewHealthImport(e.target.files[0],'backup');e.target.value='';});
 $('apply-health-import').onclick=applyHealthImport;
 $('cancel-health-import').onclick=clearHealthImport;
 $('health-settings-sheet').addEventListener('close',clearHealthImport);
 $('export-button').addEventListener('click',backup);
}
async function main(){try{state=await readState();if(!validateAppState(state))throw new Error('健康模块数据无效，请通过备份恢复。');attach();rebuildFoodSelection();setDateDefaults();render(); }catch(err){toast('初始化失败：'+err.message);}}
await main();
let lastDay=dateNow();
function refreshDay(){
 const now=dateNow();
 if(now!==lastDay){
  if(selectedDate===lastDay)selectedDate=now;
  for(const input of document.querySelectorAll('form input[name=date]'))if(input.value===lastDay)input.value=now;
  lastDay=now;render();
 }
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDay();});
setInterval(refreshDay,30000);
