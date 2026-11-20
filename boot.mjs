import {resumePurchaseUpdate} from './health/purchase-sync.mjs';
import {hydrateShell} from './shell.mjs';
import {installKeyDialog} from './ai/client.mjs';
import {installChat} from './ai/chat.mjs';
import {installUpdates} from './updates.mjs';
import {localDate,syncCalendarFields} from './calendar.mjs';

const health=document.body.dataset.module==='health';
const params=new URL(location.href).searchParams;
const account={finance:localStorage};
window.airplaneAccount=account;
installUpdates();
hydrateShell();
const headerDay=document.querySelector('.day-picker');
headerDay.querySelector('input[type=date]').value=localDate();
syncCalendarFields(headerDay);
try {await resumePurchaseUpdate(account);}
catch {window.airplanePendingPurchase=true;}
if(health)await import('./health/app.mjs');
else await import('./app.js');
const openKeys=installKeyDialog();
installChat(openKeys);
const openFromLink=()=>{if(location.hash==='#model')openKeys();};
window.addEventListener('hashchange',openFromLink);
if(params.has('private')){
 const {showLegacyExport}=await import('./legacy-export.mjs');
 await showLegacyExport();
}else openFromLink();
