
// STORAGE_KEY is intentionally permanent. Never rename it in a normal app update.
// Keeping one stable key lets new program versions reuse the user's existing ledger.
const STORAGE_KEY = 'airplane-pwa-v1';
const RECOVERY_KEY = 'airplane-pwa-recovery-v1';
const DRAFT_KEY = 'airplane-transaction-draft-v1';
const DRAFT_TTL_MS = 30 * 60 * 1000;
const SCHEMA_VERSION = 3;
const APP_VERSION = '0.7.10';
const VERSION = SCHEMA_VERSION;

const ICONS = {
  plane: '<path d="M3 14.5 21 3l-6.2 18-4.1-6.2L3 14.5Z"/><path d="m10.7 14.8 4.1-4.1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  home: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1H21v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  shield: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.3 2.3 4.8-5"/>',
  wallet: '<path d="M4 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12v4"/><path d="M16 12h5v4h-5a2 2 0 1 1 0-4Z"/>',
  food: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M16 3c3 2 4 5 4 9h-4V3Zm0 9v9"/>',
  car: '<path d="m5 11 2-5h10l2 5"/><path d="M4 11h16v7H4z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  game: '<path d="M8 8h8a5 5 0 0 1 4.7 6.7l-1.1 3.1a2 2 0 0 1-3.2.8L14 16h-4l-2.4 2.6a2 2 0 0 1-3.2-.8l-1.1-3.1A5 5 0 0 1 8 8Z"/><path d="M7 12v4M5 14h4M16 13h.01M18 15h.01"/>',
  house: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
  book: '<path d="M4 5a4 4 0 0 1 4-2h4v17H8a4 4 0 0 0-4 2V5Z"/><path d="M20 5a4 4 0 0 0-4-2h-4v17h4a4 4 0 0 1 4 2V5Z"/>',
  health: '<path d="M12 21s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.2-8 11-8 11Z"/><path d="M9 12h6M12 9v6"/>',
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
  chevron: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>'
};

const DEFAULT_CATEGORIES = [
  ['餐饮','expense','food','#F29B69'],['交通','expense','car','#6FA8DC'],['购物','expense','bag','#AA82E3'],['娱乐','expense','game','#E77BA6'],
  ['日用','expense','house','#E8B45F'],['学习','expense','book','#5F9FE5'],['医疗','expense','health','#65BFA3'],['旅行','expense','travel','#6EAED7'],
  ['人情','expense','gift','#E78378'],['其他','expense','more','#9AA09A'],
  ['工资','income','briefcase','#4CB487'],['兼职','income','laptop','#5C9FD6'],['奖学金','income','award','#C8A34C'],['奖金','income','coins','#E7A24A'],
  ['理财','income','trend','#7797DB'],['红包/转账','income','gift','#E47B8C'],['退款','income','refund','#6CB8A3'],['其他','income','more','#9AA09A']
].map((c,i)=>({id:`default-${i+1}`,name:c[0],type:c[1],icon:c[2],color:c[3],custom:true,hidden:false,order:i}));

function freshData(){
  return {version:VERSION, transactions:[], categories:structuredClone(DEFAULT_CATEGORIES), budgets:{}, balanceAdjustments:[], prefs:{initialBalance:null}};
}

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
  parsed.categories.forEach(c=>{if(c&&typeof c==='object')c.custom=true;});
  parsed.version=SCHEMA_VERSION;
  return parsed;
}

function parseStoredData(raw){
  if(!raw) return null;
  return normalizeData(JSON.parse(raw));
}

function writeStorageCopies(value){
  const raw=JSON.stringify(value);
  localStorage.setItem(STORAGE_KEY,raw);
  // A second on-device copy protects against a future buggy migration accidentally
  // damaging the primary key. It is not a substitute for exported JSON backups.
  localStorage.setItem(RECOVERY_KEY,raw);
}

function loadData(){
  const primaryRaw=localStorage.getItem(STORAGE_KEY);
  try {
    const parsed=parseStoredData(primaryRaw);
    if(parsed){
      writeStorageCopies(parsed);
      return parsed;
    }
  } catch(e){
    console.warn('Primary Airplane data is invalid; trying local recovery copy',e);
  }

  const recoveryRaw=localStorage.getItem(RECOVERY_KEY);
  try {
    const recovered=parseStoredData(recoveryRaw);
    if(recovered){
      localStorage.setItem(STORAGE_KEY,JSON.stringify(recovered));
      console.warn('Airplane restored data from the on-device recovery copy');
      return recovered;
    }
  } catch(e){
    console.warn('Airplane recovery copy is also invalid',e);
  }

  // Only a genuinely new origin/device, with neither a primary nor recovery copy,
  // starts with empty data. A program update by itself never reaches this path.
  const created=freshData();
  writeStorageCopies(created);
  return created;
}

function saveData(){ writeStorageCopies(data); }

let data = loadData();
let ui = {tab:'home', selectedMonth:monthKey(new Date()), recordFilter:'all'};
let storageProtection = {supported:!!(navigator.storage?.persist && navigator.storage?.persisted), checked:false, persisted:false};
function uid(prefix='id'){ return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`; }
function pad(n){ return String(n).padStart(2,'0'); }
function localISO(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function monthKey(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
function parseMonth(m){ const [y,mo]=m.split('-').map(Number); return {y,mo}; }
function daysInMonth(m){ const {y,mo}=parseMonth(m); return new Date(y,mo,0).getDate(); }
function monthLabel(m){ const {y,mo}=parseMonth(m); return `${y}年${mo}月`; }
function isCurrentMonth(m){ return m===monthKey(new Date()); }
function amount(n){ return `¥${Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`; }
function pct(n){ return `${Math.round(Math.max(0,n)*100)}%`; }
function escapeHTML(s=''){ return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function icon(name, cls=''){ return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.more}</svg>`; }
function tint(hex, alpha=.16){
  const h=hex.replace('#',''); const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function txForMonth(m){ return data.transactions.filter(t=>t && typeof t.date==='string' && t.date.startsWith(m)); }
function monthTotals(m){
  return txForMonth(m).reduce((a,t)=>{a[t.type]+=Number(t.amount)||0; return a;},{expense:0,income:0});
}
function budgetFor(m){ return Number(data.budgets[m]||0); }
function initialBalance(){ return Number(data.prefs?.initialBalance ?? 0); }
function balanceAdjustmentTotal(){ return (data.balanceAdjustments||[]).reduce((s,a)=>s+Number(a.delta||0),0); }
function currentBalance(){
  const txNet=data.transactions.reduce((s,t)=>s+(t.type==='income'?Number(t.amount||0):-Number(t.amount||0)),0);
  return initialBalance()+txNet+balanceAdjustmentTotal();
}
function hasInitialBalance(){ return data.prefs?.initialBalance !== null && data.prefs?.initialBalance !== undefined; }
function categoryById(id){ return data.categories.find(c=>c.id===id); }
function dateDisplay(iso){ const d=new Date(`${iso}T12:00:00`); return `${d.getMonth()+1}月${d.getDate()}日`; }
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
    <div class="category-symbol" style="color:${c.color};background:${tint(c.color)}">${icon(c.icon)}</div>
    <div class="tx-main"><div class="tx-title">${escapeHTML(c.name)}</div><div class="tx-sub">${escapeHTML(t.note||fallbackDate)}</div></div>
    <div><div class="tx-money ${cls}">${sign}${amount(t.amount)}</div><div class="tx-time">${escapeHTML(t.time||'')}</div></div>
  </div>`;
  if(!swipe) return row;
  return `<div class="tx-swipe" data-swipe-tx="${escapeHTML(t.id||'')}"><button class="tx-delete-action" data-delete-tx="${escapeHTML(t.id||'')}" type="button">删除</button>${row}</div>`;
}

function budgetMetrics(m){
  const budget=budgetFor(m), totals=monthTotals(m), dim=daysInMonth(m), now=new Date();
  const currentMonth=monthKey(now);
  const current=m===currentMonth;
  const future=m>currentMonth;
  const past=m<currentMonth;
  const elapsed = future ? 0 : (current ? now.getDate() : dim);
  const baseDaily = budget>0 ? budget/dim : 0;
  const plannedToDate = baseDaily*elapsed;
  const delta = future ? 0 : totals.expense-plannedToDate;
  const remainingBudget = budget-totals.expense;
  const today = localISO(now);
  const todayExpense = current ? data.transactions.filter(t=>t.type==='expense'&&t.date===today).reduce((s,t)=>s+Number(t.amount),0) : 0;
  const expenseBeforeToday = current ? Math.max(totals.expense-todayExpense,0) : totals.expense;
  const remainingDays = current ? Math.max(dim-now.getDate()+1,1) : dim;
  const dailyLimit = current ? (budget>0 ? Math.max(budget-expenseBeforeToday,0)/remainingDays : 0) : baseDaily;
  const todayDelta = todayExpense-dailyLimit;
  const timeProgress = future ? 0 : elapsed/dim;
  const budgetProgress = budget>0 ? totals.expense/budget : 0;
  const projection = (!future&&elapsed>0) ? totals.expense/elapsed*dim : 0;
  return {budget,...totals,dim,elapsed,baseDaily,dailyLimit,plannedToDate,delta,remainingBudget,remainingDays,todayExpense,todayDelta,timeProgress,budgetProgress,projection,current,future,past};
}

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
  document.getElementById('monthButton').innerHTML = `${monthLabel(ui.selectedMonth)} ${icon('chevron')}`;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===ui.tab));
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
    <div class="budget-top"><div><div class="eyebrow">当前余额</div><div class="balance-value ${balance<0?'negative':''}">${amount(balance)}</div></div><button class="text-button" data-action="balance">${hasInitialBalance()?'调整':'设置'}</button></div>
    <div class="helper balance-note">收入会增加余额，支出会减少余额；月预算仍由你单独设置，不会因收入自动提高。</div>
  </section>`;
}

function renderHome(){
  const m=budgetMetrics(ui.selectedMonth), current=isCurrentMonth(ui.selectedMonth);
  const ledger=renderLedgerSection();
  if(!m.budget){
    return `<div class="stack">
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
  return `<div class="stack">
    ${balanceCard()}
    <section class="card hero daily-card">
      <div class="eyebrow">${current?'今日不宜超过':'当月日均预算'}</div>
      <div class="big-money"><small>¥</small>${m.dailyLimit.toFixed(2)}</div>
      <div class="metric-grid daily-metrics">
        <div class="metric"><div class="metric-label">${current?'今日已支出':'当月已支出'}</div><div class="metric-value">${amount(current?m.todayExpense:m.expense)}</div></div>
        <div class="metric"><div class="metric-label">${rightLabel}</div><div class="metric-value ${rightClass}">${amount(rightValue)}</div></div>
      </div>
      <div class="progress-row"><div class="progress-meta"><span>${current?'今日额度使用':'预算使用'}</span><span>${pct(useRatio)}</span></div><div class="progress ${current&&overToday>0?'danger':''}"><span style="width:${Math.min(useRatio*100,100)}%"></span></div></div>
    </section>

    <section class="card budget-card">
      <div class="budget-top"><div><div class="eyebrow">本月预算</div><div class="budget-amount">${amount(m.expense)} <span class="of">/ ${amount(m.budget)}</span></div></div><button class="text-button" data-action="budget">编辑</button></div>
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
  if(ui.recordFilter!=='all') tx=tx.filter(t=>t.type===ui.recordFilter);
  tx.sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')));
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
    <div class="section-head ledger-head"><h2>账单</h2><span class="muted ledger-month">${monthLabel(ui.selectedMonth)}</span></div>
    <div class="filters ledger-filters"><button class="filter ${ui.recordFilter==='all'?'active':''}" data-filter="all">全部</button><button class="filter ${ui.recordFilter==='income'?'active':''}" data-filter="income">收入</button><button class="filter ${ui.recordFilter==='expense'?'active':''}" data-filter="expense">支出</button></div>
    ${body||`<section class="card empty"><div class="empty-icon">${icon('list')}</div><h3>这里还没有${ui.recordFilter==='income'?'收入':ui.recordFilter==='expense'?'支出':'账单'}记录</h3><p>点击下方绿色 ＋ 记下第一笔。</p></section>`}
  </section>`;
}

function renderStats(){
  const m=budgetMetrics(ui.selectedMonth), tx=txForMonth(ui.selectedMonth), expenses=tx.filter(t=>t.type==='expense');
  const grouped={}; expenses.forEach(t=>{const c=txSnapshotCategory(t); const k=c.name; grouped[k]??={value:0,color:c.color}; grouped[k].value+=Number(t.amount);});
  const parts=Object.entries(grouped).sort((a,b)=>b[1].value-a[1].value); let start=0;
  const gradient = parts.length ? parts.map(([_,v])=>{const deg=m.expense? v.value/m.expense*360:0; const seg=`${v.color} ${start}deg ${start+deg}deg`; start+=deg; return seg;}).join(',') : '#e8ebe7 0 360deg';
  const dayValues=Array(daysInMonth(ui.selectedMonth)).fill(0); expenses.forEach(t=>{dayValues[Number(t.date.slice(-2))-1]+=Number(t.amount);});
  const max=Math.max(...dayValues,1); const nowDay=isCurrentMonth(ui.selectedMonth)?new Date().getDate():-1;
  const legend=parts.slice(0,6).map(([name,v])=>`<div class="legend-row"><span class="legend-dot" style="background:${v.color}"></span><span>${escapeHTML(name)}</span><span class="legend-value">${m.expense?pct(v.value/m.expense):'0%'}</span></div>`).join('');
  return `<div class="stack"><div class="section-head"><h2>统计</h2><span class="muted" style="font-size:12px">${monthLabel(ui.selectedMonth)}</span></div>
    <div class="summary-grid"><div class="summary-card"><small>收入</small><strong class="positive">${amount(m.income)}</strong></div><div class="summary-card"><small>支出</small><strong class="negative">${amount(m.expense)}</strong></div><div class="summary-card"><small>结余</small><strong>${amount(m.income-m.expense)}</strong></div></div>
    <section class="card chart-card"><h3>支出分类</h3>${expenses.length?`<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${gradient})"></div><div class="legend">${legend}</div></div>`:`<div class="empty"><p>有支出记录后显示分类占比。</p></div>`}</section>
    <section class="card chart-card"><h3>每日支出趋势</h3><div class="bars">${dayValues.map((v,i)=>`<div class="bar ${i+1===nowDay?'today':''}" style="height:${Math.max(v/max*100,v?3:0)}%" title="${i+1}日 ${amount(v)}"></div>`).join('')}</div><div class="chart-axis"><span>1日</span><span>${Math.ceil(dayValues.length/2)}日</span><span>${dayValues.length}日</span></div></section>
    ${m.budget?`<section class="card"><div class="eyebrow">按当前消费速度</div><div class="budget-amount">预计本月支出 ${amount(m.projection)}</div><div class="helper" style="margin-top:8px">预算 ${amount(m.budget)} · ${m.projection>m.budget?`按当前节奏可能超出 ${amount(m.projection-m.budget)}`:`按当前节奏预计剩余 ${amount(m.budget-m.projection)}`}</div></section>`:''}
  </div>`;
}

function settingsContent(){
  const b=budgetFor(ui.selectedMonth);
  const protection=storageProtectionStatus();
  return `<div class="stack settings-stack">
    <section class="card settings-section">
      <button class="setting-row" data-action="balance"><span class="mini-icon">${icon('wallet')}</span><span class="setting-copy"><span class="setting-title">当前余额</span><span class="setting-sub">${hasInitialBalance()?amount(currentBalance()):'未设置初始余额'}</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="budget"><span class="mini-icon">${icon('calendar')}</span><span class="setting-copy"><span class="setting-title">月预算</span><span class="setting-sub">${monthLabel(ui.selectedMonth)} · ${b?amount(b):'未设置'}</span></span><span class="chevron">${icon('chevron')}</span></button>
    </section>
    <div class="section-head"><h2>数据</h2></div>
    <section class="card settings-section">
      <button class="setting-row" data-action="export-json"><span class="mini-icon">${icon('download')}</span><span class="setting-copy"><span class="setting-title">完整备份</span><span class="setting-sub">导出 JSON，可完整恢复预算、分类和账单</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="export-csv"><span class="mini-icon">${icon('file')}</span><span class="setting-copy"><span class="setting-title">导出明细 CSV</span><span class="setting-sub">方便在 Excel / Numbers 中查看</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="import"><span class="mini-icon">${icon('upload')}</span><span class="setting-copy"><span class="setting-title">恢复备份</span><span class="setting-sub">从 Airplane JSON 备份恢复</span></span><span class="chevron">${icon('chevron')}</span></button>
    </section>
    <div class="section-head"><h2>安装与保护</h2></div>
    <section class="card settings-section">
      <button class="setting-row" data-action="storage-persist"><span class="mini-icon">${icon('shield')}</span><span class="setting-copy"><span class="setting-title">本地数据保护</span><span class="setting-sub ${protection.cls}">${protection.label}</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="check-update"><span class="mini-icon">${icon('download')}</span><span class="setting-copy"><span class="setting-title">程序更新</span><span class="setting-sub">当前 ${APP_VERSION} · 启动优先本地，可在这里手动检查</span></span><span class="chevron">${icon('chevron')}</span></button>
    </section>
    <section class="card"><div class="helper">主屏幕 Airplane 与 Safari 网页在 iOS 上属于不同的本地数据空间。长期使用请固定从主屏幕 Airplane 进入；程序更新只替换程序文件，不会重建余额、预算、分类或账单。人为清除网站数据、删除 App 或换手机前仍请先做“完整备份”。</div></section>
    <button class="danger-button" data-action="reset">清空本机全部数据</button>
  </div>`;
}

function openSettingsModal(){
  openModal(`${modalHead('设置','完成')}<div class="settings-modal-body">${settingsContent()}</div>`);
  document.getElementById('modalSave').onclick=()=>closeModal({runDismiss:false});
  bindSettingsEvents();
}

function bindSettingsEvents(){
  document.querySelectorAll('[data-action="budget"]').forEach(b=>b.onclick=()=>openBudgetModal());
  document.querySelectorAll('[data-action="balance"]').forEach(b=>b.onclick=()=>openBalanceModal());
  document.querySelector('[data-action="export-json"]')?.addEventListener('click',exportJSON);
  document.querySelector('[data-action="export-csv"]')?.addEventListener('click',exportCSV);
  document.querySelector('[data-action="import"]')?.addEventListener('click',()=>document.getElementById('importInput').click());
  document.querySelector('[data-action="storage-persist"]')?.addEventListener('click',()=>ensurePersistentStorage(true));
  document.querySelector('[data-action="check-update"]')?.addEventListener('click',()=>checkForAppUpdate(true));
  document.querySelector('[data-action="reset"]')?.addEventListener('click',resetAll);
}

function bindViewEvents(){
  document.querySelectorAll('[data-action="budget"]').forEach(b=>b.onclick=()=>openBudgetModal());
  document.querySelectorAll('[data-action="balance"]').forEach(b=>b.onclick=()=>openBalanceModal());
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{ui.recordFilter=b.dataset.filter;render();});
  document.querySelectorAll('[data-open-tx]').forEach(row=>{
    const open=()=>openTransactionModal(data.transactions.find(t=>t.id===row.dataset.openTx));
    row.addEventListener('click',()=>{if(row.dataset.suppressClick!=='1') open(); row.dataset.suppressClick='0';});
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  });
  document.querySelectorAll('[data-delete-tx]').forEach(b=>b.onclick=e=>{e.stopPropagation();deleteTransaction(b.dataset.deleteTx);});
  bindTransactionSwipes();
}
function hydrateIcons(){
  document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
}

let modalDismissHandler=null;
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
  lockPageForModal();
  root.innerHTML=`<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-grabber" aria-label="下拉关闭"></div>${content}</div></div>`;
  const backdrop=root.querySelector('.modal-backdrop');
  const modal=root.querySelector('.modal');
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeModal({reason:'backdrop'});});
  root.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>closeModal({reason:'cancel'}));
  bindSheetSwipe(modal,backdrop);
}
function closeModal({runDismiss=true,reason='dismiss'}={}){
  const root=document.getElementById('modalRoot');
  const cb=modalDismissHandler;
  modalDismissHandler=null;
  root.innerHTML='';
  unlockPageForModal();
  if(runDismiss&&cb) cb(reason);
}
function modalHead(title,saveLabel='保存',cancelLabel='取消'){ const right=saveLabel===null?'<span></span>':`<button class="save" id="modalSave">${saveLabel}</button>`; return `<div class="modal-head"><button class="cancel" data-close>${cancelLabel}</button><h2>${title}</h2>${right}</div>`; }

function bindSheetSwipe(modal,backdrop){
  const grabber=modal.querySelector('.modal-grabber');
  let startX=0,startY=0,lastY=0,startAt=0,tracking=false,dragging=false,forceHandle=false;
  const pointXY=p=>({x:Number.isFinite(p?.screenX)?p.screenX:p?.clientX||0,y:Number.isFinite(p?.screenY)?p.screenY:p?.clientY||0});
  const reset=()=>{
    tracking=false;dragging=false;forceHandle=false;
    modal.style.transition='transform .18s ease-out';
    backdrop.style.transition='background .18s ease-out';
    modal.style.transform='';backdrop.style.background='';
    setTimeout(()=>{modal.style.transition='';backdrop.style.transition='';},190);
  };
  const beginDrag=()=>{
    if(dragging)return true;
    if(!forceHandle && modal.scrollTop>1)return false;
    const active=document.activeElement;
    if(active&&modal.contains(active)&&active.matches('input,textarea,select')) active.blur();
    dragging=true;startAt=performance.now();
    modal.style.transition='none';backdrop.style.transition='none';
    return true;
  };
  const begin=(point,target,force=false)=>{
    if(target?.closest?.('.drag-handle'))return false;
    // Do not arm sheet dismissal from interactive controls. On iOS a tiny finger
    // drift can otherwise turn a tap into a downward gesture and cancel the click.
    // Blank/card areas still support whole-sheet pull-down dismissal.
    if(!force && target?.closest?.('button,input,textarea,select,a,label,[role="button"]'))return false;
    const p=pointXY(point);startX=p.x;startY=lastY=p.y;tracking=true;dragging=false;forceHandle=force;
    if(force)beginDrag();
    return true;
  };
  const move=point=>{
    if(!tracking)return false;
    const p=pointXY(point);lastY=p.y;
    const dy=lastY-startY,dx=p.x-startX;
    if(!dragging){
      // Normal upward movement keeps scrolling the sheet. A downward gesture from
      // the top of the sheet becomes an iOS-style interactive dismissal.
      if(dy<14 || dy<Math.abs(dx)*1.2)return false;
      if(!beginDrag())return false;
    }
    const down=Math.max(0,dy);
    modal.style.transform=`translateY(${down}px)`;
    backdrop.style.background=`rgba(15,18,15,${Math.max(.08,.38-down/700)})`;
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
      setTimeout(()=>closeModal({reason:'swipe'}),140);
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

function openMonthModal(){
  let {y,mo}=parseMonth(ui.selectedMonth);
  const draw=()=>{
    openModal(`${modalHead('选择月份','完成')}<section class="card month-picker-card"><div class="month-year-nav"><button id="pickerPrevYear" class="month-year-step" type="button" aria-label="上一年">${icon('chevron')}</button><strong id="pickerYear">${y}年</strong><button id="pickerNextYear" class="month-year-step" type="button" aria-label="下一年">${icon('chevron')}</button></div><div class="month-grid" id="monthGrid">${Array.from({length:12},(_,i)=>`<button class="month-cell ${i+1===mo?'selected':''}" data-month-value="${i+1}" type="button"><span>${i+1}</span><small>月</small></button>`).join('')}</div><button class="secondary-button month-current" id="pickerCurrentMonth" type="button">回到本月</button></section>`);
    document.getElementById('pickerPrevYear').onclick=()=>{y--;draw();};
    document.getElementById('pickerNextYear').onclick=()=>{y++;draw();};
    document.querySelectorAll('[data-month-value]').forEach(b=>b.onclick=()=>{mo=Number(b.dataset.monthValue);draw();});
    document.getElementById('pickerCurrentMonth').onclick=()=>{const n=new Date();y=n.getFullYear();mo=n.getMonth()+1;draw();};
    document.getElementById('modalSave').onclick=()=>{ui.selectedMonth=`${y}-${pad(mo)}`;closeModal({runDismiss:false});render();window.scrollTo({top:0,behavior:'smooth'});};
  };
  draw();
}
function shiftMonth(delta){
  const {y,mo}=parseMonth(ui.selectedMonth);const d=new Date(y,mo-1+delta,1);ui.selectedMonth=monthKey(d);render();window.scrollTo({top:0,behavior:'smooth'});
}

function openBudgetModal(){
  const existing=budgetFor(ui.selectedMonth);
  openModal(`${modalHead('月预算')}<section class="card input-card"><label>${monthLabel(ui.selectedMonth)}支出预算</label>${moneyInputMarkup('budgetInput',existing||'','例如 2000','budget-op')}<div class="helper">支持 + − × ÷。每个月可以单独设置和修改。当前月会按“剩余预算 ÷ 包含今天在内的剩余天数”动态计算“今日不宜超过”；收入不会自动提高预算。</div></section>`);
  const readValue=bindMoneyExpressionInput('budgetInput','budget-op');
  document.getElementById('modalSave').onclick=()=>{const parsed=readValue(),v=parsed.value;if(!parsed.ok||v<0){toast('请输入有效预算或算式');return;}data.budgets[ui.selectedMonth]=Math.round(v*100)/100;saveData();closeModal({runDismiss:false});render();toast('月预算已保存');};
}

function openBalanceModal(){
  const initialized=hasInitialBalance();
  const current=currentBalance();
  if(!initialized){
    openModal(`${modalHead('设置初始余额')}<section class="card input-card"><label>开始使用 Airplane 时已有的总余额</label>${moneyInputMarkup('balanceInput','','例如 10000','balance-op')}<div class="helper">支持 + − × ÷。初始余额只用于建立起点。之后收入会增加余额、支出会减少余额；两者都不会改变你手动设置的月预算。</div></section>`);
    const readValue=bindMoneyExpressionInput('balanceInput','balance-op');
    document.getElementById('modalSave').onclick=()=>{const parsed=readValue(),v=parsed.value;if(!parsed.ok){toast('请输入有效余额或算式');return;}data.prefs.initialBalance=Math.round(v*100)/100;saveData();closeModal({runDismiss:false});render();toast('初始余额已保存');};
    return;
  }
  openModal(`${modalHead('调整当前余额')}<section class="card input-card"><label>Airplane 当前余额</label><div class="budget-amount">${amount(current)}</div><label style="margin-top:8px">调整为</label>${moneyInputMarkup('balanceInput',current.toFixed(2),'例如 10000','balance-op')}<div class="helper">支持 + − × ÷。适合补记遗漏造成的余额偏差。余额调整不计入收入、支出，也不会占用月预算。</div></section>`);
  const readValue=bindMoneyExpressionInput('balanceInput','balance-op');
  document.getElementById('modalSave').onclick=()=>{const parsed=readValue(),target=parsed.value;if(!parsed.ok){toast('请输入有效余额或算式');return;}const delta=Math.round((target-current)*100)/100;if(Math.abs(delta)>=0.01)data.balanceAdjustments.push({id:uid('bal'),delta,targetBalance:Math.round(target*100)/100,createdAt:new Date().toISOString()});saveData();closeModal({runDismiss:false});render();toast(Math.abs(delta)>=0.01?'当前余额已调整':'余额没有变化');};
}

function preferredCategoryId(type){
  const saved=type==='expense'?data.prefs.lastExpenseCategoryId:data.prefs.lastIncomeCategoryId;
  const visible=data.categories.filter(c=>c.type===type&&!c.hidden).sort((a,b)=>a.order-b.order);
  return visible.some(c=>c.id===saved)?saved:visible[0]?.id;
}
function loadTransactionDraft(){
  try{
    const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');
    if(!d||!d.savedAt||Date.now()-d.savedAt>DRAFT_TTL_MS){localStorage.removeItem(DRAFT_KEY);return null;}
    return d;
  }catch{localStorage.removeItem(DRAFT_KEY);return null;}
}
function saveTransactionDraft(d){ localStorage.setItem(DRAFT_KEY,JSON.stringify({...d,savedAt:Date.now()})); }
function clearTransactionDraft(){ localStorage.removeItem(DRAFT_KEY); }

function normalizeAmountExpression(raw=''){
  return String(raw)
    .trim()
    .replace(/[，,]/g,'.')
    .replace(/[×xX]/g,'*')
    .replace(/÷/g,'/')
    .replace(/[−–—]/g,'-')
    .replace(/\s+/g,'');
}

// Small local expression parser for the amount field. Deliberately avoids eval().
// Supports +, -, ×/*, ÷// and parentheses while keeping the final ledger amount numeric.
function parseAmountExpression(raw=''){
  const expr=normalizeAmountExpression(raw);
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
  input.addEventListener('input',update);input.addEventListener('change',update);
  document.querySelectorAll(`[data-${group}]`).forEach(button=>{
    button.addEventListener('pointerdown',e=>e.preventDefault());
    button.addEventListener('click',()=>{
      const op=button.getAttribute(`data-${group}`)||'';
      const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
      input.setRangeText(op,start,end,'end');update();
      try{input.focus({preventScroll:true});}catch{input.focus();}
    });
  });
  update();
  return ()=>parseAmountExpression(input.value);
}

function openTransactionModal(existing=null,suppliedDraft=null){
  const restored=suppliedDraft||(!existing?loadTransactionDraft():null);
  let type=restored?.type||existing?.type||'expense';
  let selected=restored?.selectedCategoryId||existing?.categoryId||preferredCategoryId(type);
  const currentTime=new Date().toTimeString().slice(0,5);
  const initial={amount:restored?.amount??(existing?Number(existing.amount).toFixed(2):''),date:restored?.date||existing?.date||localISO(),time:restored?.time||existing?.time||currentTime,note:restored?.note??existing?.note??''};
  let dirty=!!restored;
  const captureDraft=()=>({type,selectedCategoryId:selected,amount:document.getElementById('txAmount')?.value||'',date:document.getElementById('txDate')?.value||localISO(),time:document.getElementById('txTime')?.value||currentTime,note:document.getElementById('txNote')?.value||''});
  const persistDraft=()=>{if(!existing&&dirty)saveTransactionDraft(captureDraft());};
  openModal(`${modalHead(existing?'编辑记录':'记一笔',null)}<div class="segmented"><button id="expenseTab" class="expense">支出</button><button id="incomeTab" class="income">收入</button></div><div class="amount-box"><div class="amount-line"><span>¥</span><input id="txAmount" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0.00" value="${escapeHTML(initial.amount)}"></div><div id="amountCalcPreview" class="amount-calc-preview" aria-live="polite"></div><div class="amount-operators" aria-label="金额快捷计算"><button type="button" data-amount-op="+">＋</button><button type="button" data-amount-op="−">−</button><button type="button" data-amount-op="×">×</button><button type="button" data-amount-op="÷">÷</button></div></div><div class="section-head"><h2>选择分类</h2><button class="text-button organize-categories" id="quickAddCategory">整理分类</button></div><div id="categoryChooser" class="category-grid"></div><button id="txSubmit" class="primary-button transaction-submit">${existing?'保存修改':'完成'}</button><div class="optional-details-label">可选信息</div><div class="form-card transaction-date-card"><div class="form-row"><label>日期</label><input id="txDate" type="date" value="${initial.date}"></div></div><div class="form-card transaction-optional-card"><div class="form-row"><label>时间</label><input id="txTime" type="time" value="${initial.time}"></div><div class="form-row"><label>备注</label><textarea id="txNote" placeholder="可选">${escapeHTML(initial.note)}</textarea></div></div>${existing?'<button id="txDelete" class="danger-button" style="margin-top:10px">删除这笔记录</button>':''}`,{onDismiss:reason=>{if(existing)return;if(reason==='cancel')clearTransactionDraft();else persistDraft();}});
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
    document.getElementById('categoryChooser').innerHTML=cats.map(c=>`<button class="category-choice ${c.id===selected?'selected':''}" data-cat="${c.id}" style="--choice-color:${c.color}"><span class="category-symbol" style="color:${c.color};background:${tint(c.color)}">${icon(c.icon)}</span><small>${escapeHTML(c.name)}</small></button>`).join('');
    document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{selected=b.dataset.cat;markDirty();renderChooser();});
  };
  document.getElementById('expenseTab').onclick=()=>{type='expense';selected=preferredCategoryId(type);markDirty();renderChooser();};
  document.getElementById('incomeTab').onclick=()=>{type='income';selected=preferredCategoryId(type);markDirty();renderChooser();};
  ['txAmount','txDate','txTime','txNote'].forEach(id=>{const el=document.getElementById(id);el?.addEventListener('input',()=>{markDirty();if(id==='txAmount')updateAmountPreview();});el?.addEventListener('change',()=>{markDirty();if(id==='txAmount')updateAmountPreview();});});
  document.querySelectorAll('[data-amount-op]').forEach(button=>{
    button.addEventListener('pointerdown',e=>e.preventDefault());
    button.addEventListener('click',()=>{
      const input=amountInput;if(!input)return;
      const op=button.dataset.amountOp||'';
      const start=input.selectionStart??input.value.length;
      const end=input.selectionEnd??start;
      input.setRangeText(op,start,end,'end');
      dirty=true;persistDraft();updateAmountPreview();
      try{input.focus({preventScroll:true});}catch{input.focus();}
    });
  });
  updateAmountPreview();
  document.getElementById('quickAddCategory').onclick=()=>{
    const draft={...captureDraft(),savedAt:Date.now()};dirty=true;saveTransactionDraft(draft);
    openCategoryManager(type,{fromTransaction:true,draft,existing,onReturn:(returnType)=>openTransactionModal(existing,{...draft,type:returnType,selectedCategoryId:(returnType===type?selected:preferredCategoryId(returnType))})});
  };
  renderChooser();
  const submit=()=>{
    const parsedAmount=parseAmountExpression(document.getElementById('txAmount').value); const value=parsedAmount.value; const c=categoryById(selected);
    if(!parsedAmount.ok||!value||value<=0){toast('请输入有效金额或算式');return;} if(!c){toast('请选择分类');return;}
    const record={id:existing?.id||uid('tx'),type,amount:Math.round(value*100)/100,categoryId:c.id,categoryName:c.name,categoryIcon:c.icon,categoryColor:c.color,note:document.getElementById('txNote').value.trim(),date:document.getElementById('txDate').value||localISO(),time:document.getElementById('txTime').value||currentTime,createdAt:existing?.createdAt||new Date().toISOString()};
    if(existing){const i=data.transactions.findIndex(t=>t.id===existing.id);data.transactions[i]=record;} else data.transactions.push(record);
    if(type==='expense')data.prefs.lastExpenseCategoryId=c.id;else data.prefs.lastIncomeCategoryId=c.id;
    clearTransactionDraft();saveData();closeModal({runDismiss:false});render();toast(existing?'记录已修改':'已记下');
  };
  document.getElementById('txSubmit').onclick=submit;
  document.getElementById('txDelete')?.addEventListener('click',()=>{closeModal({runDismiss:false});deleteTransaction(existing.id);});
}

function deleteTransaction(id){
  const index=data.transactions.findIndex(x=>x.id===id);if(index<0)return;
  const removed=data.transactions[index];data.transactions.splice(index,1);saveData();render();
  toast('记录已删除',{actionLabel:'撤销',duration:3600,onAction:()=>{if(data.transactions.some(t=>t.id===removed.id))return;data.transactions.splice(Math.min(index,data.transactions.length),0,removed);saveData();render();toast('已恢复记录');}});
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
    document.getElementById('categoryManageList').innerHTML=list.map(c=>`<div class="category-manage-row" data-category-row="${c.id}"><button class="drag-handle" data-drag-cat="${c.id}" type="button" aria-label="拖动${escapeHTML(c.name)}排序"><span></span><span></span><span></span></button><span class="category-symbol" style="width:38px;height:38px;color:${c.color};background:${tint(c.color)}">${icon(c.icon)}</span><span class="name">${escapeHTML(c.name)}</span><span class="category-row-actions"><button class="pill action-pill" data-toggle-cat="${c.id}">${c.hidden?'显示':'隐藏'}</button><button class="pill action-pill" data-edit-cat="${c.id}">编辑</button><button class="pill action-pill negative" data-remove-cat="${c.id}">删除</button></span></div>`).join('');
    document.querySelectorAll('[data-toggle-cat]').forEach(b=>b.onclick=()=>{const c=categoryById(b.dataset.toggleCat);if(!c)return;if(!c.hidden&&data.categories.filter(x=>x.type===type&&!x.hidden).length<=1){toast('至少保留一个可用分类');return;}c.hidden=!c.hidden;saveData();draw();});
    document.querySelectorAll('[data-edit-cat]').forEach(b=>b.onclick=()=>openCategoryEditor(type,categoryById(b.dataset.editCat),{cancelLabel:'返回',onBack:()=>draw(),onDone:saved=>draw(saved?.id)}));
    document.querySelectorAll('[data-remove-cat]').forEach(b=>b.onclick=()=>removeCategory(b.dataset.removeCat,type,()=>draw()));
    document.getElementById('addCategory').onclick=()=>openCategoryEditor(type,null,{cancelLabel:'返回',onBack:()=>draw(),onDone:saved=>draw(saved?.id)});
    bindCategoryReorder(type);
    if(focusId){
      requestAnimationFrame(()=>{
        const row=document.querySelector(`[data-category-row="${focusId}"]`);
        row?.scrollIntoView?.({block:'nearest',behavior:'smooth'});
      });
    }
  };
  draw();
}

function bindCategoryReorder(type){
  const container=document.getElementById('categoryManageList');if(!container)return;
  const rows=()=>[...container.querySelectorAll('[data-category-row]')];
  const saveOrder=()=>{rows().forEach((r,i)=>{const c=categoryById(r.dataset.categoryRow);if(c)c.order=i;});saveData();};
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
  const iconOptions=['food','coffee','car','bus','train','parking','bag','clothes','game','house','building','water','bolt','flame','washing','phone','wifi','subscription','package','wrench','scissors','paw','book','health','travel','gift','briefcase','laptop','award','coins','trend','refund','more'];
  const colors=['#F29B69','#E8B45F','#72B77A','#65BFA3','#6FA8DC','#7797DB','#AA82E3','#E77BA6','#E78378','#9AA09A','#5F9FE5','#4CB487'];
  openModal(`${modalHead(existing?'编辑分类':'添加分类','保存',options.cancelLabel||'取消')}<section class="card input-card"><label>分类名称</label><input id="catName" class="large-input" maxlength="8" placeholder="例如 咖啡" value="${escapeHTML(existing?.name||'')}"></section><div class="section-head" style="margin-top:14px"><h2>图标</h2></div><section class="card"><div class="icon-palette" id="iconPalette"></div></section><div class="section-head"><h2>颜色</h2></div><section class="card"><div class="color-palette" id="colorPalette"></div></section>`,{onDismiss:options.onBack||null});
  const draw=()=>{
    document.getElementById('iconPalette').innerHTML=iconOptions.map(i=>`<button class="icon-choice ${i===selectedIcon?'selected':''}" data-icon-choice="${i}">${icon(i)}</button>`).join('');
    document.getElementById('colorPalette').innerHTML=colors.map(c=>`<button class="color-swatch ${c===selectedColor?'selected':''}" data-color="${c}" style="background:${c}"></button>`).join('');
    document.querySelectorAll('[data-icon-choice]').forEach(b=>b.onclick=()=>{selectedIcon=b.dataset.iconChoice;draw();});
    document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{selectedColor=b.dataset.color;draw();});
  }; draw();
  document.getElementById('modalSave').onclick=()=>{
    const name=document.getElementById('catName').value.trim(); if(!name){toast('请输入分类名称');return;}
    let saved=existing;
    if(existing){existing.name=name;existing.icon=selectedIcon;existing.color=selectedColor;} else {const order=Math.max(-1,...data.categories.filter(c=>c.type===type).map(c=>c.order))+1;saved={id:uid('cat'),name,type,icon:selectedIcon,color:selectedColor,custom:true,hidden:false,order};data.categories.push(saved);}
    saveData();closeModal({runDismiss:false});options.onDone?.(saved);toast(existing?'分类已修改':'分类已添加');
  };
}

function removeCategory(id,type,onDone){
  const c=categoryById(id); if(!c)return;
  if(data.categories.filter(x=>x.type===type).length<=1){toast('至少保留一个分类');return;}
  if(!confirm(`删除分类“${c.name}”？历史账单会继续保留原来的分类名称和图标。`)) return;
  data.categories=data.categories.filter(x=>x.id!==id);
  if(data.prefs.lastExpenseCategoryId===id)data.prefs.lastExpenseCategoryId=null;
  if(data.prefs.lastIncomeCategoryId===id)data.prefs.lastIncomeCategoryId=null;
  saveData();onDone?.();toast('分类已删除，历史账单已保留');
}
function downloadBlob(filename,content,type){ const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500); }
function exportJSON(){ const backup={app:'Airplane',exportedAt:new Date().toISOString(),data}; downloadBlob(`Airplane-backup-${localISO()}.json`,JSON.stringify(backup,null,2),'application/json');toast('完整备份已导出'); }
function exportCSV(){
  const rows=[['日期','时间','类型','金额','分类','备注'],...data.transactions.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(t=>[t.date,t.time||'',t.type==='expense'?'支出':'收入',Number(t.amount).toFixed(2),t.categoryName||txSnapshotCategory(t).name,t.note||''])];
  const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');downloadBlob(`Airplane-records-${localISO()}.csv`,csv,'text/csv;charset=utf-8');toast('CSV 已导出');
}
function resetAll(){ if(!confirm('确定清空这台设备里的所有 Airplane 数据？建议先导出完整备份。'))return; if(!confirm('再次确认：余额、预算、分类和账单都会被清空。'))return; data=freshData();saveData();ui.selectedMonth=monthKey(new Date());render();toast('本机数据已清空'); }
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
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{ui.tab=b.dataset.tab;render();window.scrollTo({top:0,behavior:'smooth'});});
document.getElementById('addButton').onclick=()=>openTransactionModal();
document.getElementById('monthButton').onclick=openMonthModal;
document.getElementById('prevMonthButton')?.addEventListener('click',()=>shiftMonth(-1));
document.getElementById('nextMonthButton')?.addEventListener('click',()=>shiftMonth(1));
document.getElementById('settingsButton').onclick=openSettingsModal;
document.getElementById('importInput').addEventListener('change', async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{const parsed=JSON.parse(await file.text());const incoming=normalizeData(parsed.data||parsed);if(!confirm('恢复此备份会替换当前设备上的 Airplane 数据。继续吗？'))return;data=incoming;saveData();render();toast('备份已恢复');}catch(err){toast('无法识别这个 Airplane 备份');}
});

let swReloading=false;
let updateReloadFallbackTimer=null;
let airplaneRegistration=null;
let updateToastShown=false;
let pendingUpdateWorker=null;
const UPDATE_CHECK_KEY='airplane-last-update-check-v1';
const UPDATE_ACTIVE_INTERVAL_MS=15*60*1000;
const UPDATE_RESUME_INTERVAL_MS=5*60*1000;
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

function showUpdateAvailable(worker=null){
  if(worker)pendingUpdateWorker=worker;
  if(updateToastShown)return;
  updateToastShown=true;
  toast('发现 Airplane 新版本',{actionLabel:'更新',duration:12000,onAction:activateWaitingServiceWorker});
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
    const registration=airplaneRegistration||await navigator.serviceWorker.getRegistration('./');
    if(!registration){if(showToast)toast('更新服务尚未就绪');return;}
    airplaneRegistration=registration;
    observeServiceWorkerRegistration(registration);
    updateToastShown=false;
    await registration.update();
    localStorage.setItem(UPDATE_CHECK_KEY,String(Date.now()));
    if(registration.waiting){showUpdateAvailable(registration.waiting);return;}
    if(showToast){
      if(registration.installing){toast('发现新版，正在后台准备…',{duration:2600});}
      else toast('已检查，当前已是最新版本');
    }
  }catch(err){
    console.warn('Airplane update check failed',err);
    if(showToast)toast('暂时无法连接更新服务器，继续使用本地版本');
  }
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
  // Launch always renders from the local shell first. The first network check is
  // deferred, so update discovery never sits on the startup critical path.
  setTimeout(()=>backgroundUpdateIfDue(UPDATE_RESUME_INTERVAL_MS),6000);
  if(updateIntervalTimer)clearInterval(updateIntervalTimer);
  updateIntervalTimer=setInterval(()=>backgroundUpdateIfDue(UPDATE_ACTIVE_INTERVAL_MS),UPDATE_ACTIVE_INTERVAL_MS);
}
function bindForegroundUpdateChecks(){
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')setTimeout(()=>backgroundUpdateIfDue(UPDATE_RESUME_INTERVAL_MS),700);
  });
  window.addEventListener('online',()=>setTimeout(()=>backgroundUpdateIfDue(UPDATE_RESUME_INTERVAL_MS),700));
}

async function registerAirplaneServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  try{
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      pendingUpdateWorker=null;
      if(!swReloading)return;
      clearTimeout(updateReloadFallbackTimer);
      // Give the newly activated worker a brief moment to claim the client and
      // finish cache cleanup, then reload through its fresh shell cache.
      setTimeout(()=>window.location.reload(),120);
    });
    airplaneRegistration=await navigator.serviceWorker.getRegistration('./');
    if(!airplaneRegistration){
      airplaneRegistration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    }
    observeServiceWorkerRegistration(airplaneRegistration);
    scheduleBackgroundUpdateCheck();
  }catch(err){
    console.warn('Airplane Service Worker setup failed',err);
  }
}

window.addEventListener('load',()=>{registerAirplaneServiceWorker();bindForegroundUpdateChecks();});
render();
ensurePersistentStorage();
