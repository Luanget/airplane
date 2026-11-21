import {confirmPackageAction,packagesFor,planPackageDay,previewPackageAction,revisePackageFood,selectPackage} from './containers.mjs';
import {managedFoodPackage,onShelf} from './container-ledger.mjs';
import {events,makeId,NUTRIENTS} from './core.mjs';
import {localClock,syncCalendarFields} from '../calendar.mjs';
import {syncChoiceFields} from '../choice-picker.mjs';

const format=value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:3});
const statusLabel={sealed:'未开',open:'已开',empty:'已用完',discarded:'已丢弃'};
export const packageLabel=row=>row.kind+' '+(row.number??row.ordinal+1);

export function packageSummary(rows){
 const active=rows.filter(onShelf);
 if(!active.length)return '';
 if(active.every(row=>row.stockMode==='portion'||row.stockMode==='estimated')){
  const amount=active.every(row=>row.net!=null)?(active.some(row=>row.estimated)?'约':'')+
   format(active.reduce((sum,row)=>sum+row.net,0))+' g':'净余待确认';
  return active.length+active[0].kind+' · '+amount;
 }
 return ['sealed','open'].map(status=>{
  const n=active.filter(row=>row.status===status).length;
  return n?statusLabel[status]+n+active[0].kind:null;
 }).filter(Boolean).join(' · ');
}

export function packageDetail(row){
 if(row.status==='empty'||row.status==='discarded')return statusLabel[row.status];
 if(row.gross!=null)return '最新毛重 '+format(row.gross)+' g · '+(row.net===null?'净余未知':(row.estimated?'估计':'')+'净余 '+format(row.net)+' g')+
  (row.eaten?' · 已吃 '+format(row.eaten)+' g':'');
 if(row.net!=null)return (row.estimated?'约 ':'')+format(row.net)+' g · '+(row.estimated?'估算':'净重');
 if(row.nominal)return '标称 '+format(row.nominal.value)+' '+row.nominal.unit;
 return '净含量未知';
}

export function attachPackages(dialog,{getState,commit,notify,today}){
 const form=dialog.querySelector('form'),f=form.elements;
 const title=dialog.querySelector('h2'),desc=dialog.querySelector('[data-package-description]');
 const preview=dialog.querySelector('[data-package-preview]'),submit=form.querySelector('[type=submit]');
 const optionsPanel=form.querySelector('.package-options');
 let current=null,busy=false;
 function input(){
  const values=Object.fromEntries(new FormData(form));
  for(const el of form.elements)if(el.name&&el.closest('label')?.hidden)delete values[el.name];
  return {...values,action:f.action.value,foodId:current.foodId,containerId:current.containerId,id:current.id,time:localClock(),
   expectedHead:current.head};
 }
 function update(){
  if(!current)return;
  const action=f.action.value,edit=current.edit;
  const show=(key,value)=>f[key].closest('label').hidden=!value;
  const gross=edit&&action==='eat'||!edit&&['baseline','eat','loss','refill','reweigh'].includes(action);
  show('gross',gross);
  show('grams',['net','portion'].includes(action));
  show('lunchGrams',action==='plan');
  show('dinnerGrams',action==='plan');
  show('volumeMl',!edit&&action==='eat'&&current.volume);
  show('tare',!edit&&(['empty','discard'].includes(action)||f.optionalTare.checked&&gross));
  show('meal',edit||['eat','net'].includes(action));
  show('reason',action==='reweigh');
  f.optionalTare.closest('label').hidden=edit||!gross||['empty','discard'].includes(action);
  form.querySelector('[data-gross-label]').textContent=action==='baseline'?'初始毛重（g）':'最新毛重（g）';
  form.querySelector('[data-grams-label]').textContent=action==='portion'?'确认的净重（g）':'本次食用净重（g）';
  submit.textContent=edit?'保存更正':({empty:'确认已用完',discard:'确认丢弃',eat:'确认记录饮食',net:'确认记录饮食',plan:'保存当天计划'})[action]??'保存';
  preview.hidden=false;submit.disabled=busy;
  if(edit){preview.hidden=true;return;}
  const data=input();
  if(action==='plan'){
   preview.textContent='午餐和晚餐使用同一份。实际食用时再记录。';
   submit.disabled=busy||!data.lunchGrams&&!data.dinnerGrams;
   return;
  }
  if(gross&&data.gross===''||['net','portion'].includes(action)&&data.grams===''||action==='reweigh'&&!data.reason?.trim()){
   preview.hidden=true;submit.disabled=true;return;
  }
  try{
   const result=previewPackageAction(getState(),data);
   if(result.noop){preview.textContent='毛重没有变化';submit.disabled=true;return;}
   const food=result.food;
   if(food){
    const labels=['','蛋白质 ','碳水 ','脂肪 ','钠 '],units=['kcal','g','g','g','mg'];
    const numbers=NUTRIENTS.map((key,i)=>food[key]==null?null:
     labels[i]+Number(food[key].toFixed(1))+' '+units[i]).filter(Boolean).join(' · ');
    const money=food.cost==null?'成本待核':'成本'+(result.container.actualNetGrams==null?'约':'')+' ¥'+food.cost.toFixed(2);
    preview.textContent='本次食用 '+format(result.difference)+' g'+(numbers?' · '+numbers:' · 营养待核')+' · '+money;
   }else if(action==='discard')preview.textContent=result.difference==null?'关闭包装，损耗克数未知。':'只记录损耗 '+format(result.difference)+' g。';
   else if(action==='empty')preview.textContent='关闭此包装，保留原有饮食和称重。';
   else if(result.difference!=null)preview.textContent='本次 '+format(result.difference)+' g';
   else preview.hidden=true;
  }catch(error){
   preview.textContent=error.message;submit.disabled=true;
  }
 }
 function open({foodId,containerId,editId,skuName,trigger}){
  const state=getState();
  const relation=editId?managedFoodPackage(state,editId):null;
  const container=relation?packagesFor(state,foodId).find(row=>row.id===relation.container.id):
   selectPackage(state,{foodId,containerId});
  if(!container)return;
  form.reset();
  current={foodId:container.foodId,containerId:container.id,head:container.head,id:makeId('weigh'),edit:editId,trigger,
   volume:container.nominal?.unit==='mL'};
  title.textContent=editId?'更正称重':'包装称重';
  desc.textContent=[skuName,packageLabel(container),packageDetail(container)].filter(Boolean).join(' · ');
  f.date.value=today();
  const options=container.gross==null ?
   [[container.net!=null?'net':'baseline',container.net!=null?'记录食用净重':'记录初始毛重'],
    ...(container.net!=null?[['baseline','称初始毛重']]:[]),
    ...(container.estimated?[['portion','修正确认净重']]:[])]:
   [['eat','记录食用'],['loss','洒出或损耗'],['refill','补充内容物'],['reweigh','更正称重基准']];
  const food=editId&&events(state,'foods').find(row=>row.id===editId);
  f.action.replaceChildren(...(editId?[['eat','更正本次称重']]:[...options,...(['portion','estimated'].includes(container.stockMode)?[['plan','计划当天午晚餐']]:[]),['empty','已用完'],['discard','丢弃剩余']])
   .map(([value,label])=>new Option(label,value)));
  if(food){f.date.value=food.date;f.meal.value=food.meal??'晚餐';f.gross.value=container.gross??'';}
  optionsPanel.hidden=!!editId;
  optionsPanel.open=false;
  for(const button of form.querySelectorAll('[data-package-close-action]'))button.hidden=!!editId;
  syncCalendarFields(form);syncChoiceFields(form);
  update();
  if(!dialog.open)dialog.showModal();
  dialog.querySelector('[data-sheet-close]').focus({preventScroll:true});
 }
 form.addEventListener('input',update);
 form.addEventListener('change',update);
 for(const button of form.querySelectorAll('[data-package-close-action]'))button.onclick=()=>{
  f.action.value=button.dataset.packageCloseAction;
  optionsPanel.open=true;
  syncChoiceFields(form);update();
 };
 form.onsubmit=async e=>{
  e.preventDefault();
  if(busy||!current)return;
  const job=current;busy=true;submit.disabled=true;
  try{
   const data=input();
   const result=job.edit?revisePackageFood(getState(),{...data,foodId:job.edit}):
    data.action==='plan'?{next:planPackageDay(getState(),data)}:confirmPackageAction(getState(),data);
   if(!result.duplicate)await commit(result.next,job.edit?'称重已更正':data.action==='plan'?'当天饮食计划已保存':'包装记录已保存');
   if(dialog.open)dialog.close();
  }catch(error){notify(error.message);}
  finally{busy=false;if(dialog.open)update();}
 };
 dialog.addEventListener('close',()=>{
  const trigger=current?.trigger, id=current?.containerId;
  if(trigger){
   const selected=trigger.dataset.packageSku?
    '[data-package-sku="'+CSS.escape(current.foodId)+'"]':'[data-open-package="'+CSS.escape(id)+'"]';
   const button=trigger.isConnected?trigger:document.querySelector(selected)??
    document.querySelector('[data-stock-id="'+CSS.escape(current.foodId)+'"] [data-stock-expand]')??
    document.querySelector('#inventory-search');
   button?.focus({preventScroll:true});
  }
  current=null;
 });
 return open;
}
