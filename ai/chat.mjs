import {displayDay,localDate} from '../calendar.mjs';
import {hydrateShell} from '../shell.mjs';
import {installUpdates} from '../updates.mjs';
import {resumePurchaseUpdate} from '../health/purchase-sync.mjs';
import {validInput} from '../health/contract.mjs';
import {healthReview,jpeg} from '../health/assistant.mjs';
import {recognize,mountKeyForm} from './client.mjs';
import {readKey} from './keys.mjs';
import {financeReview} from './finance.mjs';
import {chatInstructions} from './responses.mjs';
import {cleanSkill,localWorkspace,shortHistory,readLedger,readLabels} from './workspace.mjs';
import {inventoryReview,skillReview} from './operations.mjs';
import {threadBook} from './threads.mjs';
import {demoWorkspace} from './demo.mjs';

const demo=new URLSearchParams(location.search).get('demo')==='1';
const workspace=demo?await demoWorkspace(localDate()):localWorkspace();
const book=threadBook(demo?workspace.finance:localStorage);
const respond=demo?workspace.respond:recognize;
const $=selector=>document.querySelector(selector);
const transcript=$('.chat-transcript'),thread=$('.chat-thread'),review=$('.chat-review'),start=$('.assistant-start');
const composer=$('.chat-composer'),send=composer.querySelector('[type=submit]');
const status=$('[data-status]'),clearPhoto=$('[data-remove-photo]'),newChat=$('[data-new]');
const historyButton=$('[data-toggle-threads]'),historyPanel=$('#assistant-history'),historyList=$('[data-thread-list]');
const historySearch=historyPanel.querySelector('input');
const readPanel=$('.assistant-read'),share=$('[data-share-read]'),skip=$('[data-skip-read]');
const skillForm=$('#assistant-skill form'),skillOutput=skillForm.querySelector('output');
const keyPanel=$('#assistant-key-panel');
let busy=false,saving=false,firstSend=true,pending=null;

hydrateShell();
if(demo){
 $('.assistant-demo').hidden=false;
 for(const link of document.querySelectorAll('.topbar-actions a'))link.search='?demo=1';
 composer.elements.allowRead.checked=true;
}else{
 window.airplaneAccount={finance:workspace.finance};
 installUpdates();
 try{await resumePurchaseUpdate(window.airplaneAccount);}
 catch{status.textContent='库存中有未完成的采购同步，请先在库存页处理。';}
 keyPanel.hidden=false;
 const keyStatus=mountKeyForm($('#assistant-key'));
 try{
  if(!await readKey()){keyPanel.open=true;keyStatus.textContent='请导入 OpenAI API Key';}
 }catch{keyPanel.open=true;keyStatus.textContent='请重新导入 API Key';}
}

function tell(text){status.textContent=text;}
function report(err){tell(err.name==='TypeError'?'无法完成请求，请检查网络或本机存储':err.message);}
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
  button.type='button';name.textContent=row.title;button.append(name);
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
  li.append(button);return li;
 });
 empty.textContent=query?'没有符合的对话':'还没有对话记录';
 empty.hidden=rows.length>0;
 historyList.replaceChildren(...rows);
}
function openHistory(open){
 historyPanel.hidden=!open;historyButton.setAttribute('aria-expanded',String(open));
 if(!open)historySearch.value='';
 syncThreads();
}
historyButton.onclick=()=>openHistory(historyPanel.hidden);
historySearch.oninput=syncThreads;
historyPanel.addEventListener('keydown',event=>{
 if(event.key==='Escape'){event.stopPropagation();openHistory(false);historyButton.focus();}
});
function bubble(role,text){
 const p=document.createElement('p');p.className='chat-bubble '+role;p.textContent=text;
 transcript.append(p);thread.scrollTop=thread.scrollHeight;
}
function append(role,text,carry=true){
 try{book.append(role,text,carry);}
 catch{tell('浏览器空间不足，对话暂存于当前页面。');}
 start.hidden=true;bubble(role,text);syncThreads();updateContext();
}
function clearReview(){review.hidden=true;review.replaceChildren();review.onsubmit=null;}
function clearRead(){pending=null;readPanel.hidden=true;$('[data-read-preview]').textContent='';}
function resetPhoto(){
 composer.elements.image.value='';$('[data-attachment]').textContent='';clearPhoto.hidden=true;
}
function lock(){
 const waiting=busy||saving||!!pending;
 send.disabled=waiting;newChat.disabled=busy||saving;historyButton.disabled=busy||saving;
 for(const button of historyList.querySelectorAll('button'))button.disabled=busy||saving;
 historySearch.disabled=busy||saving;
 composer.elements.text.disabled=waiting;
 composer.elements.image.disabled=waiting;
 composer.elements.allowRead.disabled=waiting;
 clearPhoto.disabled=waiting;
 share.disabled=busy;skip.disabled=busy;
 for(const b of review.querySelectorAll('button'))b.disabled=waiting;
 for(const b of $('.assistant-examples').querySelectorAll('button'))b.disabled=waiting;
}
function renderThread(){
 const messages=book.current?.messages??[];
 transcript.replaceChildren();
 start.hidden=messages.length>0;
 for(const m of messages)if(m&&['user','assistant'].includes(m.role)&&typeof m.text==='string')bubble(m.role,m.text);
 clearRead();clearReview();composer.elements.text.value='';resetPhoto();syncThreads();updateContext();lock();
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

async function makeReview(proposal,today){
 clearReview();if(!proposal)return;
 const {mode,result}=proposal;
 let confirm,label;
 if(mode==='finance'){
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
  }else draft=healthReview(review,proposal,current,today);
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
 const out=document.createElement('output');out.setAttribute('role','status');
 actions.append(discard,apply);review.append(actions,out);
 review.onsubmit=async e=>{
  e.preventDefault();if(saving||busy||pending)return;
  saving=true;lock();out.textContent='';
  try{const message=await confirm();clearReview();append('assistant',message,false);}
  catch(err){out.textContent=err.message;}
  finally{saving=false;lock();}
 };
 review.hidden=false;
 thread.scrollTop=Math.max(0,thread.scrollTop+review.getBoundingClientRect().top-thread.getBoundingClientRect().top-88);
}

async function complete(response,today,usedLedger=false){
 clearRead();clearReview();
 append('assistant',response.reply,!usedLedger);
 tell('');
 try{await makeReview(response.proposal,today);}
 catch(err){clearReview();report(err);}
}
function describeSummary(scope,summary){
 if(scope==='expenses')return summary.date+' · 支出 '+summary.expense+' 元 · 收入 '+summary.income+' 元 · '+summary.count+' 笔';
 const rows=summary.stock.map(row=>row.name+' · '+(row.qty??'数量未知')+' '+row.unit);
 if(!rows.length)rows.push('没有匹配的食品');
 if(summary.more)rows.push('只发送前四项');
 if(summary.today){
  const day=summary.today;
  rows.push('今日热量 '+(day.kcal??'未知')+' / '+day.kcalTarget+' kcal',
   '今日蛋白质 '+(day.protein??'未知')+' / '+day.proteinMin+' g');
  if(day.incomplete.length)rows.push('部分营养数据待补');
 }
 return rows.join('\n');
}
composer.onsubmit=async e=>{
 e.preventDefault();if(busy||saving||pending)return;
 const text=composer.elements.text.value.trim(),file=composer.elements.image.files[0];
 if(!text&&!file){tell('请输入消息或添加照片');return;}
 busy=true;lock();tell('');
 try{
  if(!demo&&!await readKey()){keyPanel.open=true;keyPanel.scrollIntoView({block:'nearest'});tell('请先导入 API Key');return;}
  const photo=file?await jpeg(file):null,{turns,skill}=updateContext();
  const input={mode:'chat',text,photo,date:localDate(),history:turns};
  const allowRead=composer.elements.allowRead.checked&&!photo;
  if(!validInput(input))throw Error('请检查消息或照片');
  if(!demo&&firstSend&&!window.confirm('发送这条消息、手选照片、当天日期、Skill 和近期对话给 OpenAI？'))return;
  firstSend=false;tell('正在回复…');
  const response=await respond(input,{skill,allowRead});
  append('user',[text,photo?'（附一张照片）':''].filter(Boolean).join(' '));
  composer.elements.text.value='';resetPhoto();
  clearReview();
  if(response.call){
   if(!allowRead)throw Error('本轮未允许账本查询');
   const {args,item}=response.call,summary=await readLedger(workspace,args,input.date);
   pending={input,skill,item,summary};
   $('[data-read-label]').textContent='助手请求了：'+readLabels[args.scope]+'。';
   $('[data-read-preview]').textContent=describeSummary(args.scope,summary);
   readPanel.hidden=false;thread.scrollTop=thread.scrollHeight;
   tell('核对本轮账本摘要后继续。');
  }else await complete(response,input.date);
 }catch(err){report(err);}
 finally{busy=false;lock();}
};
share.onclick=async()=>{
 if(!pending||busy)return;
 const {input,skill,item,summary}=pending;
 busy=true;lock();tell('正在生成回复…');
 try{await complete(await respond(input,{skill,continuation:{item,summary}}),input.date,true);}
 catch(err){report(err);}
 finally{busy=false;lock();}
};
skip.onclick=()=>{
 clearRead();append('assistant','已取消本轮账本摘要发送。',false);tell('');lock();
};
