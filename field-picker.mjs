import {shellIcon} from './shell.mjs';

let active,installed=false,panelId=0;

function closeActive(restoreFocus=false){
 if(!active)return;
 const {field,trigger,panel}=active;
 active=null;
 field.classList.remove('is-open');
 panel.hidden=true;
 trigger.setAttribute('aria-expanded','false');
 if(restoreFocus&&trigger.isConnected)trigger.focus({preventScroll:true});
}

function installEvents(){
 if(installed)return;
 installed=true;
 const dismissOutside=event=>{
  if(active&&!active.field.contains(event.target))closeActive();
 };
 document.addEventListener('pointerdown',dismissOutside,true);
 document.addEventListener('focusin',dismissOutside);
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&active){
   event.preventDefault();event.stopPropagation();closeActive(true);
  }
 },true);
 document.addEventListener('close',event=>{
  if(active&&event.target.contains(active.field))closeActive();
 },true);
}

export function fieldLabel(input){
 return [...(input.labels[0]?.childNodes??[])].filter(node=>node!==input)
  .map(node=>node.textContent.trim()).filter(Boolean).join(' ');
}

export function bindFieldPicker(input,{title,triggerClass,fieldClass='',valueClass,fill}){
 installEvents();
 const label=input.labels[0];
 const anchor=label?.contains(input)?label:input;
 const field=document.createElement('span'),trigger=document.createElement('button'),value=document.createElement('span');
 const panel=document.createElement('span'),arrow=document.createElement('span');
 field.className=('inline-field '+fieldClass).trim();
 trigger.className=triggerClass;trigger.type='button';
 trigger.setAttribute('aria-expanded','false');
 value.className=valueClass;
 arrow.className='chevron';arrow.innerHTML=shellIcon('chevron');
 trigger.append(value,arrow);
 panel.className='inline-picker-panel';panel.hidden=true;panel.id='inline-picker-'+(++panelId);
 panel.setAttribute('role','group');panel.setAttribute('aria-label',title);
 trigger.setAttribute('aria-controls',panel.id);
 anchor.before(field);field.append(anchor,panel);input.before(trigger);input.hidden=true;
 const control={field,trigger,value,panel};
 const open=()=>{
  if(!trigger.isConnected||trigger.disabled||input.matches(':disabled'))return;
  if(active===control){closeActive();return;}
  closeActive();
  active=control;
  fill(control);
  panel.style.removeProperty('--picker-shift');
  panel.hidden=false;field.classList.add('is-open');trigger.setAttribute('aria-expanded','true');
  const box=panel.getBoundingClientRect(),edge=document.documentElement.clientWidth-12;
  const shift=box.left<12?12-box.left:Math.min(0,edge-box.right);
  panel.style.setProperty('--picker-shift',shift+'px');
  if(box.bottom>window.innerHeight-8)panel.scrollIntoView({block:'nearest',inline:'nearest'});
 };
 trigger.onclick=open;
 input.addEventListener('invalid',event=>{
  if(!trigger.getClientRects().length)return;
  event.preventDefault();
  if(!active){
   trigger.focus();
   open();
  }
 });
 return {...control,close:()=>{if(active===control)closeActive(true);}};
}
