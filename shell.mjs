export const shellGlyphs = {
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
 sparkles: '<path d="M11 3l1.7 5.3L18 10l-5.3 1.7L11 17l-1.7-5.3L4 10l5.3-1.7L11 3ZM19 13l.9 2.1L22 16l-2.1.9L19 19l-.9-2.1L16 16l2.1-.9L19 13ZM5 15v4m-2-2h4"/>',
};
export function hydrateShell(){
 for(const el of document.querySelectorAll('[data-shell-icon]')){
  const paths=shellGlyphs[el.dataset.shellIcon];
  if(paths)el.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
 }
 document.querySelectorAll('dialog.bottom-sheet').forEach(dialog=>bindSheetSwipe(dialog));
 document.querySelectorAll('dialog [data-sheet-close]').forEach(button=>{
  button.onclick=()=>button.closest('dialog').close();
 });
}

export function bindSheetSwipe(modal,backdrop,dismiss=()=>modal.close()){
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
    if(target?.closest?.('.drag-handle'))return false;
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
      setTimeout(()=>{dismiss();reset();},140);
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
