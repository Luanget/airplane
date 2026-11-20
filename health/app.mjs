import {attachPurchases} from './purchase-ui.mjs';
import {attachCombinedBackup,combinedBackup} from './backup.mjs';
import {addBatch,convertCookingWeight,measuredGrams,saveSku,splitBatch,stockAlerts} from './inventory.mjs';
import {units} from './contract.mjs';
import {manualStockQty,basis} from './candidates.mjs';
import {attachAssistant} from './assistant.mjs';
import {checkForAppUpdate} from '../updates.mjs';
import {newState,normalizeLedger,validateAppState,APP_SCHEMA,numeric,round,zero,makeId,addFood,localStockChange,dayIntake,energyForDay,cycleForDate,weightTrend,foodsForDay,inventoryWithMoves,suggestNutritionByInventory,validDate,NUTRIENTS,events,recordEvent,deleteEvent,batchBalances,addDays} from './core.mjs';
import {readState,saveState,exportState} from './storage.mjs';
const $=id=>document.getElementById(id);
const E=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=(v,d=0)=> v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
const dateNow=()=>{const d=new Date();const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;};
let state=newState(), selectedDate=dateNow(),tab='overview',toastHandle;
const editing={};
const dirtyEntries=new Set();
let activeEntryType='food';
let updatePurchases=()=>{};
const settingKeys=['calorieTarget','baselineTdee','cycleTarget','cycleDays','cycleAnchor','proteinMin','proteinMax','fatMin','sodiumTarget'];
function toast(message){
 const t=$('toast'),sheet=Array.from(document.querySelectorAll('.health-sheet[open]')).at(-1);
 (sheet??document.body).append(t);t.textContent=String(message);t.hidden=false;
 clearTimeout(toastHandle);toastHandle=setTimeout(()=>{t.hidden=true;},3500);
}
function text(id,value){$(id).textContent=String(value);}
function switchTab(next){
 tab=next;
 document.querySelectorAll('[data-tab]').forEach(x=>{
  const current=x.dataset.tab===next;
  x.classList.toggle('active',current);
  if(current)x.setAttribute('aria-current','page');else x.removeAttribute('aria-current');
 });
 document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==`view-${next}`));
 render();window.scrollTo({top:0,behavior:'instant'});
}
function render(){
 if(tab==='overview')renderOverview();
 if(tab==='record')renderRecord();
 if(tab==='inventory'){updatePurchases();renderInventory();}
 if(tab==='trends')renderTrends();
 if($('health-settings-sheet').open)renderSettings();
}
function selectEntry(type){
 activeEntryType=type;
 document.querySelectorAll('[data-entry]').forEach(b=>{
  const selected=b.dataset.entry===type;
  b.classList.toggle('active',selected);b.setAttribute('aria-pressed',String(selected));
 });
 document.querySelectorAll('[data-entry-panel]').forEach(panel=>panel.hidden=panel.dataset.entryPanel!==type);
}
function openEntry(){
 for(const type of Object.keys(historyTypes)){
  const form=$(`${type}-form`);
  if(editing[type])resetEditor(form,type);
  if(!dirtyEntries.has(type))form.elements.date.value=selectedDate;
 }
 selectEntry(activeEntryType);$('health-entry').showModal();
}
function openSettings(){
 renderSettings();$('health-settings-sheet').showModal();
}
function progress(id,val){$(id).style.width=`${Math.max(0,Math.min(100,Number(val)||0))}%`;}
function renderOverview(){
 const today=dateNow(),intake=dayIntake(state,selectedDate),cals=intake.totals.kcal,known=intake.reported;
 const goal=state.settings.calorieTarget,energy=energyForDay(state,selectedDate,today);
 $('welcome').hidden=!!state.importInfo||state.local.foods.length>0||state.local.weights.length>0;
 $('report-date').value=selectedDate;
 text('today-status',selectedDate<today?(energy.closed?'已结算':known?'数据待补':'缺少记录'):selectedDate===today?'当天待结算':'未来日期');
 text('hero-calories',known?fmt(cals,0):'—'); text('hero-goal',`目标 ${fmt(goal)} kcal`);
 text('hero-remaining',cals!==null&&!intake.incomplete.includes('kcal')?(goal-cals>=0?`剩余 ${fmt(goal-cals,0)} kcal`:`超出 ${fmt(cals-goal,0)} kcal`):'摄入数据待补');progress('cal-progress',known?cals/goal*100:0);
 for (const [id,key,unit] of [['protein-stat','protein','g'],['fat-stat','fat','g'],['carbs-stat','carbs','g'],['sodium-stat','sodium','mg']])text(id,known?`${fmt(intake.totals[key],key==='sodium'?0:1)} ${unit}`:'—');
 text('protein-goal',`目标 ${state.settings.proteinMin}–${state.settings.proteinMax}g`);text('fat-goal',`目标 ≥${state.settings.fatMin}g`);text('sodium-goal',`参考 ${state.settings.sodiumTarget} mg`);
 const weights=weightTrend(state);text('weight-stat',weights.last?`${fmt(weights.last.kg,2)} kg`:'—');text('weight-date',weights.last?weights.last.date:'尚未录入');text('weight-average',weights.last7!==null?`${fmt(weights.last7,2)} kg`:'—');text('weight-trend',weights.delta!==null?`滚动变化 ${weights.delta>0?'+':''}${fmt(weights.delta,2)} kg`:'需至少8次有效晨重');renderWeightChart(weights.points.slice(-14));
 text('cycle-title',state.settings.cycleDays===6?'六天减脂周期':state.settings.cycleDays+' 天减脂周期');
 const cycle=cycleForDate(state,selectedDate,today);text('cycle-range',`${cycle.start} — ${cycle.end} · ${cycle.closedDays}/${cycle.days}天已封账`);text('cycle-deficit',`${fmt(cycle.deficit)} kcal`);progress('cycle-progress',cycle.progress);text('cycle-pct',`目标完成 ${fmt(cycle.progress,1)}% / ${fmt(cycle.goal)} kcal`);text('cycle-equivalent',`理论脂肪当量 ${fmt(cycle.fatEquivalent,3)} kg`);text('cycle-note',cycle.unreported?`有 ${cycle.unreported} 天缺少有效进食记录，未按零摄入推算；消耗和外食热量均为估算。`:'已过日期根据现有记录自动封账。可补报更正，估算并不等于实测。');
 const entries=foodsForDay(state,selectedDate);const list=entries.slice(-12);
 $('day-food-list').innerHTML=list.length?list.map(e=>`<div class="event-row"><div class="event-main"><strong>${E(e.name)}</strong><small>${E(e.meal||'')} · ${E(e.portion||'')}</small></div><span class="event-value">${fmt(e.nutrition?.kcal)} kcal</span></div>`).join(''):'<div class="event-empty">这一天没有已确认的食品流水</div>';
 const ac=events(state,'activities').filter(a=>a.date===selectedDate);
 $('day-activity-list').innerHTML=ac.length?ac.map(a=>`<div class="event-row"><div class="event-main"><strong>${E(a.name)}</strong><small>${a.km===null?'':`${fmt(a.km,2)} km · `}${E(a.includedInBase?'包含在日常基线':'专项运动')}</small></div><span class="event-value">${a.kcal===null?'—':`${fmt(a.kcal)} kcal`}</span></div>`).join(''):'';
}
function renderWeightChart(points){
 const svg=$('weight-chart');if(!points.length){svg.innerHTML='<text x="25" y="95" fill="#8292a4" font-size="14">暂无有效晨重数据</text>';return;}
 const values=points.map(p=>p.kg),min=Math.floor(Math.min(...values)*2)/2-0.5,max=Math.ceil(Math.max(...values)*2)/2+0.5;
 const left=45,right=517,top=20,bottom=154,y=v=>bottom-(v-min)/(max-min)*(bottom-top),x=i=>left+((points.length===1?0.5:i/(points.length-1))*(right-left));
 const path=points.map((p,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(p.kg).toFixed(1)}`).join(' ');
 const ticks=Array.from({length:4},(_,i)=>min+i*(max-min)/3);
 svg.innerHTML=ticks.map(t=>`<line x1="40" y1="${y(t)}" x2="526" y2="${y(t)}" stroke="#e4ebf3" stroke-dasharray="3 4"/><text x="4" y="${y(t)+4}" font-size="11" fill="#8190a5">${fmt(t,1)}</text>`).join('')+`<path d="${path}" fill="none" stroke="#4775e7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`+
 points.map((p,i)=>`<circle cx="${x(i)}" cy="${y(p.kg)}" r="${i===points.length-1?5:3.3}" fill="#fff" stroke="#4775e7" stroke-width="2"/>`).join('')+
 [0,Math.floor((points.length-1)/2),points.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text x="${x(i)}" y="177" text-anchor="middle" fill="#8190a5" font-size="11">${E(points[i].date.slice(5))}</text>`).join('');
}
function setDateDefaults(){document.querySelectorAll('form input[name=date]').forEach(el=>{if(!el.value)el.value=dateNow();});}
const historyTypes={food:'foods',weight:'weights',activity:'activities'};
function renderRecord(){
 setDateDefaults();
 const date=$('history-date').value;
 const entries=Object.entries(historyTypes).flatMap(([type,key])=>events(state,key)
  .filter(e=>!date||e.date===date).map(e=>({...e,type}))).sort((a,b)=>b.date.localeCompare(a.date) || String(b.createdAt??'').localeCompare(String(a.createdAt??'')));
 $('local-events').innerHTML=entries.slice(0,100).map(e=>{
  const label=e.type==='weight'?`${e.kg} kg`:e.name;
  const status=({plan:'计划',cancelled:'已取消',actual:'实际'})[e.status] || e.status;
  const value=e.type==='weight'?e.isMorning||e.trendStatus?'晨重':'称重':fmt(e.nutrition?.kcal??e.kcal)+' kcal';
  return `<div class="event-row"><div class="event-main"><strong>${E(label)}</strong><small>${E(e.date)} · ${E(status||value)}${e.date<dateNow()&&e.source!=='legacy'?' · 补报或更正':''}</small></div><button class="btn btn-secondary" data-edit-id="${E(e.id)}" data-type="${e.type}" type="button">编辑</button><button class="btn btn-danger" data-delete-id="${E(e.id)}" data-type="${e.type}" type="button">删除</button></div>`;
 }).join('')||'<div class="event-empty">暂无记录</div>';
}
function editEvent(type,id){
 const row=events(state,historyTypes[type]).find(e=>e.id===id);
 if(!row)return;
 const form=$(`${type}-form`);
 editing[type]=id;
 form.reset();
 if(type==='food'){
  fillForm(form,{...row,...row.nutrition,status:row.source==='legacy'?(row.actual?'actual':row.status.includes('计划')?'plan':'cancelled'):row.status});
  updateBatches();
  form.elements.batchId.value=row.batchId??'';
  $('food-editing').hidden=$('cancel-food-edit').hidden=false;
 }else {
  fillForm(form,row);
  if(type==='weight')form.elements.isMorning.checked=!!(row.isMorning??/^(是|纳入|暂定纳入)/.test(row.trendStatus??''));
  if(type==='activity')form.elements.includedInBase.checked=!!row.includedInBase;
 }
 selectEntry(type);
 if(!$('health-entry').open)$('health-entry').showModal();
}
function fillForm(form,fields){
 for(const [key,value] of Object.entries(fields)){
  const el=form.elements.namedItem(key);
  if(el&&el.type!=='checkbox')el.value=value??'';
 }
}
function renderTrends(){
 const today=dateNow(), cycle=cycleForDate(state,today,today);
 const kilos=new Map(weightTrend(state).points.map(e=>[e.date,e.kg]));
 $('trend-days').innerHTML=`<p>本周期缺口 ${fmt(cycle.deficit)} kcal · 已结算 ${cycle.closedDays}/${cycle.days} 天</p>`+Array.from({length:14},(_,i)=>{
  const date=addDays(today,-i),intake=dayIntake(state,date),e=energyForDay(state,date,today);
  return `<div class="event-row"><div class="event-main"><strong>${date} · 晨重 ${fmt(kilos.get(date),2)} kg</strong><small>摄入 ${intake.incomplete.includes('kcal')?'≥ ':''}${fmt(intake.totals.kcal)} kcal · 蛋白质 ${fmt(intake.totals.protein,1)} g · 碳水 ${fmt(intake.totals.carbs,1)} g · 脂肪 ${fmt(intake.totals.fat,1)} g · 钠 ${fmt(intake.totals.sodium)} mg</small><small>${e.closed?'缺口 '+fmt(e.deficit)+' kcal':date===today?'待结算':'待补数据'} · 饮食成本 ${intake.cost===null?'未知':(intake.costPartial?'已知部分 ':'')+'¥'+fmt(intake.cost,2)}</small></div></div>`;
 }).join('');
}
function renderInventory(){
 const filter=$('inventory-search').value.trim().toLowerCase();const list=inventoryWithMoves(state).filter(i=>i.active && (i.name.toLowerCase().includes(filter)||i.id.toLowerCase().includes(filter)));
 list.sort((a,b)=>(Number(b.qty>0)-Number(a.qty>0))||a.name.localeCompare(b.name,'zh-CN'));
 $('inventory-list').innerHTML=list.slice(0,180).map(i=>`<div class="inv-row"><div class="event-main"><button class="btn btn-text" data-sku-edit="${E(i.id)}">${E(i.name)}</button><small>${E(i.standard)} · ${i.pricePerUnit===null?'单价未知':`原账价格字段 ¥${fmt(i.pricePerUnit,3)}（单位须核实）`}</small></div><div class="stock-qty ${i.qty!==null&&i.qty<=0?'low':''}">${i.qty===null?'待盘点':fmt(i.qty,2)}<small style="display:block;color:#8697a9;font-weight:400">${E(i.unit)}</small></div></div>`).join('')||'<div class="event-empty">没有匹配的库存食物</div>';
 const batches=batchBalances(state), byId=new Map(inventoryWithMoves(state).map(s=>[s.id,s]));
 const alerts=stockAlerts(state,dateNow());
 $('stock-alerts').textContent=[...alerts.low.map(s=>s.name+' 库存偏低'),...alerts.expiry.map(b=>byId.get(b.foodId)?.name+' 到期 '+b.expires)].join(' · ');
 $('batch-list').innerHTML=batches.filter(b=>b.remaining>0).map(b=>`<p>${E(byId.get(b.foodId)?.name)} · ${E(b.date)} · ${fmt(b.remaining,3)} ${E(byId.get(b.foodId)?.unit)} · ${b.costCents===null?'成本未知':('批次成本 ¥'+fmt(b.costCents/100,2))}${b.parent?' · 分装':''}</p>`).join('');
 $('stock-history').innerHTML=state.local.stockMoves.slice(-40).reverse().map(m=>`<div class="event-row"><span>${E(m.date)} · ${E(byId.get(m.foodId)?.name)} · ${E(m.reason)}</span><strong>${m.delta>0?'+':''}${fmt(m.delta,3)}</strong></div>`).join('');

}
function renderSettings(){
 const s=state.settings, form=$('settings-form');for(const k of settingKeys)form.elements[k].value=s[k];form.elements.preferences.value=s.preferences??'';
 const l=state.legacy;text('import-status',state.importInfo?`已导入：${state.importInfo.sourceVersion} · ${state.importedAt?.slice(0,10)}\n饮食 ${l.foods.length} 条 / 体重 ${l.weights.length} 条 / 运动 ${l.activities.length} 条 / 库存 ${l.inventory.length} 项；当前应用新增饮食 ${state.local.foods.length} 条。`:'尚未导入历史账本。可先手动添加记录，但更推荐导入旧账。');$('import-status').style.whiteSpace='pre-line';
}
function rebuildFoodSelection(){
 const inv=inventoryWithMoves(state).filter(i=>i.active).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 const opts=inv.map(i=>`<option value="${E(i.id)}">${E(i.name)} · ${E(i.standard)}</option>`).join('');
 for(const el of document.querySelectorAll('#food-select,#stock-food-select,[data-stock-options]')){
  const selected=el.value;
  el.innerHTML=(el.id==='food-select'?'<option value="">自定义食物</option>':'')+opts;
  if([...el.options].some(o=>o.value===selected))el.value=selected;
 }
 const batchOptions=batchBalances(state).filter(b=>b.remaining>0).map(b=>`<option value="${E(b.id)}">${E(inv.find(i=>i.id===b.foodId)?.name)} · ${E(b.date)} · 余 ${fmt(b.remaining,3)}</option>`).join('');
 for(const el of document.querySelectorAll('[data-batch-options]'))el.innerHTML=batchOptions;
 $('meal-template').innerHTML=(state.local.templates??[]).map(t=>`<option value="${E(t.id)}">${E(t.name)}</option>`).join('');
 updateBatches();
}
function updateBatches(){
 const form=$('food-form'),selected=form.elements.batchId.value;
 const edited=events(state,'foods').find(e=>e.id===editing.food);
 form.elements.batchId.innerHTML='<option value="">自动扣减</option>'+batchBalances(state,form.elements.foodId.value).filter(b=>b.foodId===form.elements.foodId.value&&(b.remaining>0||b.id===edited?.batchId))
  .map(b=>`<option value="${E(b.id)}">${E(b.date)} · 余 ${fmt(b.remaining,3)}</option>`).join('');
 if([...form.elements.batchId.options].some(o=>o.value===selected))form.elements.batchId.value=selected;
}
async function commit(next,message,snapshot){state=await saveState(next,state.revision ?? 0,globalThis.airplaneAccount,snapshot);rebuildFoodSelection();render();toast(message);}
async function removeEvent(type,id){
 if(!confirm('删除此记录并重新计算？'))return;
 const next=structuredClone(state);
 try{deleteEvent(next,historyTypes[type],id);await commit(next,'记录已删除');}
 catch(err){toast(err.message);}
}
function resetEditor(form,type){
 delete editing[type];dirtyEntries.delete(type);form.reset();setDateDefaults();
 if(type==='food')$('food-editing').hidden=$('cancel-food-edit').hidden=true;
}
function applyAmount(){
 const form=$('food-form'),sku=inventoryWithMoves(state).find(s=>s.id===form.elements.foodId.value);
 if(!sku)return;
 const quantity=numeric(form.elements.amount.value);
 const nutrition=suggestNutritionByInventory(sku,quantity);
 if(!nutrition){form.elements.stockQty.value='';return;}
 fillForm(form,nutrition);
 form.elements.stockQty.value=manualStockQty(sku,quantity)??'';
}
function download(name,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function backup(){download(`airplane-health-backup-${dateNow()}.json`,exportState(state));}
async function handleImport(file,kind){try{const raw=JSON.parse(await file.text());const imported=kind==='backup' ? raw : normalizeLedger(raw);
 if(kind==='ledger'&&JSON.stringify(state.legacy.sourceSnapshot)===JSON.stringify(raw)){toast('这份主账已导入');return;}
 if(!validateAppState(imported))throw Error('文件结构不正确');
 const msg=`准备导入${kind==='backup'?'健康备份':'主账 '+(imported.importInfo?.sourceVersion||'')}。\n饮食 ${imported.legacy.foods.length} 条、体重 ${imported.legacy.weights.length} 条、库存 ${imported.legacy.inventory.length} 项。\n将替换当前健康模块的数据。确定吗？`;
 $('import-preview').innerHTML=`<div class="notice notice-info">文件已解析：${E(file.name)}<br>饮食 ${imported.legacy.foods.length} 条 · 晨重 ${imported.legacy.weights.length} 条 · 库存 ${imported.legacy.inventory.length} 项</div>`;
 if(!confirm(msg))return;
 if(state.revision || state.importInfo || Object.values(state.local).some(list => list.length)) backup();
 await commit(imported,kind==='backup'?'健康备份恢复成功':'历史健康数据已导入',combinedBackup(state,null));$('health-settings-sheet').close();switchTab('overview');
 }catch(e){toast('导入失败：'+e.message);}}
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
 updatePurchases=attachPurchases({getState:()=>state,commit,notify:toast,switchTab,today:dateNow});
 attachCombinedBackup({getState:()=>state,setState:next=>{state=next;rebuildFoodSelection();render();},notify:toast,download});
 for(const select of document.querySelectorAll('[data-units]'))select.innerHTML=units.map(u=>`<option>${E(u)}</option>`).join('');
 document.querySelector('[data-nutrients]').innerHTML=NUTRIENTS.map((k,i)=>`<label>${['热量 kcal','蛋白质 g','碳水 g','脂肪 g','钠 mg'][i]}<input type="number" name="${k}" min="0" step="any"></label>`).join('');

 $('open-health-ai').onclick=()=>{$('health-ai-sheet').showModal();$('assistant-form').elements.text.focus();};
 $('add-health').onclick=openEntry;
 for(const type of Object.keys(historyTypes)) $(`${type}-form`).addEventListener('input',()=>dirtyEntries.add(type));
 $('health-settings').onclick=openSettings;
 document.querySelectorAll('[data-entry]').forEach(b=>b.onclick=()=>selectEntry(b.dataset.entry));
 document.querySelectorAll('.health-sheet').forEach(d=>d.addEventListener('close',()=>{
  const t=$('toast');
  if(d.contains(t))document.body.append(t);
 }));
 attachAssistant({getState:()=>state, commit, today:dateNow});
 $('check-update').onclick=()=>checkForAppUpdate(true);
 document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
 $('report-date').addEventListener('change',e=>{if(validDate(e.target.value)){selectedDate=e.target.value;renderOverview();}});
 $('jump-import').addEventListener('click',openSettings);$('quick-record').addEventListener('click',openEntry);$('inventory-search').addEventListener('input',()=>renderInventory());
 $('history-date').onchange=renderRecord;
 $('local-events').onclick=e=>{
  const button=e.target.closest('[data-type]');
  if(button?.dataset.editId)editEvent(button.dataset.type,button.dataset.editId);
  if(button?.dataset.deleteId)removeEvent(button.dataset.type,button.dataset.deleteId);
 };
 $('cancel-food-edit').onclick=()=>resetEditor($('food-form'),'food');
 $('food-select').onchange=()=>{
  const form=$('food-form'),sku=inventoryWithMoves(state).find(s=>s.id===form.elements.foodId.value);
  form.elements.stockQty.value='';updateBatches();
  if(!sku)return;
  const [amount,unit]=basis(sku);
  fillForm(form,{name:sku.name,amount,portion:`${amount} ${unit}`});
  form.elements.amount.placeholder='份量单位：'+unit;
  applyAmount();
 };
 $('food-form').elements.amount.oninput=applyAmount;
 $('apply-weight').onclick=()=>{
  const form=$('food-form'),fields=Object.fromEntries(new FormData(form));
  try{
   const sku=inventoryWithMoves(state).find(s=>s.id===fields.foodId);
   const batch=batchBalances(state).find(b=>b.id===fields.batchId);
   const grams=measuredGrams(fields)??numeric(fields.amount);
   if(!(grams>0)||sku&&basis(sku)[1]!=='g')throw Error('请填写有效称重。此换算要求食品营养按克计');
   const stage=sku?.stage??'raw';
   const amount=convertCookingWeight(grams,fields.measuredStage,stage,numeric(fields.raw)??batch?.raw,numeric(fields.cooked)??batch?.cooked);
   fillForm(form,{amount,portion:`${grams} g（${fields.measuredStage==='cooked'?'熟重':'生重'}）`});
   applyAmount();
   if(sku?.unit==='g') form.elements.stockQty.value=convertCookingWeight(grams,fields.measuredStage,sku.stockStage??stage,numeric(fields.raw)??batch?.raw,numeric(fields.cooked)??batch?.cooked);
  }catch(err){toast(err.message);}
 };
 $('save-template').onclick=async()=>{
  const date=$('history-date').value||selectedDate,meal=$('template-meal').value;
  const items=foodsForDay(state,date).filter(e=>e.meal===meal);
  if(!items.length){toast('所选日期和餐次没有实际记录');return;}
  const name=prompt('模板名称',meal)?.trim();
  if(!name)return;
  const next=structuredClone(state);
  (next.local.templates??=[]).push({id:makeId('meal'),name,items});
  try{await commit(next,'已保存餐食模板');}catch(err){toast(err.message);}
 };
 $('use-template').onclick=async()=>{
  const form=$('food-form'),t=(state.local.templates??[]).find(t=>t.id===$('meal-template').value);
  if(!t||!confirm('录入餐食模板「'+t.name+'」？'))return;
  const {date,meal,status}=Object.fromEntries(new FormData(form)),next=structuredClone(state);
  try{
   for(const item of t.items)addFood(next,{...item,...item.nutrition,date,meal,status,batchId:null,cost:null});
   await commit(next,'已录入餐食模板');
   $('health-entry').close();
  }catch(err){toast(err.message);}
 };
 bindForm('food', (next,d)=>addFood(next,d,editing.food),'饮食已保存');
 bindForm('weight',(next,d,f)=>{
  const kg=numeric(d.kg);
  if(!validDate(d.date)||!(kg>=20&&kg<=500))throw Error('请填写有效体重');
  recordEvent(next,'weights',{date:d.date,kg,isMorning:f.elements.isMorning.checked},editing.weight);
 },'体重已保存');
 bindForm('activity',(next,d,f)=>{
  if(!validDate(d.date)||!d.name?.trim())throw Error('请填写运动日期和名称');
  recordEvent(next,'activities',{...d,km:numeric(d.km),kcal:numeric(d.kcal),minutes:numeric(d.minutes),
   includedInBase:d.energyKind!=='total'&&f.elements.includedInBase.checked},editing.activity);
 },'运动已保存');
 bindForm('stock',(next,d,f)=>localStockChange(next,{...d,count:f.elements.count.checked}),'库存变化已保存');
 bindForm('sku',(next,d)=>saveSku(next,d),'食品已保存');
 bindForm('batch',(next,d)=>addBatch(next,{...d,expires:d.expires||null,raw:numeric(d.raw),cooked:numeric(d.cooked),
  costCents:numeric(d.cost)===null?null:Math.round(+d.cost*100)}),'批次已入库');
 bindForm('split',(next,d)=>splitBatch(next,d),'分装已完成');
 $('new-sku').onclick=()=>$('sku-form').reset();
 $('inventory-list').onclick=e=>{
  const row=inventoryWithMoves(state).find(s=>s.id===e.target.dataset.skuEdit);
  if(!row)return;
  const [basisAmount,basisUnit]=basis(row);
  const form=$('sku-form');
  form.reset();
  fillForm(form,{...row,...row.nutrition,price:row.priceBasis===row.unit?row.pricePerUnit:null,basisAmount,basisUnit});
  form.closest('details').open=true;form.scrollIntoView({block:'start'});
 };
 $('settings-form').onsubmit=async e=>{
  e.preventDefault();const fields=Object.fromEntries(new FormData(e.target)),next=structuredClone(state);
  if(+fields.proteinMin>+fields.proteinMax){toast('蛋白质下限不能大于上限');return;}
  for(const k of settingKeys)next.settings[k]=k==='cycleAnchor'?fields[k]:Number(fields[k]);
  next.settings.preferences=fields.preferences.trim();
  try{await commit(next,'参数已更新');}catch(err){toast(err.message);}
 };
 $('choose-import').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',e=>{if(e.target.files[0])handleImport(e.target.files[0],'ledger');e.target.value='';});
 $('choose-restore').addEventListener('click',()=>$('restore-file').click());$('restore-file').addEventListener('change',e=>{if(e.target.files[0])handleImport(e.target.files[0],'backup');e.target.value='';});
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