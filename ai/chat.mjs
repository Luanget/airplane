import {displayDay,localDate} from '../calendar.mjs';
import {hydrateShell} from '../shell.mjs';
import {installUpdates} from '../updates.mjs';
import {AssistantSyncPending,resumePurchaseUpdate} from '../health/purchase-sync.mjs';
import {validInput} from '../health/contract.mjs';
import {healthReview,jpeg} from '../health/assistant.mjs';
import {recognize,mountKeyForm,readDeviceKey} from './client.mjs';
import {financeReview} from './finance.mjs';
import {chatInstructions} from './responses.mjs';
import {localWorkspace,shortHistory,readLedger,readLabels,expenseGroupLabels,HISTORY_OPTIONS,readHistoryOption,saveHistoryOption} from './workspace.mjs';
import {foodEditReview,inventoryReview,portionReview,skillReview} from './operations.mjs';
import {mountSkillSettings} from './skills.mjs';
import {mountModelSettings,readChatModel} from './models.mjs';
import {threadBook} from './threads.mjs';
import {demoWorkspace} from './demo.mjs';
import {batchReview} from './batch.mjs';
import {deleteReview} from './deletion.mjs';
import {displayUsage,totalUsage} from './usage.mjs';
import {syncChoiceFields} from '../choice-picker.mjs';

const demo=new URLSearchParams(location.search).get('demo')==='1';
const workspace=demo?await demoWorkspace(localDate()):localWorkspace();
const book=threadBook(demo?workspace.finance:localStorage);
const respond=demo?workspace.respond:recognize;
const $=selector=>document.querySelector(selector);
const transcript=$('.chat-transcript'),thread=$('.chat-thread'),review=$('.chat-review'),start=$('.assistant-start');
const photoResults=$('[data-photo-results]');
const composer=$('.chat-composer'),send=composer.querySelector('[type=submit]');
const status=$('[data-status]'),clearPhoto=$('[data-remove-photo]'),newChat=$('[data-new]'),stop=$('[data-stop-request]');
const retryFollowUp=$('[data-retry-follow-up]');
const historyButton=$('[data-toggle-threads]'),historyPanel=$('#assistant-history'),historyList=$('[data-thread-list]');
const historySearch=historyPanel.querySelector('input');
const historyConfirmation=$('[data-delete-confirm]'),historyDelete=$('[data-delete-apply]');
const keyPanel=$('#assistant-key-panel'),settings=$('#assistant-settings-sheet');
let busy=false,saving=false,activeRequest=null,deletingThread=null,followUp=null,photoRun=null;

hydrateShell();
const refreshModels=mountModelSettings($('#assistant-model-panel'),workspace.finance);
$('#assistant-settings').onclick=()=>{settings.showModal();refreshModels();refreshSkills();void refreshUsage();};
async function refreshUsage(){
 if(demo)return;
 const node=$('[data-local-usage]');
 try{
  node.textContent=displayUsage(await totalUsage());
  node.title='从此版本起，按本机收到的 token 用量估算。合计覆盖本机所有导入过的 Key。';
  node.hidden=!node.textContent;
 }catch{node.hidden=true;}
}
window.addEventListener('airplane-ai-usage',()=>{if(settings.open)void refreshUsage();});
const historyOptions=$('[data-history-options]');
historyOptions.replaceChildren(...HISTORY_OPTIONS.map(option=>{
 const button=document.createElement('button');
 button.type='button';button.textContent=option.label;
 button.onclick=()=>{
  try{saveHistoryOption(workspace.finance,option.id);updateContext();}
  catch(err){report(err);}
 };
 return button;
}));
function onSettingsBackdrop(event){
 if(event.target!==settings)return false;
 const {left,top,right,bottom}=settings.getBoundingClientRect();
 return event.clientX<left||event.clientX>right||event.clientY<top||event.clientY>bottom;
}
let backdropPress=false;
settings.addEventListener('pointerdown',event=>{backdropPress=onSettingsBackdrop(event);});
settings.addEventListener('click',event=>{
 if(backdropPress&&onSettingsBackdrop(event))settings.close();
 backdropPress=false;
});
settings.addEventListener('close',()=>{
 if(location.hash==='#api-key')history.replaceState(history.state,'',location.pathname+location.search);
});
if(demo){
 $('.assistant-demo').hidden=false;
 keyPanel.hidden=false;
 keyPanel.querySelector('[data-demo-key]').hidden=false;
 for(const link of document.querySelectorAll('.topbar-actions a'))link.search='?demo=1';
}else{
 window.airplaneAccount=workspace.account;
 installUpdates();
 void resumePurchaseUpdate(window.airplaneAccount).catch(()=>{
  if(!status.textContent)status.textContent='有待同步的账本更新，请先在库存页处理。';
 });
 keyPanel.hidden=false;
 const keyStatus=mountKeyForm($('#assistant-key'));
 void readDeviceKey().then(key=>{
  if(!key&&!keyStatus.textContent)keyStatus.textContent='请导入 OpenAI API Key';
 }).catch(err=>{if(!keyStatus.textContent)keyStatus.textContent=err.message;});
}
const openKeySettings=()=>{if(location.hash==='#api-key')revealKeySettings();};
window.addEventListener('hashchange',openKeySettings);
openKeySettings();

function revealKeySettings(){
 keyPanel.open=true;
 if(!settings.open)settings.showModal();
 keyPanel.querySelector('summary').scrollIntoView({block:'nearest'});
}
function tell(text){status.textContent=text;}
function report(err){tell(err.name==='TypeError'?'无法完成请求，请检查网络或本机存储':err.message);}
async function requestReply(input,options,userText){
 const sent=userText?messageNode('user',userText):null;
 const answer=messageNode('assistant','');
 answer.classList.add('streaming-reply');answer.hidden=true;answer.setAttribute('aria-live','off');
 start.hidden=true;
 if(sent)transcript.append(sent);
 transcript.append(answer);thread.scrollTop=thread.scrollHeight;
 const onReply=text=>{
  const follow=thread.scrollHeight-thread.scrollTop-thread.clientHeight<48;
  if(answer.hidden)tell(demo?'正在接收演示回复…':'正在接收 OpenAI 回复…');
  answer.hidden=false;answer.textContent=text;
  if(follow)thread.scrollTop=thread.scrollHeight;
 };
 const onTool=()=>tell('正在准备本机账本查询…');
 const controller=new AbortController();
 activeRequest=controller;stop.hidden=false;stop.disabled=false;
 try{
  const result=await respond(input,{...options,signal:controller.signal,onReply,onTool});
  if(demo&&result.reply){
   let text='';
   for(const part of result.reply.match(/[\s\S]{1,3}/gu)??[]){
    if(controller.signal.aborted)throw Error('已停止等待演示回复。');
    text+=part;onReply(text);
    await new Promise(resolve=>setTimeout(resolve,40));
   }
   if(controller.signal.aborted)throw Error('已停止等待演示回复。');
  }
  return result;
 }finally{
  sent?.remove();answer.remove();start.hidden=!!book.current?.messages.length;
  activeRequest=null;stop.hidden=true;
 }
}
stop.onclick=()=>{
 stop.disabled=true;
 if(photoRun)photoRun.stopped=true;
 activeRequest?.abort();
};
function updateContext(){
 const budget=readHistoryOption(workspace.finance);
 const turns=shortHistory((book.current?.messages??[]).filter(m=>m?.carry&&['user','assistant'].includes(m.role)&&typeof m.text==='string'),budget);
 [...historyOptions.children].forEach((button,index)=>button.setAttribute('aria-pressed',String(budget===HISTORY_OPTIONS[index])));
 const chars=turns.reduce((n,row)=>n+row.text.length,0);
 const skills=workspace.skills.active();
 const skillChars=skills.reduce((total,skill)=>total+skill.text.length,0);
 $('[data-context-size]').textContent='历史 '+turns.length+' 条 · '+chars+'/'+budget.chars+' 字，已启用 '+skills.length+' 个 Skill · '+skillChars+' 字。';
 return {turns,skills};
}
function syncThreads(){
 const active=book.current;
 const title=$('[data-thread-title]'),empty=$('[data-thread-empty]');
 title.textContent=active?.title??'对话记录';
 historyButton.setAttribute('aria-label',active?'对话记录，当前 '+active.title:'对话记录');
 const threads=[...book.list()].sort((a,b)=>String(b.updatedAt??'').localeCompare(String(a.updatedAt??'')));
 historySearch.closest('label').hidden=threads.length<5;
 const query=historySearch.value.trim().toLowerCase();
 const rows=threads.filter(row=>row.title.toLowerCase().includes(query)).map(row=>{
  const li=document.createElement('li'),button=document.createElement('button'),name=document.createElement('strong');
  button.type='button';button.className='assistant-history-item';name.textContent=row.title;button.append(name);
  if(row.id===active?.id)button.setAttribute('aria-current','true');
  const last=new Date(row.updatedAt);
  if(Number.isFinite(last.getTime())){
   const time=document.createElement('time');time.dateTime=row.updatedAt;
   const day=localDate(last);time.textContent=day===localDate()?'今天':displayDay(day);button.append(time);
  }
  button.onclick=()=>{
   if(busy||saving)return;
   try{book.select(row.id);openHistory(false);tell('');renderThread();historyButton.focus();}
   catch(err){report(err);}
  };
  const remove=document.createElement('button');
  remove.type='button';remove.className='assistant-history-delete';remove.textContent='删除';
  remove.setAttribute('aria-label','删除对话 '+row.title);
  remove.onclick=()=>{
   if(busy||saving)return;
   deletingThread=row.id;historyConfirmation.hidden=false;
   $('[data-delete-label]').textContent='删除「'+row.title+'」这段对话？';
   historyConfirmation.scrollIntoView({block:'nearest'});
  };
  li.append(button,remove);return li;
 });
 empty.textContent=query?'没有符合的对话':'还没有对话记录';
 empty.hidden=rows.length>0;
 historyList.replaceChildren(...rows);
}
function openHistory(open){
 historyPanel.hidden=!open;historyButton.setAttribute('aria-expanded',String(open));
 if(!open){historySearch.value='';clearHistoryConfirmation();}
 syncThreads();
}
function clearHistoryConfirmation(){deletingThread=null;historyConfirmation.hidden=true;}
$('[data-delete-cancel]').onclick=clearHistoryConfirmation;
historyDelete.onclick=()=>{
 if(!deletingThread||busy||saving)return;
 const active=book.current?.id===deletingThread;
 try{
  book.remove(deletingThread);clearHistoryConfirmation();
  if(active)renderThread();else syncThreads();
  historyButton.focus();tell('已删除这段对话。');
 }catch(err){report(err);}
};
historyButton.onclick=()=>openHistory(historyPanel.hidden);
historySearch.oninput=syncThreads;
historyPanel.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.stopPropagation();openHistory(false);historyButton.focus();}
});
function messageNode(role,text){
 const p=document.createElement('p');p.className='chat-bubble '+role;p.textContent=text;
 return p;
}
function bubble(role,text,source){
 transcript.append(messageNode(role,text));
 if(typeof source?.label==='string'&&typeof source.text==='string'){
  const details=document.createElement('details'),title=document.createElement('summary'),body=document.createElement('pre');
  details.className='chat-source';title.textContent=source.label;body.textContent=source.text;
  details.append(title,body);transcript.append(details);
 }
 thread.scrollTop=thread.scrollHeight;
}
function remember(role,text,carry,source){
 try{book.append(role,text,carry,source);}
 catch{tell('浏览器空间不足，对话暂存于当前页面。');}
 start.hidden=true;syncThreads();updateContext();
}
function append(role,text,carry=true,source){
 remember(role,text,carry,source);bubble(role,text,source);
}
function clearReview(){review.hidden=true;review.replaceChildren();review.onsubmit=null;delete review.dataset.syncPending;}
function clearFollowUp(){followUp=null;retryFollowUp.hidden=true;}
function resetPhoto(){
 composer.elements.image.value='';$('[data-attachment]').textContent='';clearPhoto.hidden=true;
}
function clearComposer(){
 composer.elements.text.value='';composer.elements.allowRead.checked=true;resetPhoto();
}
function lock(){
 const waiting=busy||saving;
 send.disabled=waiting;newChat.disabled=busy||saving;historyButton.disabled=busy||saving;
 for(const button of historyList.querySelectorAll('button'))button.disabled=busy||saving;
 historySearch.disabled=busy||saving;
 historyDelete.disabled=busy||saving;
 composer.elements.text.disabled=waiting;
 composer.elements.image.disabled=waiting;
 composer.elements.allowRead.disabled=waiting;
 clearPhoto.disabled=waiting;
 retryFollowUp.disabled=waiting;
 for(const button of photoResults.querySelectorAll('button'))button.disabled=waiting;
 for(const fields of review.querySelectorAll('.assistant-batch-step'))fields.disabled=waiting||review.dataset.syncPending==='yes';
 for(const b of review.querySelectorAll('button'))b.disabled=waiting;
 for(const b of $('.assistant-examples').querySelectorAll('button'))b.disabled=waiting;
}
function renderThread(){
 const messages=book.current?.messages??[];
 transcript.replaceChildren();
 photoResults.replaceChildren();
 start.hidden=messages.length>0;
 for(const m of messages)if(m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')bubble(m.role,m.text,m.source);
 clearReview();clearFollowUp();clearComposer();syncThreads();updateContext();lock();
}
$('#assistant-skill pre').textContent=chatInstructions;
const refreshSkills=mountSkillSettings($('#assistant-skill'),workspace.skills,updateContext);
renderThread();
newChat.onclick=()=>{
 try{book.start();openHistory(false);tell('');renderThread();}
 catch(err){report(err);}
};
clearPhoto.onclick=resetPhoto;
composer.elements.image.onchange=()=>{
 const files=composer.elements.image.files;
 $('[data-attachment]').textContent=files.length>1?'已选 '+files.length+' 张照片':files[0]?.name??'';
 clearPhoto.hidden=!files.length;
};
composer.elements.text.addEventListener('keydown',e=>{
 if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&matchMedia('(pointer:fine)').matches){
  e.preventDefault();composer.requestSubmit();
 }
});
for(const button of document.querySelectorAll('[data-example]')){
 button.onclick=()=>{
  composer.elements.text.value=button.dataset.example;
  composer.elements.text.focus();
 };
}

async function makeReview(proposal,flow,photoJob){
 clearReview();if(!proposal)return;
 if(photoJob){
  const label=document.createElement('p');
  label.className='photo-review-title';label.textContent=photoJob.label;review.append(label);
 }
 const {mode,result}=proposal,today=flow.input.date;
 const willContinue=mode==='batch'&&result.next==='continue';
 let confirm,label;
 if(mode==='batch'){
  confirm=await batchReview(review,result,workspace,today,book.current?.foodDate);
  label=willContinue?'确认全部并继续':'确认全部';
 }else if(mode==='delete_record'){
  confirm=await deleteReview(review,proposal,workspace,today,book.current?.foodDate);
  label='确认删除';
 }else if(mode==='finance'){
  confirm=financeReview(review,result.entry,today,workspace.finance);
  label='确认记账';
 }else if(mode==='skill'){
  const read=skillReview(review,workspace.skills.list(),result);
  label='确认更新 Skill';
  confirm=()=>{
   const {changes,current}=read();
   workspace.skills.save(changes,current);refreshSkills();
   return current?'Skill 已更新。':'Skill 已新增并启用。';
  };
 }else{
  const current=await workspace.readHealth();
  let draft;
  if(mode==='inventory'){
   const apply=inventoryReview(review,proposal,current,today);
   draft=result.operation==='shopping'?
    {apply,label:'确认加入补货清单',saved:'补货清单已更新。'}:
    {apply,label:'确认盘点',saved:'库存已按盘点结果更新。'};
  }else if(mode==='food_edit')draft=foodEditReview(review,proposal,current,today,book.current?.foodDate);
  else if(mode==='portions')draft=portionReview(review,proposal,current,today);
  else draft=healthReview(review,proposal,current,today);
  if(draft){
   label=draft.label;
   confirm=async()=>{
    await workspace.saveHealth(draft.apply(current),current.revision??0);
    return draft.saved;
   };
  }
 }
 if(!confirm){
  if(photoJob)settlePhoto(photoJob,'此照片没有可保存的记录。');
  return;
 }
 const actions=document.createElement('div');actions.className='chat-actions';
 const apply=document.createElement('button');apply.type='submit';apply.className='primary-button';apply.textContent=label;
 if(mode==='delete_record')apply.classList.add('delete-apply');
 const discard=document.createElement('button');discard.type='button';discard.className='secondary-button';discard.textContent='放弃';
 discard.onclick=()=>{
  if(photoJob)settlePhoto(photoJob,'已放弃候选。');
  clearReview();
 };
 actions.append(discard);
 let saveOnly;
 if(willContinue){
  saveOnly=document.createElement('button');saveOnly.type='submit';saveOnly.className='secondary-button';
  saveOnly.textContent='仅保存';actions.append(saveOnly);
 }
 const out=document.createElement('output');out.setAttribute('role','status');
 actions.append(apply);review.append(actions,out);
 let continuationApproved=false;
 review.onsubmit=async e=>{
  e.preventDefault();if(saving||busy)return;
  if(review.dataset.syncPending!=='yes')continuationApproved=willContinue&&e.submitter===apply;
  saving=true;lock();out.textContent='';
  let resume=false;
  try{
   const message=await confirm();
   if(photoJob)settlePhoto(photoJob,message);
   clearReview();append('assistant',message,false);
   if(continuationApproved){
    followUp={
     input:{...flow.input,date:localDate(),text:flow.input.text||'继续完成刚才照片中的请求。',history:[],photo:null},
     options:{...flow.options,applied:result.operations.map(operation=>operation.mode)},
     steps:[]
    };
    resume=true;
   }
  }catch(err){
   out.textContent=err.message;
   if(err instanceof AssistantSyncPending){
    review.dataset.syncPending='yes';apply.textContent='继续同步';discard.hidden=true;
    if(saveOnly)saveOnly.hidden=true;
   }
  }
  finally{saving=false;lock();}
  if(resume)await continueAfterSave();
 };
 for(const select of review.querySelectorAll('select'))select.dataset.picker='';
 syncChoiceFields(review);
 review.hidden=false;
 const contextAbove=mode==='plan'||mode==='skill'?10:88;
 thread.scrollTop=Math.max(0,thread.scrollTop+review.getBoundingClientRect().top-thread.getBoundingClientRect().top-contextAbove);
}

async function complete(response,flow,source){
 clearReview();
 tell('');
 append('assistant',response.reply,!source,source);
 try{await makeReview(response.proposal,flow);}
 catch(err){clearReview();report(err);}
}
function describeSummary(scope,summary){
 if(scope==='expenses')return summary.date+' · 支出 '+summary.expense+' 元 · 收入 '+summary.income+' 元 · '+summary.count+' 笔';
 if(scope==='weight'){
  const kg=value=>value===null?'待补':value+' kg';
  if(!summary.latest)return '截至 '+displayDay(summary.asOf,true)+' 暂无有效晨重';
  return [
   '最新晨重 '+displayDay(summary.latest.date,true)+' · '+kg(summary.latest.kg)+(summary.latest.tentative?' · 暂定':''),
   '比上次 '+kg(summary.change),
   '最近 7 次均重 '+kg(summary.last7)+' · 当前窗口 '+summary.count+' 次',
   '上一窗口 '+kg(summary.previous7)+' · 均重变化 '+kg(summary.delta)
  ].join('\n');
 }
 if(scope==='cycle'){
  const day=summary.today,source={device_total:'设备全天消耗',imported_energy_model:'导入的消耗模型',base_tdee_estimate:'基础 TDEE 估计'};
  return [
   displayDay(summary.start,true)+'至'+displayDay(summary.end,true)+' · 已结算 '+summary.closedDays+'/'+summary.days+' 天',
   '最近结算 '+(summary.closedThrough?displayDay(summary.closedThrough):'暂无')+' · 待补 '+summary.unreported+' 天',
   '已结算缺口 '+summary.deficit+' / '+summary.goal+' kcal · 进度 '+summary.progress+'% · 剩余 '+summary.remaining+' kcal',
   '理论脂肪当量 '+summary.fatEquivalent+' kg',
   '今日条件缺口 '+(day.conditionalDeficit??'待补')+' · 摄入 '+(day.intake??'待补')+' · 消耗 '+(day.tdee??'待补')+' kcal'+(day.source?' · '+source[day.source]:'')
  ].join('\n');
 }
 if(scope==='expense_summary')return [
  summary.start+' 至 '+summary.end,
  '按'+expenseGroupLabels[summary.groupBy]+'汇总 · 支出 '+summary.expense+' 元 · '+summary.count+' 笔',
  ...summary.rows.map(row=>row.label+' · '+row.expense+' 元 · '+row.count+' 笔')
 ].join('\n');
 if(scope==='foods'){
  const rows=summary.foods.map(row=>[row.time,row.meal,row.name,row.portion].filter(Boolean).join(' · '));
  if(!rows.length)rows.push('没有匹配的实际饮食记录');
  return [displayDay(summary.date,true),...rows].join('\n');
 }
 const rows=summary.stock.map(row=>row.name+' · '+(row.qty??'数量未知')+' '+row.unit+
  (row.portions?.length?' · 分装 '+row.portions.map(qty=>qty+' '+row.unit).join('、'):''));
 if(!rows.length)rows.push('没有匹配的食品');
 if(summary.today){
  const day=summary.today;
  rows.push('今日热量 '+(day.kcal??'未知')+' / '+day.kcalTarget+' kcal',
   '蛋白质 '+(day.protein??'未知')+' g · 参考 '+day.proteinMin+'–'+day.proteinMax+' g',
   '脂肪 '+(day.fat??'未知')+' g · 参考下限 '+day.fatMin+' g',
   '碳水 '+(day.carbs??'未知')+' g'+(day.carbRange?' · 参考 '+day.carbRange.low+'–'+day.carbRange.high+' g':''),
   '钠 '+(day.sodium??'未知')+' mg · 参考 '+day.sodiumTarget+' mg');
  if(day.incomplete.length){
   const names={kcal:'热量',protein:'蛋白质',fat:'脂肪',carbs:'碳水',sodium:'钠'};
   rows.push('待补数据：'+day.incomplete.map(key=>names[key]).filter(Boolean).join('、'));
  }
 }
 return rows.join('\n');
}
function querySource(steps){
 if(!steps.length)return null;
 const first=steps[0];
 const label=steps.length>1?'查看本轮 '+steps.length+' 次查询的数据':
  first.scope==='foods'?'查看本次饮食记录 · '+first.summary.foods.length+' 条':'查看本次查询数据';
 return {label,text:steps.map(({scope,summary})=>describeSummary(scope,summary)).join('\n\n')};
}
async function resolveResponse(response,flow){
 const {input,options,steps}=flow;
 const queried=new Set();
 while(response.call){
   if(!options.allowRead)throw Error('本轮未允许账本查询');
   const {args,item}=response.call;
   const key=JSON.stringify(Object.entries(args).sort(([a],[b])=>a.localeCompare(b)));
   if(queried.has(key))throw Error('助手重复查询同一范围，请重试或缩小问题。');
   queried.add(key);
   tell('正在查询'+readLabels[args.scope]+'…');
   const summary=await readLedger(workspace,args,input.date);
   steps.push({item,summary,scope:args.scope});
   response=await requestReply(input,{...options,continuation:steps});
   if(args.scope==='foods')try{book.setFoodDate(summary.date);}catch{}
 }
 return response;
}
async function showResponse(response,flow){
 const resolved=await resolveResponse(response,flow);
 await complete(resolved,flow,querySource(flow.steps));
}
async function continueAfterSave(){
 if(!followUp||busy||saving)return;
 busy=true;retryFollowUp.hidden=true;lock();
 tell('账本已保存，正在继续本轮…');
 try{
  const flow={...followUp,steps:[]};
  const response=await requestReply(flow.input,flow.options);
  await showResponse(response,flow);
  clearFollowUp();
 }catch(err){
  tell('账本已保存。'+err.message);
  retryFollowUp.hidden=false;
 }finally{busy=false;lock();}
}
retryFollowUp.onclick=continueAfterSave;
function showPhoto(job,text,action=''){
 job.output.textContent=text;
 job.button.textContent=action? action+'照片 '+job.index:'';
 job.button.hidden=!action;
}
function settlePhoto(job,message){
 job.proposal=null;showPhoto(job,job.reply+'\n'+message);
}
async function recognizePhotos(jobs,flow,total){
 const run={stopped:false};
 photoRun=run;stop.textContent='停止本组识别';
 try{
  for(const job of jobs){
   if(run.stopped)break;
   showPhoto(job,'识别中…');
   tell('正在识别照片 '+job.index+' / '+total+'…');
   stop.hidden=false;stop.disabled=false;
   try{
    const photo=await jpeg(job.file);
    if(run.stopped)throw Error('识别已停止。');
    const input={...flow.input,photo},options={...flow.options,photoPosition:{index:job.index,total}},steps=[];
    const reply=await resolveResponse(await requestReply(input,options),{input,options,steps});
    job.file=null;job.proposal=reply.proposal;job.reply=reply.reply;
    const source=querySource(steps);
    remember('assistant','照片 '+job.index+'\n'+reply.reply,!source,source);
    showPhoto(job,reply.reply,job.proposal?'核对':'');
   }catch(err){
    const message=run.stopped?'识别已停止。':
     err.name==='EncodingError'?'无法读取这张照片，请重新选择。':err.message;
    showPhoto(job,message,'重试');
   }
  }
 }finally{
  photoRun=null;stop.hidden=true;stop.textContent='停止等待';
  tell(run.stopped?'已暂停，可单独识别剩余照片。':'');
 }
}
async function sendPhotos(input,options,files){
 const total=files.length;
 const flow={input,options,steps:[]};
 append('user',[input.text,'（附 '+total+' 张照片）'].filter(Boolean).join(' '));
 clearComposer();clearReview();
 const group=document.createElement('section');
 group.className='card photo-batch';group.setAttribute('aria-label','照片识别结果');
 const jobs=files.map((file,i)=>{
  const row=document.createElement('div'),name=document.createElement('strong'),output=document.createElement('p');
  const button=document.createElement('button');button.type='button';button.className='text-button';button.disabled=true;
  const index=i+1,label='照片 '+index+' · '+file.name;
  row.className='photo-result';name.textContent=label;row.append(name,output,button);group.append(row);
  const job={file,index,label,output,button};
  showPhoto(job,'等待识别','识别');
  button.onclick=async()=>{
   if(busy||saving)return;
   busy=true;lock();
   try{
    if(job.file)await recognizePhotos([job],flow,total);
    else await makeReview(job.proposal,flow,job);
   }catch(err){clearReview();report(err);}
   finally{busy=false;lock();}
  };
  return job;
 });
 photoResults.append(group);thread.scrollTop=thread.scrollHeight;
 await recognizePhotos(jobs,flow,total);
}
async function sendMessage(input,options,files){
 clearFollowUp();
 if(files.length>1){await sendPhotos(input,options,files);return;}
 tell(demo?'正在生成演示回复…':'正在等待 OpenAI 回复…');
 const userText=[input.text,input.photo?'（附一张照片）':''].filter(Boolean).join(' ');
 const response=await requestReply(input,options,userText);
 append('user',userText);
 clearComposer();
 clearReview();
 await showResponse(response,{input,options,steps:[]});
}
composer.onsubmit=async e=>{
 e.preventDefault();if(busy||saving)return;
 const text=composer.elements.text.value.trim(),files=[...composer.elements.image.files];
 if(!text&&!files.length){tell('请输入消息或添加照片');return;}
 busy=true;lock();tell('');
 try{
  if(!demo){
   tell('正在读取本机 API Key…');
   if(!await readDeviceKey()){revealKeySettings();tell('请先导入 API Key');return;}
  }
  const photo=files.length===1?await jpeg(files[0]):null,{turns,skills}=updateContext();
  const input={mode:'chat',text,photo,date:localDate(),history:turns};
  const options={model:readChatModel(workspace.finance).id,skills,allowRead:composer.elements.allowRead.checked};
  if(files.length<2&&!validInput(input))throw Error('请检查消息或照片');
  await sendMessage(input,options,files);
 }catch(err){report(err);}
 finally{busy=false;lock();}
};
