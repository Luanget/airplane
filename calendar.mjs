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

// Keep the native picker hit-target and labels. Draw the same Chinese date or
// 24-hour value on both modules instead of relying on Safari's field chrome.
export function syncCalendarFields(root=document){
 for(const input of root.querySelectorAll('input[type=date],input[type=time]')){
  let field=input.closest('.calendar-field');
  if(!field){
   field=document.createElement('span');
   field.className='calendar-field';
   const display=document.createElement('span');
   display.className='calendar-value';display.setAttribute('aria-hidden','true');
   input.before(field);field.append(display,input);
   const sync=()=>syncValue(input,display);
   input.addEventListener('input',sync);input.addEventListener('change',sync);
   input.addEventListener('click',()=>{
    if(matchMedia('(pointer:fine)').matches)try{input.showPicker?.();}catch{}
   });
  }
  syncValue(input,field.querySelector('.calendar-value'));
 }
}
function syncValue(input,display){
 display.textContent=input.type==='date'?displayDay(input.value,!input.hasAttribute('data-short-date')):normalizeClock(input.value)||'选择时间';
 display.classList.toggle('muted',!input.value);
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
