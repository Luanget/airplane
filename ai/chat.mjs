import {mountAgentChat} from './agent-chat.mjs';
import {combineReceiptTurn,localAgentCommand,routeAgent,routedSkills,scopedHistory,separateAttachmentRequests} from './routing.mjs';
import {healthTraceReceipt,relatedTaskSummaries,failureKind,taskJournal} from './task-log.mjs';
import {mountTaskSettings} from './task-settings.mjs';
import {readFinance} from '../finance-storage.mjs';
import {medicalAuto,medicalIntent,renderMedicalReview,setMedicalAuto,useMedicalTurn} from './medical-chat.mjs';
import {displayDay,localDate,localClock} from '../calendar.mjs';
import {hydrateShell,shellIcon} from '../shell.mjs';
import {installUpdates} from '../updates.mjs';
import {AssistantSyncPending,resumePurchaseUpdate} from '../health/purchase-sync.mjs';
import {validInput} from '../health/contract.mjs';
import {healthReview,jpeg} from '../health/assistant.mjs';
import {recognize,mountKeyForm,readDeviceKey} from './client.mjs';
import {financeAutomation,financeReview,setFinanceAutomation} from './finance.mjs';
import {executeAgentTask,orderAgentTasks,undoAgentTask} from './agent-executor.mjs';
import {localWorkspace,readLedger,readLabels,expenseGroupLabels} from './workspace.mjs';
import {foodEditReview,inventoryReview,portionReview} from './operations.mjs';
import {automaticMemoryEnabled,memoryKind,mountMemorySettings,setAutomaticMemory} from './memory.mjs';
import {mountModelSettings} from './models.mjs';
import {threadBook} from './threads.mjs';
import {demoWorkspace} from './demo.mjs';
import {batchReview} from './batch.mjs';
import {contextFor,HISTORY_OPTIONS,readHistoryOption,saveHistoryOption} from './context.mjs';
import {appDataReview,readAppData} from './data.mjs';
import {hasDocumentAccess,prepareDocumentEdit,readAppDocument,setDocumentAccess} from './documents.mjs';
import {deleteReview} from './deletion.mjs';
import {displayUsage,modelRates,totalUsage} from './usage.mjs';
import {executeHealthAction,healthActionReceipt,healthActionPreview,healthContext,hasHealthAuto,readPackages,READ_LIMIT,
 setHealthAuto,statedDate,undoHealthAction} from './health-actions.mjs';
import {mountAgentSettings} from './agent-settings.mjs';
import {assertSkillAction,selectSkills,skillCatalog} from './skills.mjs';
import {habitPolicy} from './health-profile.mjs';
import {healthReport,renderHealthReport} from './health-report.mjs';
import {groupMealPhotos} from './meal-photos.mjs';
import {readHealthFileStatus} from '../health/sync-io.mjs';
import {syncChoiceFields} from '../choice-picker.mjs';

const demo=new URLSearchParams(location.search).get('demo')==='1';
const workspace=demo?await demoWorkspace(localDate()):localWorkspace();
const nativeAgentEnabled=!demo;
const book=threadBook(demo?workspace.finance:localStorage);
const respond=demo?workspace.respond:recognize;
const journal=taskJournal(workspace.account);
let pendingTrace=Promise.resolve();
function trace(id,event){
 if(!id||demo)return Promise.resolve();
 pendingTrace=pendingTrace.then(()=>journal.write(id,event)).catch(()=>{});
 return pendingTrace;
}
const traceStep=(id,step)=>trace(id,{type:'step',step});
const traceStatus=(id,status,error)=>trace(id,{type:'status',status,failure:failureKind(error)});
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
let busy=false,saving=false,activeRequest=null,deletingThread=null,followUp=null,photoRun=null,photoBatch=null,nativeUi=null;

hydrateShell();
const automaticMemory=$('[data-automatic-memory]');
automaticMemory.checked=automaticMemoryEnabled(workspace.finance);
automaticMemory.onchange=()=>{
 try{setAutomaticMemory(workspace.finance,automaticMemory.checked);}
 catch(err){automaticMemory.checked=automaticMemoryEnabled(workspace.finance);report(err);}
};
const healthAuto=$('[data-health-auto]');
healthAuto.checked=hasHealthAuto(workspace.finance);
healthAuto.onchange=()=>{
 try{setHealthAuto(workspace.finance,healthAuto.checked);}
 catch(err){healthAuto.checked=hasHealthAuto(workspace.finance);report(err);}
};
const medicalSave=$('[data-medical-auto]');
medicalSave.checked=medicalAuto(workspace.finance);
medicalSave.onchange=()=>{
 try{setMedicalAuto(workspace.finance,medicalSave.checked);}
 catch(error){medicalSave.checked=medicalAuto(workspace.finance);report(error);}
};
const financeAuto=$('[data-finance-auto]'),financeLimit=$('[data-finance-limit]');
function refreshFinanceAccess(){
 const grant=financeAutomation(workspace.finance);
 financeAuto.checked=grant.enabled;financeLimit.value=String(grant.limitCents/100);
}
refreshFinanceAccess();
financeAuto.onchange=financeLimit.onchange=()=>{
 try{
  if(!financeLimit.reportValidity())throw Error('请填写财务单笔上限。');
  setFinanceAutomation(workspace.finance,financeAuto.checked,Math.round(financeLimit.valueAsNumber*100));
 }catch(err){report(err);refreshFinanceAccess();}
};
const documentAccess=$('[data-document-access]');
documentAccess.checked=hasDocumentAccess(workspace.finance);
documentAccess.onchange=()=>{
 try{setDocumentAccess(workspace.finance,documentAccess.checked);}
 catch(err){documentAccess.checked=hasDocumentAccess(workspace.finance);report(err);}
};
const refreshModels=mountModelSettings($('#assistant-model-panel'),workspace.finance);
const refreshTasks=mountTaskSettings($('[data-task-settings]'),journal,workspace.finance,demo);
$('#assistant-settings').onclick=()=>{settings.showModal();
 automaticMemory.checked=automaticMemoryEnabled(workspace.finance);
 healthAuto.checked=hasHealthAuto(workspace.finance);
 medicalSave.checked=medicalAuto(workspace.finance);
 documentAccess.checked=hasDocumentAccess(workspace.finance);
 refreshFinanceAccess();refreshModels();refreshMemory();refreshAgent();void refreshUsage();void refreshTasks();};
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
  if(options.agentQuiet){tell('正在识别操作与凭据…');return;}
  const follow=thread.scrollHeight-thread.scrollTop-thread.clientHeight<48;
  if(answer.hidden)tell(demo?'正在接收演示回复…':'正在接收 OpenAI 回复…');
  answer.hidden=false;reply.textContent=text;savePartial(text);
  if(follow)thread.scrollTop=thread.scrollHeight;
 };
 const onTool=()=>tell('正在准备本机账本查询…');
 const controller=new AbortController();
 activeRequest=controller;stop.hidden=false;stop.disabled=false;
 try{
  const result=await respond(input,{...options,rates:modelRates(workspace.finance),
   onMetric:request=>trace(options.traceId,{type:'request',request}),
   documentAccess:options.documentAccess&&hasDocumentAccess(workspace.finance),
   autoMemory:options.autoMemory&&automaticMemoryEnabled(workspace.finance),signal:controller.signal,onReply,onTool});
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
 if(nativeUi?.running){nativeUi.stop();return;}
 stop.disabled=true;
 if(photoRun)photoRun.stopped=true;
 activeRequest?.abort();
};
function updateContext(){
 const budget=readHistoryOption(workspace.finance);
 const {history:turns,summary,compact}=contextFor(book.current,budget);
 [...historyOptions.children].forEach((button,index)=>button.setAttribute('aria-pressed',String(budget===HISTORY_OPTIONS[index])));
 const chars=turns.reduce((n,row)=>n+row.text.length,0);
 $('[data-context-size]').textContent='历史 '+turns.length+' 条 · '+chars+'/'+budget.chars+' 字'+
  (summary?' · 已压缩 '+summary.length+' 字':'');
 return {turns,summary,compact};
}
async function prepareContext(date,model,traceId){
 const current=updateContext();
 if(!current.compact||demo)return current;
 const id=book.current.id,controller=new AbortController();
 activeRequest=controller;stop.hidden=false;stop.disabled=false;
 tell('正在压缩较早的对话…');
 try{
  const {summary}=await recognize({mode:'chat',text:'整理这段对话',history:current.compact.history,date,photo:null},
   {model,compacting:true,contextSummary:current.summary,signal:controller.signal,rates:modelRates(workspace.finance),
    onMetric:request=>trace(traceId,{type:'request',request})});
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
  const removed=book.list().find(row=>row.id===deletingThread);
  if(active)nativeUi?.stop();
  book.remove(deletingThread);clearHistoryConfirmation();
  for(const job of [...(removed?.agentQueue??[]),...(removed?.pending?.request?.native?[removed.pending]:[]),
   ...(removed?.messages??[]).map(message=>message.media).filter(Boolean)])
   void journal.removeRun(job.id).catch(()=>{});
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
function bubble(role,text,source,healthActionId,preserveScroll=false,agentUndo=[],media){
 const scroll=thread.scrollTop;
 const follow=thread.scrollHeight-scroll-thread.clientHeight<48;
 const node=messageNode(role,text);
 transcript.append(node);
 if(healthActionId){
  const undo=document.createElement('button');
  undo.type='button';undo.className='text-button health-write-undo';undo.textContent='撤销这次记录';
  undo.onclick=async()=>{
   if(busy||saving||undo.disabled)return;
   undo.disabled=true;
   try{undo.textContent=await undoHealthAction(workspace,healthActionId);await journal.undo(healthActionId).catch(()=>{});}
   catch(err){report(err);undo.disabled=false;}
  };
  node.querySelector('.chat-bubble').after(undo);
 }
 if(typeof source?.label==='string'&&typeof source.text==='string'){
  const details=document.createElement('details'),title=document.createElement('summary'),body=document.createElement('pre');
  details.className='chat-source';title.textContent=source.label;body.textContent=source.text;
  details.append(title,body);transcript.append(details);
  if(agentUndo.length){
   const actions=document.createElement('div');actions.className='chat-actions';
   for(const token of agentUndo){
    const undo=document.createElement('button');
    undo.type='button';undo.className='text-button health-write-undo';undo.textContent='撤销'+token.label;
    undo.onclick=async()=>{
     if(busy||saving||undo.disabled)return;
     saving=true;undo.disabled=true;lock();
     try{undo.textContent=await (token.kind==='meal_plan'?nativeUi.undo(token):undoAgentTask(workspace,token));await journal.undo(token.id).catch(()=>{});}
     catch(err){report(err);undo.disabled=false;}
     finally{saving=false;lock();}
    };
    actions.append(undo);
   }
   details.append(actions);
  }
 }
 if(media){
  const details=document.createElement('details'),title=document.createElement('summary');
  details.className='chat-source';title.textContent='本轮附件 · '+media.count+' 个';
  details.append(title);transcript.append(details);
  details.ontoggle=async()=>{
   if(!details.open||details.childElementCount>1)return;
   try{
    const stored=await journal.readRun(media.id);
    if(!stored)throw Error('附件已不在本机。');
    const box=document.createElement('div');box.className='chat-archived-media';
    stored.attachments.forEach(({input},index)=>{
     if(input.type==='input_image'){
      const image=document.createElement('img');image.alt='附件 '+(index+1);image.loading='lazy';image.src=input.image_url;box.append(image);
     }else if(input.type==='input_file'){
      const link=document.createElement('a');link.textContent='打开报告 '+(index+1);link.download='Airplane-报告-'+(index+1)+'.pdf';
      link.href=input.file_data;box.append(link);
     }
    });
    details.append(box);
   }catch(error){const note=document.createElement('p');note.textContent=error.message;details.append(note);}
  };
 }
 thread.scrollTop=!preserveScroll||follow?thread.scrollHeight:scroll;
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
function sessionFlow({id,input,options}){
 return {id,input:{...input,history:[],photo:null},options:{...options,memory:undefined,contextSummary:undefined,healthContext:undefined,healthReference:undefined,photos:undefined,skills:undefined,local:undefined},steps:[]};
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
 composer.elements.image.value='';composer.elements.medicalFiles.value='';
 $('[data-attachment]').textContent='';clearPhoto.hidden=true;send.textContent='发送';
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
 composer.elements.medicalFiles.disabled=waiting;
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
  if(m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')bubble(m.role,m.text,m.source,m.healthActionId,false,m.agentUndo,m.media);
 }
}
function showPending(){
 const pending=book.current?.pending;
 retryRequest.textContent=pending?.healthAction?.agentTask?'重试未完成步骤':'重试这条消息';
 retryRequest.hidden=!pending;
 if(!pending)return;
 if(pending.partial)bubble('assistant',pending.partial);
 tell(pending.partial?'上次回复中断，已保留收到的部分。':'上次消息已保留，可以重试。');
}
function renderThread(previousPhotos){
 const current=book.current;
 renderTranscript();photoResults.replaceChildren();
 clearReview();clearFollowUp();clearComposer();
 photoBatch=null;
 if(current?.photos){
  const files=current.photos.id===previousPhotos?.id?
   current.photos.jobs.map(job=>previousPhotos.jobs.find(old=>old.index===job.index)?.file):[];
  renderPhotoBatch(current.photos,files);
 }
 showPending();
 restoreReview.hidden=!current?.review;
 if(current?.followUp){
  followUp=current.followUp;retryFollowUp.hidden=false;
  if(followUp.partial)bubble('assistant',followUp.partial);
 }
 syncThreads();updateContext();lock();
 void nativeUi?.restore();
}
const refreshMemory=mountMemorySettings($('#assistant-memory'),workspace.memory,updateContext);
const refreshAgent=mountAgentSettings($('#assistant-agent'),workspace,refreshMemory);
renderThread();
newChat.onclick=()=>{
 try{book.start();openHistory(false);tell('');renderThread();}
 catch(err){report(err);}
};
clearPhoto.onclick=()=>{resetPhoto();void nativeUi?.clearDraftAttachments();};
function describeAttachments(medical){
 const active=medical?composer.elements.medicalFiles:composer.elements.image;
 const other=medical?composer.elements.image:composer.elements.medicalFiles;
 other.value='';
 const files=active.files;
 $('[data-attachment]').textContent=files.length>1?'已选 '+files.length+' 份附件':files[0]?.name??'';
 send.textContent=medical&&files.length?'发送所选报告识别':'发送';
 clearPhoto.hidden=!files.length;
}
composer.elements.image.onchange=()=>describeAttachments(false);
composer.elements.medicalFiles.onchange=()=>describeAttachments(true);
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

function requiresConfirmation(proposal){
 const {mode,result}=proposal;
 const associated={entry:'eat',food_edit:'correct',activity:'activity',portions:'split',inventory:'inventory',purchase:'purchase',plan:'next_meal'}[mode];
 if(associated){
  try{assertSkillAction(skillCatalog(workspace.finance),associated);}catch{return true;}
 }
 if(mode==='document_edit'){
  // Conversation-only metadata edits have a narrowly scoped shortcut.
  if(result.document!=='conversations')return true;
  try{
   const patch=JSON.parse(result.patch);
   return !Array.isArray(patch)||patch.filter(row=>row.op!=='test').length!==1||
    patch.some(row=>row.op!=='test'&&!(/^\/threads\/\d+\/title$/.test(row.path)&&row.op==='replace'||
     row.path==='/customNotes'&&row.op==='add'));
  }catch{return true;}
 }
 if(mode==='batch')return result.operations.some(requiresConfirmation);
 if(mode==='delete_record')return result.selection!=='one'||!result.query.trim();
 if(mode==='app_data_edit')return ['health_settings','finance_settings','assistant_settings','legacy_rules','balances','budgets'].includes(result.dataset);
 return false;
}
function directWrite(response,flow){
 if(flow.input.photo&&['purchase','finance','batch'].includes(response.proposal?.mode))return false;
 return response.saveMode==='save'&&!!response.proposal&&!!flow.input.text.trim()&&
  flow.options.allowRead&&flow.options.documentAccess&&!requiresConfirmation(response.proposal);
}
async function makeReview(proposal,flow,photoJob,direct=false){
 clearReview();if(!proposal)return;
 const panel=direct?document.createElement('form'):review;
 if(photoJob){
  const label=document.createElement('p');
  label.className='photo-review-title';label.textContent=photoJob.label;panel.append(label);
 }
 const {mode,result}=proposal,today=flow.input.date;
 if(mode==='plan'&&!proposal.date)proposal={...proposal,date:statedDate(flow.input.text,today)};
 const traceId=flow.options.traceId;
 const reviewId=photoJob?'photo-'+photoJob.index:'review';
 const reviewStep=(status,receipt=null,error)=>traceStep(traceId,{id:reviewId,kind:mode,dependsOn:[],
  evidence:[photoJob?.label??flow.input.text.slice(0,360)],status,receipt,failure:failureKind(error)});
 const editsConversation=mode==='document_edit'&&result.document==='conversations';
 const willContinue=mode==='batch'&&result.next==='continue';
 let confirm,label;
 if(mode==='batch'){
  confirm=await batchReview(panel,result,workspace,today,book.current?.foodDate);
  label=willContinue?'确认全部并继续':'确认全部';
 }else if(mode==='document_edit'){
  const activeId=book.current?.id,batchId=photoBatch?.id;
  const draft=await prepareDocumentEdit(workspace,result,editsConversation?(next,message)=>{
   const row=next?.threads?.find(thread=>thread?.id===activeId);
   if(!row)return;
   const same=proposal=>proposal?.mode==='document_edit'&&proposal.result?.patch===result.patch;
   if(!photoJob&&same(row.review?.proposal))row.review=null;
   if(photoJob&&row.photos?.id===batchId){
    const job=row.photos.jobs.find(item=>item.index===photoJob.index);
    if(!same(job?.proposal))return;
    job.proposal=null;job.stage='settled';job.reply+='\n'+message;
    const summaryLine=row.messages[row.photos.summaryIndex];
    const previousSummary=row.photos.summary;
    row.photos.summary=photoSummary(row.photos.jobs);
    if(summaryLine?.text===previousSummary)summaryLine.text=row.photos.summary;
   }
  }:undefined);
  const title=document.createElement('p');
  title.textContent='原始数据 · '+draft.name;
  const details=document.createElement('details');details.className='assistant-prompt document-review';
  const summary=document.createElement('summary');
  summary.textContent='查看 '+draft.operations.filter(row=>row.op!=='test').length+' 项修改';
  const patch=document.createElement('pre');patch.textContent=JSON.stringify(draft.operations,null,2);
  details.append(summary,patch);panel.append(title,details);
  confirm=async()=>{
   const message=await draft.save();
   if(editsConversation){
    const previousPhotos=photoBatch;
    book.reload();renderThread(previousPhotos);
   }
   if(result.document==='memory')refreshMemory();
   if(result.document==='model')refreshModels();
   if(result.document==='history')updateContext();
   if(result.document==='local_usage')void refreshUsage();
   return direct&&message.endsWith('已保存。')?message+' '+draft.operations.filter(row=>row.op!=='test')
    .map(row=>({add:'新增',replace:'替换',remove:'删除'}[row.op])+' '+(row.path||'整份文档')).join('、')+'。':message;
  };
  label='确认保存原始数据';
 }else if(mode==='app_data_edit'){
  const apply=await appDataReview(panel,workspace,book,result,today);
  confirm=async()=>{
   const message=await apply();
   if(result.dataset==='assistant_settings'){refreshModels();updateContext();}
   if(result.dataset==='memory')refreshMemory();
   return message;
  };
  label=result.action==='delete'?'确认撤销或删除':'确认更新';
 }else if(mode==='delete_record'){
  confirm=await deleteReview(panel,proposal,workspace,today,book.current?.foodDate,direct);
  label='确认删除';
 }else if(mode==='finance'){
  confirm=financeReview(panel,result.entry,today,workspace.finance,direct);
  label='确认记账';
 }else{
  const current=await workspace.readHealth();
  let draft;
  if(mode==='inventory'){
   const apply=inventoryReview(panel,proposal,current,today);
   draft=result.operation==='shopping'?
    {apply,label:'确认加入补货清单',saved:'补货清单已更新。'}:
    {apply,label:'确认盘点',saved:'库存已按盘点结果更新。'};
  }else if(mode==='food_edit')draft=foodEditReview(panel,proposal,current,today,book.current?.foodDate);
  else if(mode==='portions')draft=portionReview(panel,proposal,current,today);
  else draft=healthReview(panel,proposal,current,today);
  if(draft){
   label=draft.label;
   confirm=async()=>{
    const next=draft.apply(current);
    const message=direct&&draft.receipt?draft.receipt(current,next):draft.saved;
    await workspace.saveHealth(next,current.revision??0);
    return message;
   };
  }
 }
 if(!confirm){
  if(direct)throw Error('缺少可以保存的记录，请补充信息。');
  if(photoJob)settlePhoto(photoJob,'此照片没有可保存的记录。');
  return;
 }

 async function save(continueRequested){
  if(direct&&!hasDocumentAccess(workspace.finance))throw Error('完整数据权限已关闭。');
  const operations=mode==='batch'?result.operations:[proposal];
  const fingerprints=operations.map(operation=>JSON.stringify(operation));
  const previouslySaved=flow.options.savedOperations??[];
  if(direct&&fingerprints.some(item=>previouslySaved.includes(item)))throw Error('检测到本轮已经保存的操作，请检查账本后再继续。');
  if(!photoJob&&!editsConversation&&book.current?.review)book.setReview({...book.current.review,applying:true});
  if(photoJob&&!editsConversation){photoJob.stage='applying';savePhotoBatch();}
  let message;
  try{message=await confirm();}
  catch(err){
   if(direct&&err instanceof AssistantSyncPending){
    await resumePurchaseUpdate(workspace.account);
    message='财务与健康账本已同步。';
   }else{
    if(photoJob&&!editsConversation){photoJob.stage='done';savePhotoBatch();}
    else if(book.current?.review?.applying)book.setReview({...book.current.review,applying:false});
    throw err;
   }
  }
  void reviewStep('done',{summary:message});
  if(!willContinue||!continueRequested)void traceStatus(traceId,'done');
  if(editsConversation){
   if(!direct||!book.current)tell(message);
  }
  else if(photoJob)settlePhoto(photoJob,message);
  else book.setReview(null);
  if(mode==='app_data_edit'&&result.dataset==='conversations')renderThread(photoBatch);
  restoreReview.hidden=true;clearReview();
  if(!editsConversation){
   if(mode==='app_data_edit'&&result.dataset==='conversations'&&!book.current)tell(message);
   else if(!photoJob||direct)append('assistant',photoJob?'照片 '+photoJob.index+' · '+message:message,false);
  }else if(direct&&book.current){
   append('assistant',photoJob?'照片 '+photoJob.index+' · '+message:message,false);
  }
  if(continueRequested&&book.current){
   followUp={
    id:crypto.randomUUID(),input:{...flow.input,date:localDate(),text:flow.input.text||'继续完成刚才照片中的请求。',history:[],photo:null},
    options:{...flow.options,contextSummary:'',applied:[...(flow.options.applied??[]),...operations.map(operation=>operation.mode)],
     savedOperations:[...previouslySaved,...fingerprints]},
    steps:[]
   };
   book.setFollowUp(sessionFlow(followUp));
  }
 }
 if(direct){
  await save(willContinue);
  return;
 }

 const actions=document.createElement('div');actions.className='chat-actions';
 const apply=document.createElement('button');apply.type='submit';apply.className='primary-button';apply.textContent=label;
 if(mode==='delete_record'||mode==='app_data_edit'&&result.action==='delete')apply.classList.add('delete-apply');
 void reviewStep('review');void traceStatus(traceId,'review');
 const discard=document.createElement('button');discard.type='button';discard.className='secondary-button';discard.textContent='放弃';
 discard.onclick=()=>{
  void reviewStep('cancelled');void traceStatus(traceId,'cancelled');
  if(photoJob)settlePhoto(photoJob,'已放弃候选。');
  else book.setReview(null);
  if(mode==='app_data_edit'&&result.dataset==='conversations')renderThread(photoBatch);
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
  if(review.dataset.syncPending!=='yes'){
   continuationApproved=willContinue&&e.submitter===apply;
   void trace(traceId,{type:'confirm'});
  }
  saving=true;lock();out.textContent='';
  try{await save(continuationApproved);}
  catch(err){
   void reviewStep('pending',null,err);void traceStatus(traceId,'pending',err);
   out.textContent=err.message;
   if(err instanceof AssistantSyncPending){
    review.dataset.syncPending='yes';apply.textContent='继续同步';discard.hidden=true;
    if(saveOnly)saveOnly.hidden=true;
   }
  }
  finally{saving=false;lock();}
  if(continuationApproved)await continueAfterSave();
 };
 for(const select of review.querySelectorAll('select'))select.dataset.picker='';
 syncChoiceFields(review);
 review.hidden=false;
 const contextAbove=mode==='plan'?10:88;
 thread.scrollTop=Math.max(0,thread.scrollTop+review.getBoundingClientRect().top-thread.getBoundingClientRect().top-contextAbove);
}

function rememberAutomatically(response,flow){
 if(!flow.options.autoMemory||!flow.options.allowRead||!response.memoryUpdates?.length)return;
 const {mode,result}=response.proposal??{};
 if(['app_data_edit','document_edit'].includes(mode)&&(result.dataset??result.document)==='memory')return;
 let names;
 try{names=workspace.memory.rememberFromTurn(response.memoryUpdates,flow.input.text);}
 catch(err){tell('自动记忆未保存。'+err.message);return;}
 if(names.length){
  refreshMemory();
  append('assistant','已记住 '+names.map(name=>'「'+name+'」').join('、')+'。',false);
 }
}
function healthOptions(flow,ticket,confirmed=false){
 const options=flow.options,auto=!!options.healthAuto&&hasHealthAuto(workspace.finance);
 return {id:ticket.operationId??ticket.id,text:flow.input.text,today:flow.input.date,
  clock:options.healthClock??localClock(),mediaKey:options.mediaKey,skills:skillCatalog(workspace.finance),
  habits:habitPolicy(workspace.memory.list().filter(row=>memoryKind(row)==='habit')),photoSteps:flow.photoSteps,reference:options.healthReference??book.current?.healthReference,
  foodDate:book.current?.foodDate,auto,confirmed,
  guard:()=>{
   if(!flow.options.allowRead||!composer.elements.allowRead.checked)throw Error('本轮本机数据权限已关闭，账本未更改。');
   if(!confirmed&&(!options.healthAuto||!hasHealthAuto(workspace.finance)))throw Error('健康自动执行权限已关闭，账本未更改。');
  }};
}
function echoHealth(ticket,result,source){
 source=result.source??source;
 const record=result.record,id=record&&!record.undone?record.id:null;
 if(record?.reference&&!record.undone)book.setHealthReference(record.reference);
 if(!book.finish(ticket,result.text,source,null,id?{healthActionId:id}:undefined))return;
 retryRequest.hidden=true;restoreReview.hidden=true;
 bubble('assistant',result.text,source,id,true);syncThreads();updateContext();
}
async function saveHealthProposal(plan,flow,ticket,source,confirmed=false){
 const controller=new AbortController();
 activeRequest=controller;stop.hidden=false;stop.disabled=false;
 tell('正在本机保存并核对健康记录…');
 try{
  const options=healthOptions(flow,ticket,confirmed);
  const base=flow.healthBase??await workspace.readHealth();
  return await executeHealthAction(workspace,base,plan,{...options,signal:controller.signal,guard:()=>{
   options.guard();
   const currentSkills=skillCatalog(workspace.finance);
   if(flow.photoSteps)assertSkillAction(currentSkills,'photo_meal');
   for(const step of plan.steps)assertSkillAction(currentSkills,step.kind);
  }});
 }finally{
  activeRequest=null;stop.hidden=true;
 }
}
function healthTrace(plan,flow,status,result,error){
 const traceId=flow.options.traceId;
 for(const [index,step] of (plan?.steps??[]).entries()){
  void traceStep(traceId,{id:'health-'+index,kind:step.kind,dependsOn:index?['health-'+(index-1)]:[],
   tool:'health_action',intent:[step.kind],objects:step.name?[step.name]:[],evidence:[step.date].filter(Boolean),
   operationId:result?.record?.id??flow.options.traceId,status,receipt:healthTraceReceipt(result?.record),retryable:status==='pending',
   failure:failureKind(error)});
 }
 void traceStatus(traceId,status,error);
}
async function completeHealth(plan,flow,source,ticket){
 const options=healthOptions(flow,ticket);
 const base=flow.healthBase??await workspace.readHealth();
 const previously=healthActionReceipt(base,options);
 if(previously){healthTrace(plan,flow,'done',previously);echoHealth(ticket,previously,source);tell('');return;}
 let prepared;
 try{prepared=healthActionPreview(base,plan,options);}
 catch(err){healthTrace(plan,flow,'blocked',null,err);echoHealth(ticket,{text:err.message},source);tell('');return;}
 if(!prepared.execute){
  healthTrace(plan,flow,'done');
  echoHealth(ticket,{text:[prepared.preview,...(flow.photoNotes??[])].filter(Boolean).join('\n'),source:prepared.source},source);tell('');return;}
 const savedPlan=flow.photoSteps?{plan,photoSteps:flow.photoSteps,photoReview:flow.photoReview,photoNotes:flow.photoNotes}:plan;
 if(!book.stageHealth(ticket,savedPlan))return;
 if(!options.auto||flow.photoReview){
  if(flow.options.healthAuto&&!flow.photoReview){tell('健康自动执行权限已关闭，账本未更改。');showPending();return;}
  healthTrace(plan,flow,'review');
  const body=document.createElement('p');body.textContent=['待保存 · '+prepared.preview,...(flow.photoNotes??[])].join('\n');
  const apply=document.createElement('button');apply.type='submit';apply.textContent='确认健康记录';apply.className='primary-button';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='text-button';cancel.textContent='取消';
  cancel.onclick=()=>{healthTrace(plan,flow,'cancelled');echoHealth(ticket,{text:'已取消健康记录。'},source);clearReview();};
  review.append(body,apply,cancel);review.hidden=false;
  review.onsubmit=async event=>{
   event.preventDefault();if(busy||saving)return;
   saving=true;lock();void trace(flow.options.traceId,{type:'confirm'});
   healthTrace(plan,flow,'running');
   try{const result=await saveHealthProposal(plan,flow,ticket,source,true);healthTrace(plan,flow,'done',result);echoHealth(ticket,result,source);clearReview();tell('');}
   catch(err){healthTrace(plan,flow,'pending',null,err);report(err);retryRequest.hidden=false;}
   finally{saving=false;lock();}
  };
  return;
 }
 healthTrace(plan,flow,'running');
 let result;
 try{result=await saveHealthProposal(plan,flow,ticket,source);}
 catch(error){healthTrace(plan,flow,'pending',null,error);throw error;}
 healthTrace(plan,flow,'done',result);
 if(flow.photoNotes?.length)result.text+='\n'+flow.photoNotes.join('\n');
 echoHealth(ticket,result,source);tell('');
}
function echoAgent(ticket,result){
 const source={label:'执行详情',text:result.detail};
 if(result.reference)book.setHealthReference(result.reference);
 if(!book.finish(ticket,result.text,source,null,{agentUndo:result.undo}))return;
 clearReview();retryRequest.hidden=true;restoreReview.hidden=true;
 bubble('assistant',result.text,source,null,true,result.undo);syncThreads();updateContext();tell('');
}
async function completeAgent(plan,flow,ticket,staged={},approved=staged.approved??[]){
 if(!flow.options.allowRead)throw Error('请先允许本轮访问本机数据。');
 try{orderAgentTasks(plan);}
 catch(err){void traceStatus(flow.options.traceId,'failed',err);echoAgent(ticket,{text:err.message,detail:err.message,undo:[]});return;}
 const state={agentTask:plan,prior:staged.prior,approved,attachmentKeys:staged.attachmentKeys??flow.options.attachmentKeys,
  mediaKey:staged.mediaKey??flow.options.mediaKey};
 if(!book.stageHealth(ticket,state))return;
 const controller=new AbortController();
 activeRequest=controller;stop.hidden=false;stop.disabled=false;
 let result;
 try{
  result=await executeAgentTask(workspace,plan,{id:ticket.operationId??ticket.id,
   today:flow.input.date,text:flow.input.text,clock:flow.options.healthClock,mediaKey:state.mediaKey,
   attachmentKeys:state.attachmentKeys,approved,prior:state.prior,healthOptions:healthOptions(flow,ticket),signal:controller.signal,
   guard:()=>{if(!composer.elements.allowRead.checked)throw Error('本轮本机数据权限已关闭。');},
   onStep:label=>tell('正在处理'+label+'并核对本机回执…'),
   onStepEvent:step=>void traceStep(flow.options.traceId,step),
   progress:prior=>{book.stageHealth(ticket,{...state,prior});}});
 }finally{activeRequest=null;stop.hidden=true;}
 const ready=result.rows.filter(row=>row.state==='review');
 const pending=result.rows.some(row=>row.state==='pending');
 const blocked=result.rows.find(row=>['blocked','waiting'].includes(row.state));
 const outcome=blocked?(result.rows.some(row=>row.state==='done')?'partial':'blocked'):'done';
 void traceStatus(flow.options.traceId,pending?'pending':ready.length?'review':outcome,blocked?.reason);
 if(!ready.length&&!pending){echoAgent(ticket,result);return;}
 const body=document.createElement('p');body.textContent=result.text;
 const detail=document.createElement('details'),title=document.createElement('summary'),description=document.createElement('p');
 title.textContent='执行详情';description.textContent=result.detail;detail.append(title,description);
 review.replaceChildren(body,detail);review.hidden=false;
 if(ready.length){
  const apply=document.createElement('button');apply.type='submit';apply.textContent='确认待保存项';apply.className='primary-button';
  review.append(apply);
  review.onsubmit=async event=>{
   event.preventDefault();if(busy||saving)return;
   saving=true;lock();void trace(flow.options.traceId,{type:'confirm'});
   const ids=[...new Set([...approved,...ready.map(row=>row.id)])];
   try{await completeAgent(plan,flow,ticket,{...state,prior:result.results},ids);}
   catch(err){report(err);retryRequest.hidden=false;}
   finally{saving=false;lock();}
  };
 }
 const finish=document.createElement('button');
 finish.type='button';finish.className='text-button';finish.textContent='结束本轮';
 finish.onclick=()=>{if(!busy&&!saving){void traceStatus(flow.options.traceId,'partial');echoAgent(ticket,result);}};
 if(!pending)review.append(finish);
 retryRequest.hidden=!pending;retryRequest.textContent='重试未完成步骤';tell(pending?'尚有步骤未完成，可重试。':'');
}
async function complete(response,flow,source,ticket){
 clearReview();tell('');
 if(ticket&&response.proposal?.mode==='agent_task'){
  await completeAgent(response.proposal.result,flow,ticket);
  rememberAutomatically(response,flow);
  return;
 }
 if(ticket&&response.proposal?.mode==='photo_meal'){
  try{
   assertSkillAction(skillCatalog(workspace.finance),'photo_meal');
   const grouped=groupMealPhotos(response.proposal.result,flow.input.text,flow.options.photos?.length??0);
   if(!grouped.plan.steps.length){echoHealth(ticket,{text:grouped.notes.join('；')||'这组照片暂时没有可记录的食物。'},source);return;}
   flow.photoSteps=grouped.photoSteps;flow.photoReview=grouped.review;flow.photoNotes=grouped.notes;
   await completeHealth(grouped.plan,flow,source,ticket);
  }catch(err){
   if(book.current?.pending?.healthAction)throw err;
   echoHealth(ticket,{text:err.message},source);tell('');
  }
  rememberAutomatically(response,flow);
  return;
 }
 if(ticket&&response.proposal?.mode==='health_action'){
  await completeHealth(response.proposal.result,flow,source,ticket);
  rememberAutomatically(response,flow);
  return;
 }
 const candidate=response.proposal?{proposal:response.proposal,flow:sessionFlow(flow)}:null;
 if(!candidate)void traceStatus(flow.options.traceId,'done');
 if(ticket){
  if(!book.finish(ticket,response.reply,source,candidate))return;
  bubble('assistant',response.reply,source);syncThreads();updateContext();
 }else{
  append('assistant',response.reply,!source,source);book.setReview(candidate);
 }
 retryRequest.hidden=true;restoreReview.hidden=true;
 const direct=directWrite(response,flow);
 try{await makeReview(response.proposal,flow,undefined,direct);}
 catch(err){
  clearReview();
  if(direct){
   if(book.current?.review&&!book.current.review.applying)book.setReview(null);
   append('assistant',err instanceof AssistantSyncPending?err.message:'无法完成本轮写入。'+err.message,false);
  }else report(err);
 }
 rememberAutomatically(response,flow);
}
function describeSummary(scope,summary){
 if(scope==='health_report')return renderHealthReport(summary);
 if(scope==='health_status')return '本机账本修订 '+summary.device.revision+' · '+
  (summary.syncPackage?'最近生成同步包 '+summary.syncPackage.issuedAt:'本机未记录同步包导出')+'。'+summary.external.message;
 if(scope==='app_data'||scope==='packages')return JSON.stringify(summary,null,2);
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
   displayDay(summary.start,true)+'至'+displayDay(summary.end,true)+' · 有摄入 '+summary.reportedDays+'/'+summary.days+' 天',
   '最近结算 '+(summary.closedThrough?displayDay(summary.closedThrough):'暂无')+' · 待补 '+summary.unreported+' 天',
   '已结算缺口 '+summary.deficit+' / '+summary.goal+' kcal · 进度 '+summary.progress+'% · 剩余 '+summary.remaining+' kcal',
   '理论脂肪当量 '+summary.fatEquivalent+' kg',
   displayDay(day.date)+' 账面缺口 '+(day.deficit??'待补')+(day.possibleOverestimate?'（可能高估）':'')+' · 摄入 '+(day.intake??'待补')+' · 消耗 '+(day.tdee??'待补')+' kcal'+(day.source?' · '+source[day.source]:'')
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
    '账面缺口 '+(day.deficit??'待补')+(day.possibleOverestimate?'（可能高估）':'')+' kcal');
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
 if(steps.every(step=>step.scope==='app_document'))return null;
 steps=steps.filter(step=>step.scope!=='app_document');
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
   if(steps.length>=READ_LIMIT)throw Error('本轮查询步骤过多，账本未更改。请缩小问题或重试。');
   const {args,item}=response.call;
   const key=JSON.stringify(Object.entries(args).sort(([a],[b])=>a.localeCompare(b)));
   if(queried.has(key))throw Error('助手重复查询同一范围，请重试或缩小问题。');
   queried.add(key);
   tell(args.scope==='app_document'?'正在查询指定的原始数据…':'正在查询'+(args.scope==='packages'?'独立包装':args.scope==='health_report'?'健康报告':args.scope==='health_status'?'文件状态':readLabels[args.scope])+'…');
   let summary;
   if(args.scope==='app_document'){
    if(!options.documentAccess)throw Error('本轮未开启完整数据权限');
    summary=await readAppDocument(workspace,args);
   }else if(args.scope==='app_data')summary=await readAppData(workspace,book,args);
   else if(args.scope==='packages')summary=readPackages(flow.healthBase??await workspace.readHealth(),args);
   else if(args.scope==='health_report')summary=healthReport(flow.healthBase??await workspace.readHealth(),args.date??input.date,input.date,{includeMeals:args.view==='meals'});
   else if(args.scope==='health_status')summary=readHealthFileStatus(workspace.finance,flow.healthBase??await workspace.readHealth());
   else summary=await readLedger(workspace,args,input.date);
   steps.push({item,summary,scope:args.scope});
   void traceStep(options.traceId,{id:'read-'+steps.length,kind:args.scope,dependsOn:[],status:'done',
    evidence:[args.date??args.start??args.query??''].filter(Boolean)});
   response=await requestReply(input,{...options,continuation:steps},savePartial);
   if(args.scope==='foods')try{book.setFoodDate(summary.date);}catch{}
 }
 return response;
}
async function showResponse(response,flow,ticket,savePartial){
 const resolved=await resolveResponse(response,flow,savePartial);
 await complete(resolved,flow,querySource(flow.steps),ticket);
}
async function runFollowUp(){
 while(followUp){
  const next=followUp;
  retryFollowUp.hidden=true;
  tell('账本已保存，正在继续本轮…');
  renderTranscript();
  const saved=checkpoint(text=>{
   if(followUp!==next&&(!next.id||followUp?.id!==next.id))return;
   next.partial=text;book.setFollowUp({...sessionFlow(next),partial:text});
  });
  try{
   const flow={...next,options:{...next.options,memory:memoriesFor(next.input,next.options.allowRead)},steps:[]};
   const response=await requestReply(flow.input,flow.options,saved.update);
   await showResponse(response,flow,undefined,saved.update);
   if(followUp===next||next.id&&followUp?.id===next.id){clearFollowUp();book.setFollowUp(null);}
  }catch(err){
   saved.stop();
   if(next.partial)bubble('assistant',next.partial);
   tell('账本已保存。'+err.message);
   retryFollowUp.hidden=false;
   break;
  }finally{saved.stop();}
 }
}
async function continueAfterSave(){
 if(!followUp||busy||saving)return;
 busy=true;lock();
 try{await runFollowUp();}
 finally{busy=false;lock();}
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
  const batchId=photoBatch?.id;
  for(const index of jobs.map(job=>job.index)){
   if(run.stopped||photoBatch?.id!==batchId)break;
   const job=photoBatch?.jobs.find(item=>item.index===index);
   if(!job?.file)continue;
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
    if(index===1)rememberAutomatically(reply,{input,options});
    if(directWrite(reply,{input,options})){
     savePhotoBatch();
     try{
      await makeReview(job.proposal,{input,options,steps},job,true);
      await runFollowUp();
     }catch(err){
      if(job.stage==='applying'){
       showPhoto(job,job.reply+'\n'+err.message);
      }else settlePhoto(job,'无法完成写入。'+err.message);
     }
    }
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
    const flow={...batch.flow,options:{...batch.flow.options,memory:memoriesFor(batch.flow.input,batch.flow.options.allowRead)}};
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
 if(files.length>1&&!options.groupedPhotos){await sendPhotos(input,options,files);return;}
 if(files.length){
  const encoded=options.groupedPhotos?[...new Set(await Promise.all(files.map(jpeg)))]:[input.photo];
  input={...input,photo:encoded[0]};
  if(options.groupedPhotos)options.photos=encoded;
  const keys=[];
  for(const photo of encoded){
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(photo));
   keys.push(Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join(''));
  }
  options.attachmentKeys=keys;options.mediaKey=[...keys].sort().join(':');
 }
 const userText=[input.text,input.photo?(options.groupedPhotos?'（附 '+files.length+' 张图片）':'（附一张照片）'):''].filter(Boolean).join(' ');
 const previous=book.current?.pending?.request;
 const savedPlan=book.current?.pending?.healthAction;
 const resumesAttachment=!!(savedPlan?.photoSteps||savedPlan?.agentTask)&&previous?.text===input.text;
 const hasPhoto=!!input.photo||resumesAttachment&&previous.hasPhoto;
 if(!files.length&&resumesAttachment)options.mediaKey=previous.mediaKey;
 const reuse=previous?.text===input.text&&previous.hasPhoto===hasPhoto&&(previous.mediaKey??null)===(options.mediaKey??null);
 const ticket=book.begin(userText,{text:input.text,date:input.date,allowRead:options.allowRead,hasPhoto,
  healthClock:options.healthClock,mediaKey:options.mediaKey,traceId:options.traceId},reuse);
 void trace(options.traceId,{type:'thread',threadId:book.current?.id});
 const saved=checkpoint(text=>book.checkpoint(ticket,text));
 clearReview();restoreReview.hidden=true;retryRequest.hidden=true;photoResults.replaceChildren();
 renderTranscript();syncThreads();
 tell(options.local?'正在本机处理…':demo?'正在生成演示回复…':'正在等待 OpenAI 回复…');
 try{
  const flow={input,options,steps:[]};
  const staged=book.current?.pending?.healthAction;
   if(options.healthActions&&!staged?.agentTask&&(options.healthAuto||staged)){
   flow.healthBase=await workspace.readHealth();
   if(options.healthAuto){
    const context=healthContext(flow.healthBase,input,options.healthReference);
    if(Object.keys(context).length>1)options.healthContext=context;
   }
  }
  const existing=flow.healthBase&&healthActionReceipt(flow.healthBase,healthOptions(flow,ticket));
  if(existing){
   healthTrace(options.local?.proposal?.result??staged?.plan??staged,flow,'done',existing);
   echoHealth(ticket,existing);tell('');
  }else if(staged?.agentTask){
   await completeAgent(staged.agentTask,flow,ticket,staged);
  }else if(staged){
   if(!options.healthActions)throw Error('本轮未允许本机健康数据操作。');
   if(staged.plan){flow.photoSteps=staged.photoSteps;flow.photoReview=staged.photoReview;flow.photoNotes=staged.photoNotes;}
   await completeHealth(staged.plan??staged,flow,null,ticket);
  }else if(options.local?.query){
   const args=options.local.query,summary=await readLedger(workspace,args,input.date);
   if(args.scope==='foods'){
    book.setFoodDate(args.date);
    if(options.local.meal)summary.foods=summary.foods.filter(row=>row.meal===options.local.meal);
   }
   const source=querySource([{scope:args.scope,summary}]);
   const reply=args.scope==='balance'?'当前总余额 '+summary.balance.toFixed(2)+' 元。':
    args.scope==='foods'&&options.local.meal?describeSummary(args.scope,summary):
    args.scope==='foods'?'本机 '+summary.date+' 的实际饮食共 '+summary.foods.length+' 条。':describeSummary(args.scope,summary);
   if(book.finish(ticket,reply,source,null)){bubble('assistant',reply,source,null,true);syncThreads();updateContext();}
   void traceStep(options.traceId,{id:'read-1',kind:args.scope,dependsOn:[],status:'done',evidence:[input.date]});
   void traceStatus(options.traceId,'done');tell('');
  }else if(options.local?.proposal){
   await complete({proposal:options.local.proposal},flow,null,ticket);
  }else if(options.decomposed){
   const request={...input,text:options.decomposed.wireText};
   let response;
   try{response=await requestReply(request,options,saved.update);}
   catch(error){if(failureKind(error)==='cancelled')throw error;}
   const combined=combineReceiptTurn(options.decomposed,response?.proposal);
   if(!combined)throw Error('这组订单有较多步骤，请按订单分别处理。');
   await complete({proposal:combined},flow,null,ticket);
  }else{
   const response=await requestReply(input,options,saved.update);
   await showResponse(response,flow,ticket,saved.update);
  }
  saved.stop();
  await runFollowUp();
  clearComposer();
 }catch(err){
  saved.stop();
  if(book.current?.pending?.id===ticket.id)showPending();
  throw err;
 }finally{saved.stop();}
}
retryRequest.onclick=()=>{
 if(nativeUi&&book.current?.pending?.request?.native){void nativeUi.restore({resume:true});return;}
 const item=book.current?.pending?.request;
 if(!item||busy||saving)return;
 composer.elements.text.value=item.text;
 composer.elements.allowRead.checked=item.allowRead;
 if(item.hasPhoto&&!book.current?.pending?.healthAction){tell('请重新选中原照片后再发送。');return;}
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
function memoriesFor(input,allowRead,profile='general'){
 if(!allowRead)return [];
 const previous=input.history.filter(message=>message.role==='user').at(-1)?.text;
 const cue=/^(?:把)?(?:这条|那条|刚才|上面|继续|然后)/.test(input.text)?previous:'';
 return workspace.memory.relevant([input.text,cue].filter(Boolean).join(' '),{budget:profile==='general'?1100:600,limit:profile==='general'?6:3});
}
async function runMedicalTurn(kind,text,files,route,traceId){
 clearReview();clearFollowUp();
 const allowed=()=>composer.elements.allowRead.checked;
 function echo(role,message,detail){
  const source=detail?{label:'健康档案详情',text:detail}:undefined;
  book.append(role,message,false,source,{privateMedical:true});
  bubble(role,message,source,null,true);start.hidden=true;syncThreads();updateContext();
 }
 let medicalReceipt=null;
 const finish=(message,detail)=>{
  const status=/已取消/.test(message)?'cancelled':/未能|无法/.test(message)?'blocked':'done';
  void traceStep(traceId,{id:'medical',kind,tool:'medical_'+kind,operationId:traceId,dependsOn:[],status,receipt:medicalReceipt});
  void traceStatus(traceId,status);
  echo('assistant',message,detail);clearReview();tell('');
 };
 echo('user',text||'识别本轮选中的体检报告');
 await useMedicalTurn(workspace,{
  kind,text,files,allowed,show:finish,onSaved:receipt=>{medicalReceipt=receipt;},
  ask:async(question,medical)=>{
   if(!await readDeviceKey()){revealKeySettings();throw Error('请先导入 API Key。');}
   tell('正在处理本轮所选健康档案…');
   return requestReply({mode:'chat',text:question,photo:null,date:localDate(),history:[]},
    {medical,model:route.model,traceId,allowRead:false,agentQuiet:true});
  },
  review:draft=>{
   void traceStep(traceId,{id:'medical',kind,dependsOn:[],status:'review'});
   void traceStatus(traceId,'review');tell('');
   renderMedicalReview(review,{...draft,save:async date=>{
    saving=true;lock();void trace(traceId,{type:'confirm'});
    try{return await draft.save(date);}
    finally{saving=false;lock();}
   }},finish,error=>{void traceStatus(traceId,'pending',error);report(error);},()=>busy||saving);
  }
 });
 clearComposer();
}
composer.onsubmit=async e=>{
 e.preventDefault();if(busy||saving)return;
 const activePending=book.current?.pending;
 if(nativeUi&&(!activePending||activePending.request?.native)){await nativeUi.submit();return;}
 const text=composer.elements.text.value.trim(),files=[...composer.elements.image.files];
 const medicalFiles=[...composer.elements.medicalFiles.files];
 const kind=!demo?medicalIntent(text,files.length,medicalFiles.length):null;
 if(demo&&medicalFiles.length){tell('演示模式仅支持普通照片。');return;}
 const savedRequest=book.current?.pending;
 const resumeSaved=!!savedRequest?.healthAction&&savedRequest.request?.text===text;
 if(!text&&!files.length&&!medicalFiles.length&&!resumeSaved){tell('请输入消息或添加照片');return;}
 busy=true;lock();tell('');
 const pending=savedRequest?.request;
 const retry=pending?.text===text&&pending.hasPhoto===Boolean(files.length||resumeSaved&&pending.hasPhoto);
 const traceId=retry?pending.traceId??savedRequest.operationId:crypto.randomUUID();
 try{
  const allowRead=composer.elements.allowRead.checked,date=(retry?pending.date:null)??localDate();
  const route=routeAgent(workspace.finance,{text,photos:files.length+medicalFiles.length,medical:kind,allowRead,legacy:demo,today:date});
  let local=!demo&&!kind&&!resumeSaved?localAgentCommand(workspace,{text,today:date,allowRead,files:files.length,reference:book.current?.healthReference}):null;
  if(local?.needsStock){
   const scoped=healthContext(await workspace.readHealth(),{text,date},book.current?.healthReference);
   if(scoped.stock?.length!==1||!(scoped.stock[0].quantity>0))local=null;
  }
  await trace(traceId,{type:'start',route:local?'local':resumeSaved?'resume':route.profile,threadId:book.current?.id});
  if(kind){
   void traceStep(traceId,{id:'medical',kind,dependsOn:[],status:'running',evidence:medicalFiles.length||files.length?
    ['本轮所选附件 '+(medicalFiles.length||files.length)+' 份']:['本轮指定档案']});
   await runMedicalTurn(kind,text,medicalFiles.length?medicalFiles:files,route,traceId);
   return;
  }
  if(!demo&&!resumeSaved&&!local){
   tell('正在读取本机 API Key…');
   if(!await readDeviceKey()){revealKeySettings();tell('请先导入 API Key');void traceStatus(traceId,'blocked','缺少 API Key');return;}
  }
  const photo=files.length===1?await jpeg(files[0]):null;
  const model=route.model;
  const context=resumeSaved||local?{turns:[],summary:null}:route.profile==='general'?
   await prepareContext(date,model,traceId):scopedHistory(route.profile,text,updateContext());
  const {turns,summary}=route.profile==='general'?scopedHistory(route.profile,text,context):context;
  const history=retry&&turns.at(-1)?.role==='user'?turns.slice(0,-1):turns;
  const catalog=allowRead?skillCatalog(workspace.finance):[];
  const groupedPhotos=!demo&&(files.length>1||files.length===1&&route.profile==='vision'&&/标签|营养成分/.test(text))&&
   (!separateAttachmentRequests(text)||/采购|订单|支付|付款|退款/.test(text))&&
   catalog.some(skill=>['photos','receipts'].includes(skill.id)&&skill.enabled);
  const input={mode:'chat',text,photo,date,history};
  const agentTasks=!demo&&allowRead&&(local?.proposal?.mode==='agent_task'||files.length>0||
   /账|帐|财务|买|花了|收了|支出|收入|采购|退款|报销|付款|支付/.test(text));
  const financeContext=allowRead&&['finance','receipt','mixed'].includes(route.profile)?
   (readFinance(workspace.finance).payload?.categories??[]).filter(row=>!row.hidden&&
    (route.profile!=='receipt'||!row.id.startsWith('default-')))
    .map(({id,name,type})=>({id,name,type})):undefined;
  const logs=allowRead&&!local&&!resumeSaved?await journal.recent().catch(()=>[]):[];
  const taskContext=logs.length?relatedTaskSummaries(logs,{text,threadId:book.current?.id,profile:route.profile,
   health:await workspace.readHealth().catch(()=>null),ledger:readFinance(workspace.finance).payload}):[];
  const options={model,profile:route.profile,traceId,local,taskContext,decomposed:route.decomposed,financeContext,contextSummary:summary,allowRead,
   memory:memoriesFor(input,allowRead,route.profile),
   documentAccess:hasDocumentAccess(workspace.finance),autoMemory:automaticMemoryEnabled(workspace.finance),
   skills:routedSkills(selectSkills(catalog,{text,photos:files.length>0,
    previousText:history.filter(row=>row.role==='user').at(-1)?.text}),route.profile),groupedPhotos,
   agentTasks,receiptInput:agentTasks&&files.length>0,agentQuiet:agentTasks,
   healthActions:!demo&&allowRead&&!['receipt','finance'].includes(route.profile)&&(!files.length||groupedPhotos||agentTasks)&&!!input.text,
   healthAuto:allowRead&&hasHealthAuto(workspace.finance),
   healthClock:(retry?pending.healthClock:null)??localClock(),healthReference:book.current?.healthReference};
  if(files.length<2&&!resumeSaved&&!validInput(input))throw Error('请检查消息或照片');
  await sendMessage(input,options,files);
 }catch(err){void traceStatus(traceId,book.current?.pending?.healthAction?'pending':'failed',err);report(err);}
 finally{busy=false;lock();}
};

if(nativeAgentEnabled){
 nativeUi=mountAgentChat({book,journal,workspace,composer,review,stop,retry:retryRequest,replyRetry:$('[data-retry-agent-reply]'),
  steerLabel:$('[data-agent-steer]'),transcript,thread,context:updateContext,trace,status:tell,onError:report,
  onQueue:count=>{if(count)tell('等待处理 '+count+' 条消息');},
  onUser:label=>{start.hidden=true;bubble('user',label,null,null,true);syncThreads();},
  onFinal:(reply,source,undo,media)=>{bubble('assistant',reply,source,null,true,undo,media);syncThreads();updateContext();},
  onKey:revealKeySettings,resetPhoto});
 void nativeUi.restore();
}
