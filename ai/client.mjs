import {MODEL,OPENAI_URL,modelRequest,parseResult,pendingLedgerRead} from './responses.mjs';
import {readResponseStream,ResponseStreamError} from './stream.mjs';
import {readKey,importKey,forgetKey} from './keys.mjs';
import {localDate} from '../calendar.mjs';

const keyFields=`  <p>导入自己的 OpenAI Key 后直接调用 ${MODEL}。Key 加密保存在本机。</p>
  <label>OpenAI API Key<input name="key" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="sk-…"></label>
  <label>或选择仅包含 Key 的文本文件<input name="file" type="file" accept=".txt,text/plain"></label>
  <output role="status"></output>
  <div class="ai-actions"><button type="submit">保存 Key</button><button type="button" data-check>发送连接测试</button><button type="button" data-remove>移除本机 Key</button></div>`;

export function bindKeyForm(form,onSaved=()=>{}) {
 const out=form.querySelector('output');
 form.onsubmit=async e=>{
  e.preventDefault();
  try{
   const file=form.elements.file.files[0],typed=form.elements.key.value.trim();
   if(file&&typed)throw Error('请选择一种导入方式');
   if(file?.size>8192)throw Error('请选择仅包含一行 Key 的文本文件');
   await importKey(file?await file.text():typed);
   form.reset();out.textContent='已保存 Key';onSaved();
  }catch(err){out.textContent=err.message;}
 };
 form.querySelector('[data-remove]').onclick=async()=>{
  try{await forgetKey();form.reset();out.textContent='已移除本机 Key';}
  catch{out.textContent='无法移除 Key，请检查浏览器存储';}
 };
 const check=form.querySelector('[data-check]');
 check.onclick=async()=>{
  check.disabled=true;out.textContent='正在向 OpenAI 发送测试消息…';
  try{
   const result=await recognize({mode:'chat',date:localDate(),history:[],photo:null,text:'这是连接测试，请回复「连接正常」。'});
   out.textContent='已收到 OpenAI 回复：'+result.reply;
  }catch(err){out.textContent=err.message;}
  finally{check.disabled=false;}
 };
 return out;
}
export function mountKeyForm(form) {
 form.innerHTML=keyFields;
 return bindKeyForm(form);
}

export async function readDeviceKey(){
 try{return await readKey();}
 catch{throw Error('无法读取本机 API Key，请打开设置重新导入。');}
}

function apiError(response,body){
 const code=body?.error?.code;
 const causes={
  context_length_exceeded:'本轮内容超过模型能处理的范围，请缩小本轮查询范围',
  invalid_json_schema:'OpenAI 拒绝了当前版本的输出格式，请更新 Airplane',
  insufficient_quota:'此 Key 所属项目的 API 额度或余额不足',
  unsupported_country_region_territory:'OpenAI 拒绝了当前网络所在地区的 API 请求'
 };
 const errors={
  400:'OpenAI 拒绝了请求参数',401:'OpenAI 未接受这个 Key，请核对并重新导入',
  403:'OpenAI 拒绝了当前 Key 的访问，请核对项目权限',
  404:'当前项目无法访问 '+MODEL,429:'OpenAI 触发本项目的额度或频率限制'
 };
 const reason=Object.hasOwn(causes,code)?causes[code]:errors[response.status]??'OpenAI 暂时无法处理请求';
 const id=response.headers.get('x-request-id')??'';
 return Error(reason+'（HTTP '+response.status+(/^[A-Za-z0-9_-]{1,100}$/.test(id)?'，请求 ID '+id:'')+'）。');
}

export async function recognize(input,{signal,onReply,onTool,...options}={}) {
 if(!navigator.onLine)throw Error('目前离线，手动录入仍可用');
 const key=await readDeviceKey();
 if(!key)throw Error('请先点「API Key」导入自己的密钥');
 const request={...modelRequest(input,options),stream:true};
 const controller=new AbortController(),cancel=()=>controller.abort();
 if(signal?.aborted)cancel();
 signal?.addEventListener('abort',cancel,{once:true});
 let timedOut=false,receivedEvent=false,timeout;
 const waitForData=()=>{
  clearTimeout(timeout);
  timeout=setTimeout(()=>{timedOut=true;cancel();},60000);
 };
 waitForData();
 let response,body;
 try{
  response=await fetch(OPENAI_URL,{method:'POST',cache:'no-store',credentials:'omit',
   referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal,
   headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify(request)});
  if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')){
   body=await readResponseStream(response,{onReply,onTool,onActivity:()=>{
    receivedEvent=true;waitForData();
   }});
  }else{
   body=await response.json().catch(err=>{
    if(response.ok||controller.signal.aborted)throw err;
    return null;
   });
  }
 }catch(err){
  if(timedOut)throw Error(receivedEvent?'OpenAI 回复中断，60 秒没有收到新内容。原消息仍在，可以重试。':
   '等待 OpenAI 开始回复超时。原消息仍在，可以重试。');
  if(signal?.aborted)throw Error('已停止等待 OpenAI 回复。');
  if(err instanceof ResponseStreamError)throw err;
  if(err instanceof SyntaxError)throw Error('收到的 OpenAI 响应格式不正确，请重试。');
  throw Error('浏览器未能读取 OpenAI 响应。请检查当前网络能否访问 api.openai.com，并核对 API Key。');
 }finally{
  clearTimeout(timeout);signal?.removeEventListener('abort',cancel);
 }
 if(!response.ok)throw apiError(response,body);
 if(body?.status==='incomplete')throw Error('OpenAI 返回了未完成的响应。可以重试，原账本数据仍保留。');
 if(body?.status==='failed')throw Error('OpenAI 在生成回复时失败，请稍后重试。');
 try{
  const call=pendingLedgerRead(body);
  if(call){
   if(!options.allowRead)throw Error();
   return {call};
  }
  return parseResult(body,input);
 }
 catch{throw Error('已收到 OpenAI 响应，但无法读取回复或候选格式。');}
}
