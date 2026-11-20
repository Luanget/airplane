export const APP_VERSION='0.9.2';
export const shellGlyphs = {
 close: '<path d="m6 6 12 12M18 6 6 18"/>',
 check: '<path d="m5 12 4 4L19 6"/>',
 download: '<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>',
 chevron: '<path d="m9 6 6 6-6 6"/>',
 plane: '<path d="M3 14.5 21 3l-6.2 18-4.1-6.2L3 14.5Z"/><path d="m10.7 14.8 4.1-4.1"/>',
 wallet: '<path d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12v4"/><path d="M16 12h5v4h-5a2 2 0 1 1 0-4Z"/>',
 health: '<path d="M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11Z"/><path d="M9 12h6M12 9v6"/>',
 settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1H21v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
 home: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
 plus: '<path d="M12 5v14M5 12h14"/>',
 activity: '<path d="M2 12h5l3-7 4 14 3-7h5"/>',
 chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
 list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
 bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
 sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 bowl: '<path d="M3 11h18a9 9 0 0 1-6 8.5V21H9v-1.5A9 9 0 0 1 3 11ZM9 7c0-1.5 1.5-2 1.5-3.5M14 7c0-1.5 1.5-2 1.5-3.5"/>',
 moon: '<path d="M20.6 15.2A8.8 8.8 0 0 1 8.8 3.4a8.9 8.9 0 1 0 11.8 11.8Z"/><path d="M17 3v6m-3-3h6"/>',
 apple: '<path d="M12 8.5c-1.6-.2-2.1-1.6-4.5-1.5C4.5 7 3 9.6 3 12.3c0 3.2 2.4 8.7 5.4 8.7 1.4 0 2.4-.8 3.6-.8 1.2 0 2.3.8 3.6.8 3 0 5.4-5.5 5.4-8.7C21 9.6 19.5 7 16.5 7c-2.4-.1-2.9 1.3-4.5 1.5ZM12 8.5C12 5 13.5 3.2 16.5 3"/>',
 calendar: '<rect x="3.5" y="5.5" width="17" height="15" rx="3"/><path d="M7.5 3.5v4m9-4v4m-13 2h17m-12 4h3m2.5 0h2m-6 3h3"/>',
 scale: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M7 13a5 5 0 0 1 10 0m-5 0 2-2"/>',
 person: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20v-1.3a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5V20"/>',
 sparkles: '<path d="M11 3l1.7 5.3L18 10l-5.3 1.7L11 17l-1.7-5.3L4 10l5.3-1.7L11 3ZM19 13l.9 2.1L22 16l-2.1.9L19 19l-.9-2.1L16 16l2.1-.9L19 13ZM5 15v4m-2-2h4"/>',
};
export function shellIcon(name){
 return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shellGlyphs[name]??''}</svg>`;
}
export function hydrateShell(){
 for(const el of document.querySelectorAll('[data-shell-icon]')){
  if(shellGlyphs[el.dataset.shellIcon])el.innerHTML=shellIcon(el.dataset.shellIcon);
 }
 document.querySelectorAll('dialog.bottom-sheet').forEach(dialog=>bindSheetSwipe(dialog));
 document.querySelectorAll('dialog [data-sheet-close]').forEach(button=>{
  button.onclick=()=>button.closest('dialog').close();
 });
}

let confirmationSheet;
export function confirmAction({title,message,action='确认',danger=false}){
 if(!confirmationSheet){
  confirmationSheet=document.createElement('dialog');
  confirmationSheet.className='modal bottom-sheet confirmation-sheet';
  confirmationSheet.setAttribute('aria-labelledby','confirmation-title');
  confirmationSheet.innerHTML=`
   <div class="modal-grabber" aria-hidden="true"></div>
   <div class="modal-head"><button type="button" class="cancel">取消</button><h2 id="confirmation-title"></h2><span></span></div>
   <section class="card"><p></p><button type="button" data-confirm></button></section>`;
  document.body.append(confirmationSheet);
  bindSheetSwipe(confirmationSheet);
  confirmationSheet.querySelector('.cancel').onclick=()=>confirmationSheet.close();
  confirmationSheet.querySelector('[data-confirm]').onclick=()=>confirmationSheet.close('confirmed');
 }
 const sheet=confirmationSheet;
 if(sheet.open)return Promise.resolve(false);
 sheet.querySelector('h2').textContent=title;sheet.querySelector('p').textContent=message;
 const button=sheet.querySelector('[data-confirm]');
 button.textContent=action;button.className=danger?'danger-button':'primary-button';
 sheet.returnValue='';
 return new Promise(resolve=>{
  sheet.addEventListener('close',()=>resolve(sheet.returnValue==='confirmed'),{once:true});
  sheet.showModal();
 });
}

export function bindSheetSwipe(modal,backdrop,dismiss=()=>modal.close()){
  const surface=backdrop??modal;
  const isOutside=event=>{
    if(event.target!==surface)return false;
    const {left,right,top,bottom}=modal.getBoundingClientRect();
    return event.clientX<left||event.clientX>=right||event.clientY<top||event.clientY>=bottom;
  };
  let pressed=false;
  surface.addEventListener('pointerdown',event=>{pressed=event.isPrimary&&event.button===0&&isOutside(event);});
  surface.addEventListener('pointercancel',()=>{pressed=false;});
  surface.addEventListener('click',event=>{
    const dismissTap=pressed&&isOutside(event);
    pressed=false;
    if(dismissTap)dismiss('backdrop');
  });
  const backdropStyle=backdrop?.style;
  const grabber=modal.querySelector('.modal-grabber');
  let startX=0,startY=0,lastY=0,startAt=0,tracking=false,dragging=false,forceHandle=false;
  const pointXY=p=>({x:Number.isFinite(p?.screenX)?p.screenX:p?.clientX||0,y:Number.isFinite(p?.screenY)?p.screenY:p?.clientY||0});
  const reset=()=>{
    tracking=false;dragging=false;forceHandle=false;
    modal.style.transition='transform .18s ease-out';
    if(backdropStyle)backdropStyle.transition='background .18s ease-out';
    modal.style.transform='';if(backdropStyle)backdropStyle.background='';
    setTimeout(()=>{modal.style.transition='';if(backdropStyle)backdropStyle.transition='';},190);
  };
  const beginDrag=()=>{
    if(dragging)return true;
    if(!forceHandle && modal.scrollTop>1)return false;
    const active=document.activeElement;
    if(active&&modal.contains(active)&&active.matches('input,textarea,select')) active.blur();
    dragging=true;startAt=performance.now();
    modal.style.transition='none';if(backdropStyle)backdropStyle.transition='none';
    return true;
  };
  const begin=(point,target,force=false)=>{
    if(target?.closest?.('.drag-handle,.inline-picker-panel'))return false;
    // Arm the gesture from the whole sheet, including controls. Nothing is
    // prevented on touchstart, so a normal tap still behaves like a tap. Only
    // after a clearly downward movement do we take over and dismiss the sheet.
    const p=pointXY(point);startX=p.x;startY=lastY=p.y;tracking=true;dragging=false;forceHandle=force;
    if(force)beginDrag();
    return true;
  };
  const move=point=>{
    if(!tracking)return false;
    const p=pointXY(point);lastY=p.y;

    if(!dragging && !forceHandle && modal.scrollTop>1){
      // Let native scrolling consume the gesture until the sheet reaches its
      // top edge. Rebase the origin continuously so dismissal can hand off
      // smoothly if the user keeps pulling downward after reaching the top.
      startX=p.x;startY=lastY=p.y;
      return false;
    }

    const dy=lastY-startY,dx=p.x-startX;
    if(!dragging){
      // A small movement remains a normal tap/scroll. Once the gesture is
      // clearly downward and mostly vertical, the sheet itself follows it.
      if(dy<10 || dy<Math.abs(dx)*1.15)return false;
      if(!beginDrag())return false;
    }
    const down=Math.max(0,dy);
    modal.style.transform=`translateY(${down}px)`;
    if(backdropStyle)backdropStyle.background=`rgba(15,18,15,${Math.max(.08,.38-down/700)})`;
    return true;
  };
  const finish=()=>{
    if(!tracking)return;
    if(!dragging){tracking=false;forceHandle=false;return;}
    tracking=false;dragging=false;
    const dy=Math.max(0,lastY-startY);
    const velocity=dy/Math.max(1,performance.now()-startAt);
    if(dy>Math.min(92,modal.clientHeight*.13)||velocity>.56){
      modal.style.transition='transform .16s ease-in';
      modal.style.transform='translateY(110%)';
      setTimeout(()=>{dismiss('swipe');reset();},140);
    }else reset();
  };

  // The whole sheet can be pulled down, not only the grabber. We do not call
  // preventDefault until the gesture is clearly downward and the sheet is at
  // scrollTop 0, so normal scrolling and taps remain natural.
  modal.addEventListener('touchstart',e=>{
    if(e.touches.length!==1)return;
    const force=!!e.target.closest?.('.modal-grabber');
    if(begin(e.touches[0],e.target,force)&&force)e.preventDefault();
  },{passive:false});
  modal.addEventListener('touchmove',e=>{
    if(e.touches.length!==1||!tracking)return;
    if(move(e.touches[0]))e.preventDefault();
  },{passive:false});
  modal.addEventListener('touchend',finish,{passive:true});
  modal.addEventListener('touchcancel',()=>{if(dragging)reset();else{tracking=false;forceHandle=false;}},{passive:true});

  // Desktop/pen testing keeps the explicit grabber affordance.
  grabber?.addEventListener('pointerdown',e=>{
    if(e.pointerType==='touch')return;
    if(begin(e,e.target,true)){grabber.setPointerCapture?.(e.pointerId);e.preventDefault();}
  });
  grabber?.addEventListener('pointermove',e=>{if(e.pointerType!=='touch'&&tracking){move(e);e.preventDefault();}});
  grabber?.addEventListener('pointerup',e=>{if(e.pointerType!=='touch')finish();});
  grabber?.addEventListener('pointercancel',e=>{if(e.pointerType!=='touch')reset();});
}
