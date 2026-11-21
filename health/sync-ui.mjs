import {localDate} from '../calendar.mjs';
import {readFinance} from '../finance-storage.mjs';
import {APP_VERSION} from '../shell.mjs';
import {readRestoreSnapshot,readState} from './storage.mjs';
import {importSource} from './sync-source.mjs';
import {planHealthMerge} from './sync.mjs';
import {commitHealthMerge,createSyncPackage,financeStamp,HEALTH_FILE_STATUS_KEY} from './sync-io.mjs';

const states={added:'新增',existing:'已导入',same:'相同',corrected:'已更正',suspect:'疑似重复或待核对',conflict:'冲突'};
function element(tag,text,css){
 const node=document.createElement(tag);
 if(text!=null)node.textContent=text;
 if(css)node.className=css;
 return node;
}
const stringify=value=>JSON.stringify(value,null,2);

export function attachHealthMerge(panel,{account,setState,notify,download}){
 const find=selector=>panel.querySelector(selector);
 const file=find('[data-sync-file]'),preview=find('[data-sync-preview]'),info=find('[data-sync-info]');
 const changes=find('[data-sync-changes]'),summary=find('[data-sync-summary]'),impact=find('[data-sync-impact]');
 const apply=find('[data-sync-apply]'),keep=find('[data-sync-keep]'),sourceInput=find('[data-sync-source]');
 let job=null,sequence=0,busy=false;
 function clear(){
  sequence++;job=null;preview.hidden=true;info.textContent='';changes.replaceChildren();impact.replaceChildren();
 }
 function render(){
  if(!job)return;
  const {plan,source,choices}=job;
  preview.hidden=false;
  info.textContent=source.label+' · '+source.version+' · '+source.id;
  const counter=Object.fromEntries(Object.keys(states).map(key=>[key,0]));
  for(const record of plan.rows)counter[record.status]++;
  summary.textContent=Object.entries(counter).filter(([,count])=>count).map(([key,n])=>states[key]+' '+n).join(' · ')||'该文件没有可合并的健康数据。';
  if(source.finance)summary.textContent+='。文件含财务数据，本次仅处理健康账。';
  changes.replaceChildren();
  for(const problem of plan.problems)changes.append(element('p',problem,'sync-problem'));
  const cards={};
  for(const record of plan.rows){
   const compact=['same','existing'].includes(record.status);
   const section=cards[compact]??=element('details');
   if(!section.firstChild){
    section.append(element('summary',compact?'已有或相同记录':'待核对与计划改动'));
    section.open=!compact;changes.append(section);
   }
   const name=record.after?.name??record.before?.name??record.after?.date??record.before?.date??record.after?.key??record.before?.key??'';
   const card=element('details',undefined,'sync-change');
   card.append(element('summary',[states[record.status],record.label,name].filter(Boolean).join(' · ')));
   if(record.options.length){
    card.open=true;
    const label=element('label','处理方式');
    const select=element('select');
    select.dataset.syncChoice=record.id;
    select.add(new Option('请选择',''));
    for(const item of record.options)select.add(new Option(item.label,item.value));
    select.value=record.chosen??'';
    select.onchange=()=>{
     const value=select.value;
     if(value)choices[record.id]=value;else delete choices[record.id];
     recalculate(record.id);
    };
    label.append(select);card.append(label);
   }
   if(record.impact)card.append(element('p',record.impact,'form-hint'));
   const comparison=element('div',undefined,'sync-values');
   for(const [side,value] of [['本机原值',record.before],['来源值',record.after]]){
    const group=element('section');
    group.append(element('strong',side),element('pre',value===null?'—':stringify(value)));
    comparison.append(group);
   }
   card.append(comparison);section.append(card);
  }
  impact.replaceChildren();
  impact.hidden=plan.impact.length===0;
  if(plan.impact.length){
   impact.append(element('summary','受影响日期与营养、消耗预览'));
   for(const row of plan.impact)impact.append(element('p',row.date+' · 摄入 '+(row.before.kcal??'待补')+
    ' → '+(row.after.kcal??'待补')+' kcal · 消耗 '+row.tdeeBefore+' → '+row.tdeeAfter+' kcal'));
   impact.append(element('pre',stringify(plan.impact)));
  }
  keep.hidden=!plan.unresolved.some(row=>row.options.some(option=>['keep','skip'].includes(option.value)));
  apply.disabled=busy||!plan.changed||plan.unresolved.length>0||plan.problems.length>0;
 }
 function recalculate(focus){
  if(!job)return;
  try{
   job.plan=planHealthMerge(job.current,job.source,{choices:job.choices,finance:job.finance.payload});
   render();
   if(focus)changes.querySelector('[data-sync-choice="'+CSS.escape(focus)+'"]')?.focus({preventScroll:true});
  }catch(error){apply.disabled=true;notify(error.message);}
 }
 async function load(input,label){
  const token=++sequence;
  info.textContent='正在读取并比较本机账本…';
  summary.textContent=''; changes.replaceChildren(); impact.replaceChildren();
  preview.hidden=false;
  apply.disabled=true;
  try{
   const source=importSource(input,{label,identity:sourceInput.value.trim()||undefined});
   const [current,finance]=await Promise.all([readState(account),Promise.resolve().then(()=>readFinance(account.finance))]);
   if(token!==sequence)return;
   job={current,finance,source,choices:{},input,label};recalculate();
  }catch(error){
   if(token!==sequence)return;
   clear();notify(error.message);
  }
 }
 find('[data-sync-choose]').onclick=()=>file.click();
 file.onchange=async()=>{
  const selected=file.files[0];file.value='';
  if(!selected)return;
  clear();
  const picked=sequence;
  try{
   const text=await selected.text();
   if(picked===sequence)await load(JSON.parse(text),selected.name);
  }catch{if(picked===sequence)notify('无法读取 JSON 文件');}
 };
 sourceInput.onchange=()=>{if(job&&!busy)void load(job.input,job.label);};
 keep.onclick=()=>{
  for(const row of job.plan.unresolved){
   const option=row.options.find(item=>['keep','skip'].includes(item.value));
   if(option)job.choices[row.id]=option.value;
  }
  recalculate();
 };
 find('[data-sync-cancel]').onclick=clear;
 panel.closest('dialog').addEventListener('close',clear);
 apply.onclick=async()=>{
  if(!job||busy)return;
  busy=true;apply.disabled=true;
  try{
   const saved=await commitHealthMerge(job.current,job.plan,financeStamp(job.finance),account);
   setState(saved);clear();notify('已合并到本机，已保留合并前完整快照。');
  }catch(error){notify(error.message);}
  finally{busy=false;if(job)render();}
 };
 find('[data-sync-snapshot]').onclick=async()=>{
  try{
   const snapshot=await readRestoreSnapshot(account);
   if(!snapshot)throw Error('暂无恢复前快照');
   download('airplane-before-merge-backup.json',stringify(snapshot));
  }catch(error){notify(error.message);}
 };
 find('[data-sync-export]').onclick=async()=>{
  try{
   const current=await readState(account);
   const key='airplane-health-sync-device-v1';
   let id=account.finance.getItem(key);
   if(!id){id=crypto.randomUUID();account.finance.setItem(key,id);}
   const pack=createSyncPackage(current,{id,version:APP_VERSION});
   download('airplane-health-sync-'+localDate()+'.json',stringify(pack));
   try{account.finance.setItem(HEALTH_FILE_STATUS_KEY,JSON.stringify({issuedAt:pack.anchor.exportedAt,revision:current.revision??0}));}
   catch{/* Download is independent of the device's status display. */}
   notify('已生成同步包，请手动带回外部主账。');
  }catch(error){notify(error.message);}
 };
}

export function renderSyncCatalog(panel,state){
 const groups={aliases:'食品别名',prices:'单价目录',purchaseEvents:'外部采购',inventoryAudit:'库存审计',pendingStock:'扣库待核对',rules:'现行规则'};
 const catalogs={...state.legacy.catalogs,rules:state.legacy.rules,pendingStock:state.sync?.pendingStock};
 panel.replaceChildren(...Object.entries(groups).flatMap(([key,label])=>{
  const rows=catalogs[key]??[];
  if(!rows.length)return [];
  const list=element('details'),summary=element('summary',label+' · '+rows.length);
  list.append(summary);
  for(const row of rows){
   const item=element('details');
   item.append(element('summary',[row.date,row.name??row.key,row.alias].filter(Boolean).join(' · ')||row.id),
    element('pre',stringify(row)));
   list.append(item);
  }
  return [list];
 }));
 panel.hidden=!panel.childElementCount;
}
