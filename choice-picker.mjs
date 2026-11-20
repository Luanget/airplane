import {shellIcon} from './shell.mjs';
import {bindFieldPicker,fieldLabel} from './field-picker.mjs';

const controls=new WeakMap();

function renderChoices(select,control){
 const query=control.panel.querySelector('.choice-search').value.trim().normalize('NFKC').toLowerCase();
 const options=[...select.options].filter(option=>!option.hidden&&option.label.normalize('NFKC').toLowerCase().includes(query));
 const rows=options.map(option=>{
  const row=document.createElement('button'),copy=document.createElement('span');
  const [title,...details]=option.label.split(' · ');
  const name=document.createElement('span');name.className='setting-title';name.textContent=title;
  row.type='button';row.className='setting-row choice-option';row.disabled=option.disabled||!!option.closest('optgroup')?.disabled;
  const picked=option===select.selectedOptions[0];
  row.setAttribute('aria-pressed',String(picked));
  copy.className='setting-copy';copy.append(name);row.append(copy);
  if(details.length){
   const sub=document.createElement('span');sub.className='setting-sub';sub.textContent=details.join(' · ');copy.append(sub);
  }
  if(picked){
   const tick=document.createElement('span');tick.className='choice-check';tick.innerHTML=shellIcon('check');row.append(tick);
  }
  row.onclick=()=>{
   if(select.selectedIndex!==option.index){
    select.selectedIndex=option.index;
    select.dispatchEvent(new Event('input',{bubbles:true}));
    select.dispatchEvent(new Event('change',{bubbles:true}));
   }
   syncChoiceFields(select.form??document);
   control.close();
  };
  return row;
 });
 if(!rows.length){
  const empty=document.createElement('p');empty.className='choice-empty';empty.textContent=query?'没有匹配的选项':'暂无可选项';rows.push(empty);
 }
 control.panel.querySelector('.choice-list').replaceChildren(...rows);
}

function fillChoices(select,control){
 const search=document.createElement('input'),list=document.createElement('span');
 search.type='search';search.className='choice-search';search.placeholder='搜索';
 search.setAttribute('aria-label','搜索选项');
 search.hidden=!select.hasAttribute('data-picker-search')&&select.options.length<8;
 search.oninput=()=>renderChoices(select,control);
 search.onkeydown=event=>{if(event.key==='Enter')event.preventDefault();};
 list.className='choice-list';
 control.panel.replaceChildren(search,list);
 renderChoices(select,control);
}

function reflect(select,control) {
 const label=select.selectedOptions[0]?.label||'请选择';
 control.value.textContent=label.split(' · ')[0];
 control.trigger.setAttribute('aria-label',control.title+'，'+label);
 control.trigger.disabled=select.matches(':disabled');
}

export function syncChoiceFields(root=document) {
 for(const select of root.querySelectorAll('select[data-picker]')){
  let control=controls.get(select);
  if(!control){
   const title=select.dataset.picker||fieldLabel(select)||'选择选项';
   control=bindFieldPicker(select,{
    title,triggerClass:'choice-trigger',valueClass:'choice-value',fill:()=>fillChoices(select,control)
   });
   control.title=title;controls.set(select,control);
   select.addEventListener('change',()=>reflect(select,control));
   if(select.form&&!select.form.hasAttribute('data-choice-reset')){
    const form=select.form;form.dataset.choiceReset='';
    form.addEventListener('reset',()=>queueMicrotask(()=>syncChoiceFields(form)));
   }
  }
  reflect(select,control);
 }
}
