import {bindDayPicker,displayDay,localDate as localISO,localClock,normalizeClock,syncCalendarFields} from './calendar.mjs';
import {APP_VERSION,bindSheetSwipe,confirmAction,shellGlyphs} from './shell.mjs';
import {readState as readHealthState} from './health/storage.mjs';
import {purchaseForTransaction,purchaseTransactionId} from './health/purchases.mjs';
import {RECOVERY_KEY,STORAGE_KEY,DRAFT_KEY,PRE_RESTORE_KEY,DEFAULT_CATEGORIES,freshData,replaceFinance,validateFinanceBackup} from './finance-storage.mjs';
import {currentBalanceFor,daysInMonth,monthlyBudget,monthlyMetrics,transactionsForMonth} from './finance-metrics.mjs';
import {bindUpdateCheck} from './updates.mjs';

// STORAGE_KEY is intentionally permanent. Never rename it in a normal app update.
// Keeping one stable key lets new program versions reuse the user's existing ledger.
const financeStore = window.airplaneAccount.finance;
const DRAFT_TTL_MS = 30 * 60 * 1000;
const SCHEMA_VERSION = 4;
const VERSION = SCHEMA_VERSION;

const ICONS = {
  ...shellGlyphs,
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  shield: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.3 2.3 4.8-5"/>',
  food: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M16 3c3 2 4 5 4 9h-4V3Zm0 9v9"/>',
  car: '<path d="m5 11 2-5h10l2 5"/><path d="M4 11h16v7H4z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>',
  game: '<path d="M8 8h8a5 5 0 0 1 4.7 6.7l-1.1 3.1a2 2 0 0 1-3.2.8L14 16h-4l-2.4 2.6a2 2 0 0 1-3.2-.8l-1.1-3.1A5 5 0 0 1 8 8Z"/><path d="M7 12v4M5 14h4M16 13h.01M18 15h.01"/>',
  house: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
  book: '<path d="M4 5a4 4 0 0 1 4-2h4v17H8a4 4 0 0 0-4 2V5Z"/><path d="M20 5a4 4 0 0 0-4-2h-4v17h4a4 4 0 0 1 4 2V5Z"/>',
  travel: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M9 7V5a3 3 0 0 1 6 0v2M8 11v5M16 11v5"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M12 9v12M3 13h18M7.5 9C5 9 4 7.5 5 6c1.2-1.8 4.2.3 7 3M16.5 9C19 9 20 7.5 19 6c-1.2-1.8-4.2.3-7 3"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12h18M10 12v2h4v-2"/>',
  laptop: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M2 20h20M8 20h8"/>',
  award: '<circle cx="12" cy="9" r="5"/><path d="m9 13-2 8 5-3 5 3-2-8"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  trend: '<path d="M3 18 9 12l4 4 8-10"/><path d="M15 6h6v6"/>',
  refund: '<path d="M4 9h11a5 5 0 0 1 0 10H9"/><path d="m8 5-4 4 4 4"/>',
  coffee: '<path d="M5 8h12v7a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5V8Z"/><path d="M17 10h2a3 3 0 0 1 0 6h-2M8 3v2M12 3v2"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  water: '<path d="M12 3S6 9.5 6 14a6 6 0 0 0 12 0c0-4.5-6-11-6-11Z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  bolt: '<path d="M13 2 5 14h6l-1 8 9-13h-6V2Z"/>',
  flame: '<path d="M13 3s1 3-1 5c-1.1 1.8-4 2.8-4 6a4 4 0 0 0 8 0c0-1.5-.6-2.8-1.5-4 2.8 1.6 4.5 4 4.5 6.8A7 7 0 0 1 5 17c0-4.7 3.4-8.4 8-14Z"/>',
  washing: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16"/><circle cx="12" cy="14" r="4"/><path d="M8 5.5h.01M11 5.5h2"/>',
  building: '<path d="M5 21V4h14v17M3 21h18"/><path d="M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2"/>',
  wifi: '<path d="M4 9a12 12 0 0 1 16 0M7 12a8 8 0 0 1 10 0M10 15a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1"/>',
  package: '<path d="m4 7 8-4 8 4v10l-8 4-8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10M8 5l8 4"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5 5L3 18l3 3 6.5-6.5a4 4 0 0 0 5-5l-2.5 2.5-3-3 2.5-2.5Z"/>',
  parking: '<circle cx="12" cy="12" r="9"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3M10 13h3"/>',
  paw: '<circle cx="12" cy="15" r="4"/><circle cx="7" cy="9" r="2"/><circle cx="11" cy="6" r="2"/><circle cx="16" cy="8" r="2"/><circle cx="18" cy="12" r="1.7"/>',
  bus: '<rect x="5" y="3" width="14" height="16" rx="3"/><path d="M5 10h14M8 19v2M16 19v2M8 14h.01M16 14h.01"/>',
  train: '<rect x="6" y="3" width="12" height="15" rx="3"/><path d="M6 10h12M9 14h.01M15 14h.01M9 18l-3 3M15 18l3 3M8 21h8"/>',
  clothes: '<path d="m8 4-5 3 3 5 2-1v10h8V11l2 1 3-5-5-3a4 4 0 0 1-8 0Z"/>',
  scissors: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8.5 8.5 11 8.5M8.5 15.5 19.5 7"/>',
  subscription: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 14h4"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 19h16"/>',
  file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>'
};

function normalizeData(parsed){
  // Schema migrations are additive: never replace transactions, budgets, categories,
  // balances, preferences or future unknown fields just because the app was updated.
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid Airplane data');
  if(!Array.isArray(parsed.transactions)) parsed.transactions=[];
  if(!Array.isArray(parsed.categories) || !parsed.categories.length) parsed.categories=structuredClone(DEFAULT_CATEGORIES);
  if(!parsed.budgets || typeof parsed.budgets !== 'object' || Array.isArray(parsed.budgets)) parsed.budgets={};
  if(!Array.isArray(parsed.balanceAdjustments)) parsed.balanceAdjustments=[];
  if(!parsed.prefs || typeof parsed.prefs !== 'object' || Array.isArray(parsed.prefs)) parsed.prefs={};
  if(!('initialBalance' in parsed.prefs)) parsed.prefs.initialBalance=null;
  if(!('lastExpenseCategoryId' in parsed.prefs)) parsed.prefs.lastExpenseCategoryId=null;
  if(!('lastIncomeCategoryId' in parsed.prefs)) parsed.prefs.lastIncomeCategoryId=null;
  // Categories are user-owned after 0.7.6: former built-ins and newly added items behave identically.
  parsed.categories.forEach(c=>{
    if(!c||typeof c!=='object')return;
    c.custom=true;
    if(c.type==='expense'&&typeof c.budgetExcludedDefault!=='boolean')c.budgetExcludedDefault=false;
  });
  parsed.version=SCHEMA_VERSION;
  return parsed;
}

function dataNeedsMigration(parsed){
  if(!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true;
  if(parsed.version!==SCHEMA_VERSION) return true;
  if(!Array.isArray(parsed.transactions)) return true;
  if(!Array.isArray(parsed.categories) || !parsed.categories.length) return true;
  if(!parsed.budgets || typeof parsed.budgets !== 'object' || Array.isArray(parsed.budgets)) return true;
  if(!Array.isArray(parsed.balanceAdjustments)) return true;
  if(!parsed.prefs || typeof parsed.prefs !== 'object' || Array.isArray(parsed.prefs)) return true;
  if(!('initialBalance' in parsed.prefs) || !('lastExpenseCategoryId' in parsed.prefs) || !('lastIncomeCategoryId' in parsed.prefs)) return true;
  if(parsed.categories.some(c=>c&&typeof c==='object'&&c.custom!==true)) return true;
  if(parsed.categories.some(c=>c&&typeof c==='object'&&c.type==='expense'&&typeof c.budgetExcludedDefault!=='boolean')) return true;
  return false;
}

function parseStoredData(raw){
  if(!raw) return null;
  const parsed=JSON.parse(raw);
  const recognized=Array.isArray(parsed?.transactions) || Array.isArray(parsed?.categories)
    || Array.isArray(parsed?.balanceAdjustments) || (parsed?.budgets && typeof parsed.budgets==='object')
    || (parsed?.prefs && typeof parsed.prefs==='object');
  if (!recognized || (parsed.transactions!==undefined && !Array.isArray(parsed.transactions))) throw new Error('unrecognized ledger');
  const needsMigration=dataNeedsMigration(parsed);
  return {value:normalizeData(parsed),needsMigration};
}

let observedFinanceRaw=null;
function writeStorageCopies(value){
  replaceFinance(financeStore,value,observedFinanceRaw);
  observedFinanceRaw=JSON.stringify(value);
}

function runWhenIdle(task, timeout=1800){
  if('requestIdleCallback' in window){
    requestIdleCallback(()=>task(),{timeout});
  }else{
    setTimeout(task,700);
  }
}

function ensureRecoveryCopyAfterLaunch(value){
  if(financeStore.getItem(RECOVERY_KEY))return;
  runWhenIdle(()=>{
    try{
      if(!financeStore.getItem(RECOVERY_KEY))financeStore.setItem(RECOVERY_KEY,JSON.stringify(value));
    }catch(e){console.warn('Deferred recovery copy failed',e);}
  });
}

function loadData(){
  const primaryRaw=financeStore.getItem(STORAGE_KEY);
  observedFinanceRaw=primaryRaw;
  try {
    const parsed=parseStoredData(primaryRaw);
    if(parsed){
      // The old startup path rewrote the entire ledger to BOTH localStorage keys on
      // every launch. localStorage writes are synchronous on iOS and become visibly
      // slower as the ledger grows. Only persist here when an actual migration is
      // required; normal launches are read-only until the user changes data.
      if(parsed.needsMigration) writeStorageCopies(parsed.value);
      else ensureRecoveryCopyAfterLaunch(parsed.value);
      return parsed.value;
    }
  } catch(e){
    console.warn('Primary Airplane data is invalid; trying local recovery copy',e);
  }

  const recoveryRaw=financeStore.getItem(RECOVERY_KEY);
  try {
    const recovered=parseStoredData(recoveryRaw);
    if(recovered){
      const restoredRaw=JSON.stringify(recovered.value);
      financeStore.setItem(STORAGE_KEY,restoredRaw);
      observedFinanceRaw=restoredRaw;
      if(recovered.needsMigration)financeStore.setItem(RECOVERY_KEY,JSON.stringify(recovered.value));
      console.warn('Airplane restored data from the on-device recovery copy');
      return recovered.value;
    }
  } catch(e){
    console.warn('Airplane recovery copy is also invalid',e);
  }

  // Only a genuinely new origin/device, with neither a primary nor recovery copy,
  // starts with empty data. A program update by itself never reaches this path.
  if(primaryRaw!==null || recoveryRaw!==null){
    recoveryRequired=true;
    return freshData();
  }
  const created=freshData();
  writeStorageCopies(created);
  return created;
}

let dataRevision=0;
function saveData(){
  dataRevision++;monthTxCache.clear();balanceCache.revision=-1;
  try{writeStorageCopies(data);return true;}
  catch(err){
    try{
      const raw=financeStore.getItem(STORAGE_KEY);
      const saved=parseStoredData(raw);
      if(saved){data=saved.value;observedFinanceRaw=raw;}
    }catch{}
    closeModal({runDismiss:false});render();
    toast(err.message||'账本保存失败，请重新打开后重试');
    return false;
  }
}

let recoveryRequired=false;
let data = loadData();
let ui = {tab:'home', selectedMonth:monthKey(new Date()), recordFilter:'all',day:localISO(),dayOnly:false};
let storageProtection = {supported:!!(navigator.storage?.persist && navigator.storage?.persisted), checked:false, persisted:false};
function uid(prefix='id'){ return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
function pad(n){ return String(n).padStart(2,'0'); }
function monthKey(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
function parseMonth(m){ const [y,mo]=m.split('-').map(Number); return {y,mo}; }
function monthLabel(m){ const {y,mo}=parseMonth(m); return `${y}年${mo}月`; }
function isCurrentMonth(m){ return m===monthKey(new Date()); }
function defaultTransactionDateForSelectedMonth(){
  const today=localISO();
  return ui.day<=today?ui.day:today;
}
function amount(n){ return `¥${Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function pct(n){ return `${Math.round(Math.max(0,n)*100)}%`; }
function escapeHTML(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function icon(name, cls=''){ return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.more}</svg>`; }
function categoryColor(value){
  return typeof value==='string'&&CSS.supports('color',value)?value:'#9AA09A';
}
function tint(hex, alpha=.16){
  const h=/^#[0-9a-f]{6}$/i.test(hex)?hex.slice(1):'9AA09A'; const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
const monthTxCache=new Map();
const balanceCache={revision:-1,day:'',value:0};
function txForMonth(m){
  const cached=monthTxCache.get(m);
  if(cached&&cached.revision===dataRevision)return cached.value;
  const value=transactionsForMonth(data,m);
  monthTxCache.set(m,{revision:dataRevision,value});
  return value;
}
function budgetFor(m){ return monthlyBudget(data,m,txForMonth(m)).budget; }
function currentBalance(){
  const today=localISO();
  if(balanceCache.revision===dataRevision&&balanceCache.day===today)return balanceCache.value;
  const value=currentBalanceFor(data,today);
  balanceCache.revision=dataRevision;balanceCache.day=today;balanceCache.value=value;
  return value;
}
function hasInitialBalance(){ return data.prefs?.initialBalance !== null && data.prefs?.initialBalance !== undefined; }
function categoryById(id){ return data.categories.find(c=>c.id===id); }
const dateDisplay=displayDay;
function weekday(iso){ return ['周日','周一','周二','周三','周四','周五','周六'][new Date(`${iso}T12:00:00`).getDay()]; }
function txSnapshotCategory(t){
  const c=categoryById(t.categoryId);
  return {name:t.categoryName||c?.name||'其他', icon:t.categoryIcon||c?.icon||'more', color:t.categoryColor||c?.color||'#9AA09A'};
}

function txRow(t, swipe=false){
  const c=txSnapshotCategory(t);
  const sign=t.type==='expense'?'-':'+';
  const cls=t.type==='expense'?'':'positive';
  const fallbackDate=(typeof t.date==='string'&&t.date)?dateDisplay(t.date):'未标日期';
  const row=`<div class="tx-row tx-row-interactive" data-open-tx="${escapeHTML(t.id||'')}" role="button" tabindex="0">
    <div class="category-symbol" style="color:${escapeHTML(categoryColor(c.color))};background:${tint(c.color)}">${icon(c.icon)}</div>
    <div class="tx-main"><div class="tx-title">${escapeHTML(c.name)}${t.type==='income'&&t.budgetSync?'<span class="tx-budget-badge">预算+</span>':''}${t.type==='expense'&&t.budgetExcluded===true?'<span class="tx-budget-badge excluded">预算外</span>':''}</div><div class="tx-sub">${escapeHTML(t.note||fallbackDate)}</div></div>
    <div><div class="tx-money ${cls}">${sign}${amount(t.amount)}</div><div class="tx-time">${escapeHTML(normalizeClock(t.time))}</div></div>
  </div>`;
  if(!swipe) return row;
  return `<div class="tx-swipe" data-swipe-tx="${escapeHTML(t.id||'')}"><button class="tx-delete-action" data-delete-tx="${escapeHTML(t.id||'')}" type="button">删除</button>${row}</div>`;
}

function budgetMetrics(m){ return monthlyMetrics(data,m,localISO(),txForMonth(m)); }
function refreshStorageProtectionUI(){
  const el=document.querySelector('[data-action="storage-persist"] .setting-sub');
  if(!el)return;
  const p=storageProtectionStatus();
  el.className=`setting-sub ${p.cls}`;
  el.textContent=p.label;
}

function storageProtectionStatus(){
  if(!storageProtection.supported) return {label:'当前环境不支持', cls:'muted'};
  if(!storageProtection.checked) return {label:'正在检查…', cls:'muted'};
  return storageProtection.persisted
    ? {label:'已启用持久化存储', cls:'positive'}
    : {label:'未启用，系统仍可能回收本地数据', cls:'negative'};
}

async function ensurePersistentStorage(showToast=false){
  if(!storageProtection.supported){
    storageProtection.checked=true;
    refreshStorageProtectionUI();
    if(showToast) toast('当前浏览器不支持持久化存储申请');
    return false;
  }
  try{
    let persisted=await navigator.storage.persisted();
    if(!persisted) persisted=await navigator.storage.persist();
    storageProtection.persisted=!!persisted;
    storageProtection.checked=true;
    refreshStorageProtectionUI();
    if(showToast) toast(persisted?'本地数据保护已启用':'系统暂未授予持久化存储');
    return !!persisted;
  }catch(err){
    console.warn('Persistent storage request failed', err);
    storageProtection.persisted=false;
    storageProtection.checked=true;
    refreshStorageProtectionUI();
    if(showToast) toast('持久化存储检查失败');
    return false;
  }
}

function render(){
  writeFinanceDay(ui.day);
  document.querySelectorAll('[data-tab]').forEach(b=>{
    const active=b.dataset.tab===ui.tab;b.classList.toggle('active',active);
    if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
  });
  const app=document.getElementById('app');
  try{
    app.innerHTML = ui.tab==='stats' ? renderStats() : renderHome();
  }catch(err){
    console.error('Airplane view render failed',err);
    app.innerHTML=`<section class="card recover-card"><div class="empty-icon">${icon('plane')}</div><h3>页面暂时没有正常显示</h3><p>你的本地账本没有被删除。请关闭 Airplane 后重新打开；若仍然出现，可继续使用设置中的完整备份。</p><button class="secondary-button" id="retryRender" type="button">重新加载页面</button></section>`;
    document.getElementById('retryRender')?.addEventListener('click',()=>window.location.reload());
  }
  hydrateIcons();
  bindViewEvents();
}

function balanceCard(){
  const balance=currentBalance();
  return `<section class="card balance-card">
    <div class="budget-top"><div><div class="eyebrow">当前总余额</div><div class="balance-value ${balance<0?'negative':''}">${amount(balance)}</div></div><button class="text-button" data-action="balance">${hasInitialBalance()?'调整':'设置'}</button></div>
    <div class="helper balance-note">按全部收入与支出计算</div>
  </section>`;
}

function renderHome(){
  const m=budgetMetrics(ui.selectedMonth), current=isCurrentMonth(ui.selectedMonth);
  const ledger=renderLedgerSection();
  if(!m.budget){
    return `<div class="stack month-swipe-view" data-month-swipe-view="home">
      ${balanceCard()}
      <section class="card hero empty budget-empty">
        <div class="empty-icon">${icon('wallet')}</div>
        <h3>先设置${current?'本月':'这个月'}预算</h3>
        <p>预算由你每个月单独填写。设置后 Airplane 会根据此前实际支出动态计算每天的控制额度。</p>
        <button class="primary-button" data-action="budget">设置${current?'本月':'该月'}预算</button>
      </section>
      ${ledger}
    </div>`;
  }
  const planText = m.future ? '月份尚未开始' : (m.delta>0 ? `多支出 ${amount(m.delta)}` : `节省 ${amount(Math.abs(m.delta))}`);
  const planClass = m.future ? 'muted' : (m.delta>0 ? 'negative' : 'positive');
  const planLabel = m.current ? '当前较计划' : (m.future ? '计划状态' : '最终较计划');
  const useRatio = current ? (m.dailyLimit>0 ? m.todayExpense/m.dailyLimit : (m.todayExpense>0?1:0)) : m.budgetProgress;
  const remainingToday=Math.max(m.dailyLimit-m.todayExpense,0);
  const overToday=Math.max(m.todayExpense-m.dailyLimit,0);
  const rightLabel=current ? (overToday>0?'今日已超支':'今日还可支出') : '剩余预算';
  const rightValue=current ? (overToday>0?overToday:remainingToday) : m.remainingBudget;
  const rightClass=current&&overToday>0?'negative':(current?'positive':(m.remainingBudget<0?'negative':''));
  return `<div class="stack month-swipe-view" data-month-swipe-view="home">
    ${balanceCard()}
    <section class="card hero daily-card">
      <div class="eyebrow">${current?'今日不宜超过':'当月日均预算'}</div>
      <div class="big-money"><small>¥</small>${m.dailyLimit.toFixed(2)}</div>
      <div class="metric-grid daily-metrics">
        <div class="metric"><div class="metric-label">${current?'今日预算支出':'当月预算支出'}</div><div class="metric-value">${amount(current?m.todayExpense:m.budgetExpense)}</div></div>
        <div class="metric"><div class="metric-label">${rightLabel}</div><div class="metric-value ${rightClass}">${amount(rightValue)}</div></div>
      </div>
      ${current&&m.todayExcludedExpense>0?`<div class="helper" style="margin-top:9px">今日预算外 ${amount(m.todayExcludedExpense)}</div>`:''}
      <div class="progress-row"><div class="progress-meta"><span>${current?'今日额度使用':'预算使用'}</span><span>${pct(useRatio)}</span></div><div class="progress ${current&&overToday>0?'danger':''}"><span style="width:${Math.min(useRatio*100,100)}%"></span></div></div>
    </section>

    <section class="card budget-card">
      <div class="budget-top"><div><div class="eyebrow">月预算</div><div class="budget-amount">${amount(m.budgetExpense)} <span class="of">/ ${amount(m.budget)}</span></div>${m.syncBudget>0?`<div class="helper budget-sync-note budget-sync-line">基础 ${amount(m.baseBudget)} · 收入同步 +${amount(m.syncBudget)}</div>`:''}${m.excludedExpense>0?`<div class="helper budget-sync-note budget-expense-line">总支出 ${amount(m.expense)} · 预算外 ${amount(m.excludedExpense)}</div>`:''}</div><button class="text-button" data-action="budget">编辑</button></div>
      <div class="progress-row"><div class="progress-meta"><span>预算使用 ${pct(m.budgetProgress)}</span><span>时间进度 ${pct(m.timeProgress)}</span></div><div class="progress ${m.budgetProgress>m.timeProgress?'danger':''}"><span style="width:${Math.min(m.budgetProgress*100,100)}%"></span></div></div>
      <div class="plan-grid">
        <div class="plan-tile"><div class="metric-label">${planLabel}</div><strong class="${planClass}">${planText}</strong></div>
        <div class="plan-tile"><div class="metric-label">剩余预算</div><strong class="${m.remainingBudget<0?'negative':''}">${amount(m.remainingBudget)}</strong></div>
      </div>
    </section>
    ${ledger}
  </div>`;
}

function renderLedgerSection(){
  let tx=[...txForMonth(ui.selectedMonth)];
  if(ui.dayOnly)tx=tx.filter(t=>t.date===ui.day);
  if(ui.recordFilter!=='all') tx=tx.filter(t=>t.type===ui.recordFilter);
  tx.sort((a,b)=>(b.date+normalizeClock(b.time)).localeCompare(a.date+normalizeClock(a.time)));
  const groups=Object.groupBy ? Object.groupBy(tx,t=>t.date) : tx.reduce((g,t)=>((g[t.date]??=[]).push(t),g),{});
  const body=Object.keys(groups).sort().reverse().map(date=>{
    const rows=groups[date];
    const expense=rows.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount||0),0);
    const income=rows.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount||0),0);
    let summary=''; let cls='muted';
    if(ui.recordFilter==='expense'){summary=`-${amount(expense)}`;cls='negative';}
    else if(ui.recordFilter==='income'){summary=`+${amount(income)}`;cls='positive';}
    else if(income||expense){const net=income-expense;summary=`${net>=0?'+':'-'}${amount(Math.abs(net))}`;cls=net>=0?'positive':'negative';}
    return `<div class="day-group"><div class="day-head"><span>${dateDisplay(date)} ${weekday(date)}</span><span class="${cls}">${summary}</span></div><section class="card transaction-list">${rows.map(t=>txRow(t,true)).join('')}</section></div>`;
  }).join('');
  return `<section class="ledger-section">
    <div class="section-head ledger-head"><h2>账单</h2><button class="text-button" data-action="choose-month" aria-label="选择月份">${monthLabel(ui.selectedMonth)} ${icon('chevron')}</button></div>
    <div class="filters ledger-filters">${ui.dayOnly?'<button class="filter" data-action="show-month">查看整月</button>':''}<button class="filter ${ui.recordFilter==='all'?'active':''}" data-filter="all">全部</button><button class="filter ${ui.recordFilter==='income'?'active':''}" data-filter="income">收入</button><button class="filter ${ui.recordFilter==='expense'?'active':''}" data-filter="expense">支出</button></div>
    ${body||`<section class="card empty"><div class="empty-icon">${icon('list')}</div><h3>这里还没有${ui.recordFilter==='income'?'收入':ui.recordFilter==='expense'?'支出':'账单'}记录</h3><p>点击下方绿色 ＋ 记下第一笔。</p></section>`}
  </section>`;
}

function renderStats(){
  const m=budgetMetrics(ui.selectedMonth), tx=txForMonth(ui.selectedMonth), expenses=tx.filter(t=>t.type==='expense');
  const grouped={}; expenses.forEach(t=>{
    const snapshot=txSnapshotCategory(t);
    const current=t.categoryId?categoryById(t.categoryId):null;
    const key=t.categoryId?`id:${t.categoryId}`:`legacy:${snapshot.name}`;
    grouped[key]??={value:0,name:current?.name||snapshot.name,color:current?.color||snapshot.color};
    grouped[key].value+=Number(t.amount);
  });
  const rawParts=Object.values(grouped).sort((a,b)=>b.value-a.value);
  const parts=rawParts.length>6
    ? [...rawParts.slice(0,5),{name:'其他',color:'#9AA09A',value:rawParts.slice(5).reduce((sum,item)=>sum+item.value,0)}]
    : rawParts;
  let start=0;
  const gradient = parts.length ? parts.map(v=>{const deg=m.expense? v.value/m.expense*360:0; const seg=`${categoryColor(v.color)} ${start}deg ${start+deg}deg`; start+=deg; return seg;}).join(',') : '#e8ebe7 0 360deg';
  const dayValues=Array(daysInMonth(ui.selectedMonth)).fill(0); expenses.forEach(t=>{dayValues[Number(t.date.slice(-2))-1]+=Number(t.amount);});
  const max=Math.max(...dayValues,1); const nowDay=isCurrentMonth(ui.selectedMonth)?new Date().getDate():-1;
  const legend=parts.map(v=>`<div class="legend-row"><span class="legend-dot" style="background:${escapeHTML(categoryColor(v.color))}"></span><span>${escapeHTML(v.name)}</span><span class="legend-value">${m.expense?pct(v.value/m.expense):'0%'}</span></div>`).join('');
  let budgetResult='';
  if(m.budget){
    if(m.current){
      budgetResult=`<section class="card"><div class="eyebrow">按当前消费速度</div><div class="budget-amount">预计日常预算支出 ${amount(m.projection)}</div><div class="helper" style="margin-top:8px">预算 ${amount(m.budget)} · ${m.projection>m.budget?`按当前节奏可能超出 ${amount(m.projection-m.budget)}`:`按当前节奏预计剩余 ${amount(m.budget-m.projection)}`}${m.excludedExpense>0?` · 另有预算外 ${amount(m.excludedExpense)}`:''}</div></section>`;
    }else if(m.past){
      const diff=m.budgetExpense-m.budget;
      budgetResult=`<section class="card"><div class="eyebrow">本月最终结果</div><div class="budget-amount">最终日常预算支出 ${amount(m.budgetExpense)}</div><div class="helper" style="margin-top:8px">预算 ${amount(m.budget)} · ${diff>0?`最终超出 ${amount(diff)}`:`最终节省 ${amount(Math.abs(diff))}`}${m.excludedExpense>0?` · 另有预算外 ${amount(m.excludedExpense)}`:''}</div></section>`;
    }else{
      budgetResult=`<section class="card"><div class="eyebrow">计划状态</div><div class="budget-amount">月份尚未开始</div><div class="helper" style="margin-top:8px">已设置预算 ${amount(m.budget)}</div></section>`;
    }
  }
  return `<div class="stack month-swipe-view" data-month-swipe-view="stats"><div class="section-head"><h2>统计</h2><button class="text-button" data-action="choose-month" aria-label="选择月份">${monthLabel(ui.selectedMonth)} ${icon('chevron')}</button></div>
    <div class="summary-grid"><div class="summary-card"><small>收入</small><strong class="positive">${amount(m.income)}</strong></div><div class="summary-card"><small>总支出</small><strong class="negative">${amount(m.expense)}</strong></div><div class="summary-card"><small>日常预算支出</small><strong>${amount(m.budgetExpense)}</strong></div><div class="summary-card"><small>结余</small><strong>${amount(m.income-m.expense)}</strong></div></div>
    <section class="card chart-card"><h3>支出分类</h3>${expenses.length?`<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${escapeHTML(gradient)})"></div><div class="legend">${legend}</div></div>`:`<div class="empty"><p>有支出记录后显示分类占比。</p></div>`}</section>
    <section class="card chart-card"><h3>每日支出趋势</h3><div class="bars">${dayValues.map((v,i)=>`<button class="bar ${i+1===nowDay?'today':''}" data-day-bar="${i+1}" data-day-value="${v}" style="height:${Math.max(v/max*100,v?3:0)}%" type="button" aria-label="${displayDay(ui.selectedMonth+'-'+pad(i+1))}支出 ${amount(v)}"></button>`).join('')}</div><div class="chart-axis"><span>1日</span><span>${Math.ceil(dayValues.length/2)}日</span><span>${dayValues.length}日</span></div><div class="bar-detail" id="barDetail">点按柱子查看当天金额</div></section>
    ${budgetResult}
  </div>`;
}

function settingsContent(){
  const b=budgetFor(ui.selectedMonth);
  const protection=storageProtectionStatus();
  return `<div class="stack settings-stack">
    <section class="card settings-section">
      <button class="setting-row" data-action="balance"><span class="mini-icon">${icon('wallet')}</span><span class="setting-copy"><span class="setting-title">当前总余额</span><span class="setting-sub">${hasInitialBalance()?amount(currentBalance()):'未设置初始余额'}</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="balance-history"><span class="mini-icon">${icon('refund')}</span><span class="setting-copy"><span class="setting-title">余额调整记录</span><span class="setting-sub">${(data.balanceAdjustments||[]).length?`${data.balanceAdjustments.length} 次调整`:'暂无调整'}</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="budget"><span class="mini-icon">${icon('calendar')}</span><span class="setting-copy"><span class="setting-title">月预算</span><span class="setting-sub">${monthLabel(ui.selectedMonth)} · ${b?amount(b):'未设置'}</span></span><span class="chevron">${icon('chevron')}</span></button>
    </section>
    <div class="section-head"><h2>数据</h2></div>
    <section class="card settings-section">
      <button class="setting-row" data-action="export-json"><span class="mini-icon">${icon('download')}</span><span class="setting-copy"><span class="setting-title">完整备份</span><span class="setting-sub">导出 JSON，可完整恢复预算、分类和账单</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="export-csv"><span class="mini-icon">${icon('file')}</span><span class="setting-copy"><span class="setting-title">导出明细 CSV</span><span class="setting-sub">方便在 Excel / Numbers 中查看</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="import"><span class="mini-icon">${icon('upload')}</span><span class="setting-copy"><span class="setting-title">恢复备份</span><span class="setting-sub">严格校验 Airplane JSON，恢复前自动留存当前快照</span></span><span class="chevron">${icon('chevron')}</span></button>
      ${financeStore.getItem(PRE_RESTORE_KEY)?`<button class="setting-row" data-action="restore-pre-snapshot"><span class="mini-icon">${icon('refund')}</span><span class="setting-copy"><span class="setting-title">恢复前快照</span><span class="setting-sub">找回最近一次导入备份前的本机账本</span></span><span class="chevron">${icon('chevron')}</span></button>`:''}
    </section>
    <div class="section-head"><h2>安装与保护</h2></div>
    <section class="card settings-section">
      <button class="setting-row" data-action="storage-persist"><span class="mini-icon">${icon('shield')}</span><span class="setting-copy"><span class="setting-title">本地数据保护</span><span class="setting-sub ${protection.cls}">${protection.label}</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="check-update"><span class="mini-icon">${icon('download')}</span><span class="setting-copy"><span class="setting-title">程序更新</span><span class="setting-sub">当前 ${APP_VERSION} · 启动优先本地，可在这里手动检查</span></span><span class="chevron">${icon('chevron')}</span></button>
      <a class="setting-row" href="./assistant/${window.airplaneAccount.demo?'?demo=1':''}#api-key"><span class="mini-icon">${icon('sparkles')}</span><span class="setting-copy"><span class="setting-title">管理 API Key</span><span class="setting-sub">使用自己的 OpenAI Key</span></span><span class="chevron">${icon('chevron')}</span></a>
    </section>
    <section class="card"><div class="helper">主屏幕 Airplane 与 Safari 网页在 iOS 上属于不同的本地数据空间。长期使用请固定从主屏幕 Airplane 进入；程序更新只替换程序文件，不会重建余额、预算、分类或账单。人为清除网站数据、删除 App 或换手机前仍请先做“完整备份”。</div></section>
    <button class="danger-button" data-action="reset">清空本机全部数据</button>
  </div>`;
}

function openSettingsModal(){
  openModal(`${modalHead('设置',null,'关闭')}<div class="settings-modal-body">${settingsContent()}</div>`);
  bindSettingsEvents();
}

function bindSettingsEvents(){
  document.querySelectorAll('[data-action="budget"]').forEach(b=>b.onclick=()=>openBudgetModal());
  document.querySelectorAll('[data-action="balance"]').forEach(b=>b.onclick=()=>openBalanceModal());
  document.querySelector('[data-action="balance-history"]')?.addEventListener('click',openBalanceHistoryModal);
  document.querySelector('[data-action="export-json"]')?.addEventListener('click',exportJSON);
  document.querySelector('[data-action="export-csv"]')?.addEventListener('click',exportCSV);
  document.querySelector('[data-action="import"]')?.addEventListener('click',()=>document.getElementById('importInput').click());
  document.querySelector('[data-action="restore-pre-snapshot"]')?.addEventListener('click',restorePreRestoreSnapshot);
  document.querySelector('[data-action="storage-persist"]')?.addEventListener('click',()=>ensurePersistentStorage(true));
  bindUpdateCheck(document.querySelector('[data-action="check-update"]'));
  document.querySelector('[data-action="reset"]')?.addEventListener('click',resetAll);
}

function bindViewEvents(){
  document.querySelector('[data-action="choose-month"]')?.addEventListener('click',openMonthModal);
  document.querySelector('[data-action="show-month"]')?.addEventListener('click',()=>{ui.dayOnly=false;render();});
  document.querySelectorAll('[data-action="budget"]').forEach(b=>b.onclick=()=>openBudgetModal());
  document.querySelectorAll('[data-action="balance"]').forEach(b=>b.onclick=()=>openBalanceModal());
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{ui.recordFilter=b.dataset.filter;render();});
  document.querySelectorAll('[data-open-tx]').forEach(row=>{
    const open=()=>openTransactionModal(data.transactions.find(t=>t.id===row.dataset.openTx));
    row.addEventListener('click',()=>{if(row.dataset.suppressClick!=='1') open(); row.dataset.suppressClick='0';});
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  });
  document.querySelectorAll('[data-delete-tx]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteTransaction(b.dataset.deleteTx);});
  document.querySelectorAll('[data-day-bar]').forEach(bar=>bar.addEventListener('click',()=>{
    const detail=document.getElementById('barDetail');if(!detail)return;
    document.querySelectorAll('[data-day-bar]').forEach(b=>b.classList.toggle('selected',b===bar));
    detail.textContent=`${displayDay(ui.selectedMonth+'-'+pad(bar.dataset.dayBar))} · ${amount(Number(bar.dataset.dayValue||0))}`;
  }));
  bindTransactionSwipes();
  bindMonthSwipe();
}
function hydrateIcons(){
  document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
}

let modalDismissHandler=null;
let modalBeforeDismissHandler=null;
let activeUndo=null;
let modalBodyLocked=false;
let modalScrollY=0;

function lockPageForModal(){
  if(modalBodyLocked) return;
  modalBodyLocked=true;
  modalScrollY=window.scrollY||0;
  document.body.classList.add('modal-open');
  document.body.style.top=`-${modalScrollY}px`;
}
function unlockPageForModal(){
  if(!modalBodyLocked) return;
  modalBodyLocked=false;
  document.body.classList.remove('modal-open');
  document.body.style.top='';
  window.scrollTo(0,modalScrollY);
}

function openModal(content, options={}){
  const root=document.getElementById('modalRoot');
  modalDismissHandler=options.onDismiss||null;
  modalBeforeDismissHandler=options.beforeDismiss||null;
  lockPageForModal();
  root.innerHTML=`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-grabber" aria-label="下拉关闭"></div>${content}</div></div>`;
  syncCalendarFields(root);
  const backdrop=root.querySelector('.modal-backdrop');
  const modal=root.querySelector('.modal');
  root.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal({reason:'cancel'}));
  bindSheetSwipe(modal,backdrop,reason=>closeModal({reason}));
}
async function closeModal({runDismiss=true,reason='dismiss'}={}){
  const root=document.getElementById('modalRoot');
  const before=modalBeforeDismissHandler;
  const sheet=root.firstElementChild;
  if(runDismiss&&before&&await before(reason)===false)return false;
  if(root.firstElementChild!==sheet)return false;
  const cb=modalDismissHandler;
  modalDismissHandler=null;
  modalBeforeDismissHandler=null;
  root.innerHTML='';
  unlockPageForModal();
  if(runDismiss&&cb) cb(reason);
  return true;
}
function modalHead(title,saveLabel='保存',cancelLabel='取消'){ const right=saveLabel===null?'<span></span>':`<button class="save" id="modalSave">${saveLabel}</button>`; return `<div class="modal-head"><button class="cancel" data-close>${cancelLabel}</button><h2>${title}</h2>${right}</div>`; }

function openMonthModal(){
  let {y,mo}=parseMonth(ui.selectedMonth);
  const draw=()=>{
    openModal(`${modalHead('选择月份','完成')}<section class="card month-picker-card"><div class="month-year-nav"><button id="pickerPrevYear" class="month-year-step" type="button" aria-label="上一年">${icon('chevron')}</button><strong id="pickerYear">${y}年</strong><button id="pickerNextYear" class="month-year-step" type="button" aria-label="下一年">${icon('chevron')}</button></div><div class="month-grid" id="monthGrid">${Array.from({length:12},(_,i)=>`<button class="month-cell ${i+1===mo?'selected':''}" data-month-value="${i+1}" type="button"><span>${i+1}</span><small>月</small></button>`).join('')}</div><button class="secondary-button month-current" id="pickerCurrentMonth" type="button">回到本月</button></section>`);
    document.getElementById('pickerPrevYear').onclick=()=>{y--;draw();};
    document.getElementById('pickerNextYear').onclick=()=>{y++;draw();};
    document.querySelectorAll('[data-month-value]').forEach(b=>b.onclick=()=>{mo=Number(b.dataset.monthValue);draw();});
    document.getElementById('pickerCurrentMonth').onclick=()=>{const n=new Date();y=n.getFullYear();mo=n.getMonth()+1;draw();};
    document.getElementById('modalSave').onclick=()=>{selectMonth(`${y}-${pad(mo)}`);closeModal({runDismiss:false});render();window.scrollTo({top:0,behavior:'smooth'});};
  };
  draw();
}
function selectMonth(month){
  ui.selectedMonth=month;
  ui.day=isCurrentMonth(month)?localISO():month+'-'+pad(Math.min(new Date().getDate(),daysInMonth(month)));
  ui.dayOnly=false;
}
function shiftMonth(delta,{smooth=true}={}){
  const {y,mo}=parseMonth(ui.selectedMonth);const d=new Date(y,mo-1+delta,1);selectMonth(monthKey(d));render();window.scrollTo({top:0,behavior:smooth?'smooth':'auto'});
}
function bindMonthSwipe(){
  const view=document.querySelector('[data-month-swipe-view]');if(!view)return;
  let startX=0,startY=0,lastX=0,tracking=false,horizontal=false;
  const blocked=target=>{if(target?.closest?.('.bar'))return false;return !!target?.closest?.('button,input,textarea,select,a,.tx-swipe,.drag-handle');};
  view.addEventListener('touchstart',e=>{
    if(e.touches.length!==1||blocked(e.target))return;
    const t=e.touches[0];startX=lastX=t.clientX;startY=t.clientY;tracking=true;horizontal=false;
  },{passive:true});
  view.addEventListener('touchmove',e=>{
    if(!tracking||e.touches.length!==1)return;
    const t=e.touches[0],dx=t.clientX-startX,dy=t.clientY-startY;lastX=t.clientX;
    if(!horizontal){
      if(Math.abs(dx)<12)return;
      if(Math.abs(dx)<=Math.abs(dy)*1.25){tracking=false;return;}
      horizontal=true;
    }
    e.preventDefault();
    const offset=Math.max(-30,Math.min(30,dx*.18));
    view.style.transition='none';view.style.transform=`translateX(${offset}px)`;view.style.opacity=String(Math.max(.92,1-Math.abs(offset)/240));
  },{passive:false});
  const finish=()=>{
    if(!tracking)return;
    const dx=lastX-startX;tracking=false;
    if(horizontal&&Math.abs(dx)>56){shiftMonth(dx<0?1:-1,{smooth:false});return;}
    view.style.transition='transform .16s ease-out, opacity .16s ease-out';view.style.transform='';view.style.opacity='';
    setTimeout(()=>{view.style.transition='';},170);
  };
  view.addEventListener('touchend',finish,{passive:true});
  view.addEventListener('touchcancel',finish,{passive:true});
}

function openBudgetModal(){
  const {syncBudget,budget:existing}=monthlyBudget(data,ui.selectedMonth,txForMonth(ui.selectedMonth));
  openModal(`${modalHead('月预算')}<section class="card input-card"><label>${monthLabel(ui.selectedMonth)}总支出预算</label>${moneyInputMarkup('budgetInput',existing||'','例如 2000','budget-op')}<div class="helper">支持 + − × ÷。${syncBudget>0?`当前总预算中有 ${amount(syncBudget)} 来自“收入同步增加预算”；这里编辑的是总预算，保存时会自动保留这部分收入加成。`:'每个月可以单独设置和修改。收入默认开启“同步增加预算”，单笔不需要同步时可以关闭。'} 当前月的普通预算会按剩余天数动态分配；当天同步增加的收入会完整加到当天额度，不在当天摊给后续日期。</div></section>`);
  const readValue=bindMoneyExpressionInput('budgetInput','budget-op');
  document.getElementById('modalSave').onclick=()=>{const parsed=readValue(),v=parsed.value;if(!parsed.ok||v<=0){toast('预算需要大于 0');return;}if(v+0.005<syncBudget){toast(`总预算不能低于已同步增加的 ${amount(syncBudget)}`);return;}data.budgets[ui.selectedMonth]=Math.max(0,Math.round((v-syncBudget)*100)/100);if(!saveData())return;closeModal({runDismiss:false});render();toast('月预算已保存');};
}

function openBalanceModal(){
  const initialized=hasInitialBalance();
  const current=currentBalance();
  if(!initialized){
    openModal(`${modalHead('设置初始余额')}<section class="card input-card"><label>开始使用 Airplane 时已有的总余额</label>${moneyInputMarkup('balanceInput','','例如 10000','balance-op')}<div class="helper">支持 + − × ÷。初始余额只用于建立起点。之后收入会增加余额、支出会减少余额；两者都不会改变你手动设置的月预算。</div></section>`);
    const readValue=bindMoneyExpressionInput('balanceInput','balance-op');
    document.getElementById('modalSave').onclick=()=>{const parsed=readValue(),v=parsed.value;if(!parsed.ok){toast('请输入有效余额或算式');return;}data.prefs.initialBalance=Math.round(v*100)/100;if(!saveData())return;closeModal({runDismiss:false});render();toast('初始余额已保存');};
    return;
  }
  openModal(`${modalHead('调整当前总余额')}<section class="card input-card"><label>Airplane 当前总余额</label><div class="budget-amount">${amount(current)}</div><label style="margin-top:8px">调整为</label>${moneyInputMarkup('balanceInput',current.toFixed(2),'例如 10000','balance-op')}<div class="helper">支持 + − × ÷。适合补记遗漏造成的余额偏差。余额调整不计入收入、支出，也不会占用月预算。</div></section>`);
  const readValue=bindMoneyExpressionInput('balanceInput','balance-op');
  document.getElementById('modalSave').onclick=()=>{const parsed=readValue(),target=parsed.value;if(!parsed.ok){toast('请输入有效余额或算式');return;}const delta=Math.round((target-current)*100)/100;if(Math.abs(delta)>=0.01)data.balanceAdjustments.push({id:uid('bal'),delta,targetBalance:Math.round(target*100)/100,createdAt:new Date().toISOString()});if(!saveData())return;closeModal({runDismiss:false});render();toast(Math.abs(delta)>=0.01?'当前总余额已调整':'余额没有变化');};
}

function openBalanceHistoryModal(){
  const rows=(data.balanceAdjustments||[]).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  openModal(`${modalHead('余额调整记录','完成')}<div id="balanceHistoryBody"></div>`);
  const draw=()=>{
    const body=document.getElementById('balanceHistoryBody');if(!body)return;
    const items=(data.balanceAdjustments||[]).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    body.innerHTML=items.length?`<section class="card balance-history-list">${items.map(a=>{
      const delta=Number(a.delta||0);let when='时间未知';
      const stamp=new Date(a.createdAt);
      if(Number.isFinite(stamp.getTime()))when=displayDay(localISO(stamp))+' '+localClock(stamp);
      return `<div class="balance-history-row"><div><strong class="${delta>=0?'positive':'negative'}">${delta>=0?'+':'-'}${amount(Math.abs(delta))}</strong><small>${escapeHTML(when)}${Number.isFinite(Number(a.targetBalance))?` · 调整后 ${amount(a.targetBalance)}`:''}</small></div><button class="history-delete" data-delete-balance="${escapeHTML(a.id||'')}" type="button" aria-label="删除这次余额调整">${icon('trash')}</button></div>`;
    }).join('')}</section><div class="helper balance-history-help">删除一次调整会同步改变当前总余额，但不会影响收入、支出和月预算。</div>`:`<section class="card empty"><div class="empty-icon">${icon('refund')}</div><h3>暂无余额调整</h3><p>以后通过“调整当前余额”产生的修正会记录在这里。</p></section>`;
    body.querySelectorAll('[data-delete-balance]').forEach(button=>button.onclick=async()=>{
      const id=button.dataset.deleteBalance,index=data.balanceAdjustments.findIndex(a=>a.id===id);if(index<0)return;
      const removed=data.balanceAdjustments[index];
      if(!await confirmAction({title:'删除余额调整',message:`删除这次 ${Number(removed.delta||0)>=0?'增加':'减少'} ${amount(Math.abs(Number(removed.delta||0)))} 的余额调整？`,action:'确认删除',danger:true}))return;
      data.balanceAdjustments.splice(index,1);if(!saveData())return;render();draw();toast('余额调整已删除',{actionLabel:'撤销',duration:3600,onAction:()=>{data.balanceAdjustments.splice(Math.min(index,data.balanceAdjustments.length),0,removed);if(!saveData())return;render();draw();toast('已恢复余额调整');}});
    });
  };
  document.getElementById('modalSave').onclick=()=>closeModal({runDismiss:false});
  draw();
}

function preferredCategoryId(type){
  const saved=type==='expense'?data.prefs.lastExpenseCategoryId:data.prefs.lastIncomeCategoryId;
  const visible=data.categories.filter(c=>c.type===type&&!c.hidden).sort((a,b)=>a.order-b.order);
  return visible.some(c=>c.id===saved)?saved:visible[0]?.id;
}
function loadTransactionDraft(){
  try{
    const d=JSON.parse(financeStore.getItem(DRAFT_KEY)||'null');
    if(!d||!d.savedAt||Date.now()-d.savedAt>DRAFT_TTL_MS){financeStore.removeItem(DRAFT_KEY);return null;}
    return d;
  }catch{financeStore.removeItem(DRAFT_KEY);return null;}
}
function saveTransactionDraft(d){ financeStore.setItem(DRAFT_KEY,JSON.stringify({...d,savedAt:Date.now()})); }
function clearTransactionDraft(){ financeStore.removeItem(DRAFT_KEY); }

function normalizeAmountExpression(raw=''){
  return String(raw)
    .trim()
    .replace(/[，,]/g,'.')
    .replace(/[×xX]/g,'*')
    .replace(/÷/g,'/')
    .replace(/[−–—]/g,'-')
    .replace(/\s+/g,'');
}

// Keep a single operator when a user accidentally types several in a row.
// Preserve *- and /- so negative factors (e.g. 10×-2) still work.
function compactAmountOperators(raw=''){
  return String(raw).replace(/[+\-−–—×xX÷*\/]{2,}/g,sequence=>{
    const normalized=normalizeAmountExpression(sequence);
    if((normalized[0]==='*'||normalized[0]==='/')&&normalized.endsWith('-')) return sequence[0]+sequence.at(-1);
    return sequence.at(-1);
  });
}
function tidyAmountInput(input){
  const before=input.value,after=compactAmountOperators(before);
  if(before===after)return;
  const cursor=input.selectionStart;
  input.value=after;
  if(cursor!==null){
    const newCursor=compactAmountOperators(before.slice(0,cursor)).length;
    try{input.setSelectionRange(newCursor,newCursor);}catch{}
  }
}
// Insert at the explicit caret, or append when the amount field has no caret.
// The pointerdown snapshot also preserves selection on iOS if a tap blurs the input.
function amountCaret(input){
  return document.activeElement===input && input.selectionStart!==null
    ? {start:input.selectionStart,end:input.selectionEnd??input.selectionStart} : null;
}
function insertAmountOperator(input,op,selection=null){
  const raw=input.value,current=compactAmountOperators(raw);
  const start=selection ? compactAmountOperators(raw.slice(0,selection.start)).length : current.length;
  const end=selection ? compactAmountOperators(raw.slice(0,selection.end)).length : current.length;
  // The clicked operator wins over an adjacent operator instead of stacking.
  const left=current.slice(0,start).replace(/[+\-−–—×xX÷*\/]+$/,'');
  const right=current.slice(end).replace(/^[+\-−–—×xX÷*\/]+/,'');
  const hasNumber=/[0-9)]/.test(left+right);
  input.value=hasNumber?left+op+right:(normalizeAmountExpression(op)==='-'?'−':'');
  return hasNumber?left.length+op.length:input.value.length;
}
function bindAmountOperator(button,input,getOperator,onChange){
  let pressedSelection=null;
  button.addEventListener('pointerdown',e=>{
    pressedSelection=amountCaret(input);
    e.preventDefault();
  });
  button.addEventListener('pointercancel',()=>{pressedSelection=null;});
  button.addEventListener('click',()=>{
    const cursor=insertAmountOperator(input,getOperator(),pressedSelection||amountCaret(input));
    pressedSelection=null;
    onChange();
    try{input.focus({preventScroll:true});}catch{input.focus();}
    try{input.setSelectionRange(cursor,cursor);}catch{}
  });
}

// Small local expression parser for the amount field. Deliberately avoids eval().
// Supports +, -, ×/*, ÷// and parentheses while keeping the final ledger amount numeric.
function parseAmountExpression(raw=''){
  // Ignore meaningless leading operators and unfinished trailing operators.
  const expr=compactAmountOperators(normalizeAmountExpression(raw))
    .replace(/^[+*\/]+/,'')
    .replace(/[+\-*\/]+$/,'');
  if(!expr || !/^[0-9+\-*/().]+$/.test(expr)) return {ok:false,value:NaN};
  let i=0;
  const skip=()=>{};
  const parseNumber=()=>{
    const start=i;
    while(i<expr.length && /[0-9.]/.test(expr[i])) i++;
    const token=expr.slice(start,i);
    if(!token || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new Error('number');
    const value=Number(token);
    if(!Number.isFinite(value)) throw new Error('number');
    return value;
  };
  const parseFactor=()=>{
    skip();
    if(expr[i]==='+'){ i++; return parseFactor(); }
    if(expr[i]==='-'){ i++; return -parseFactor(); }
    if(expr[i]==='('){
      i++;
      const value=parseExpression();
      if(expr[i]!==')') throw new Error('paren');
      i++;
      return value;
    }
    return parseNumber();
  };
  const parseTerm=()=>{
    let value=parseFactor();
    while(i<expr.length && (expr[i]==='*' || expr[i]==='/')){
      const op=expr[i++];
      const rhs=parseFactor();
      if(op==='/' && Math.abs(rhs)<1e-12) throw new Error('zero');
      value=op==='*' ? value*rhs : value/rhs;
      if(!Number.isFinite(value)) throw new Error('finite');
    }
    return value;
  };
  const parseExpression=()=>{
    let value=parseTerm();
    while(i<expr.length && (expr[i]==='+' || expr[i]==='-')){
      const op=expr[i++];
      const rhs=parseTerm();
      value=op==='+' ? value+rhs : value-rhs;
      if(!Number.isFinite(value)) throw new Error('finite');
    }
    return value;
  };
  try{
    const value=parseExpression();
    if(i!==expr.length || !Number.isFinite(value)) return {ok:false,value:NaN};
    return {ok:true,value};
  }catch{
    return {ok:false,value:NaN};
  }
}

function moneyOperatorsMarkup(group='money-op'){
  return `<div class="amount-operators compact-operators" aria-label="快捷计算"><button type="button" data-${group}="+">＋</button><button type="button" data-${group}="−">−</button><button type="button" data-${group}="×">×</button><button type="button" data-${group}="÷">÷</button></div>`;
}
function moneyInputMarkup(id,value='',placeholder='例如 2000',group='money-op'){
  return `<input id="${id}" class="large-input" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="${placeholder}" value="${escapeHTML(String(value??''))}"><div id="${id}Preview" class="amount-calc-preview compact-preview" aria-live="polite"></div>${moneyOperatorsMarkup(group)}`;
}
function bindMoneyExpressionInput(inputId,group='money-op'){
  const input=document.getElementById(inputId),preview=document.getElementById(`${inputId}Preview`);
  if(!input)return ()=>({ok:false,value:NaN});
  const update=()=>{
    const raw=input.value||'',normalized=normalizeAmountExpression(raw);
    const hasCalculation=/[+*/]/.test(normalized)||/\d-/.test(normalized);
    const parsed=parseAmountExpression(raw);
    if(!hasCalculation){preview.textContent='';preview.classList.remove('visible','invalid');return parsed;}
    if(parsed.ok){preview.textContent=`= ${amount(parsed.value)}`;preview.classList.add('visible');preview.classList.remove('invalid');}
    else{preview.textContent='继续输入算式';preview.classList.add('visible','invalid');}
    return parsed;
  };
  input.addEventListener('input',()=>{tidyAmountInput(input);update();});input.addEventListener('change',update);
  document.querySelectorAll(`[data-${group}]`).forEach(button=>{
    bindAmountOperator(button,input,()=>button.getAttribute(`data-${group}`)||'',update);
  });
  update();
  return ()=>parseAmountExpression(input.value);
}

function openTransactionModal(existing=null,suppliedDraft=null){
  const restored=suppliedDraft||(!existing?loadTransactionDraft():null);
  let type=restored?.type||existing?.type||'expense';
  let selected=restored?.selectedCategoryId||existing?.categoryId||preferredCategoryId(type);
  let budgetSync=existing?existing.budgetSync===true:(suppliedDraft?.budgetSync??true);
  let budgetExcluded=!!(restored?.budgetExcluded??existing?.budgetExcluded??(type==='expense'&&categoryById(selected)?.budgetExcludedDefault===true));
  const date=restored?.date||existing?.date||defaultTransactionDateForSelectedMonth();
  const defaultTime=date===localISO()?localClock():'';
  const initial={amount:restored?.amount??(existing?Number(existing.amount).toFixed(2):''),date,time:normalizeClock(restored?.time??(existing?existing.time:defaultTime)),note:restored?.note??existing?.note??''};
  let dirty=!!restored;
  const editBaseline=existing?{type:existing.type,selectedCategoryId:existing.categoryId,budgetSync:!!existing.budgetSync,budgetExcluded:existing.budgetExcluded===true,amount:Number(existing.amount),date:existing.date||initial.date,time:normalizeClock(existing.time),note:existing.note??''}:null;
  const captureDraft=()=>({type,selectedCategoryId:selected,budgetSync,budgetExcluded,amount:document.getElementById('txAmount')?.value||'',date:document.getElementById('txDate')?.value||localISO(),time:document.getElementById('txTime')?.value??'',note:document.getElementById('txNote')?.value||''});
  const persistDraft=()=>{if(!existing&&!suppliedDraft?.purchaseId&&dirty)saveTransactionDraft(captureDraft());};
  openModal(`${modalHead(existing?'编辑记录':'记一笔',null)}<div class="segmented"><button id="expenseTab" class="expense">支出</button><button id="incomeTab" class="income">收入</button></div><div class="amount-box"><div class="amount-line"><span>¥</span><input id="txAmount" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.00" value="${escapeHTML(initial.amount)}"></div><div id="amountCalcPreview" class="amount-calc-preview" aria-live="polite"></div><div class="amount-operators" aria-label="金额快捷计算"><button type="button" data-amount-op="+">＋</button><button type="button" data-amount-op="−">−</button><button type="button" data-amount-op="×">×</button><button type="button" data-amount-op="÷">÷</button></div></div><div class="section-head"><h2>选择分类</h2><button class="text-button organize-categories" id="quickAddCategory">整理分类</button></div><div id="categoryChooser" class="category-grid"></div><button id="budgetSyncToggle" class="budget-sync-toggle" type="button" role="switch" aria-checked="${budgetSync?'true':'false'}"><span><strong>同步增加预算</strong><small>这笔收入会增加本月预算，并完整加到记账当天的可支出额度</small></span><span class="toggle-switch" aria-hidden="true"><i></i></span></button><button id="budgetIncludeToggle" class="budget-sync-toggle ${budgetExcluded?'':'active'}" type="button" role="switch" aria-checked="${budgetExcluded?'false':'true'}"><span><strong>计入日常预算</strong><small>关闭后仍计入总支出并减少余额，但不占用月预算和每日额度</small></span><span class="toggle-switch" aria-hidden="true"><i></i></span></button><button id="txSubmit" class="primary-button transaction-submit">${existing?'保存修改':'完成'}</button><div class="optional-details-label">可选信息</div><div class="form-card transaction-date-card"><div class="form-row"><label for="txDate">日期</label><input id="txDate" type="date" max="${localISO()}" value="${escapeHTML(initial.date)}"></div></div><div class="form-card transaction-optional-card"><div class="form-row"><label for="txTime">时间</label><input id="txTime" type="time" value="${escapeHTML(initial.time)}"></div><div class="form-row"><label>备注</label><textarea id="txNote" placeholder="可选">${escapeHTML(initial.note)}</textarea></div></div>${existing?'<button id="txDelete" class="danger-button" style="margin-top:10px">删除这笔记录</button>':''}`,{beforeDismiss:reason=>{if(!existing)return true;const now=captureDraft();const parsed=parseAmountExpression(now.amount);const amountChanged=parsed.ok?Math.abs(parsed.value-editBaseline.amount)>=0.005:String(now.amount)!==String(initial.amount);const changed=type!==editBaseline.type||selected!==editBaseline.selectedCategoryId||budgetSync!==editBaseline.budgetSync||budgetExcluded!==editBaseline.budgetExcluded||amountChanged||now.date!==editBaseline.date||now.time!==editBaseline.time||now.note!==editBaseline.note;return !changed||confirmAction({title:'放弃修改',message:'这笔记录还有未保存的修改。',action:'确认放弃',danger:true});},onDismiss:reason=>{if(existing)return;if(reason==='cancel')clearTransactionDraft();else persistDraft();}});
  const amountInput=document.getElementById('txAmount');
  const amountPreview=document.getElementById('amountCalcPreview');
  const updateAmountPreview=()=>{
    const raw=amountInput?.value||'';
    const normalized=normalizeAmountExpression(raw);
    const hasCalculation=/[+*/]/.test(normalized) || /\d-/.test(normalized);
    const parsed=parseAmountExpression(raw);
    if(!hasCalculation){
      amountPreview.textContent='';
      amountPreview.classList.remove('visible','invalid');
      return;
    }
    if(parsed.ok && parsed.value>0){
      amountPreview.textContent=`= ${amount(parsed.value)}`;
      amountPreview.classList.add('visible');
      amountPreview.classList.remove('invalid');
    }else{
      amountPreview.textContent='继续输入算式';
      amountPreview.classList.add('visible','invalid');
    }
  };
  const markDirty=()=>{dirty=true;persistDraft();};
  const renderChooser=()=>{
    document.getElementById('expenseTab').className=`expense ${type==='expense'?'active':''}`;
    document.getElementById('incomeTab').className=`income ${type==='income'?'active':''}`;
    const cats=data.categories.filter(c=>c.type===type&&!c.hidden).sort((a,b)=>a.order-b.order);
    if(!cats.some(c=>c.id===selected)) selected=preferredCategoryId(type);
    document.getElementById('categoryChooser').innerHTML=cats.map(c=>`<button class="category-choice ${c.id===selected?'selected':''}" data-cat="${escapeHTML(c.id)}" style="--choice-color:${escapeHTML(categoryColor(c.color))}"><span class="category-symbol" style="color:${escapeHTML(categoryColor(c.color))};background:${tint(c.color)}">${icon(c.icon)}</span><small>${escapeHTML(c.name)}</small></button>`).join('');
    document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{
      selected=b.dataset.cat;
      if(type==='expense'&&!existing)budgetExcluded=categoryById(selected)?.budgetExcludedDefault===true;
      if(type==='income'&&!existing)budgetSync=true;
      markDirty();renderChooser();
    });
    const syncToggle=document.getElementById('budgetSyncToggle');
    if(syncToggle){
      syncToggle.hidden=type!=='income';
      syncToggle.classList.toggle('active',type==='income'&&budgetSync);
      syncToggle.setAttribute('aria-checked',type==='income'&&budgetSync?'true':'false');
    }
    const includeToggle=document.getElementById('budgetIncludeToggle');
    if(includeToggle){
      includeToggle.hidden=type!=='expense';
      includeToggle.classList.toggle('active',type==='expense'&&!budgetExcluded);
      includeToggle.setAttribute('aria-checked',type==='expense'&&!budgetExcluded?'true':'false');
    }
  };
  document.getElementById('expenseTab').onclick=()=>{type='expense';selected=preferredCategoryId(type);budgetExcluded=categoryById(selected)?.budgetExcludedDefault===true;markDirty();renderChooser();};
  document.getElementById('incomeTab').onclick=()=>{type='income';selected=preferredCategoryId(type);if(!existing)budgetSync=true;markDirty();renderChooser();};
  document.getElementById('budgetSyncToggle').onclick=()=>{if(type!=='income')return;budgetSync=!budgetSync;markDirty();renderChooser();};
  document.getElementById('budgetIncludeToggle').onclick=()=>{if(type!=='expense')return;budgetExcluded=!budgetExcluded;markDirty();renderChooser();};
  ['txAmount','txDate','txTime','txNote'].forEach(id=>{const el=document.getElementById(id);el?.addEventListener('input',()=>{if(id==='txAmount')tidyAmountInput(el);markDirty();if(id==='txAmount')updateAmountPreview();});el?.addEventListener('change',()=>{markDirty();if(id==='txAmount')updateAmountPreview();});});
  document.querySelectorAll('[data-amount-op]').forEach(button=>{
    bindAmountOperator(button,amountInput,()=>button.dataset.amountOp||'',()=>{
      dirty=true;persistDraft();updateAmountPreview();
    });
  });
  updateAmountPreview();
  document.getElementById('quickAddCategory').onclick=()=>{
    const draft={...captureDraft(),savedAt:Date.now()};dirty=true;
    // Editing an existing record must never leak into the draft used by the next
    // brand-new transaction. Keep edit state only in memory while organizing.
    if(!existing&&!suppliedDraft?.purchaseId)saveTransactionDraft(draft);
    openCategoryManager(type,{fromTransaction:true,draft,existing,onReturn:(returnType)=>openTransactionModal(existing,{...suppliedDraft,...draft,type:returnType,selectedCategoryId:(returnType===type?selected:preferredCategoryId(returnType))})});
  };
  renderChooser();
  let submitting=false;
  const submit=async(syncStock=false)=>{
    if(submitting)return;
    if (observedFinanceRaw!==financeStore.getItem(STORAGE_KEY)){toast('账本已在其他页面更新，请刷新');return;}
    const parsedAmount=parseAmountExpression(document.getElementById('txAmount').value); const value=parsedAmount.value; const c=categoryById(selected);
    if(!parsedAmount.ok||!value||value<=0){toast('请输入有效金额或算式');return;} if(!c){toast('请选择分类');return;}
    const chosenDate=document.getElementById('txDate').value||localISO();
    if(chosenDate>localISO()){toast('记账日期不能晚于今天');return;}
    if(suppliedDraft?.purchaseId&&(type!=='expense'||Math.round(value*100)!==suppliedDraft.purchaseCents||chosenDate!==suppliedDraft.date)){
      toast('采购关联需要相同的支出金额和日期');return;
    }
    if(syncStock&&type!=='expense'){toast('请先填写食品采购支出');return;}
    const record={...(existing||{}),id:existing?.id||suppliedDraft?.purchaseId||uid('tx'),type,amount:Math.round(value*100)/100,budgetSync:type==='income'&&budgetSync,budgetExcluded:type==='expense'&&budgetExcluded,categoryId:c.id,categoryName:c.name,categoryIcon:c.icon,categoryColor:c.color,note:document.getElementById('txNote').value.trim(),date:chosenDate,time:normalizeClock(document.getElementById('txTime').value),createdAt:existing?.createdAt||new Date().toISOString()};
    if(existing||suppliedDraft?.purchaseOrderId){
      const sourceButton=document.getElementById('txSubmit');
      submitting=true;
      try{
        const health=await readHealthState();
        if(sourceButton!==document.getElementById('txSubmit'))return;
        if (observedFinanceRaw!==financeStore.getItem(STORAGE_KEY)){toast('账本已在其他页面更新，请刷新');return;}
        if(suppliedDraft?.purchaseOrderId){
          const order=health.local.purchases?.find(p=>p.id===suppliedDraft.purchaseOrderId&&p.status!=='cancelled');
          if(!order||order.totalCents!==Math.round(record.amount*100)||order.date!==record.date){
            toast('采购订单已更新，请从库存重新打开');return;
          }
        }
        if(existing){
          if(existing.receiptKey&&(syncStock||record.amount!==Number(existing.amount)||record.date!==existing.date||record.type!==existing.type)){
            toast('截图订单的金额和日期需要整单核对。请在原对话查看执行详情。');return;
          }
          const order=purchaseForTransaction(health,existing.id);
          if(order&&(syncStock||record.amount!==Number(existing.amount)||record.date!==existing.date||record.time!==normalizeClock(existing.time)||record.type!==existing.type)){
            openLinkedPurchase(order);return;
          }
        }
      }catch(err){toast('无法核对关联采购，请稍后重试');return;}
      finally{submitting=false;}
    }
    if(existing){const i=data.transactions.findIndex(t=>t.id===existing.id);data.transactions[i]=record;}
    else if(data.transactions.some(t=>t.id===record.id)){toast('这张采购订单已记账');return;}
    else data.transactions.push(record);
    if(record.type==='expense')data.prefs.lastExpenseCategoryId=c.id;else data.prefs.lastIncomeCategoryId=c.id;
    if(!saveData())return;clearTransactionDraft();ui.day=record.date;ui.selectedMonth=record.date.slice(0,7);closeModal({runDismiss:false});render();toast(existing?'记录已修改':'已记下');
    if(syncStock){
      const url=new URL('./health/',location.href);
      if(window.airplaneAccount.demo)url.searchParams.set('demo','1');
      url.searchParams.set('financeTx',record.id);
      location.href=url.href;
    }
  };
  document.getElementById('txSubmit').onclick=()=>submit();
  if(!suppliedDraft?.purchaseId&&!existing?.receiptKey){
    const sync=document.createElement('button');
    sync.type='button';sync.className='secondary-button';sync.textContent='保存食品支出并同步入库';
    sync.onclick=()=>submit(true);
    document.getElementById('txSubmit').after(sync);
  }
  document.getElementById('txDelete')?.addEventListener('click',()=>{closeModal({runDismiss:false});deleteTransaction(existing.id);});
}

function openLinkedPurchase(order){
  const url=new URL('./health/',location.href);
  if(window.airplaneAccount.demo)url.searchParams.set('demo','1');
  url.searchParams.set('editPurchase',order.id);
  location.href=url.href;
}
async function deleteTransaction(id){
  if(data.transactions.find(row=>row.id===id)?.receiptKey){
    toast('请在原对话的执行详情中撤销整张截图订单。');return;
  }
  try{
    const order=purchaseForTransaction(await readHealthState(),id);
    if(order){openLinkedPurchase(order);return;}
    if(observedFinanceRaw!==financeStore.getItem(STORAGE_KEY)){toast('账本已在其他页面更新，请刷新');return;}
  }catch{toast('无法核对关联采购，请稍后重试');return;}
  const index=data.transactions.findIndex(x=>x.id===id);if(index<0)return;
  const removed=data.transactions[index];data.transactions.splice(index,1);if(!saveData())return;render();
  toast('记录已删除',{actionLabel:'撤销',duration:3600,onAction:()=>{if(data.transactions.some(t=>t.id===removed.id))return;data.transactions.splice(Math.min(index,data.transactions.length),0,removed);if(!saveData())return;render();toast('已恢复记录');}});
}

function bindTransactionSwipes(){
  document.querySelectorAll('.tx-swipe').forEach(wrap=>{
    const row=wrap.querySelector('.tx-row');if(!row)return;
    let startX=0,startY=0,dx=0,tracking=false,horizontal=false;
    const setX=x=>{row.style.transition='none';row.style.transform=`translateX(${x}px)`;};
    row.addEventListener('pointerdown',e=>{startX=e.clientX;startY=e.clientY;dx=0;tracking=true;horizontal=false;row.setPointerCapture?.(e.pointerId);});
    row.addEventListener('pointermove',e=>{
      if(!tracking)return;const mx=e.clientX-startX,my=e.clientY-startY;
      if(!horizontal&&Math.abs(mx)>8&&Math.abs(mx)>Math.abs(my)*1.2)horizontal=true;
      if(!horizontal)return;dx=Math.max(-88,Math.min(0,mx));setX(dx);e.preventDefault();
    });
    const finish=()=>{if(!tracking)return;tracking=false;row.style.transition='transform .18s ease-out';const open=horizontal&&dx<-42;row.style.transform=open?'translateX(-78px)':'';if(horizontal&&Math.abs(dx)>10)row.dataset.suppressClick='1';setTimeout(()=>{row.style.transition='';},190);};
    row.addEventListener('pointerup',finish);row.addEventListener('pointercancel',finish);
  });
}

function openCategoryManager(initialType='expense',options={}){
  let type=initialType;
  const returnToTransaction=()=>{closeModal({runDismiss:false});options.onReturn?.(type);};
  const draw=(focusId=null)=>{
    openModal(`${modalHead('整理分类','完成',options.fromTransaction?'返回':'取消')}<div class="segmented"><button id="catExpense" class="expense ${type==='expense'?'active':''}">支出分类</button><button id="catIncome" class="income ${type==='income'?'active':''}">收入分类</button></div><div class="category-manage-toolbar"><div class="helper reorder-tip">按住左侧拖动柄，上下移动即可调整记账页顺序。</div><button class="text-button" id="addCategory" type="button">＋ 新增</button></div><section class="card category-manager-card" id="categoryManageList"></section>`,{onDismiss:options.fromTransaction?()=>options.onReturn?.(type):null});
    document.getElementById('modalSave').onclick=()=>options.fromTransaction?returnToTransaction():closeModal({runDismiss:false});
    document.querySelector('.modal-head .cancel').onclick=()=>options.fromTransaction?returnToTransaction():closeModal({runDismiss:false});
    document.getElementById('catExpense').onclick=()=>{type='expense';draw();};
    document.getElementById('catIncome').onclick=()=>{type='income';draw();};
    const list=data.categories.filter(c=>c.type===type).sort((a,b)=>a.order-b.order);
    document.getElementById('categoryManageList').innerHTML=list.map(c=>`<div class="category-manage-row" data-category-row="${escapeHTML(c.id)}"><button class="drag-handle" data-drag-cat="${escapeHTML(c.id)}" type="button" aria-label="拖动${escapeHTML(c.name)}排序"><span></span><span></span><span></span></button><span class="category-symbol" style="width:38px;height:38px;color:${escapeHTML(categoryColor(c.color))};background:${tint(c.color)}">${icon(c.icon)}</span><span class="name">${escapeHTML(c.name)}${type==='expense'&&c.budgetExcludedDefault===true?'<em class="category-budget-default-badge">默认预算外</em>':''}</span><span class="category-row-actions"><button class="pill action-pill" data-toggle-cat="${escapeHTML(c.id)}">${c.hidden?'显示':'隐藏'}</button><button class="pill action-pill" data-edit-cat="${escapeHTML(c.id)}">编辑</button><button class="pill action-pill negative" data-remove-cat="${escapeHTML(c.id)}">删除</button></span></div>`).join('');
    document.querySelectorAll('[data-toggle-cat]').forEach(b=>b.onclick=()=>{const c=categoryById(b.dataset.toggleCat);if(!c)return;if(!c.hidden&&data.categories.filter(x=>x.type===type&&!x.hidden).length<=1){toast('至少保留一个可用分类');return;}c.hidden=!c.hidden;if(!saveData())return;draw();});
    document.querySelectorAll('[data-edit-cat]').forEach(b=>b.onclick=()=>openCategoryEditor(type,categoryById(b.dataset.editCat),{cancelLabel:'返回',onBack:()=>draw(),onDone:saved=>draw(saved?.id)}));
    document.querySelectorAll('[data-remove-cat]').forEach(b=>b.onclick=()=>removeCategory(b.dataset.removeCat,type,()=>draw()));
    document.getElementById('addCategory').onclick=()=>openCategoryEditor(type,null,{cancelLabel:'返回',onBack:()=>draw(),onDone:saved=>draw(saved?.id)});
    bindCategoryReorder(type);
    if(focusId){
      requestAnimationFrame(()=>{
        const row=document.querySelector(`[data-category-row="${CSS.escape(focusId)}"]`);
        row?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
      });
    }
  };
  draw();
}

function bindCategoryReorder(type){
  const container=document.getElementById('categoryManageList');if(!container)return;
  const rows=()=>[...container.querySelectorAll('[data-category-row]')];
  const saveOrder=()=>{rows().forEach((r,i)=>{const c=categoryById(r.dataset.categoryRow);if(c)c.order=i;});if(!saveData())return;};
  const capture=()=>new Map(rows().map(r=>[r,r.getBoundingClientRect()]));
  const animateReflow=(before,dragged)=>{
    rows().forEach(r=>{
      if(r===dragged)return;
      const old=before.get(r), now=r.getBoundingClientRect();
      if(!old)return;
      const dx=old.left-now.left, dy=old.top-now.top;
      if(Math.abs(dx)<.5&&Math.abs(dy)<.5)return;
      if(typeof r.animate==='function'){
        r.getAnimations?.().forEach(a=>{if(a.id==='airplane-category-reflow')a.cancel();});
        const a=r.animate([
          {transform:`translate(${dx}px, ${dy}px)`},
          {transform:'translate(0, 0)'}
        ],{duration:190,easing:'cubic-bezier(.22,.8,.28,1)'});
        a.id='airplane-category-reflow';
      }
    });
  };
  const moveRow=(row,clientY)=>{
    const others=rows().filter(x=>x!==row);
    const beforeRow=others.find(x=>clientY < x.getBoundingClientRect().top + x.getBoundingClientRect().height/2);
    const currentNext=row.nextElementSibling;
    if((beforeRow&&currentNext===beforeRow)||(!beforeRow&&!currentNext))return;
    const before=capture();
    container.insertBefore(row,beforeRow||null);
    animateReflow(before,row);
    const modal=container.closest('.modal');
    if(modal){const rect=modal.getBoundingClientRect();if(clientY>rect.bottom-80)modal.scrollTop+=10;else if(clientY<rect.top+90)modal.scrollTop-=10;}
  };
  container.querySelectorAll('.drag-handle').forEach(handle=>{
    const row=handle.closest('[data-category-row]');if(!row)return;
    let active=false,startY=0,lastY=0;
    const begin=y=>{active=true;startY=lastY=y;row.classList.add('dragging');document.body.classList.add('reordering');};
    const update=y=>{if(!active)return;lastY=y;row.style.setProperty('--drag-offset',`${Math.max(-10,Math.min(10,(y-startY)*.08))}px`);moveRow(row,y);};
    const end=()=>{if(!active)return;active=false;row.classList.remove('dragging');row.style.removeProperty('--drag-offset');document.body.classList.remove('reordering');saveOrder();};
    handle.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;begin(e.touches[0].clientY);e.preventDefault();},{passive:false});
    handle.addEventListener('touchmove',e=>{if(!active||!e.touches[0])return;update(e.touches[0].clientY);e.preventDefault();},{passive:false});
    handle.addEventListener('touchend',end,{passive:true});
    handle.addEventListener('touchcancel',end,{passive:true});
    handle.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;begin(e.clientY);handle.setPointerCapture?.(e.pointerId);e.preventDefault();});
    handle.addEventListener('pointermove',e=>{if(!active||e.pointerType==='touch')return;update(e.clientY);e.preventDefault();});
    handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  });
}

function openCategoryEditor(type,existing=null,options={}){
  let selectedIcon=existing?.icon||(type==='expense'?'coffee':'coins'); let selectedColor=existing?.color||(type==='expense'?'#EFA06D':'#4CB487');
  let defaultBudgetExcluded=type==='expense'&&existing?.budgetExcludedDefault===true;
  const iconOptions=['food','coffee','car','bus','train','parking','bag','clothes','game','house','building','water','bolt','flame','washing','phone','wifi','subscription','package','wrench','scissors','paw','book','health','travel','gift','briefcase','laptop','award','coins','trend','refund','more'];
  const colors=['#F29B69','#E8B45F','#72B77A','#65BFA3','#6FA8DC','#7797DB','#AA82E3','#E77BA6','#E78378','#9AA09A','#5F9FE5','#4CB487'];
  openModal(`${modalHead(existing?'编辑分类':'添加分类','保存',options.cancelLabel||'取消')}<section class="card input-card"><label>分类名称</label><input id="catName" class="large-input" maxlength="8" placeholder="例如 咖啡" value="${escapeHTML(existing?.name||'')}"></section>${type==='expense'?`<button id="categoryBudgetDefaultToggle" class="budget-sync-toggle ${defaultBudgetExcluded?'':'active'}" type="button" role="switch" aria-checked="${defaultBudgetExcluded?'false':'true'}"><span><strong>默认计入日常预算</strong><small>关闭后，新记这个分类时会默认标记为“预算外”；单笔仍可改回。</small></span><span class="toggle-switch" aria-hidden="true"><i></i></span></button>`:''}<div class="section-head" style="margin-top:14px"><h2>图标</h2></div><section class="card"><div class="icon-palette" id="iconPalette"></div></section><div class="section-head"><h2>颜色</h2></div><section class="card"><div class="color-palette" id="colorPalette"></div></section>`,{onDismiss:options.onBack||null});
  const draw=()=>{
    document.getElementById('iconPalette').innerHTML=iconOptions.map(i=>`<button class="icon-choice ${i===selectedIcon?'selected':''}" data-icon-choice="${i}">${icon(i)}</button>`).join('');
    document.getElementById('colorPalette').innerHTML=colors.map(c=>`<button class="color-swatch ${c===selectedColor?'selected':''}" data-color="${c}" style="background:${c}"></button>`).join('');
    document.querySelectorAll('[data-icon-choice]').forEach(b=>b.onclick=()=>{selectedIcon=b.dataset.iconChoice;draw();});
    document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{selectedColor=b.dataset.color;draw();});
  }; draw();
  document.getElementById('categoryBudgetDefaultToggle')?.addEventListener('click',()=>{
    defaultBudgetExcluded=!defaultBudgetExcluded;
    const toggle=document.getElementById('categoryBudgetDefaultToggle');
    toggle?.classList.toggle('active',!defaultBudgetExcluded);
    toggle?.setAttribute('aria-checked',defaultBudgetExcluded?'false':'true');
  });
  document.getElementById('modalSave').onclick=()=>{
    const name=document.getElementById('catName').value.trim(); if(!name){toast('请输入分类名称');return;}
    let saved=existing;
    if(existing){existing.name=name;existing.icon=selectedIcon;existing.color=selectedColor;if(type==='expense')existing.budgetExcludedDefault=defaultBudgetExcluded;} else {const order=Math.max(-1,...data.categories.filter(c=>c.type===type).map(c=>c.order))+1;saved={id:uid('cat'),name,type,icon:selectedIcon,color:selectedColor,custom:true,hidden:false,order,budgetExcludedDefault:type==='expense'?defaultBudgetExcluded:undefined};data.categories.push(saved);}
    if(!saveData())return;closeModal({runDismiss:false});options.onDone?.(saved);toast(existing?'分类已修改':'分类已添加');
  };
}

async function removeCategory(id,type,onDone){
  const c=categoryById(id); if(!c)return;
  const sameType=data.categories.filter(x=>x.type===type);
  const visible=sameType.filter(x=>!x.hidden);
  if(sameType.length<=1){toast('至少保留一个分类');return;}
  if(!c.hidden&&visible.length<=1){toast('至少保留一个可用分类');return;}
  if(!await confirmAction({title:'删除分类',message:`删除分类“${c.name}”？历史账单会保留原来的分类名称和图标。`,action:'确认删除',danger:true}))return;
  data.categories=data.categories.filter(x=>x.id!==id);
  if(data.prefs.lastExpenseCategoryId===id)data.prefs.lastExpenseCategoryId=null;
  if(data.prefs.lastIncomeCategoryId===id)data.prefs.lastIncomeCategoryId=null;
  if(!saveData())return;onDone?.();toast('分类已删除，历史账单已保留');
}
function downloadBlob(filename,content,type){ const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500); }
function makeBackup(payload=data,extra={}){return {app:'Airplane',format:'airplane-backup',schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),...extra,data:payload};}
function exportJSON(){ downloadBlob(`Airplane-backup-${localISO()}.json`,JSON.stringify(makeBackup(),null,2),'application/json');toast('完整备份已导出'); }
function validatedBackupData(parsed){return normalizeData(validateFinanceBackup(parsed));}
function savePreRestoreSnapshot(){
  financeStore.setItem(PRE_RESTORE_KEY,JSON.stringify(makeBackup(structuredClone(data),{snapshotType:'pre-restore',savedAt:new Date().toISOString()})));
}
async function restorePreRestoreSnapshot(){
  try{
    const raw=financeStore.getItem(PRE_RESTORE_KEY);if(!raw){toast('当前没有可恢复的快照');return;}
    const incoming=validatedBackupData(JSON.parse(raw));
    if(!await confirmAction({title:'恢复快照',message:'这会替换当前财务账本，当前账本将保存为新的恢复前快照。',action:'确认恢复'}))return;
    const current=structuredClone(data);
    data=incoming;clearTransactionDraft();
    financeStore.setItem(PRE_RESTORE_KEY,JSON.stringify(makeBackup(current,{snapshotType:'pre-restore',savedAt:new Date().toISOString()})));
    if(!saveData())return;closeModal({runDismiss:false});render();toast('已恢复上一次导入前的账本');
  }catch(err){console.warn('Airplane pre-restore snapshot is invalid',err);toast('恢复前快照已损坏，无法恢复');}
}
function exportCSV(){
  const rows=[['日期','时间','类型','金额','分类','计入日常预算','同步增加预算','备注'],...data.transactions.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(t=>[t.date,t.time||'',t.type==='expense'?'支出':'收入',Number(t.amount).toFixed(2),t.categoryName||txSnapshotCategory(t).name,t.type==='expense'?(t.budgetExcluded===true?'否':'是'):'',t.type==='income'&&t.budgetSync?'是':'否',t.note||''])];
  const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');downloadBlob(`Airplane-records-${localISO()}.csv`,csv,'text/csv;charset=utf-8');toast('CSV 已导出');
}
async function resetAll(){
  const approved=await confirmAction({title:'清空财务账本',message:'这会清除本机财务账本中的余额、预算、分类和账单。',action:'清空财务数据',danger:true});
  if(!approved)return;
  clearTransactionDraft();data=freshData();if(!saveData())return;selectMonth(monthKey());render();toast('本机数据已清空');
}
function toast(msg,options={}){
  document.querySelector('.toast')?.remove();
  if(activeUndo){clearTimeout(activeUndo);activeUndo=null;}
  const d=document.createElement('div');d.className='toast';
  d.innerHTML=`<span>${escapeHTML(msg)}</span>${options.actionLabel?`<button class="toast-action" type="button">${escapeHTML(options.actionLabel)}</button>`:''}`;
  document.body.appendChild(d);
  const remove=()=>{d.remove();activeUndo=null;};
  if(options.actionLabel){d.querySelector('.toast-action').onclick=()=>{remove();options.onAction?.();};}
  activeUndo=setTimeout(remove,options.duration||2200);
}

// Global navigation
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{ui.tab=b.dataset.tab;render();window.scrollTo({top:0,behavior:'smooth'});});
document.getElementById('addButton').onclick=()=>openTransactionModal();
const writeFinanceDay=bindDayPicker(document.querySelector('.day-picker'),date=>{
  ui.day=date;ui.selectedMonth=date.slice(0,7);ui.dayOnly=true;render();
});
document.getElementById('settingsButton').onclick=openSettingsModal;
document.getElementById('importInput').addEventListener('change', async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{
    const parsed=JSON.parse(await file.text());
    const incoming=validatedBackupData(parsed);
    if(!await confirmAction({title:'恢复财务备份',message:'将使用这份备份替换本机财务账本。当前账本会保存为恢复前快照。',action:'确认恢复'}))return;
    if(recoveryRequired){
      const damaged={primary:financeStore.getItem(STORAGE_KEY),recovery:financeStore.getItem(RECOVERY_KEY)};
      financeStore.setItem('airplane-damaged-before-restore-v1',JSON.stringify(damaged));
      recoveryRequired=false;
      clearTransactionDraft();writeStorageCopies(incoming);window.location.reload();return;
    }
    savePreRestoreSnapshot();
    clearTransactionDraft();data=incoming;if(!saveData())return;render();toast('备份已恢复，原账本已保留为恢复前快照');
  }catch(err){console.warn('Airplane backup import rejected',err);toast('无法识别这个 Airplane 备份');}
});

if(recoveryRequired){
  document.querySelector('.tabbar').hidden=true;
  document.querySelector('.topbar').hidden=true;
  const app=document.querySelector('#app');
  app.innerHTML='<section class="card recover-card"><h2>账本需要恢复</h2><p>本机的两份账本均无法解析。可以先保存原始副本，再选择一份有效的财务备份。</p><button id="save-damaged" class="secondary-button">导出原始副本</button><button id="import-repair" class="primary-button">选择财务备份</button></section>';
  document.querySelector('#save-damaged').onclick=()=>downloadBlob('Airplane-damaged-backup.json',JSON.stringify({primary:financeStore.getItem(STORAGE_KEY),recovery:financeStore.getItem(RECOVERY_KEY)}),'application/json');
  document.querySelector('#import-repair').onclick=()=>document.querySelector('#importInput').click();
}else {
  render();
}
function refreshFinanceLedger(){
  if(recoveryRequired||document.querySelector('#modalRoot .modal'))return;
  try{
    const raw=financeStore.getItem(STORAGE_KEY);
    if(!raw||raw===observedFinanceRaw)return;
    data=parseStoredData(raw).value;observedFinanceRaw=raw;
    dataRevision++;monthTxCache.clear();balanceCache.revision=-1;render();
  }catch{}
}
window.addEventListener('storage',refreshFinanceLedger);
window.addEventListener('airplane:finance-saved',refreshFinanceLedger);
if(window.airplanePendingPurchase)toast('有待同步的账本更新，请在健康库存页处理',{duration:5500});
const purchaseQuery=new URL(location.href).searchParams.get('purchase');
if(purchaseQuery&&!recoveryRequired)readHealthState().then(health=>{
  const order=(health.local.purchases??[]).find(p=>p.id===purchaseQuery);
  if(!order||order.status==='cancelled'||!order.totalCents){toast('没有可确认的采购支出');return;}
  const id=purchaseTransactionId(order);
  if(data.transactions.some(t=>t.id===id)){toast('这张采购订单已记账');return;}
  if(order.financeId){toast('请先恢复已关联的财务支出');return;}
  openTransactionModal(null,{type:'expense',selectedCategoryId:preferredCategoryId('expense'),
    amount:(order.totalCents/100).toFixed(2),date:order.date,time:order.time??'',note:order.note||'食品采购',purchaseId:id,purchaseOrderId:order.id,purchaseCents:order.totalCents});
}).catch(()=>toast('无法读取关联采购'));
// Persistence status is important but not required to show the ledger. Query it
// after launch instead of competing with the first interactive frame on iOS.
runWhenIdle(()=>ensurePersistentStorage(),1600);
