import {exampleInput,assessExample,exampleText} from './example.mjs';
import {MODEL,callModel} from './responses.mjs';
import {readKey,importKey,forgetKey} from './keys.mjs';

export function installKeyDialog() {
  const dlg=document.createElement('dialog');
  dlg.id='ai-keys';dlg.className='ai-dialog';dlg.setAttribute('aria-labelledby','ai-key-title');
  dlg.innerHTML=`<form><h2 id="ai-key-title">本机模型设置</h2><p>默认模型 ${MODEL}。Key 保存在当前账本的本机存储中，调用费用记入签发这个 Key 的 OpenAI 项目。</p>
    <label>OpenAI API Key<input name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-…"></label>
    <label>或导入纯文本 Key 文件<input name="file" type="file" accept=".txt,text/plain"></label>
    <output role="status"></output><div class="ai-actions"><button type="submit">保存 Key</button><button type="button" data-forget>移除本机 Key</button><button type="button" data-close>关闭</button></div>
    <details><summary>试识别饮食示例</summary><p>${exampleText}。本次向 OpenAI 发送这句话和三项样例 SKU（牛奶按克计）。结果仅在这里显示。</p><button data-demo type="button">同意发送并试识别一次</button><pre data-result role="status"></pre></details></form>`;
  document.body.append(dlg);
  const f=dlg.querySelector('form'),msg=f.querySelector('output');
  const clear=()=>{f.elements.key.value=''; f.elements.file.value='';};
  const demo=f.querySelector('[data-demo]'),result=f.querySelector('[data-result]');
  dlg.addEventListener('close',()=>{
    clear();
    if (location.hash==='#model') history.replaceState(null,'',location.pathname+location.search);
  });
  demo.onclick=async()=>{
    if (demo.disabled) return;
    demo.disabled=true;result.textContent='正在识别样例…';
    try { result.textContent=assessExample(await recognize(exampleInput())).join('\n'); }
    catch(err) {result.textContent=err instanceof TypeError?'无法连接 OpenAI，请检查设备网络':err.message;}
    finally {demo.disabled=false;}
  };
  f.querySelector('[data-close]').onclick=()=>dlg.close();
  f.querySelector('[data-forget]').onclick=async()=>{
    try {await forgetKey(window.airplaneAccount);clear();msg.textContent='已移除';} catch {msg.textContent='移除失败，请检查本机存储';}
  };
  f.onsubmit=async e=>{
    e.preventDefault();
    try {
      const file=f.elements.file.files[0];
      if (file && f.elements.key.value.trim()) throw Error('请选择一种导入方式');
      if (file?.size>8192) throw Error('请选择仅含一行 Key 的文本文件');
      await importKey(window.airplaneAccount,file?await file.text():f.elements.key.value);
      clear();msg.textContent='已保存，可关闭设置或试识别下方示例';document.dispatchEvent(new Event('airplane-key-imported'));
    } catch(err) {msg.textContent=err.message;}
  };
  async function open(){
    if (!dlg.open) dlg.showModal();
    try { msg.textContent=await readKey(window.airplaneAccount)?'已配置，可替换或移除':'此账本尚未导入 Key'; }
    catch {msg.textContent='读取失败，可重新导入 Key';}
  }
  document.addEventListener('click',e=>{if(e.target.closest('[data-ai-key]')) open();});
  return open;
}
export async function recognize(data) {
  if (!navigator.onLine) throw Error('当前离线，手动记录仍可使用');
  const key=await readKey(window.airplaneAccount);
  if (!key) throw Error('请先点击「本机模型设置」导入自己的 Key');
  return callModel(key,data);
}
