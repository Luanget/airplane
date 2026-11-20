import {displayDay,localDate} from '../calendar.mjs';
import {hydrateShell,shellIcon} from '../shell.mjs';
import {installUpdates} from '../updates.mjs';
import {AssistantSyncPending,resumePurchaseUpdate} from '../health/purchase-sync.mjs';
import {validInput} from '../health/contract.mjs';
import {healthReview,jpeg} from '../health/assistant.mjs';
import {recognize,mountKeyForm,readDeviceKey} from './client.mjs';
import {financeReview} from './finance.mjs';
import {chatInstructions} from './responses.mjs';
import {localWorkspace,readLedger,readLabels,expenseGroupLabels} from './workspace.mjs';
import {foodEditReview,inventoryReview,portionReview,skillReview} from './operations.mjs';
import {mountSkillSettings} from './skills.mjs';
import {mountModelSettings,readChatModel} from './models.mjs';
import {threadBook} from './threads.mjs';
import {demoWorkspace} from './demo.mjs';
import {batchReview} from './batch.mjs';
import {contextFor,HISTORY_OPTIONS,readHistoryOption,saveHistoryOption} from './context.mjs';
import {appDataReview,readAppData} from './data.mjs';
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
const retryFollowUp=$('[data-retry-follow-up]'),retryRequest=$('[data-retry-request]'),restoreReview=$('[data-restore-review]');
const historyButton=$('[data-toggle-threads]'),historyPanel=$('#assistant-history'),historyList=$('[data-thread-list]');
const historySearch=historyPanel.querySelector('input');
const historyConfirmation=$('[data-delete-confirm]'),historyDelete=$('[data-delete-apply]');
const keyPanel=$('#assistant-key-panel'),settings=$('#assistant-settings-sheet');
let busy=false,saving=false,activeRequest=null,deletingThread=null,followUp=null,photoRun=null,photoBatch=null;

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
async function requestReply(input,options,savePartial=()=>{}){
 const answer=messageNode('assistant','');
 const reply=answer.querySelector('.chat-bubble');
 answer.classList.add('streaming-reply');answer.hidden=true;answer.setAttribute('aria-live','off');
 start.hidden=true;
 transcript.append(answer);thread.scrollTop=thread.scrollHeight;
 const onReply=text=>{
  const follow=thread.scrollHeight-thread.scrollTop-thread.clientHeight<48;
  if(answer.hidden)tell(demo?'正在接收演示回复…':'正在接收 OpenAI 回复…');
  answer.hidden=false;reply.textContent=text;savePartial(text);
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
  answer.remove();start.hidden=!!book.current?.messages.length;
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
 const {history:turns,summary,compact}=contextFor(book.current,budget);
 [...historyOptions.children].forEach((button,index)=>button.setAttribute('aria-pressed',String(budget===HISTORY_OPTIONS[index])));
 const chars=turns.reduce((n,row)=>n+row.text.length,0);
 const skills=workspace.skills.active();
 $('[data-context-size]').textContent='历史 '+turns.length+' 条 · '+chars+'/'+budget.chars+' 字'+
  (summary?' · 已压缩 '+summary.length+' 字':'')+' · '+skills.length+' 个 Skill';
 return {turns,summary,compact,skills};
}
async function prepareContext(date,model){
 const current=updateContext();
 if(!current.compact||demo)return current;
 const id=book.current.id,controller=new AbortController();
 activeRequest=controller;stop.hidden=false;stop.disabled=false;
 tell('正在压缩较早的对话…');
 try{
  const {summary}=await recognize({mode:'chat',text:'整理这段对话',history:current.compact.history,date,photo:null},
   {model,compacting:true,contextSummary:current.summary,signal:controller.signal});
  book.setSummary(id,summary,current.compact.through);
  return updateContext();
 }catch(err){
  if(controller.signal.aborted)throw err;
  return current;
 }finally{activeRequest=null;stop.hidden=true;}
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
document.addEventListener('pointerdown',event=>{
 if(!historyPanel.hidden&&!historyPanel.contains(event.target)&&!historyButton.contains(event.target))openHistory(false);
});
historySearch.oninput=syncThreads;
historyPanel.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.stopPropagation();openHistory(false);historyButton.focus();}
});
function messageNode(role,text){
 const row=document.createElement('div'),mark=document.createElement('span'),body=document.createElement('p');
 const assistant=role==='assistant';
 row.className='chat-message '+role;
 row.setAttribute('role','group');row.setAttribute('aria-label',assistant?'助手':'你');
 mark.className='chat-avatar';mark.setAttribute('aria-hidden','true');
 mark.innerHTML=shellIcon(assistant?'sparkles':'person');
 body.className='chat-bubble '+role;body.textContent=text;
 row.append(mark,body);
 return row;
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
function sessionFlow({input,options}){
 return {input:{...input,history:[],photo:null},options:{...options,skills:undefined,contextSummary:undefined},steps:[]};
}
function checkpoint(save){
 let text='',timer;
 const flush=()=>{
  clearTimeout(timer);timer=undefined;
  if(text)try{save(text);}catch{}
 };
 window.addEventListener('pagehide',flush);
 document.addEventListener('visibilitychange',flush);
 return {
  update(value){text=value;if(!timer)timer=setTimeout(flush,240);},
  stop(){flush();window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',flush);}
 };
}
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
 retryFollowUp.disabled=waiting;retryRequest.disabled=waiting;restoreReview.disabled=waiting;
 for(const button of photoResults.querySelectorAll('button'))button.disabled=waiting;
 for(const fields of review.querySelectorAll('.assistant-batch-step'))fields.disabled=waiting||review.dataset.syncPending==='yes';
 for(const b of review.querySelectorAll('button'))b.disabled=waiting;
 for(const b of $('.assistant-examples').querySelectorAll('button'))b.disabled=waiting;
}
function renderTranscript(){
 const current=book.current,messages=current?.messages??[];
 transcript.replaceChildren();
 start.hidden=messages.length>0;
 for(const [index,m] of messages.entries()){
  if(index===current?.photos?.summaryIndex)continue;
  if(m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')bubble(m.role,m.text,m.source);
 }
}
function showPending(){
 const pending=book.current?.pending;
 retryRequest.hidden=!pending;
 if(!pending)return;
 if(pending.partial)bubble('assistant',pending.partial);
 tell(pending.partial?'上次回复中断，已保留收到的部分。':'上次消息已保留，可以重试。');
}
function renderThread(){
 const current=book.current;
 renderTranscript();photoResults.replaceChildren();
 clearReview();clearFollowUp();clearComposer();
 photoBatch=null;if(current?.photos)renderPhotoBatch(current.photos);
 showPending();
 restoreReview.hidden=!current?.review;
 if(current?.followUp){
  followUp=current.followUp;retryFollowUp.hidden=false;
  if(followUp.partial)bubble('assistant',followUp.partial);
 }
 syncThreads();updateContext();lock();
}
$('#assistant-skill pre').textContent=chatInstructions;
const refreshSkills=mountSkillSettings($('#assistant-skill'),workspace.skills,updateContext,mergeDefault);
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
 }else if(mode==='app_data_edit'){
  const apply=await appDataReview(review,workspace,book,result,today);
  confirm=async()=>{
   const message=await apply();
   if(result.dataset==='conversations')renderThread();
   if(result.dataset==='assistant_settings'){refreshModels();updateContext();}
   if(['skills','skill_folders'].includes(result.dataset))refreshSkills();
   return message;
  };
  label=result.action==='delete'?'确认撤销或删除':'确认更新';
 }else if(mode==='delete_record'){
  confirm=await deleteReview(review,proposal,workspace,today,book.current?.foodDate);
  label='确认删除';
 }else if(mode==='finance'){
  confirm=financeReview(review,result.entry,today,workspace.finance);
  label='确认记账';
 }else if(mode==='skill'){
  const merge=flow.options.skillMerge;
  const read=skillReview(review,workspace.skills.list(),result,merge?.id);
  label='确认更新 Skill';
  confirm=()=>{
   const {changes,current}=read();
   if(merge)workspace.skills.resolveDefault(merge,changes.text);
   else workspace.skills.save(changes,current);
   refreshSkills();
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
 if(mode==='delete_record'||mode==='app_data_edit'&&result.action==='delete')apply.classList.add('delete-apply');
 const discard=document.createElement('button');discard.type='button';discard.className='secondary-button';discard.textContent='放弃';
 discard.onclick=()=>{
  if(photoJob)settlePhoto(photoJob,'已放弃候选。');
  else book.setReview(null);
  restoreReview.hidden=true;clearReview();
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
   if(!photoJob&&book.current?.review)book.setReview({...book.current.review,applying:true});
   if(photoJob){photoJob.stage='applying';savePhotoBatch();}
   const message=await confirm();
   if(photoJob)settlePhoto(photoJob,message);
   else book.setReview(null);
   restoreReview.hidden=true;clearReview();
   if(mode==='app_data_edit'&&result.dataset==='conversations'&&!book.current)tell(message);
   else append('assistant',message,false);
   if(continuationApproved){
    followUp={
     input:{...flow.input,date:localDate(),text:flow.input.text||'继续完成刚才照片中的请求。',history:[],photo:null},
     options:{...flow.options,contextSummary:'',applied:result.operations.map(operation=>operation.mode)},
     steps:[]
    };
    book.setFollowUp(sessionFlow(followUp));
    resume=true;
   }
  }catch(err){
   if(photoJob){photoJob.stage='done';savePhotoBatch();}
   else if(book.current?.review?.applying)book.setReview({...book.current.review,applying:false});
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

async function complete(response,flow,source,ticket){
 clearReview();tell('');
 if(flow.options.skillMerge&&response.proposal?.mode!=='skill')throw Error('没有收到可核对的融合结果');
 const candidate=response.proposal?{proposal:response.proposal,flow:sessionFlow(flow)}:null;
 if(ticket){
  if(!book.finish(ticket,response.reply,source,candidate))return;
  bubble('assistant',response.reply,source);syncThreads();updateContext();
 }else{
  append('assistant',response.reply,!source,source);book.setReview(candidate);
 }
 retryRequest.hidden=true;restoreReview.hidden=true;
 try{await makeReview(response.proposal,flow);}
 catch(err){clearReview();report(err);}
}
function describeSummary(scope,summary){
 if(scope==='app_data')return JSON.stringify(summary,null,2);
 if(scope==='balance')return '当前总余额 '+new Intl.NumberFormat('zh-CN',{style:'currency',currency:summary.currency}).format(summary.balance);
 if(scope==='budget')return [
  summary.month+' · 月预算 ¥'+summary.budget+' · 剩余 ¥'+summary.remainingBudget,
  '日常预算支出 ¥'+summary.budgetExpense+' · 预算外 ¥'+summary.excludedExpense,
  ...(summary.current?['今日限额 ¥'+summary.dailyLimit+' · 今日计入预算 ¥'+summary.todayExpense]:[])
 ].join('\n');
 if(scope==='stock_alerts')return [
  ...summary.low.map(row=>row.name+' · 库存 '+row.qty+' / 提醒线 '+row.minimum+' '+row.unit),
  ...summary.expiry.map(row=>row.name+' · '+row.qty+' '+row.unit+' · '+displayDay(row.expires)+' 到期')
 ].join('\n')||'暂无库存提醒';
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
   displayDay(day.date)+(day.closed?'已结算缺口 ':'条件缺口 ')+(day.conditionalDeficit??'待补')+' · 摄入 '+(day.intake??'待补')+' · 消耗 '+(day.tdee??'待补')+' kcal'+(day.source?' · '+source[day.source]:'')
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
 const rows=(summary.stock??[]).map(row=>row.name+' · '+(row.qty??'数量未知')+' '+row.unit+
  (row.portions?.length?' · 分装 '+row.portions.map(qty=>qty+' '+row.unit).join('、'):''));
 if(summary.stock&&!rows.length)rows.push('没有匹配的食品');
 if(summary.today||scope==='nutrition'){
  const day=summary.today??summary;
  const date=day.date?displayDay(day.date):'今日';
  rows.push(date+'热量 '+(day.kcal??'未知')+' / '+day.kcalTarget+' kcal',
   '蛋白质 '+(day.protein??'未知')+' g · 参考 '+day.proteinMin+'–'+day.proteinMax+' g',
   '脂肪 '+(day.fat??'未知')+' g · 参考下限 '+day.fatMin+' g',
   '碳水 '+(day.carbs??'未知')+' g'+(day.carbRange?' · 参考 '+day.carbRange.low+'–'+day.carbRange.high+' g':''),
   '钠 '+(day.sodium??'未知')+' mg · 参考 '+day.sodiumTarget+' mg');
  if(scope==='nutrition'){
   rows.push('饮食成本 '+(day.cost===null?'未知':(day.costPartial?'已知部分 ':'')+'¥'+day.cost),
    (day.closed?'已结算缺口 ':'条件缺口 ')+(day.deficit??'待补')+' kcal');
  }
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
async function resolveResponse(response,flow,savePartial){
 const {input,options,steps}=flow;
 const queried=new Set();
 while(response.call){
   if(!options.allowRead)throw Error('本轮未允许账本查询');
   const {args,item}=response.call;
   const key=JSON.stringify(Object.entries(args).sort(([a],[b])=>a.localeCompare(b)));
   if(queried.has(key))throw Error('助手重复查询同一范围，请重试或缩小问题。');
   queried.add(key);
   tell('正在查询'+readLabels[args.scope]+'…');
   const summary=args.scope==='app_data'?await readAppData(workspace,book,args):
    await readLedger(workspace,args,input.date);
   steps.push({item,summary,scope:args.scope});
   response=await requestReply(input,{...options,continuation:steps},savePartial);
   if(args.scope==='foods')try{book.setFoodDate(summary.date);}catch{}
 }
 return response;
}
async function showResponse(response,flow,ticket,savePartial){
 const resolved=await resolveResponse(response,flow,savePartial);
 await complete(resolved,flow,querySource(flow.steps),ticket);
}
async function continueAfterSave(){
 if(!followUp||busy||saving)return;
 busy=true;retryFollowUp.hidden=true;lock();
 tell('账本已保存，正在继续本轮…');
 renderTranscript();
 const saved=checkpoint(text=>{
  if(!followUp)return;
  followUp.partial=text;book.setFollowUp({...sessionFlow(followUp),partial:text});
 });
 try{
  const flow={...followUp,options:{skills:workspace.skills.active(),...followUp.options},steps:[]};
  const response=await requestReply(flow.input,flow.options,saved.update);
  await showResponse(response,flow,undefined,saved.update);
  clearFollowUp();book.setFollowUp(null);
 }catch(err){
  saved.stop();
  if(followUp?.partial)bubble('assistant',followUp.partial);
  tell('账本已保存。'+err.message);
  retryFollowUp.hidden=false;
 }finally{saved.stop();busy=false;lock();}
}
retryFollowUp.onclick=continueAfterSave;
function photoSummary(jobs){
 const done=jobs.filter(job=>job.stage==='done'||job.stage==='settled'||job.stage==='applying');
 const remaining=jobs.length-done.length;
 const details=done.flatMap(job=>{
  const result=job.proposal?.result;
  const items=result?.items??job.items??[];
  const labels=items.filter(row=>row.name).map(row=>row.name+(row.amount&&row.unit?' '+row.amount+' '+row.unit:''));
  if(!labels.length&&result?.activity?.name)labels.push(result.activity.name);
  if(!labels.length&&result?.entry?.amount)labels.push((result.entry.note||'收支')+' ¥'+result.entry.amount);
  if(!labels.length&&job.reply){
   const first=job.reply.trim().match(/^[^。！？\n]+[。！？]?/)?.[0];
   if(first)labels.push(first);
  }
  return labels.length?['照片 '+job.index+' · '+labels.join('、')]:[];
 });
 const waiting=remaining?'还有 '+remaining+' 张未完成，可重试。':'';
 const notice=jobs.some(job=>job.proposal&&job.stage==='done')?'请逐张核对候选。':'';
 return ['这组共 '+jobs.length+' 张照片，已识别 '+done.length+' 张。'+waiting,...details,notice].filter(Boolean).join('\n');
}
function showPhoto(job,text,action=''){
 job.output.textContent=text;
 job.button.textContent=action? action+'照片 '+job.index:'';
 job.button.hidden=!action;
}
function savePhotoBatch(final=false){
 if(!photoBatch)return;
 const {id,flow,jobs}=photoBatch;
 const text=photoSummary(jobs);
 const photos={id,flow:sessionFlow(flow),summary:text,jobs:jobs.map(({index,label,reply,proposal,stage,items})=>
  ({index,label,reply,proposal,stage,items}))};
 photoBatch.summary=text;
 book.setPhotos(photos);
 if(final){
  photoBatch.final?.remove();
  photoBatch.final=messageNode('assistant',text);photoResults.append(photoBatch.final);
  thread.scrollTop=thread.scrollHeight;
 }
}
function settlePhoto(job,message){
 job.items=job.proposal?.result?.items;job.proposal=null;job.stage='settled';
 job.reply=job.reply+'\n'+message;showPhoto(job,job.reply);savePhotoBatch(true);
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
   const saved=checkpoint(text=>{job.reply=text;savePhotoBatch();});
   try{
    const photo=await jpeg(job.file);
    if(run.stopped)throw Error('识别已停止。');
    const input={...flow.input,photo},options={...flow.options,photoPosition:{index:job.index,total}},steps=[];
    const reply=await resolveResponse(await requestReply(input,options,saved.update),{input,options,steps},saved.update);
    saved.stop();job.file=null;job.proposal=reply.proposal;job.reply=reply.reply;job.stage='done';
    const source=querySource(steps);
    remember('assistant','照片 '+job.index+'\n'+reply.reply,!source,source);
    showPhoto(job,reply.reply,job.proposal?'核对':'');
   }catch(err){
    saved.stop();
    const reason=run.stopped?'识别已停止。':err.name==='EncodingError'?'无法读取这张照片，请重新选择。':err.message;
    job.reply=[job.reply,reason].filter(Boolean).join('\n');job.stage='error';
    showPhoto(job,job.reply,'重试');
   }
   savePhotoBatch();
  }
 }finally{
  photoRun=null;stop.hidden=true;stop.textContent='停止等待';
  savePhotoBatch(true);
  tell(run.stopped?'已暂停，可单独识别剩余照片。':'');
 }
}
function renderPhotoBatch(batch,files=[]){
 photoResults.replaceChildren();
 const group=document.createElement('section');
 group.className='card photo-batch';group.setAttribute('aria-label','照片识别结果');
 const jobs=batch.jobs.map((fields,i)=>{
  const row=document.createElement('div'),name=document.createElement('strong'),output=document.createElement('p');
  const button=document.createElement('button');button.type='button';button.className='text-button';
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='image/*';fileInput.hidden=true;
  const job={...fields,file:files[i]??null,output,button};
  row.className='photo-result';name.textContent=job.label;row.append(name,output,button,fileInput);group.append(row);
  if(job.stage==='applying')showPhoto(job,job.reply+'\n上次保存未确认完成，请先核对账本。');
  else if(job.stage==='done'||job.stage==='settled')showPhoto(job,job.reply,job.proposal?'核对':'');
  else if(job.file)showPhoto(job,'等待识别','识别');
  else showPhoto(job,(job.reply?job.reply+'\n':'')+'重新选择这张照片可接续识别。','重新选择');
  const run=async()=>{
   if(busy||saving)return;
   busy=true;lock();
   try{
    const flow={...batch.flow,options:{skills:workspace.skills.active(),...batch.flow.options}};
    if(job.file)await recognizePhotos([job],flow,jobs.length);
    else await makeReview(job.proposal,flow,job);
   }catch(err){clearReview();report(err);}
   finally{busy=false;lock();}
  };
  button.onclick=()=>{
   if(!job.file&&!job.proposal){fileInput.click();return;}
   void run();
  };
  fileInput.onchange=()=>{
   if(!fileInput.files[0])return;
   job.file=fileInput.files[0];fileInput.value='';void run();
  };
  return job;
 });
 photoResults.append(group);
 const final=batch.summary?messageNode('assistant',batch.summary):null;
 if(final)photoResults.append(final);
 photoBatch={...batch,jobs,final};
 thread.scrollTop=thread.scrollHeight;
}
async function sendPhotos(input,options,files){
 const total=files.length,flow={input,options,steps:[]};
 const display=[input.text,'（附 '+total+' 张照片）'].filter(Boolean).join(' ');
 book.begin(display,{text:input.text,date:input.date,allowRead:options.allowRead,hasPhoto:true});
 renderTranscript();syncThreads();updateContext();
 clearComposer();clearReview();restoreReview.hidden=true;retryRequest.hidden=true;
 renderPhotoBatch({id:crypto.randomUUID(),flow,jobs:files.map((file,i)=>({
  index:i+1,label:'照片 '+(i+1)+' · '+file.name,stage:'queued'
 }))},files);
 savePhotoBatch();
 await recognizePhotos(photoBatch.jobs,flow,total);
}
async function sendMessage(input,options,files){
 clearFollowUp();book.setFollowUp(null);
 if(files.length>1){await sendPhotos(input,options,files);return;}
 const userText=[input.text,input.photo?'（附一张照片）':''].filter(Boolean).join(' ');
 const previous=book.current?.pending?.request;
 const hasPhoto=!!input.photo;
 const reuse=previous?.text===input.text&&previous.hasPhoto===hasPhoto;
 const ticket=book.begin(userText,{text:input.text,date:input.date,allowRead:options.allowRead,hasPhoto,skillMerge:options.skillMerge},reuse);
 const saved=checkpoint(text=>book.checkpoint(ticket,text));
 clearReview();restoreReview.hidden=true;retryRequest.hidden=true;photoResults.replaceChildren();
 renderTranscript();syncThreads();
 tell(demo?'正在生成演示回复…':'正在等待 OpenAI 回复…');
 try{
  const response=await requestReply(input,options,saved.update);
  await showResponse(response,{input,options,steps:[]},ticket,saved.update);
  clearComposer();
 }catch(err){
  saved.stop();
  if(book.current?.pending?.id===ticket.id)showPending();
  throw err;
 }finally{saved.stop();}
}
retryRequest.onclick=()=>{
 const item=book.current?.pending?.request;
 if(!item||busy||saving)return;
 composer.elements.text.value=item.text;
 composer.elements.allowRead.checked=item.allowRead;
 if(item.hasPhoto){tell('请重新选中原照片后再发送。');return;}
 composer.requestSubmit();
};
restoreReview.onclick=async()=>{
 const candidate=book.current?.review;
 if(!candidate||busy||saving)return;
 if(candidate.applying){
  tell('上次保存未确认完成，请先核对账本。');
  return;
 }
 busy=true;lock();
 try{await makeReview(candidate.proposal,candidate.flow);restoreReview.hidden=true;}
 catch(err){clearReview();report(err);}
 finally{busy=false;lock();}
};
async function mergeDefault(info){
 if(!info||busy||saving)return;
 busy=true;lock();
 try{
  if(!demo&&!await readDeviceKey()){revealKeySettings();tell('请先导入 API Key');return;}
  settings.close();
  const input={mode:'chat',text:'融合新版 Skill：'+info.name,photo:null,date:localDate(),history:[]};
  await sendMessage(input,{model:readChatModel(workspace.finance).id,allowRead:false,skillMerge:info},[]);
 }catch(err){report(err);}
 finally{busy=false;lock();}
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
  const pending=book.current?.pending?.request;
  const retry=pending?.text===text,skillMerge=retry?pending.skillMerge:undefined;
  const photo=files.length===1?await jpeg(files[0]):null,date=(retry?pending.date:null)??localDate();
  const model=readChatModel(workspace.finance).id;
  const {turns,skills,summary}=await prepareContext(date,model);
  const history=skillMerge?[]:retry&&turns.at(-1)?.role==='user'?turns.slice(0,-1):turns;
  const input={mode:'chat',text,photo,date,history};
  const options=skillMerge?{model,allowRead:false,skillMerge}:
   {model,skills,contextSummary:summary,allowRead:composer.elements.allowRead.checked};
  if(files.length<2&&!validInput(input))throw Error('请检查消息或照片');
  await sendMessage(input,options,files);
 }catch(err){report(err);}
 finally{busy=false;lock();}
};
