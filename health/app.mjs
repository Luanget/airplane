import {manualStockQty,basis} from './candidates.mjs';
import {attachAssistant} from './assistant.mjs';
import {checkForAppUpdate} from '../updates.mjs';
import {newState,normalizeLedger,validateAppState,APP_SCHEMA,numeric,round,zero,makeId,addFood,localStockChange,dayIntake,energyForDay,cycleForDate,weightTrend,foodsForDay,inventoryWithMoves,suggestNutritionByInventory,validDate,NUTRIENTS} from './core.mjs';
import {readState,saveState,exportState} from './storage.mjs';
const $=id=>document.getElementById(id);
const E=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=(v,d=0)=> v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
const dateNow=()=>{const d=new Date();const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;};
let state=newState(), selectedDate=dateNow(),tab='overview',toastHandle;
function toast(message){const t=$('toast');t.textContent=String(message);t.classList.add('show');clearTimeout(toastHandle);toastHandle=setTimeout(()=>t.classList.remove('show'),3500);}
function text(id,value){$(id).textContent=String(value);}
function switchTab(next){tab=next;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===next));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('hidden',x.id!==`view-${next}`));render();window.scrollTo({top:0,behavior:'instant'});}
function render(){ if(tab==='overview')renderOverview();if(tab==='record')renderRecord();if(tab==='inventory')renderInventory();if(tab==='settings')renderSettings(); }
function progress(id,val){$(id).style.width=`${Math.max(0,Math.min(100,Number(val)||0))}%`;}
function renderOverview(){
 const today=dateNow(),intake=dayIntake(state,selectedDate),cals=intake.totals.kcal,known=intake.reported;
 const goal=state.settings.calorieTarget;
 $('welcome').hidden=!!state.importInfo||state.local.foods.length>0||state.local.weights.length>0;
 $('report-date').value=selectedDate;
 text('today-status',selectedDate<today?(known?'次日封账':'缺少记录'):selectedDate===today?'当天待结算':'未来日期');
 text('hero-calories',known?fmt(cals,0):'—'); text('hero-goal',`目标 ${fmt(goal)} kcal`);
 text('hero-remaining',known?(goal-cals>=0?`剩余 ${fmt(goal-cals,0)} kcal`:`超出 ${fmt(cals-goal,0)} kcal`):'暂无食物记录');progress('cal-progress',known?cals/goal*100:0);
 for (const [id,key,unit] of [['protein-stat','protein','g'],['fat-stat','fat','g'],['carbs-stat','carbs','g'],['sodium-stat','sodium','mg']])text(id,known?`${fmt(intake.totals[key],key==='sodium'?0:1)} ${unit}`:'—');
 text('protein-goal',`目标 ${state.settings.proteinMin}–${state.settings.proteinMax}g`);text('fat-goal',`目标 ≥${state.settings.fatMin}g`);
 const weights=weightTrend(state);text('weight-stat',weights.last?`${fmt(weights.last.kg,2)} kg`:'—');text('weight-date',weights.last?weights.last.date:'尚未录入');text('weight-average',weights.last7!==null?`${fmt(weights.last7,2)} kg`:'—');text('weight-trend',weights.delta!==null?`滚动变化 ${weights.delta>0?'+':''}${fmt(weights.delta,2)} kg`:'需至少8次有效晨重');renderWeightChart(weights.points.slice(-14));
 text('cycle-title',state.settings.cycleDays===6?'六天减脂周期':state.settings.cycleDays+' 天减脂周期');
 const cycle=cycleForDate(state,selectedDate,today);text('cycle-range',`${cycle.start} — ${cycle.end} · ${cycle.closedDays}/${cycle.days}天已封账`);text('cycle-deficit',`${fmt(cycle.deficit)} kcal`);progress('cycle-progress',cycle.progress);text('cycle-pct',`目标完成 ${fmt(cycle.progress,1)}% / ${fmt(cycle.goal)} kcal`);text('cycle-equivalent',`理论脂肪当量 ${fmt(cycle.fatEquivalent,3)} kg`);text('cycle-note',cycle.unreported?`有 ${cycle.unreported} 天缺少有效进食记录，未按零摄入推算；消耗和外食热量均为估算。`:'已过日期根据现有记录自动封账。可补报更正，估算并不等于实测。');
 const entries=foodsForDay(state,selectedDate);const list=entries.slice(-12);
 $('day-food-list').innerHTML=list.length?list.map(e=>`<div class="event-row"><div class="event-main"><strong>${E(e.name)}</strong><small>${E(e.meal||'')} · ${E(e.portion||'')}</small></div><span class="event-value">${fmt(e.nutrition?.kcal)} kcal</span></div>`).join(''):'<div class="event-empty">这一天没有已确认的食品流水</div>';
 const ac=[...state.legacy.activities,...state.local.activities].filter(a=>a.date===selectedDate);
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
function renderRecord(){setDateDefaults();const entries=[...state.local.foods.slice(-12).map(x=>({...x,type:'food'})),...state.local.weights.slice(-6).map(x=>({...x,type:'weight'})),...state.local.activities.slice(-6).map(x=>({...x,type:'activity'}))].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,15);
 $('local-events').innerHTML=entries.length?entries.map(e=>{const label=e.type==='food'?e.name:e.type==='weight'?`${e.kg} kg`:`${e.name} ${e.km??''}km`;const value=e.type==='food'?`${fmt(e.nutrition.kcal)} kcal`:e.type==='activity'?`${fmt(e.kcal)} kcal`:'';return `<div class="event-row"><div class="event-main"><strong>${E(label)} ${e.status==='plan'?'<span class="tag tag-plan">计划</span>':''}</strong><small>${E(e.date)} · ${E(e.type==='food'?e.meal:e.type==='weight'?'晨重':'活动')}</small></div><span class="event-value">${value}</span><button class="btn btn-danger" data-delete-id="${E(e.id)}" data-delete-type="${e.type}" type="button" aria-label="删除该条本地记录">删除</button></div>`;}).join(''):'<div class="event-empty">暂无自行添加的记录</div>';
 document.querySelectorAll('[data-delete-id]').forEach(btn=>btn.addEventListener('click',()=>deleteLocal(btn.dataset.deleteId,btn.dataset.deleteType)));
}
function renderInventory(){
 const filter=$('inventory-search').value.trim().toLowerCase();const list=inventoryWithMoves(state).filter(i=>i.active && (i.name.toLowerCase().includes(filter)||i.id.toLowerCase().includes(filter)));
 list.sort((a,b)=>(Number(b.qty>0)-Number(a.qty>0))||a.name.localeCompare(b.name,'zh-CN'));
 $('inventory-list').innerHTML=list.slice(0,180).map(i=>`<div class="inv-row"><div class="event-main"><strong>${E(i.name)}</strong><small>${E(i.standard)} · ${i.pricePerUnit===null?'单价未知':`原账价格字段 ¥${fmt(i.pricePerUnit,3)}（单位须核实）`}</small></div><div class="stock-qty ${i.qty!==null&&i.qty<=0?'low':''}">${i.qty===null?'待盘点':fmt(i.qty,2)}<small style="display:block;color:#8697a9;font-weight:400">${E(i.unit)}</small></div></div>`).join('')||'<div class="event-empty">没有匹配的库存食物</div>';
}
function renderSettings(){
 const s=state.settings, form=$('settings-form');for(const k of ['calorieTarget','baselineTdee','cycleTarget','cycleDays','cycleAnchor'])form.elements[k].value=s[k];
 const l=state.legacy;text('import-status',state.importInfo?`已导入：${state.importInfo.sourceVersion} · ${state.importedAt?.slice(0,10)}\n饮食 ${l.foods.length} 条 / 体重 ${l.weights.length} 条 / 运动 ${l.activities.length} 条 / 库存 ${l.inventory.length} 项；当前应用新增饮食 ${state.local.foods.length} 条。`:'尚未导入历史账本。可先手动添加记录，但更推荐导入旧账。');$('import-status').style.whiteSpace='pre-line';
}
function rebuildFoodSelection(){const inv=inventoryWithMoves(state);const opts='<option value="">自定义食物</option>'+inv.filter(i=>i.active).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(i=>`<option value="${E(i.id)}">${E(i.name)} · ${E(i.standard)}</option>`).join('');$('food-select').innerHTML=opts;$('stock-food-select').innerHTML=opts.replace('<option value="">自定义食物</option>','');}
async function commit(next,message){state=await saveState(next,state.revision ?? 0);rebuildFoodSelection();render();toast(message);}
async function deleteLocal(id,type){if(!confirm('删除这条本地记录？关联的库存扣减也会撤销。历史导入记录不会被修改。'))return;const next=structuredClone(state);const key=type==='food'?'foods':type==='weight'?'weights':'activities';next.local[key]=next.local[key].filter(x=>x.id!==id);if(type==='food')next.local.stockMoves=next.local.stockMoves.filter(x=>x.linkedFoodId!==id);try{await commit(next,'已删除该条本地记录');}catch(e){toast(e.message);}}
function download(name,content){const blob=new Blob([content],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function backup(){download(`airplane-health-backup-${dateNow()}.json`,exportState(state));}
async function handleImport(file,kind){try{const raw=JSON.parse(await file.text());const imported=kind==='backup' ? raw : normalizeLedger(raw);
 if(!validateAppState(imported))throw Error('文件结构不正确');
 const msg=`准备导入${kind==='backup'?'健康备份':'主账 '+(imported.importInfo?.sourceVersion||'')}。\n饮食 ${imported.legacy.foods.length} 条、体重 ${imported.legacy.weights.length} 条、库存 ${imported.legacy.inventory.length} 项。\n将替换当前健康模块的数据。确定吗？`;
 $('import-preview').innerHTML=`<div class="notice notice-info">文件已解析：${E(file.name)}<br>饮食 ${imported.legacy.foods.length} 条 · 晨重 ${imported.legacy.weights.length} 条 · 库存 ${imported.legacy.inventory.length} 项</div>`;
 if(!confirm(msg))return;
 if(state.revision || state.importInfo || Object.values(state.local).some(list => list.length)) backup();
 await commit(imported,kind==='backup'?'健康备份恢复成功':'历史健康数据已导入');switchTab('overview');
 }catch(e){toast('导入失败：'+e.message);}}
function attach(){
 attachAssistant({getState:()=>state, commit, today:dateNow});
 $('check-update').onclick=()=>checkForAppUpdate(true);
 document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
 $('report-date').addEventListener('change',e=>{if(validDate(e.target.value)){selectedDate=e.target.value;renderOverview();}});
 $('jump-import').addEventListener('click',()=>switchTab('settings'));$('quick-record').addEventListener('click',()=>switchTab('record'));$('inventory-search').addEventListener('input',()=>renderInventory());
 $('food-select').addEventListener('change',()=>{
  const id=$('food-select').value,item=inventoryWithMoves(state).find(x=>x.id===id);const f=$('food-form');f.elements.stockQty.value='';if(!item)return;
  f.elements.name.value=item.name;f.elements.portion.value=item.standard;
  f.elements.amount.placeholder='份量单位：'+basis(item)[1];
  f.elements.amount.value='';for(const key of NUTRIENTS)f.elements[key].value=item.nutrition?.[key] ?? '';
 });
 $('food-form').elements.amount.addEventListener('input',()=>{
  const f=$('food-form'),item=inventoryWithMoves(state).find(x=>x.id===f.elements.foodId.value);if(!item)return;
  const nut=suggestNutritionByInventory(item,f.elements.amount.value);if(!nut){f.elements.stockQty.value='';return;}
  for(const key of NUTRIENTS)f.elements[key].value=nut[key] ?? '';
  const quantity=Number(f.elements.amount.value);f.elements.stockQty.value=manualStockQty(item,quantity) ?? '';
  // Legacy price units are heterogeneous: do not invent an automatic cost allocation.
 });
 $('food-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;const next=structuredClone(state);try{const fields=Object.fromEntries(new FormData(f));addFood(next,fields);await commit(next,fields.status==='plan'?'已保存计划（不计入热量）':'饮食已入账');f.reset();setDateDefaults();}catch(err){toast('未保存：'+err.message);}});
 $('weight-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,fields=Object.fromEntries(new FormData(f));const kg=numeric(fields.kg);if(!validDate(fields.date)||kg===null||kg<20||kg>500){toast('请填写有效体重');return;}const next=structuredClone(state);next.local.weights=next.local.weights.filter(x=>x.date!==fields.date);next.local.weights.push({id:makeId('weight'),date:fields.date,kg,isMorning:f.elements.isMorning.checked,source:'manual',createdAt:new Date().toISOString()});try{await commit(next,'晨重已记录');f.reset();setDateDefaults();}catch(err){toast(err.message);}});
 $('activity-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f));if(!validDate(d.date)||!d.name?.trim()||numeric(d.kcal)===null){toast('请填写运动日期、名称、热量');return;}const next=structuredClone(state);next.local.activities.push({id:makeId('activity'),date:d.date,name:d.name.trim(),km:numeric(d.km),kcal:+d.kcal,includedInBase:f.elements.includedInBase.checked,source:'manual',createdAt:new Date().toISOString()});try{await commit(next,'运动已记录');f.reset();setDateDefaults();}catch(err){toast(err.message);}});
 $('stock-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f));const next=structuredClone(state);try{localStockChange(next,d);await commit(next,'库存变化已记录');f.reset();setDateDefaults();}catch(err){toast(err.message);}});
 $('settings-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f));if(!validDate(d.cycleAnchor)){toast('周期日期无效');return;}const next=structuredClone(state);for(const k of ['calorieTarget','baselineTdee','cycleTarget','cycleDays'])next.settings[k]=Number(d[k]);next.settings.cycleAnchor=d.cycleAnchor;try{await commit(next,'参数已更新');}catch(err){toast(err.message);}});
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