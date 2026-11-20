import {bindDayPicker,displayDay,localDate as dateNow,localClock,normalizeClock,syncCalendarFields} from '../calendar.mjs';
import {attachShopping} from './shopping.mjs';
import {attachPurchases} from './purchase-ui.mjs';
import {bindBackupExports,unpackBackup,restoreBackup} from './backup.mjs';
import {readFinance,validateFinanceBackup} from '../finance-storage.mjs';
import {addBatch,convertCookingWeight,displayStockQuantity,measuredGrams,portionSources,registerPortions,saveSku,stockAlerts,stockMeasure,storedStockQuantity} from './inventory.mjs';
import {units} from './contract.mjs';
import {quantityInUnit,basis,packageInfo} from './candidates.mjs';
import {APP_VERSION,shellIcon} from '../shell.mjs';
import {bindUpdateCheck} from '../updates.mjs';
import {syncChoiceFields} from '../choice-picker.mjs';
import {newState,normalizeLedger,recoverLegacyPortions,validateAppState,APP_SCHEMA,numeric,makeId,addFood,localStockChange,dayIntake,energyForDay,cycleForDate,weightTrend,foodsForDay,inventoryWithMoves,suggestNutritionByInventory,validDate,NUTRIENTS,events,recordEvent,deleteEvent,batchBalances,availableBatches,addDays,isOnHand,isStockReference,carbReference,currentCarbReference,importedDietTargets} from './core.mjs';
import {readState,saveState} from './storage.mjs';
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
 syncChoiceFields();
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
 rebuildFoodSelection();
 selectEntry(activeEntryType);syncCalendarFields($('health-entry'));$('health-entry').showModal();
}
function openSettings(){
 $('template-settings').elements.date.value=selectedDate;
 renderSettings();syncCalendarFields($('health-settings-sheet'));$('health-settings-sheet').showModal();
}
function progress(id,val){$(id).style.width=`${Math.max(0,Math.min(100,Number(val)||0))}%`;}
function carbLabel(range){
 return range?(range.low===range.high?range.low:range.low+'–'+range.high)+' g':'';
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
 const {range,fromImport}=currentCarbReference(state);
 const carbs=carbLabel(range);
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
const mealSymbols={
 '早餐':'sun','早午餐':'sun','午餐':'bowl','晚餐':'moon','加餐':'apple','未分餐':'bowl'
};
function recordSymbol(glyph){
 return `<span class="category-symbol health-record-symbol" data-tone="${glyph}" aria-hidden="true">${shellIcon(glyph)}</span>`;
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
 const glyph=badge?'calendar':mealSymbols[timelineGroup(row)];
 return `<button type="button" class="tx-row tx-row-interactive health-tx-row diet-row" data-edit-id="${E(row.id)}" data-type="food">
  ${recordSymbol(glyph)}
  <span class="diet-content">
   <span class="diet-main"><span class="tx-title">${E(row.name)}</span>${badge?`<span class="diet-status">${badge}</span>`:''}</span>
   ${values?`<span class="diet-nutrients">${values}</span>`:''}
  </span>
 </button>`;
}
function timelineRow(row){
 const {type}=row,weight=type==='weight';
 const title=weight?(row.isMorning||/^(是|纳入|暂定纳入)/.test(row.trendStatus??'')?'晨重':'称重'):row.name;
 const icon=weight?'scale':'activity';
 const kcal=row.nutrition?.kcal??row.kcal;
 const amount=weight?fmt(row.kg,1)+' kg':kcal==null?'':fmt(kcal,1)+' kcal';
 return `<button type="button" class="tx-row tx-row-interactive health-tx-row" data-edit-id="${E(row.id)}" data-type="${type}">
  ${recordSymbol(icon)}
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
   picker.add(new Option(stockName(original)+' · 原记录用料',original.id));
  const status=eatingState(row);
  fillForm(form,{...row,...row.nutrition,status:status==='unknown'?'cancelled':status});
  setFoodUnit(original,row.amountUnit??(row.amount&&original?basis(original)[1]:foodEntryUnit(original)));
  if(original)form.elements.stockQty.value=displayStockQuantity(original,row.stockQty)??'';
  updateBatches(row.batchId??'');
  showFoodFields();
  $('food-editing').hidden=$('cancel-food-edit').hidden=false;showFoodSummary();
 }else {
  fillForm(form,row);
  if(type==='weight')form.elements.isMorning.checked=!!(row.isMorning??/^(是|纳入|暂定纳入)/.test(row.trendStatus??''));
  if(type==='activity')updateActivityLabel();
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
 syncChoiceFields(form);
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
 const batches=batchBalances(state), byId=new Map(stock.map(s=>[s.id,s]));
 function renderGroups(entries){
  const button=(row,label,secondary='')=>{
   const portions=batches.filter(batch=>batch.foodId===row.id&&batch.remaining>0&&(batch.portion||batch.parent));
   return `<div class="stock-item"><button type="button" class="inventory-food" data-stock-expand aria-expanded="false" aria-label="${E(label)}">
    <span class="stock-name"><strong>${E(label)}</strong>${secondary?`<small>${E(secondary)}</small>`:''}</span>
    <span class="stock-qty ${row.qty<0?'low':''}">${row.qty===null?'数量未知':fmtStock(row)}</span></button>
    <div class="stock-actions" hidden>
     ${portions.length?`<p>${portions.map(batch=>fmtStock(row,batch.remaining)).join(' · ')}</p>`:''}
     <div class="button-row">${isOnHand(row)?`<button type="button" class="btn btn-secondary" data-stock-meal="${E(row.id)}">记饮食</button>
      <button type="button" class="btn btn-text" data-stock-split="${E(row.id)}">记录分装</button>`:''}
      <button type="button" class="btn btn-text" data-sku-edit="${E(row.id)}">编辑食品</button>
     </div>
    </div></div>`;
  };
  return entries.map(({name,rows})=>rows.length===1?button(rows[0],name):
   `<details class="stock-group"><summary><strong>${E(name)}</strong><small>${rows.length} 条记录</small></summary>
    ${rows.map(row=>button(row,row.name,row.standard)).join('')}</details>`).join('');
 }
 $('inventory-list').innerHTML=renderGroups(known)||'<div class="event-empty">没有匹配的在库食品</div>';
 $('unknown-stock').hidden=!unknown.length;
 text('unknown-stock-title','数量未记录 · '+unknown.length+' 项');
 $('unknown-stock-list').innerHTML=renderGroups(unknown);
 const alerts=stockAlerts(state,dateNow());
 const alertText=[...alerts.low.filter(s=>s.qty>0).map(s=>stockName(s)+' 库存偏低'),...alerts.expiry.map(b=>byId.get(b.foodId)?.name+' 到期 '+displayDay(b.expires))].join(' · ');
 $('stock-alerts').textContent=alertText;$('stock-alerts').hidden=!alertText;
 $('batch-list').innerHTML=batches.filter(b=>b.remaining>0).map(b=>`<p>${E(byId.get(b.foodId)?.name)} · ${E(displayDay(b.date))} · ${fmtStock(byId.get(b.foodId),b.remaining)} · ${b.costCents===null?'成本未知':('批次成本 ¥'+fmt(b.costCents/100,2))}${b.portion||b.parent?' · 分装':''}</p>`).join('');
 $('stock-history').innerHTML=state.local.stockMoves.slice(-40).reverse().map(m=>`<div class="event-row"><span>${E(displayDay(m.date))}${normalizeClock(m.time)?' '+normalizeClock(m.time):''} · ${E(byId.get(m.foodId)?.name)} · ${E(m.reason)}</span><strong>${m.delta>0?'+':''}${fmtStock(byId.get(m.foodId),m.delta)}</strong></div>`).join('');

}
function fmtStock(sku,quantity=sku?.qty){
 return E(stockText(sku,quantity));
}
function stockText(sku,quantity=sku?.qty){
 const value=displayStockQuantity(sku,quantity),unit=stockUnit(stockMeasure(sku).unit);
 return value==null?'—':Number(value.toFixed(3))+' '+unit;
}
function renderSettings(){
 const s=state.settings, form=$('settings-form');for(const k of settingKeys)form.elements[k].value=s[k];form.elements.preferences.value=s.preferences??'';
 const imported=importedDietTargets(state.legacy.rules);
 $('diet-reference').hidden=!Object.entries(imported).some(([key,value])=>s[key]!==value);
 const proposed={...s,...imported};
 text('diet-reference-text',`普通日 ${proposed.calorieTarget} kcal · 蛋白质 ${proposed.proteinMin}–${proposed.proteinMax} g · 脂肪至少 ${proposed.fatMin} g · 碳水约 ${carbLabel(carbReference(proposed))||'待核对'}`);
 text('import-status',state.importInfo?'主账 '+state.importInfo.sourceVersion:'本机账本');
}
function rebuildFoodSelection(){
 const inv=inventoryWithMoves(state).filter(i=>i.active&&!isStockReference(i)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 const onHand=inv.filter(isOnHand);
 const opts=inv.map(i=>`<option value="${E(i.id)}">${E(i.name)} · ${E(i.standard)}</option>`).join('');
 const catalog=$('inventory-catalog'),currentSku=$('sku-form').elements.id.value;
 catalog.innerHTML='<option value="">新食品</option>'+inv.map(i=>
  `<option value="${E(i.id)}">${E(stockName(i))} · ${i.qty===0?'已用完':i.qty===null?'数量未记录':E(stockUnit(stockMeasure(i).unit))}</option>`).join('');
 catalog.value=currentSku;
 for(const el of document.querySelectorAll('#stock-food-select,[data-stock-options]')){
  const selected=el.value;
  el.innerHTML=opts;
  if([...el.options].some(o=>o.value===selected))el.value=selected;
 }
 const picker=$('food-select'),selected=picker.value;
 const foodOptions=onHand.map(sku=>new Option(stockName(sku)+' · 余 '+stockText(sku),sku.id));
 const edited=events(state,'foods').find(row=>row.id===editing.food);
 const original=edited&&inventoryWithMoves(state).find(row=>row.id===edited.foodId);
 if(original&&!onHand.some(row=>row.id===original.id))
  foodOptions.push(new Option(stockName(original)+' · 原记录用料',original.id));
 picker.replaceChildren(new Option('外食 / 自定义',''),...foodOptions);
 if(foodOptions.some(option=>option.value===selected))picker.value=selected;
 else if(selected)selectFood();
 const sourceFood=$('split-form').elements.foodId,current=sourceFood.value;
 sourceFood.replaceChildren(new Option('请选择在库食品',''),...onHand.map(sku=>new Option(stockName(sku)+' · 余 '+stockText(sku),sku.id)));
 if(onHand.some(sku=>sku.id===current))sourceFood.value=current;
 $('meal-templates').hidden=!!editing.food||!(state.local.templates?.length);
 $('meal-template').innerHTML=(state.local.templates??[]).map(t=>`<option value="${E(t.id)}">${E(t.name)}</option>`).join('');
 updateBatches();
 showFoodFields();
 updateStockInputLabels();
}
function updateBatches(selected=$('food-batch').value){
 const form=$('food-form'),picker=form.elements.batchId,sku=stockSku(form.elements.foodId.value);
 const batches=availableBatches(state,sku?.id,form.elements.date.value,editing.food);
 picker.replaceChildren(new Option('自填份量',''),...batches.map((batch,i)=>
  new Option(stockText(sku,batch.remaining)+' · '+(batch.portion||batch.parent?'分装':'批次')+
   ' '+(i+1)+' · '+displayDay(batch.date),batch.id)));
 if(batches.some(batch=>batch.id===selected))picker.value=selected;
 $('food-portion-picker').hidden=!batches.length;
 syncChoiceFields(form);
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
 if(type==='food'){
  $('food-editing').hidden=$('cancel-food-edit').hidden=true;$('food-options').open=false;
  setFoodUnit(null);updateBatches();showFoodFields();showFoodSummary();
 }
 if(type==='activity'){$('activity-details').open=false;updateActivityLabel();}
 if(type==='split')updateSplitSources();
 syncCalendarFields(form);syncChoiceFields(form);
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
 return sku?stockMeasure(sku).unit:'';
}
function setFoodUnit(sku,unit=foodEntryUnit(sku)){
 const amount=$('food-form').elements.amount;
 amount.dataset.unit=unit;
 text('food-amount-label',unit?'份量（'+unit+'）':'份量');
}
function showFoodFields(){
 const form=$('food-form'),fromStock=!!form.elements.foodId.value;
 $('food-custom').hidden=fromStock&&!editing.food;
 $('food-amount-row').hidden=!fromStock;
 form.elements.name.required=!fromStock||!!editing.food;
 form.elements.amount.required=fromStock&&!editing.food;
}
function selectFood(){
 const form=$('food-form'),sku=stockSku(form.elements.foodId.value);
 form.elements.batchId.value='';
 fillForm(form,{name:sku?stockName(sku):'',amount:'',stockQty:'',portion:'',cost:'',
  ...Object.fromEntries(NUTRIENTS.map(key=>[key,'']))});
 setFoodUnit(sku);updateBatches();showFoodFields();showFoodSummary();
}
function applyAmount(syncPortion=false){
 const form=$('food-form'),sku=inventoryWithMoves(state).find(s=>s.id===form.elements.foodId.value);
 if(!sku)return;
 const quantity=numeric(form.elements.amount.value),unit=form.elements.amount.dataset.unit||foodEntryUnit(sku);
 if(syncPortion)form.elements.portion.value=quantity===null?'':quantity+' '+unit;
 let labelQuantity=quantityInUnit(sku,quantity,unit,basis(sku)[1]);
 if(syncPortion&&labelQuantity!==null&&sku.stage&&sku.stockStage&&sku.stage!==sku.stockStage){
  const batch=batchBalances(state,sku.id).find(row=>row.id===form.elements.batchId.value);
  labelQuantity=batch?.raw>0&&batch?.cooked>0?convertCookingWeight(labelQuantity,sku.stockStage,sku.stage,batch.raw,batch.cooked):null;
 }
 const nutrition=suggestNutritionByInventory(sku,labelQuantity);
 if(nutrition)fillForm(form,nutrition);
 else if(syncPortion)for(const key of NUTRIENTS)form.elements[key].value='';
 const stockQty=quantityInUnit(sku,quantity,unit,sku.unit);
 form.elements.stockQty.value=displayStockQuantity(sku,stockQty)??'';showFoodSummary();
}
function stockSku(id){return inventoryWithMoves(state).find(row=>row.id===id);}
function updateStockInputLabels(){
 for(const [id,foodId] of [
  ['stock-amount-label',$('stock-food-select').value],['batch-amount-label',$('batch-form').elements.foodId.value]
 ]){
  const label=$(id),unit=stockUnit(stockMeasure(stockSku(foodId)).unit);
  label.textContent=label.dataset.label+(unit?'（'+unit+'）':'');
 }
 updateSplitSources();
}
function updateSplitSources(){
 const form=$('split-form'),sku=stockSku(form.elements.foodId.value),picker=form.elements.batchId,prior=picker.value;
 const sources=portionSources(state,sku,form.elements.date.value||dateNow());
 text('split-amount-label',sku?'各份数量（'+stockUnit(stockMeasure(sku).unit)+'）':'各份数量');
 picker.replaceChildren(...sources.map(batch=>new Option(batch.id?stockText(sku,batch.remaining)+' · '+displayDay(batch.date):
  '未分批库存 · '+stockText(sku,batch.remaining),batch.id)));
 if(sources.some(batch=>batch.id===prior))picker.value=prior;
 syncChoiceFields(form);
}
function updateActivityLabel(){
 const total=$('activity-form').elements.energyKind.value==='total';
 const previous=editing.activity&&events(state,'activities').find(row=>row.id===editing.activity);
 text('activity-kcal-label',total?'全天总消耗 kcal':previous?.includedInBase?'活动热量 kcal（已计入基线）':'额外活动热量 kcal');
}
function download(name,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function clearHealthImport(){
 importVersion++;importPreview=null;$('import-preview').hidden=true;
}
async function previewHealthImport(file){
 clearHealthImport();
 const version=importVersion;
 try{
  const raw=JSON.parse(await file.text());
  if(version!==importVersion)return;
  const panelBackup=$('combined-backup'),includes=name=>panelBackup.querySelector('[name='+name+']').checked;
  let health,finance,message='备份已恢复';
  if(raw?.format==='airplane-combined-v1')({health,finance}=unpackBackup(raw));
  else if(raw?.appType===APP_SCHEMA)health=raw;
  else if(raw?.app==='Airplane'||Array.isArray(raw?.transactions))finance=validateFinanceBackup(raw);
  else{
   if(JSON.stringify(state.legacy.sourceSnapshot)===JSON.stringify(raw)){toast('这份主账已导入');return;}
   health=normalizeLedger(raw);message='历史健康数据已导入';
  }
  if(health&&!validateAppState(health))throw Error('健康备份结构无效');
  health=includes('health')?health:null;finance=includes('finance')?finance:null;
  if(!health&&!finance)throw Error('文件中没有所选账本，请核对勾选范围');
  const financeRevision=finance?readFinance(window.airplaneAccount.finance).primary:null;
  importPreview={health,finance,financeRevision,message,revision:state.revision??0};
  const panel=$('import-preview');
  panel.querySelector('[data-import-summary]').textContent=[file.name,finance&&`财务 ${finance.transactions.length} 笔`,
   health&&`健康 ${events(health,'foods').length} 条饮食 · ${events(health,'weights').length} 条称重`].filter(Boolean).join(' · ');
  panel.hidden=false;panel.scrollIntoView({block:'nearest'});
 }catch(err){if(version===importVersion)toast('导入失败：'+err.message);}
}
async function applyHealthImport(){
 const button=$('apply-health-import'),cancel=$('cancel-health-import');
 if(button.disabled||!importPreview)return;
 const preview=importPreview;
 button.disabled=true;cancel.disabled=true;$('choose-import').disabled=true;
 try{
  if(preview.revision!==(state.revision??0))throw Error('账本已变更，请重新预览文件');
  await restoreBackup(state,preview,window.airplaneAccount,setHealthState);
  clearHealthImport();$('health-settings-sheet').close();switchTab('overview');
  toast(preview.message);
 }catch(err){toast('导入失败：'+err.message);}
 finally{button.disabled=false;cancel.disabled=false;$('choose-import').disabled=false;}
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
function setHealthState(next){state=recoverLegacyPortions(next);rebuildFoodSelection();render();}
function attach(){
 const purchases=attachPurchases({getState:()=>state,commit,setState:setHealthState,notify:toast,switchTab,today:dateNow});
 window.addEventListener('airplane:health-saved',e=>setHealthState(e.detail));
 updatePurchases=purchases.render;
 updateShopping=attachShopping({getState:()=>state,commit,notify:toast,today:dateNow,openOrder:purchases.openOrder});
 bindBackupExports($('combined-backup'),{getState:()=>state,notify:toast,download});
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
 text('health-version','当前 '+APP_VERSION+' · 检查更新');
 bindUpdateCheck($('check-update'));
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
 $('food-select').onchange=selectFood;
 const foodForm=$('food-form');
 foodForm.oninput=showFoodSummary;
 foodForm.elements.amount.oninput=()=>applyAmount(true);
 foodForm.elements.date.onchange=()=>{
  const batch=foodForm.elements.batchId;
  const selected=batch.value;
  updateBatches();
  if(selected&&!batch.value){foodForm.elements.amount.value='';applyAmount(true);}
 };
 $('food-batch').onchange=()=>{
  const sku=stockSku(foodForm.elements.foodId.value);
  const batch=availableBatches(state,sku?.id,foodForm.elements.date.value,editing.food)
   .find(row=>row.id===foodForm.elements.batchId.value);
  setFoodUnit(sku);
  foodForm.elements.amount.value=displayStockQuantity(sku,batch?.remaining)??'';
  applyAmount(true);
 };
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
 bindForm('food',(next,d,form)=>{
  const sku=stockSku(d.foodId);
  const stockQty=storedStockQuantity(sku,d.stockQty);
  if(d.foodId&&!editing.food&&(!sku||!isOnHand(sku)||!(stockQty>0)))throw Error('请选择仍有库存的食材并填写份量');
  addFood(next,{...d,amountUnit:form.elements.amount.dataset.unit,stockQty},editing.food);
 },'饮食已保存');
 bindForm('weight',(next,d,f)=>{
  const kg=numeric(d.kg);
  if(!validDate(d.date)||!(kg>=20&&kg<=500))throw Error('请填写有效体重');
  recordEvent(next,'weights',{date:d.date,time:normalizeClock(d.time),kg,isMorning:f.elements.isMorning.checked},editing.weight);
 },'体重已保存');
 $('activity-form').elements.energyKind.onchange=updateActivityLabel;
 bindForm('activity',(next,d)=>{
  if(!validDate(d.date)||!d.name?.trim())throw Error('请填写运动日期和名称');
  const previous=editing.activity&&events(next,'activities').find(row=>row.id===editing.activity);
  recordEvent(next,'activities',{...d,time:normalizeClock(d.time),km:numeric(d.km),kcal:numeric(d.kcal),minutes:numeric(d.minutes),
   includedInBase:d.energyKind!=='total'&&previous?.includedInBase===true},editing.activity);
 },'运动已保存');
 for(const select of [$('stock-food-select'),$('batch-form').elements.foodId])
  select.addEventListener('change',updateStockInputLabels);
 bindForm('stock',(next,d,f)=>localStockChange(next,{...d,delta:storedStockQuantity(stockSku(d.foodId),d.delta),count:f.elements.count.checked}),'库存变化已保存');
 bindForm('sku',(next,d)=>saveSku(next,d),'食品已保存');
 bindForm('batch',(next,d)=>addBatch(next,{...d,quantity:storedStockQuantity(stockSku(d.foodId),d.quantity),expires:d.expires||null,raw:numeric(d.raw),cooked:numeric(d.cooked),
  costCents:numeric(d.cost)===null?null:Math.round(+d.cost*100)}),'批次已入库');
 const split=$('split-form');
 split.elements.foodId.onchange=split.elements.date.onchange=updateSplitSources;
 bindForm('split',(next,d)=>{
  const sku=stockSku(d.foodId);
  const quantities=d.quantities.normalize('NFKC').trim().split(/[,、;；\s]+/).map(value=>storedStockQuantity(sku,value));
  registerPortions(next,{...d,quantities});
 },'分装已保存');
 $('sku-form').addEventListener('reset',()=>$('sku-form').querySelectorAll('option[data-legacy-unit]').forEach(option=>option.remove()));
 $('new-sku').onclick=()=>$('sku-form').reset();
 function revealSku(){
  $('inventory-tools').open=true;$('sku-panel').open=true;
  $('sku-panel').scrollIntoView({block:'start'});
 }
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
  syncChoiceFields(form);
  revealSku();
 }
 function editStock(event){
  const button=event.target.closest('[data-stock-expand]');
  if(button){
   const panel=button.nextElementSibling;
   panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));
   return;
  }
  const action=event.target.closest('[data-sku-edit],[data-stock-meal],[data-stock-split]');
  if(!action)return;
  const {skuEdit:id,stockMeal,stockSplit}=action.dataset;
  if(id)selectSku(id);
  if(stockMeal){
   selectEntry('food');openEntry();foodForm.elements.foodId.value=stockMeal;selectFood();
  }
  if(stockSplit){
   split.elements.foodId.value=stockSplit;updateSplitSources();
   $('inventory-tools').open=$('split-panel').open=true;
   $('split-panel').scrollIntoView({block:'start'});
  }
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
 $('choose-import').onclick=()=>$('import-file').click();
 $('import-file').onchange=e=>{
  const file=e.target.files[0];e.target.value='';
  if(file)void previewHealthImport(file);
 };
 for(const checkbox of $('combined-backup').querySelectorAll('input[type=checkbox]'))checkbox.addEventListener('change',clearHealthImport);
 $('apply-health-import').onclick=applyHealthImport;
 $('cancel-health-import').onclick=clearHealthImport;
 $('health-settings-sheet').addEventListener('close',clearHealthImport);
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
