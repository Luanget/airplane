import {bindSheetSwipe} from '../shell.mjs';
import {MODEL,OPENAI_URL,modelRequest,parseResult} from './responses.mjs';
import {readKey,importKey,forgetKey} from './keys.mjs';

export function installKeyDialog() {
 const dialog=document.createElement('dialog');
 dialog.id='ai-keys';
 dialog.className='modal bottom-sheet ai-dialog';
 dialog.setAttribute('aria-labelledby','ai-key-title');
 dialog.innerHTML=`<div class="modal-grabber" aria-hidden="true"></div><form>
  <div class="modal-head"><button type="button" class="cancel" data-close>关闭</button><h2 id="ai-key-title">API Key</h2><span></span></div>
  <p>导入自己的 OpenAI Key 后直接调用 ${MODEL}。Key 加密保存在本机。</p>
  <label>OpenAI API Key<input name="key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="sk-…"></label>
  <label>或选择仅包含 Key 的文本文件<input name="file" type="file" accept=".txt,text/plain"></label>
  <output role="status"></output>
  <div class="ai-actions"><button type="submit">保存 Key</button><button type="button" data-remove>移除本机 Key</button></div></form>`;
 document.body.append(dialog);
 bindSheetSwipe(dialog);
 const form=dialog.querySelector('form'),out=form.querySelector('output');
 let afterSave=null;
 form.onsubmit=async e=>{
  e.preventDefault();
  try{
   const file=form.elements.file.files[0],typed=form.elements.key.value.trim();
   if(file&&typed)throw Error('请选择一种导入方式');
   if(file?.size>8192)throw Error('请选择仅包含一行 Key 的文本文件');
   await importKey(file?await file.text():typed);
   const proceed=afterSave;
   form.reset();dialog.close();
   proceed?.();
  }catch(err){out.textContent=err.message;}
 };
 form.querySelector('[data-remove]').onclick=async()=>{
  try{await forgetKey();form.reset();out.textContent='已移除本机 Key';}
  catch{out.textContent='无法移除 Key，请检查浏览器存储';}
 };
 form.querySelector('[data-close]').onclick=()=>dialog.close();
 dialog.onclose=()=>{form.reset();out.textContent='';afterSave=null;};
 async function open(onSaved=null){
  if(dialog.open)return;
  afterSave=onSaved;
  dialog.showModal();
  try{
   const current=await readKey();
   if(dialog.open)out.textContent=current?'已导入 Key，可替换或移除':'请导入 OpenAI API Key';
  }catch{if(dialog.open)out.textContent='无法读取已保存的 Key，可重新导入';}
 }
 document.addEventListener('click',e=>{if(e.target.closest('[data-ai-key]'))open();});
 return open;
}

export async function recognize(input) {
 if(!navigator.onLine)throw Error('目前离线，手动录入仍可用');
 const key=await readKey();
 if(!key)throw Error('请先点「API Key」导入自己的密钥');
 const request=modelRequest(input);
 const response=await fetch(OPENAI_URL,{method:'POST',cache:'no-store',credentials:'omit',
  referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(request)});
 if(!response.ok){
  const errors={401:'OpenAI 未接受这个 Key，请重新导入',403:'当前 Key 或地区无法使用此模型',
   404:'当前项目无法使用此模型',429:'OpenAI 的额度、余额或速率限制阻止了本次调用'};
  throw Error(errors[response.status]??'OpenAI 暂时无法完成识别');
 }
 try{return parseResult(await response.json(),input);}
 catch{throw Error('模型未返回可核对的候选，请补充输入后重试');}
}
