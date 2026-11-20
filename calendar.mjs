import {bindFieldPicker,fieldLabel} from './field-picker.mjs';

const pad=value=>String(value).padStart(2,'0');
export const localDate=(d=new Date())=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export const localClock=(d=new Date())=>`${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function normalizeClock(value){
 const match=/^(上午|下午|AM|PM)?\s*(\d{1,2})[:：](\d{2})(?::\d{2})?\s*(AM|PM|上午|下午)?$/i.exec(String(value??'').trim());
 if(!match)return '';
 let hours=Number(match[2]);
 const minutes=Number(match[3]),period=(match[1]||match[4]||'').toLowerCase();
 if(hours>23||minutes>59||period&&(hours<1||hours>12))return '';
 if(period)hours=hours%12+(['pm','下午'].includes(period)?12:0);
 return pad(hours)+':'+pad(minutes);
}

export function displayDay(value,includeYear=false){
 const date=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value??''));
 if(!date)return '未选日期';
 return (includeYear?date[1]+'年':'')+Number(date[2])+'月'+Number(date[3])+'日';
}

const calendarControls=new WeakMap();
const calendarForms=new WeakSet();

function pickerButton(label,action){
 const button=document.createElement('button');
 button.type='button';button.textContent=label;button.onclick=action;
 return button;
}

function fitsField(input){
 const probe=input.cloneNode(false);
 return value=>{probe.value=value;return probe.value===value&&probe.validity.valid;};
}

function pickerActions(input,panel,write,buttons){
 const actions=document.createElement('span');actions.className='calendar-actions';
 if(!input.required)actions.append(pickerButton('清空',()=>write('')));
 actions.append(...buttons);panel.append(actions);
}

function dateMenu(input,panel,write){
 panel.className='inline-picker-panel calendar-menu';
 const allowed=fitsField(input),today=localDate();
 const current=input.value||(input.max&&today>input.max?input.max:input.min&&today<input.min?input.min:today);
 const initial=new Date(current+'T12:00:00');
 const month=new Date(initial.getFullYear(),initial.getMonth(),1,12);
 const header=document.createElement('span'),label=document.createElement('strong'),grid=document.createElement('span');
 header.className='calendar-menu-head';grid.className='calendar-date-grid';
 const previous=pickerButton('‹',()=>step(-1)),next=pickerButton('›',()=>step(1));
 previous.setAttribute('aria-label','上个月');next.setAttribute('aria-label','下个月');
 header.append(previous,label,next);
 panel.replaceChildren(header,grid);

 function draw(){
  const year=month.getFullYear(),index=month.getMonth(),days=new Date(year,index+1,0,12).getDate();
  label.textContent=year+'年'+(index+1)+'月';
  const cells=[...'一二三四五六日'].map(day=>{
   const item=document.createElement('span');item.className='calendar-weekday';item.textContent=day;return item;
  });
  for(let i=0;i<(month.getDay()+6)%7;i++)cells.push(document.createElement('span'));
  for(let day=1;day<=days;day++){
   const date=localDate(new Date(year,index,day,12));
   const button=pickerButton(String(day),()=>write(date));
   button.setAttribute('aria-label',displayDay(date,true));button.setAttribute('aria-pressed',String(date===input.value));
   if(date===today)button.setAttribute('aria-current','date');
   button.disabled=!allowed(date);cells.push(button);
  }
  grid.replaceChildren(...cells);
  previous.disabled=!!input.min&&localDate(new Date(year,index,0,12))<input.min;
  next.disabled=!!input.max&&localDate(new Date(year,index+1,1,12))>input.max;
 }
 function step(change){month.setMonth(month.getMonth()+change);draw();}
 const now=pickerButton('今天',()=>write(today));now.disabled=!allowed(today);
 pickerActions(input,panel,write,[now]);draw();
}

function timeMenu(input,panel,write){
 panel.className='inline-picker-panel calendar-menu';
 const allowed=fitsField(input),now=localClock();
 const values=(normalizeClock(input.value)||now).split(':').map(Number);
 const columns=document.createElement('span');columns.className='calendar-time-grid';
 const apply=pickerButton('确定',()=>write(values.map(pad).join(':')));
 apply.className='calendar-apply';apply.disabled=!allowed(values.map(pad).join(':'));
 for(const [index,name,count] of [[0,'小时',24],[1,'分钟',60]]){
  const column=document.createElement('span'),label=document.createElement('strong'),list=document.createElement('span');
  column.className='calendar-time-column';list.className='calendar-time-list';label.textContent=name;
  list.setAttribute('role','group');list.setAttribute('aria-label',name);
  const buttons=Array.from({length:count},(_,n)=>{
   const button=pickerButton(pad(n),()=>{
    buttons[values[index]].setAttribute('aria-pressed','false');
    values[index]=n;button.setAttribute('aria-pressed','true');
    apply.disabled=!allowed(values.map(pad).join(':'));
   });
   button.setAttribute('aria-label',name+' '+pad(n));
   button.setAttribute('aria-pressed',String(n===values[index]));
   return button;
  });
  list.append(...buttons);column.append(label,list);columns.append(column);
  requestAnimationFrame(()=>{
   const active=buttons[values[index]];
   list.scrollTop=active.offsetTop-(list.clientHeight-active.offsetHeight)/2;
  });
 }
 panel.replaceChildren(columns);
 const current=pickerButton('现在',()=>write(now));current.disabled=!allowed(now);
 pickerActions(input,panel,write,[current,apply]);
}

// The original inputs still supply form values and constraints.
export function syncCalendarFields(root=document){
 for(const input of root.querySelectorAll('input[type=date],input[type=time]')){
  let control=calendarControls.get(input);
  if(!control){
   const title=fieldLabel(input)||(input.type==='date'?'选择日期':'选择时间');
   const write=value=>{
    if(input.value!==value){
     input.value=value;
     input.dispatchEvent(new Event('input',{bubbles:true}));
     input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    control.close();
   };
   control=bindFieldPicker(input,{title,triggerClass:'calendar-trigger',fieldClass:'calendar-field',valueClass:'calendar-value',
    fill:()=> (input.type==='date'?dateMenu:timeMenu)(input,control.panel,write)});
   control.title=title;calendarControls.set(input,control);
   const sync=()=>syncValue(input,control);
   input.addEventListener('input',sync);input.addEventListener('change',sync);
   if(input.form&&!calendarForms.has(input.form)){
    const form=input.form;calendarForms.add(form);
    form.addEventListener('reset',()=>queueMicrotask(()=>syncCalendarFields(form)));
   }
  }
  syncValue(input,control);
 }
}
function syncValue(input,control){
 const label=input.type==='date'?displayDay(input.value,!input.hasAttribute('data-short-date')):normalizeClock(input.value)||'选择时间';
 control.value.textContent=label;control.value.classList.toggle('muted',!input.value);
 control.trigger.setAttribute('aria-label',control.title+'，'+label);
 control.trigger.disabled=input.matches(':disabled');
}

export function bindDayPicker(root,onSelect){
 const input=root.querySelector('input[type=date]');
 input.addEventListener('change',()=>{if(input.value)onSelect(input.value);});
 for(const button of root.querySelectorAll('[data-day-step]')){
  button.onclick=()=>{
   const date=new Date(input.value+'T12:00:00');
   if(!Number.isFinite(date.getTime()))return;
   date.setDate(date.getDate()+Number(button.dataset.dayStep));
   onSelect(localDate(date));
  };
 }
 return date=>{input.value=date;syncCalendarFields(root);};
}
