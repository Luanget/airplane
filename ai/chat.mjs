import {displayDay,localDate} from '../calendar.mjs';
import {hydrateShell} from '../shell.mjs';
import {installUpdates} from '../updates.mjs';
import {AssistantSyncPending,resumePurchaseUpdate} from '../health/purchase-sync.mjs';
import {validInput} from '../health/contract.mjs';
import {healthReview,jpeg} from '../health/assistant.mjs';
import {recognize,mountKeyForm,readDeviceKey} from './client.mjs';
import {financeReview} from './finance.mjs';
import {chatInstructions} from './responses.mjs';
import {cleanSkill,localWorkspace,shortHistory,readLedger,readLabels} from './workspace.mjs';
import {foodEditReview,inventoryReview,skillReview} from './operations.mjs';
import {threadBook} from './threads.mjs';
import {demoWorkspace} from './demo.mjs';
import {batchReview} from './batch.mjs';

const demo=new URLSearchParams(location.search).get('demo')==='1';
const workspace=demo?await demoWorkspace(localDate()):localWorkspace();
const book=threadBook(demo?workspace.finance:localStorage);
const respond=demo?workspace.respond:recognize;
const $=selector=>document.querySelector(selector);
const transcript=$('.chat-transcript'),thread=$('.chat-thread'),review=$('.chat-review'),start=$('.assistant-start');
const composer=$('.chat-composer'),send=composer.querySelector('[type=submit]');
const status=$('[data-status]'),clearPhoto=$('[data-remove-photo]'),newChat=$('[data-new]'),stop=$('[data-stop-request]');
const retryFollowUp=$('[data-retry-follow-up]');
const historyButton=$('[data-toggle-threads]'),historyPanel=$('#assistant-history'),historyList=$('[data-thread-list]');
const historySearch=historyPanel.querySelector('input');
const historyConfirmation=$('[data-delete-confirm]'),historyDelete=$('[data-delete-apply]');
const readPanel=$('[data-read-preview]').closest('section'),share=$('[data-share-read]'),skip=$('[data-skip-read]');
const consentPanel=$('#assistant-consent'),approve=$('[data-approve-send]'),cancelSend=$('[data-cancel-send]');
const consentKey='airplane-ai-send-consent-v1';
const skillForm=$('#assistant-skill form'),skillOutput=skillForm.querySelector('output');
const keyPanel=$('#assistant-key-panel');
let busy=false,saving=false,prepared=null,pending=null,activeRequest=null,deletingThread=null,followUp=null;
let firstSend=!demo&&localStorage.getItem(consentKey)!=='yes';

hydrateShell();
if(demo){
 $('.assistant-demo').hidden=false;
 for(const link of document.querySelectorAll('.topbar-actions a'))link.search='?demo=1';
 composer.elements.allowRead.checked=true;
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
 const openKeySettings=()=>{if(location.hash==='#api-key')revealKeySettings();};
 window.addEventListener('hashchange',openKeySettings);
 openKeySettings();
}

function revealKeySettings(){
 keyPanel.open=true;keyPanel.scrollIntoView({block:'nearest'});
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
stop.onclick=()=>{stop.disabled=true;activeRequest?.abort();};
function updateContext(){
 const turns=shortHistory((book.current?.messages??[]).filter(m=>m?.carry&&['user','assistant'].includes(m.role)&&typeof m.text==='string'));
 const chars=turns.reduce((n,row)=>n+row.text.length,0);
 const skill=workspace.readSkill().slice(0,320);
 $('[data-context-size]').textContent='历史 '+turns.length+' 条 · '+chars+'/900 字，Skill '+skill.length+'/320 字。';
 return {turns,skill};
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
function append(role,text,carry=true,source){
 try{book.append(role,text,carry,source);}
 catch{tell('浏览器空间不足，对话暂存于当前页面。');}
 start.hidden=true;bubble(role,text,source);syncThreads();updateContext();
}
function clearReview(){review.hidden=true;review.replaceChildren();review.onsubmit=null;delete review.dataset.syncPending;}
function clearFollowUp(){followUp=null;retryFollowUp.hidden=true;}
function clearRead(){pending=null;readPanel.hidden=true;$('[data-read-preview]').textContent='';}
function clearConsent(){prepared=null;consentPanel.hidden=true;}
function resetPhoto(){
 composer.elements.image.value='';$('[data-attachment]').textContent='';clearPhoto.hidden=true;
}
function lock(){
 const waiting=busy||saving||!!pending||!!prepared;
 send.disabled=waiting;newChat.disabled=busy||saving;historyButton.disabled=busy||saving;
 for(const button of historyList.querySelectorAll('button'))button.disabled=busy||saving;
 historySearch.disabled=busy||saving;
 historyDelete.disabled=busy||saving;
 composer.elements.text.disabled=waiting;
 composer.elements.image.disabled=waiting;
 composer.elements.allowRead.disabled=waiting;
 clearPhoto.disabled=waiting;
 share.disabled=busy;skip.disabled=busy;approve.disabled=busy;cancelSend.disabled=busy;
 retryFollowUp.disabled=waiting;
 for(const fields of review.querySelectorAll('.assistant-batch-step'))fields.disabled=waiting||review.dataset.syncPending==='yes';
 for(const b of review.querySelectorAll('button'))b.disabled=waiting;
 for(const b of $('.assistant-examples').querySelectorAll('button'))b.disabled=waiting;
}
function renderThread(){
 const messages=book.current?.messages??[];
 transcript.replaceChildren();
 start.hidden=messages.length>0;
 for(const m of messages)if(m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')bubble(m.role,m.text,m.source);
 clearConsent();clearRead();clearReview();clearFollowUp();composer.elements.text.value='';resetPhoto();syncThreads();updateContext();lock();
}
function refreshSkill(){skillForm.elements.skill.value=workspace.readSkill().slice(0,320);updateContext();}
$('#assistant-skill pre').textContent=chatInstructions;
skillForm.onsubmit=e=>{
 e.preventDefault();
 try{
  workspace.saveSkill(cleanSkill(skillForm.elements.skill.value));
  refreshSkill();skillOutput.textContent='已保存到本机';
 }catch(err){skillOutput.textContent=err.message;}
};
renderThread();refreshSkill();
newChat.onclick=()=>{
 try{book.start();openHistory(false);tell('');renderThread();}
 catch(err){report(err);}
};
clearPhoto.onclick=resetPhoto;
composer.elements.image.onchange=()=>{
 const file=composer.elements.image.files[0];
 $('[data-attachment]').textContent=file?.name??'';clearPhoto.hidden=!file;
};
composer.elements.text.addEventListener('keydown',e=>{
 if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&matchMedia('(pointer:fine)').matches){
  e.preventDefault();composer.requestSubmit();
 }
});
for(const button of document.querySelectorAll('[data-example]')){
 button.onclick=()=>{
  composer.elements.text.value=button.dataset.example;
  composer.elements.allowRead.checked=button.hasAttribute('data-use-ledger');
  composer.elements.text.focus();
 };
}

async function makeReview(proposal,flow){
 clearReview();if(!proposal)return;
 const {mode,result}=proposal,today=flow.input.date;
 const willContinue=mode==='batch'&&result.next==='continue';
 let confirm,label;
 if(mode==='batch'){
  confirm=await batchReview(review,result,workspace,today,book.current?.foodDate);
  label=willContinue?'确认全部并继续':'确认全部';
 }else if(mode==='finance'){
  confirm=financeReview(review,result.entry,today,workspace.finance);
  label='确认记账';
 }else if(mode==='skill'){
  const current=workspace.readSkill(),read=skillReview(review,current,result.text);
  label='确认更新 Skill';
  confirm=()=>{
   if(workspace.readSkill()!==current)throw Error('Skill 已变更，请重新提出建议');
   workspace.saveSkill(read());refreshSkill();return 'Skill 已更新。';
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
  else draft=healthReview(review,proposal,current,today);
  if(draft){
   label=draft.label;
   confirm=async()=>{
    await workspace.saveHealth(draft.apply(current),current.revision??0);
    return draft.saved;
   };
  }
 }
 if(!confirm)return;
 const actions=document.createElement('div');actions.className='chat-actions';
 const apply=document.createElement('button');apply.type='submit';apply.className='primary-button';apply.textContent=label;
 const discard=document.createElement('button');discard.type='button';discard.className='secondary-button';discard.textContent='放弃';
 discard.onclick=clearReview;
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
  e.preventDefault();if(saving||busy||pending||prepared)return;
  if(review.dataset.syncPending!=='yes')continuationApproved=willContinue&&e.submitter===apply;
  saving=true;lock();out.textContent='';
  let resume=false;
  try{
   const message=await confirm();
   clearReview();append('assistant',message,false);
   if(continuationApproved){
    followUp={
     input:{...flow.input,date:localDate(),text:flow.input.text||'继续完成刚才照片中的请求。',history:[],photo:null},
     options:{skill:flow.options.skill,allowRead:true,applied:result.operations.map(operation=>operation.mode)},
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
 review.hidden=false;
 thread.scrollTop=Math.max(0,thread.scrollTop+review.getBoundingClientRect().top-thread.getBoundingClientRect().top-88);
}

async function complete(response,flow,source){
 clearRead();clearReview();
 tell('');
 append('assistant',response.reply,!source,source);
 try{await makeReview(response.proposal,flow);}
 catch(err){clearReview();report(err);}
}
function describeSummary(scope,summary){
 if(scope==='expenses')return summary.date+' · 支出 '+summary.expense+' 元 · 收入 '+summary.income+' 元 · '+summary.count+' 笔';
 if(scope==='foods'){
  const rows=summary.foods.map(row=>[row.time,row.meal,row.name,row.portion].filter(Boolean).join(' · '));
  if(!rows.length)rows.push('没有匹配的实际饮食记录');
  return [displayDay(summary.date,true),...rows].join('\n');
 }
 const rows=summary.stock.map(row=>row.name+' · '+(row.qty??'数量未知')+' '+row.unit);
 if(!rows.length)rows.push('没有匹配的食品');
 if(summary.today){
  const day=summary.today;
  rows.push('今日热量 '+(day.kcal??'未知')+' / '+day.kcalTarget+' kcal',
   '今日蛋白质 '+(day.protein??'未知')+' / '+day.proteinMin+' g');
  if(day.incomplete.length)rows.push('部分营养数据待补');
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
async function showResponse(response,flow){
 const {input,options,steps}=flow;
 if(response.call){
   if(!options.allowRead)throw Error('本轮未允许账本查询');
   const {args,item}=response.call,summary=await readLedger(workspace,args,input.date);
   pending={input,options,steps,item,summary,scope:args.scope};
   $('[data-read-label]').textContent='助手请求了：'+readLabels[args.scope]+'。';
   $('[data-read-preview]').textContent=describeSummary(args.scope,summary);
   readPanel.hidden=false;thread.scrollTop=thread.scrollHeight;
   tell('核对本轮账本摘要后继续。');
 }else await complete(response,flow,querySource(steps));
}
async function continueAfterSave(){
 if(!followUp||busy||saving||pending||prepared)return;
 busy=true;retryFollowUp.hidden=true;lock();
 tell('账本已保存，正在继续本轮…');
 try{
  const flow=followUp;
  const response=await requestReply(flow.input,flow.options);
  await showResponse(response,flow);
  clearFollowUp();
 }catch(err){
  tell('账本已保存。'+err.message);
  retryFollowUp.hidden=false;
 }finally{busy=false;lock();}
}
retryFollowUp.onclick=continueAfterSave;
async function sendMessage(input,options){
 clearFollowUp();
 tell(demo?'正在生成演示回复…':'正在等待 OpenAI 回复…');
 const userText=[input.text,input.photo?'（附一张照片）':''].filter(Boolean).join(' ');
 const response=await requestReply(input,options,userText);
 append('user',userText);
 composer.elements.text.value='';resetPhoto();
 clearReview();
 await showResponse(response,{input,options,steps:[]});
}
composer.onsubmit=async e=>{
 e.preventDefault();if(busy||saving||pending||prepared)return;
 const text=composer.elements.text.value.trim(),file=composer.elements.image.files[0];
 if(!text&&!file){tell('请输入消息或添加照片');return;}
 busy=true;lock();tell('');
 try{
  if(!demo){
   tell('正在读取本机 API Key…');
   if(!await readDeviceKey()){revealKeySettings();tell('请先导入 API Key');return;}
  }
  const photo=file?await jpeg(file):null,{turns,skill}=updateContext();
  const input={mode:'chat',text,photo,date:localDate(),history:turns};
  const options={skill,allowRead:composer.elements.allowRead.checked&&!photo};
  if(!validInput(input))throw Error('请检查消息或照片');
  if(firstSend){
   prepared={input,options};
   consentPanel.hidden=false;
   tell('还没发送。请在下方确认首次发送。');
   consentPanel.scrollIntoView({block:'nearest'});
   return;
  }
  await sendMessage(input,options);
 }catch(err){report(err);}
 finally{busy=false;lock();}
};
approve.onclick=async()=>{
 if(!prepared||busy)return;
 const {input,options}=prepared;
 busy=true;clearConsent();lock();
 firstSend=false;
 try{localStorage.setItem(consentKey,'yes');}catch{}
 try{await sendMessage(input,options);}
 catch(err){report(err);}
 finally{busy=false;lock();}
};
cancelSend.onclick=()=>{clearConsent();tell('');lock();composer.elements.text.focus();};
share.onclick=async()=>{
 if(!pending||busy)return;
 const {input,options,item,summary,scope}=pending;
 const steps=[...pending.steps,{item,summary,scope}];
 busy=true;lock();tell(demo?'正在生成演示回复…':'账本摘要已发送，正在等待 OpenAI 回复…');
 try{
  const response=await requestReply(input,{...options,continuation:steps});
  if(scope==='foods'){
   try{book.setFoodDate(summary.date);}catch{}
  }
  await showResponse(response,{input,options,steps});
 }
 catch(err){report(err);}
 finally{busy=false;lock();}
};
skip.onclick=()=>{
 const source=querySource(pending?.steps??[]);
 clearRead();tell('');append('assistant','已取消发送这次账本摘要。',false,source);lock();
};
