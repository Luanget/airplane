import {recognize} from './client.mjs';

export function attachFinanceAssistant({categories,today,openEntry,revision}) {
  const dlg=document.querySelector('#finance-assistant'), form=dlg.querySelector('form');
  const status=form.querySelector('output'), submit=form.querySelector('[type=submit]');
  let generation=0;
  const list=()=>categories().filter(c=>!c.hidden).map(({id,name,type})=>({id,name,type}));
  document.querySelector('#open-finance-ai').onclick=()=>{
    form.querySelector('[data-fields]').textContent=list().map(c=>c.name).join('、');
    status.textContent='';dlg.showModal();form.elements.text.focus();
  };
  dlg.addEventListener('close',()=>{generation++;submit.disabled=false;});
  form.querySelector('[data-close]').onclick=()=>dlg.close();
  form.elements.text.oninput=()=>{generation++;submit.disabled=false;status.textContent='';};
  form.onsubmit=async e=>{
    e.preventDefault();
    if (submit.disabled) return;
    const id=++generation;
    submit.disabled=true;status.textContent='正在识别…';
    try {
      const base=revision();
      const input={mode:'finance',text:form.elements.text.value.trim(),date:today(),categories:list()};
      const result=await recognize(input);
      if (id!==generation || !dlg.open) return;
      if (!result.entry) {status.textContent=result.note || '请补充收支方向和金额';return;}
      if (base!==revision()) throw Error('账本已变更，请重新识别');
      const {type,amount,date,categoryId,note}=result.entry;
      dlg.close();form.reset();
      openEntry({type,amount,date,note,selectedCategoryId:categoryId,fromAssistant:true});
    } catch(err){if(id===generation) status.textContent=err instanceof TypeError?'无法连接 AI 服务，请检查设备网络':err.message;}
    finally {if(id===generation) submit.disabled=false;}
  };
}
