import {resumePurchaseUpdate} from './health/purchase-sync.mjs';
import {hydrateShell} from './shell.mjs';
import {installKeyDialog} from './ai/client.mjs';
import {accountKeys, privateAccount} from './account.mjs';
import {installUpdates} from './updates.mjs';

const health = document.body.dataset.module === 'health';
const isPrivate = new URL(location.href).searchParams.has('private');
const accountLink = document.querySelector('[data-account]');
const gate = document.querySelector('#account-gate');
const content = document.querySelector('[data-shell]');
installUpdates();
hydrateShell();
const openKeys=installKeyDialog();
if (isPrivate) {
  content.hidden = true;
  gate.hidden = false;
  gate.querySelector('input').focus();
  // A restored back/forward entry must also be locked.
  addEventListener('pagehide', () => { content.hidden = true; });
  addEventListener('pageshow', e => { if (e.persisted) location.reload(); });
  gate.onsubmit = async e => {
    e.preventDefault();
    const input = gate.querySelector('input');
    try {
      const keys = await accountKeys(input.value.trim());
      await import('./vendor/nacl-fast.min.js');
      const account = privateAccount(keys, globalThis.nacl, localStorage);
      input.value = '';
      accountLink.textContent = '锁定账户';
      accountLink.href = '?private=1';
      document.querySelector('[data-module-link]').href += '?private=1';
      await start(account);
      gate.hidden = true;
      content.hidden = false;
    } catch (err) { gate.querySelector('output').textContent = err.message; }
  };
} else {
  await start({finance: localStorage});
}

async function start(account) {
  window.airplaneAccount = account;
  try {await resumePurchaseUpdate(account);}
  catch {window.airplanePendingPurchase=true;}
  if (health) await import('./health/app.mjs');
  else await import('./app.js');
  const openFromLink=()=>{if(location.hash==='#model') openKeys();};
  window.addEventListener('hashchange',openFromLink);
  openFromLink();
}
