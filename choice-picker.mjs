import {bindSheetSwipe,shellIcon} from './shell.mjs';

const controls=new WeakMap();
let sheet,active;

function picker() {
 if(sheet)return sheet;
 sheet=document.createElement('dialog');
 sheet.className='modal bottom-sheet choice-sheet';
 sheet.setAttribute('aria-labelledby','choice-heading');
 sheet.innerHTML=`
   <div class="modal-grabber" aria-hidden="true"></div>
   <div class="modal-head"><button type="button" class="cancel">取消</button><h2 id="choice-heading"></h2><span></span></div>
   <input type="search" class="choice-search" placeholder="搜索" aria-label="搜索选项" hidden>
   <div class="card settings-section choice-list"></div>`;
 document.body.append(sheet);
 bindSheetSwipe(sheet);
 sheet.querySelector('.cancel').onclick=()=>sheet.close();
 sheet.querySelector('.choice-search').oninput=renderChoices;
 sheet.addEventListener('close',()=>{
  active?.trigger.setAttribute('aria-expanded','false');
  active=null;
 });
 return sheet;
}

function renderChoices() {
 const {select}=active;
 const query=sheet.querySelector('.choice-search').value.trim().normalize('NFKC').toLowerCase();
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
   sheet.close();
  };
  return row;
 });
 if(!rows.length){
  const empty=document.createElement('p');empty.className='choice-empty';empty.textContent=query?'没有匹配的选项':'暂无可选项';rows.push(empty);
 }
 sheet.querySelector('.choice-list').replaceChildren(...rows);
}

function openPicker(select,control) {
 if(!select.isConnected||select.matches(':disabled'))return;
 const dialog=picker(),search=dialog.querySelector('.choice-search');
 if(dialog.open)return;
 active={select,...control};
 dialog.querySelector('h2').textContent=control.title;
 search.value='';search.hidden=!select.hasAttribute('data-picker-search')&&select.options.length<8;
 dialog.scrollTop=0;
 renderChoices();
 control.trigger.setAttribute('aria-expanded','true');
 dialog.showModal();
 dialog.querySelector('.cancel').focus({preventScroll:true});
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
   const label=select.labels[0];
   const title=select.dataset.picker||[...(label?.childNodes??[])].filter(node=>node!==select)
    .map(node=>node.textContent.trim()).filter(Boolean).join(' ')||'选择选项';
   const trigger=document.createElement('button'),value=document.createElement('span');
   trigger.type='button';trigger.className='choice-trigger';trigger.setAttribute('aria-haspopup','dialog');
   trigger.setAttribute('aria-expanded','false');
   value.className='choice-value';
   const arrow=document.createElement('span');arrow.className='chevron';arrow.innerHTML=shellIcon('chevron');
   trigger.append(value,arrow);select.before(trigger);select.hidden=true;
   control={trigger,value,title};controls.set(select,control);
   trigger.onclick=()=>openPicker(select,control);
   select.addEventListener('change',()=>reflect(select,control));
   if(select.form&&!select.form.hasAttribute('data-choice-reset')){
    const form=select.form;form.dataset.choiceReset='';
    form.addEventListener('reset',()=>queueMicrotask(()=>syncChoiceFields(form)));
   }
   select.addEventListener('invalid',event=>{
    if(!trigger.getClientRects().length)return;
    event.preventDefault();openPicker(select,control);
   });
  }
  reflect(select,control);
 }
}
