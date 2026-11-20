import {bindSheetSwipe} from '../shell.mjs';
import {localDate} from '../calendar.mjs';
import {readState,saveState} from '../health/storage.mjs';
import {validInput} from '../health/contract.mjs';
import {healthReview,jpeg} from '../health/assistant.mjs';
import {recognize} from './client.mjs';
import {readKey} from './keys.mjs';
import {financeReview} from './finance.mjs';

const intro='可以帮你安排一餐、记收支、更新食材库存，也可以读菜品照片和包装标签。';
export function installChat(openKeys){
 const dialog=document.createElement('dialog');
 dialog.id='airplane-chat';dialog.className='modal bottom-sheet chat-sheet';
 dialog.setAttribute('aria-labelledby','chat-title');
 dialog.innerHTML=`<div class="modal-grabber" aria-hidden="true"></div>
  <div class="modal-head"><button type="button" class="cancel" data-close>关闭</button><h2 id="chat-title">AI 助手</h2><button type="button" class="save" data-ai-key>API Key</button></div>
  <div class="chat-thread"><div class="chat-transcript" role="log" aria-label="对话" aria-live="polite"></div>
    <form class="card chat-review" aria-label="核对候选" hidden></form>
  </div>
  <div class="chat-tools"><button type="button" class="text-button" data-new>新对话</button></div>
  <form class="chat-composer">
    <label class="chat-text"><span class="sr-only">消息</span><textarea name="text" rows="2" maxlength="1600" placeholder="例如：晚餐想吃鸡胸，帮我搭配一餐"></textarea></label>
    <div class="chat-actions"><label class="secondary-button chat-attach">添加照片<input name="image" type="file" accept="image/*"></label><span data-attachment></span><button type="button" class="text-button" data-remove-photo hidden>移除</button><button type="submit" class="primary-button">发送</button></div>
    <p class="chat-privacy">发送本次消息、所选照片、当天日期及本对话最近 8 条文字给 OpenAI。</p>
    <output data-status aria-live="polite"></output>
  </form>`;
 document.body.append(dialog);bindSheetSwipe(dialog);
 const select=s=>dialog.querySelector(s);
 const transcript=select('.chat-transcript'),thread=select('.chat-thread'),review=select('.chat-review');
 const composer=select('.chat-composer'),send=composer.querySelector('[type=submit]');
 const status=select('[data-status]'),clearPhoto=select('[data-remove-photo]'),newChat=select('[data-new]');
 let history=[],busy=false,saving=false,firstSend=true;
 function append(role,text){
  const p=document.createElement('p');p.className='chat-bubble '+role;p.textContent=text;
  transcript.append(p);thread.scrollTop=thread.scrollHeight;
 }
 function clearReview(){review.hidden=true;review.replaceChildren();review.onsubmit=null;}
 function resetPhoto(){
  composer.elements.image.value=''; select('[data-attachment]').textContent='';clearPhoto.hidden=true;
 }
 function setBusy(){
  send.disabled=busy||saving;newChat.disabled=busy||saving;
  composer.elements.text.disabled=busy;
  composer.elements.image.disabled=busy;
  clearPhoto.disabled=busy;
  for(const b of review.querySelectorAll('button'))b.disabled=busy||saving;
 }
 function reset(){
  history=[];transcript.replaceChildren();append('assistant',intro);
  clearReview();composer.reset();resetPhoto();status.textContent='';
 }
 function show(){
  if(!dialog.open)dialog.showModal();
  if(matchMedia('(pointer:fine)').matches)composer.elements.text.focus();
 }
 reset();select('[data-close]').onclick=()=>dialog.close();
 newChat.onclick=()=>{if(!busy&&!saving)reset();};
 clearPhoto.onclick=resetPhoto;
 composer.elements.image.onchange=()=>{
  const file=composer.elements.image.files[0];
  select('[data-attachment]').textContent=file?.name??'';clearPhoto.hidden=!file;
 };
 for(const button of document.querySelectorAll('[data-open-ai]')){
  button.onclick=async()=>{
   try{if(await readKey())show();else openKeys(show);}
   catch{openKeys(show);}
  };
 }
 async function makeReview(proposal,today){
  clearReview();if(!proposal)return;
  let confirm, label='确认记账';
  if(proposal.mode==='finance')confirm=financeReview(review,proposal.result.entry,today);
  else{
   const current=await readState();
   const draft=healthReview(review,proposal,current,today);
   if(draft){
    label=draft.label;
    confirm=async()=>{
     const next=await saveState(draft.apply(current),current.revision??0);
     window.dispatchEvent(new CustomEvent('airplane:health-saved',{detail:next}));
     return draft.saved;
    };
   }
  }
  if(!confirm)return;
  const actions=document.createElement('div');actions.className='chat-actions';
  const apply=document.createElement('button');apply.type='submit';apply.className='primary-button';apply.textContent=label;
  const discard=document.createElement('button');discard.type='button';discard.className='secondary-button';discard.textContent='放弃';
  discard.onclick=clearReview;
  const output=document.createElement('output');output.setAttribute('role','status');
  actions.append(discard,apply);review.append(actions,output);
  review.onsubmit=async e=>{
   e.preventDefault();if(saving||busy)return;
   saving=true;setBusy();output.textContent='';
   try{
    const message=await confirm();
    if(proposal.mode==='finance')window.dispatchEvent(new Event('airplane:finance-saved'));
    clearReview();append('assistant',message);
   }catch(err){output.textContent=err.message;}
   finally{saving=false;setBusy();}
  };
  review.hidden=false;
  thread.scrollTop=Math.max(0,review.offsetTop-thread.offsetTop-8);
 }
 composer.onsubmit=async e=>{
  e.preventDefault();if(busy||saving)return;
  const text=composer.elements.text.value.trim(),file=composer.elements.image.files[0];
  if(!text&&!file){status.textContent='请输入消息或添加照片';return;}
  busy=true;setBusy();status.textContent='';
  try{
   if(!await readKey()){openKeys();return;}
   const photo=file?await jpeg(file):null;
   const input={mode:'chat',text,photo,date:localDate(),history:history.slice(-8)};
   if(!validInput(input))throw Error('请检查消息或照片');
   if(firstSend&&!window.confirm('发送本次消息、所选照片、当天日期及本对话最近 8 条文字给 OpenAI？'))return;
   firstSend=false;status.textContent='正在回复…';
   const response=await recognize(input);
   clearReview();
   const userText=[text,photo?'（附一张照片）':''].filter(Boolean).join(' ');
   append('user',userText);append('assistant',response.reply);
   history=[...history,{role:'user',text:userText.slice(0,1600)},{role:'assistant',text:response.reply}].slice(-8);
   composer.reset();resetPhoto();
   status.textContent='';
   try{await makeReview(response.proposal,input.date);}
   catch(err){clearReview();status.textContent=err.message;}
  }catch(err){status.textContent=err.name==='TypeError'?'无法连接 OpenAI，请检查网络':err.message;}
  finally{busy=false;setBusy();}
 };
}
