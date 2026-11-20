import {accountKeys} from '../account.mjs';

// A same-origin HTTPS route can point at the Worker in production.
const base=location.hostname==='127.0.0.1'||location.hostname==='localhost'?'http://127.0.0.1:8787':'';
const accessSlot=()=> 'airplane-ai-session:'+(window.airplaneAccount?.id??'device');
const token=()=>sessionStorage.getItem(accessSlot());
async function api(path,data) {
 if(!navigator.onLine)throw Error('目前离线，手动录入仍可用');
 if(!token())throw Error('先在「AI 权限」输入管理员提供的访问码');
 const response=await fetch(base+path,{method:data?'POST':'GET',cache:'no-store',credentials:'omit',redirect:'error',
   signal:AbortSignal.timeout(60000),headers:{Authorization:'Bearer '+token(),...(data?{'Content-Type':'application/json'}:{})},
   body:data?JSON.stringify(data):undefined});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'AI 服务当前不可用');
 return result;
}
export function installAccessDialog() {
 const dialog=document.createElement('dialog');
 dialog.id='ai-access';dialog.className='ai-dialog';dialog.setAttribute('aria-labelledby','ai-access-title');
 dialog.innerHTML=`<form><h2 id="ai-access-title">AI 权限</h2><p>输入管理员提供的 Airplane 访问码。本地账本可以直接使用。</p>
  <label>访问码<input name="code" type="password" autocomplete="off" spellcheck="false"></label>
  <output role="status"></output><div class="ai-actions"><button type="submit">验证授权</button><button type="button" data-remove>断开授权</button><button type="button" data-close>关闭</button></div><button type="button" data-old-secret>清理旧版浏览器密钥</button></form>`;
 document.body.append(dialog);
 const form=dialog.querySelector('form'),out=form.querySelector('output');
 async function showUsage(){
  if(!token()){out.textContent='尚未授权 AI';return;}
  try{
   const u=await api('/api/usage');
   out.textContent=`${u.month} 已用 ${u.calls}/${u.monthlyCalls} 次，计费与预留约 $${(u.billableMicros/1e6).toFixed(3)}`;
  }catch(err){out.textContent=err instanceof TypeError?'无法连接 AI 服务':err.message;}
 }
 form.onsubmit=async e=>{
  e.preventDefault();
  try {
   const keys=await accountKeys(form.elements.code.value.trim());
   sessionStorage.setItem(accessSlot(),keys.bearer);form.reset();
   await showUsage();
  }catch(err){out.textContent=err.message;}
 };
 form.querySelector('[data-remove]').onclick=()=>{sessionStorage.removeItem(accessSlot());out.textContent='已移除本次会话授权';};
 form.querySelector('[data-old-secret]').onclick=()=>{
  if(!confirm('移除旧版保存在本机的 OpenAI Key？服务端授权和账本记录可继续使用。'))return;
  const slot='airplane-openai-credential-v1';
  if(window.airplaneAccount?.id){
   window.airplaneAccount.finance.removeItem(slot);out.textContent='已清理当前私人账本的旧版密钥';return;
  }
  const req=indexedDB.deleteDatabase(slot);
  req.onsuccess=()=>{out.textContent='已清理设备账本的旧版密钥';};
  req.onerror=()=>{out.textContent='浏览器无法清理旧版密钥';};
  req.onblocked=()=>{out.textContent='请先关闭仍在使用旧版的 Airplane 页面';};
 };
 form.querySelector('[data-close]').onclick=()=>dialog.close();
 dialog.onclose=()=>form.reset();
 const open=()=>{if(!dialog.open){dialog.showModal();showUsage();}};
 document.addEventListener('click',e=>{if(e.target.closest('[data-ai-key]'))open();});
 return open;
}
export const recognize=data=>api('/api/assist',data);
