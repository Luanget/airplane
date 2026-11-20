import {shellIcon} from './shell.mjs';

const scope = new URL('./', import.meta.url).href;
let manualView=null;
function showManualStatus(message,ready=false){
  if(!manualView?.panel.isConnected||!manualView.button.getClientRects().length)return false;
  const {panel,status,action}=manualView;
  panel.hidden=false;status.textContent=message;action.hidden=!ready;
  return true;
}
function toast(message, {duration=2500}={}) {
  if(showManualStatus(message))return;
  let el = document.querySelector('.update-status');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast update-status';
    el.setAttribute('role','status');
    document.body.append(el);
  }
  el.textContent = message;
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.remove(), duration);
}
let swReloading=false;
let updateReloadFallbackTimer=null;
let airplaneRegistration=null;
let updateBannerShown=false;
let updateReminderDismissed=false;
let pendingUpdateWorker=null;
const UPDATE_CHECK_KEY='airplane-last-update-check-v1';
const UPDATE_ACTIVE_INTERVAL_MS=5*60*1000;
const UPDATE_RESUME_INTERVAL_MS=2*60*1000;
let updateIntervalTimer=null;
const observedRegistrations=new WeakSet();

function activateWaitingServiceWorker(){
  const worker=airplaneRegistration?.waiting||pendingUpdateWorker;
  if(!worker){
    // A previous bridge worker may already have activated itself. In that case
    // the update succeeded; do not report a false failure.
    toast('新版已经生效或正在完成切换',{duration:2200});
    return;
  }
  const activate=()=>{
    swReloading=true;
    toast('正在更新 Airplane…',{duration:1800});
    worker.postMessage({type:'SKIP_WAITING'});
    // iOS can occasionally miss/delay controllerchange even after the new
    // worker reaches activated. Keep a bounded reload fallback so the fresh
    // shell is actually loaded after the user explicitly chose to update.
    clearTimeout(updateReloadFallbackTimer);
    updateReloadFallbackTimer=setTimeout(()=>{
      if(swReloading)window.location.reload();
    },4500);
  };
  if(worker.state==='installed'||worker.state==='activating'){activate();return;}
  if(worker.state==='activated'){toast('Airplane 已是新版本');return;}
  const onState=()=>{
    if(worker.state==='installed'){worker.removeEventListener('statechange',onState);activate();}
    else if(worker.state==='redundant'){worker.removeEventListener('statechange',onState);toast('新版准备失败，请稍后在设置中重试');}
  };
  worker.addEventListener('statechange',onState);
  toast('新版正在准备，完成后会继续更新…',{duration:2200});
}

function hideUpdateBanner(){
  document.querySelector('.update-banner')?.remove();
  updateBannerShown=false;
}
function showUpdateAvailable(worker=null,{force=false}={}){
  if(worker)pendingUpdateWorker=worker;
  if(updateReminderDismissed&&!force)return;
  if(force)updateReminderDismissed=false;
  if(showManualStatus('新版已准备好',true)){hideUpdateBanner();return;}
  if(updateBannerShown&&document.querySelector('.update-banner'))return;
  updateBannerShown=true;
  document.querySelector('.update-banner')?.remove();
  const d=document.createElement('div');d.className='update-banner';
  d.innerHTML=`<span><strong>Airplane 有新版本</strong><small>已在后台准备好</small></span><button class="update-banner-action" type="button">更新</button><button class="update-banner-close" type="button" aria-label="稍后更新">${shellIcon('close')}</button>`;
  document.body.appendChild(d);
  d.querySelector('.update-banner-action').onclick=()=>{hideUpdateBanner();activateWaitingServiceWorker();};
  d.querySelector('.update-banner-close').onclick=()=>{updateReminderDismissed=true;hideUpdateBanner();};
}

function observeServiceWorkerRegistration(registration){
  if(!registration)return;
  if(registration.waiting)showUpdateAvailable(registration.waiting);
  if(observedRegistrations.has(registration))return;
  observedRegistrations.add(registration);
  registration.addEventListener('updatefound',()=>{
    const worker=registration.installing;
    if(!worker)return;
    worker.addEventListener('statechange',()=>{
      if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdateAvailable(worker);
    });
  });
}

async function checkForAppUpdate(showToast=false){
  if(!('serviceWorker' in navigator)){if(showToast)toast('当前环境不支持程序更新');return;}
  try{
    const registration=airplaneRegistration||await navigator.serviceWorker.getRegistration(scope);
    if(!registration){if(showToast)toast('更新服务尚未就绪');return;}
    airplaneRegistration=registration;
    observeServiceWorkerRegistration(registration);
    await registration.update();
    try{localStorage.setItem(UPDATE_CHECK_KEY,String(Date.now()));}catch{}
    if(registration.waiting){showUpdateAvailable(registration.waiting,{force:showToast});return;}
    if(showToast){
      if(registration.installing){toast('发现新版，正在后台准备…',{duration:2600});}
      else toast('已检查，当前已是最新版本');
    }
  }catch(err){
    console.warn('Airplane update check failed',err);
    if(showToast)toast('暂时无法连接更新服务器，继续使用本地版本');
  }
}

export function bindUpdateCheck(button){
  if(!button)return;
  const panel=document.createElement('div'),status=document.createElement('output'),action=document.createElement('button');
  panel.className='update-inline';panel.hidden=true;
  status.setAttribute('aria-live','polite');
  action.type='button';action.className='primary-button';action.textContent='更新';action.hidden=true;
  panel.append(status,action);button.after(panel);
  const view={button,panel,status,action};
  button.closest('dialog')?.addEventListener('close',()=>{
    panel.hidden=true;
    if(manualView===view)manualView=null;
  });
  action.onclick=activateWaitingServiceWorker;
  button.onclick=async()=>{
    manualView=view;
    hideUpdateBanner();
    showManualStatus('正在检查更新…');button.disabled=true;
    try{await checkForAppUpdate(true);}
    finally{button.disabled=false;}
  };
}

function lastUpdateCheckAt(){
  return Number(localStorage.getItem(UPDATE_CHECK_KEY)||0);
}
function backgroundUpdateIfDue(minInterval=UPDATE_ACTIVE_INTERVAL_MS){
  if(document.visibilityState!=='visible'||navigator.onLine===false)return;
  if(Date.now()-lastUpdateCheckAt()<minInterval)return;
  checkForAppUpdate(false);
}
function scheduleBackgroundUpdateCheck(){
  // Startup is never blocked by the network: render from the local shell first,
  // then always perform one fresh update check shortly after launch. Do not
  // reuse the previous session's timestamp to suppress this first check.
  setTimeout(()=>{
    if(document.visibilityState==='visible'&&navigator.onLine!==false)checkForAppUpdate(false);
  },6000);
  if(updateIntervalTimer)clearInterval(updateIntervalTimer);
  updateIntervalTimer=setInterval(()=>backgroundUpdateIfDue(UPDATE_ACTIVE_INTERVAL_MS),UPDATE_ACTIVE_INTERVAL_MS);
}
function bindForegroundUpdateChecks(){
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')setTimeout(()=>backgroundUpdateIfDue(UPDATE_RESUME_INTERVAL_MS),700);
  });
  // Reconnecting is a useful opportunity to discover a version that could not
  // be checked while offline, without affecting normal launch performance.
  window.addEventListener('online',()=>setTimeout(()=>backgroundUpdateIfDue(0),700));
}

async function registerAirplaneServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  try{
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      pendingUpdateWorker=null;hideUpdateBanner();
      if(!swReloading)showManualStatus('已切换到新版本');
      if(!swReloading)return;
      clearTimeout(updateReloadFallbackTimer);
      // Give the newly activated worker a brief moment to claim the client and
      // finish cache cleanup, then reload through its fresh shell cache.
      setTimeout(()=>window.location.reload(),120);
    });
    airplaneRegistration=await navigator.serviceWorker.getRegistration(scope);
    if(!airplaneRegistration){
      airplaneRegistration=await navigator.serviceWorker.register(new URL('./sw.js',scope),{updateViaCache:'none'});
    }
    observeServiceWorkerRegistration(airplaneRegistration);
    scheduleBackgroundUpdateCheck();
  }catch(err){
    console.warn('Airplane Service Worker setup failed',err);
  }
}

export function installUpdates(){
  bindForegroundUpdateChecks();
  // Keep the launch frame free of browser-management work. The already-active
  // Service Worker serves the app from cache before this code runs; registration
  // bookkeeping and update discovery can safely begin after the first paint.
  setTimeout(registerAirplaneServiceWorker,700);
}
