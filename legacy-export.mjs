import {accountKeys,privateAccount} from './account.mjs';
import {readFinance} from './finance-storage.mjs';
import {readState} from './health/storage.mjs';
import {resumePurchaseUpdate} from './health/purchase-sync.mjs';
import {combinedBackup} from './health/backup.mjs';
import {bindSheetSwipe} from './shell.mjs';

export async function showLegacyExport(){
 const dialog=document.createElement('dialog');
 dialog.className='modal bottom-sheet ai-dialog';dialog.id='legacy-export';
 dialog.setAttribute('aria-labelledby','legacy-export-title');
 dialog.innerHTML=`<div class="modal-grabber" aria-hidden="true"></div><form>
  <div class="modal-head"><button type="button" class="cancel">关闭</button><h2 id="legacy-export-title">导出旧私人账本</h2><span></span></div>
  <p>使用原账户码导出旧数据。下载后可在「健康 → 设置 → 统一备份与恢复」选择要恢复的账本。</p>
  <label>原账户码<input name="code" type="password" required minlength="64" maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
  <button type="submit" class="primary-button">下载统一备份</button><output role="status"></output></form>`;
 document.body.append(dialog);bindSheetSwipe(dialog);
 const form=dialog.querySelector('form'),button=form.querySelector('[type=submit]'),status=form.querySelector('output');
 dialog.querySelector('.cancel').onclick=()=>dialog.close();
 dialog.onclose=()=>{
  form.reset();dialog.remove();
  const url=new URL(location.href);url.searchParams.delete('private');history.replaceState(null,'',url);
 };
 form.onsubmit=async e=>{
  e.preventDefault();if(button.disabled)return;
  button.disabled=true;status.textContent='';
  try{
   const code=form.elements.code.value.trim();form.elements.code.value='';
   const keys=await accountKeys(code);
   await import('./vendor/nacl-fast.min.js');
   const account=privateAccount(keys,globalThis.nacl,localStorage);
   await resumePurchaseUpdate(account);
   const finance=readFinance(account.finance).payload,health=await readState(account);
   if(!dialog.open)return;
   if(!finance&&!health.revision)throw Error('此账户码在当前浏览器没有找到旧账本');
   const payload=combinedBackup(health.revision?health:null,finance);
   const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
   const link=document.createElement('a');link.href=url;link.download='airplane-legacy-backup.json';
   document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
   status.textContent='已导出，可以关闭此窗口。';
  }catch(err){status.textContent=err.message;}
  finally{button.disabled=false;}
 };
 dialog.showModal();
}
