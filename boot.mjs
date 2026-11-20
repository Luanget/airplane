import {resumePurchaseUpdate} from './health/purchase-sync.mjs';
import {hydrateShell} from './shell.mjs';
import {installUpdates} from './updates.mjs';
import {localDate,syncCalendarFields} from './calendar.mjs';

const health=document.body.dataset.module==='health';
const params=new URL(location.href).searchParams;
const demo=params.get('demo')==='1';
const account=demo?(await (await import('./ai/demo.mjs')).demoWorkspace(localDate())).account:{finance:localStorage};
if(demo){
 for(const link of document.querySelectorAll('[data-module-link], [data-open-ai], [data-ai-settings]'))link.search='?demo=1';
 const marker=document.createElement('span');marker.className='demo-label';marker.textContent='演示';
 document.querySelector('.brand-row').append(marker);
}
window.airplaneAccount=account;
if(!demo)installUpdates();
hydrateShell();
const headerDay=document.querySelector('.day-picker');
headerDay.querySelector('input[type=date]').value=localDate();
syncCalendarFields(headerDay);
try {await resumePurchaseUpdate(account);}
catch {window.airplanePendingPurchase=true;}
if(health)await import('./health/app.mjs');
else await import('./app.js');
function openFromLink(){
 if(location.hash!=='#model')return;
 const url=new URL('./assistant/',import.meta.url);
 if(demo)url.searchParams.set('demo','1');
 url.hash='api-key';location.replace(url.href);
}
window.addEventListener('hashchange',openFromLink);
if(!demo&&params.has('private')){
 const {showLegacyExport}=await import('./legacy-export.mjs');
 await showLegacyExport();
}else openFromLink();
