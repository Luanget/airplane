
// STORAGE_KEY is intentionally permanent. Never rename it in a normal app update.
// Keeping one stable key lets new program versions reuse the user's existing ledger.
const STORAGE_KEY = 'airplane-pwa-v1';
const RECOVERY_KEY = 'airplane-pwa-recovery-v1';
const SCHEMA_VERSION = 3;
const APP_VERSION = '0.5.0';
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
].map((c,i)=>({id:`default-${i+1}`,name:c[0],type:c[1],icon:c[2],color:c[3],custom:false,hidden:false,order:i}));

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
function txForMonth(m){ return data.transactions.filter(t=>t.date.startsWith(m)); }
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

function budgetMetrics(m){
  const budget=budgetFor(m), totals=monthTotals(m), dim=daysInMonth(m), now=new Date();
  const current=isCurrentMonth(m);
  const elapsed = current ? now.getDate() : dim;
  const baseDaily = budget>0 ? budget/dim : 0;
  const plannedToDate = baseDaily*elapsed;
  const delta = totals.expense-plannedToDate;
  const remainingBudget = budget-totals.expense;
  const today = localISO(now);
  const todayExpense = current ? data.transactions.filter(t=>t.type==='expense'&&t.date===today).reduce((s,t)=>s+Number(t.amount),0) : 0;
  const expenseBeforeToday = current ? Math.max(totals.expense-todayExpense,0) : totals.expense;
  const remainingDays = current ? Math.max(dim-now.getDate()+1,1) : dim;
  const dailyLimit = current ? (budget>0 ? Math.max(budget-expenseBeforeToday,0)/remainingDays : 0) : baseDaily;
  const todayDelta = todayExpense-dailyLimit;
  const timeProgress = elapsed/dim;
  const budgetProgress = budget>0 ? totals.expense/budget : 0;
  const projection = elapsed>0 ? totals.expense/elapsed*dim : 0;
  return {budget,...totals,dim,elapsed,baseDaily,dailyLimit,plannedToDate,delta,remainingBudget,remainingDays,todayExpense,todayDelta,timeProgress,budgetProgress,projection};
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
    if(ui.tab==='settings') render();
    if(showToast) toast('当前浏览器不支持持久化存储申请');
    return false;
  }
  try{
    let persisted=await navigator.storage.persisted();
    if(!persisted) persisted=await navigator.storage.persist();
    storageProtection.persisted=!!persisted;
    storageProtection.checked=true;
    if(ui.tab==='settings') render();
    if(showToast) toast(persisted?'本地数据保护已启用':'系统暂未授予持久化存储');
    return !!persisted;
  }catch(err){
    console.warn('Persistent storage request failed', err);
    storageProtection.persisted=false;
    storageProtection.checked=true;
    if(ui.tab==='settings') render();
    if(showToast) toast('持久化存储检查失败');
    return false;
  }
}

function render(){
  document.getElementById('monthButton').innerHTML = `${monthLabel(ui.selectedMonth)} ${icon('chevron')}`;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===ui.tab));
  const app=document.getElementById('app');
  app.innerHTML = ui.tab==='home' ? renderHome() : ui.tab==='records' ? renderRecords() : ui.tab==='stats' ? renderStats() : renderSettings();
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
  if(!m.budget){
    return `<div class="stack">
      ${balanceCard()}
      <section class="card hero empty">
        <div class="empty-icon">${icon('wallet')}</div>
        <h3>先设置${current?'本月':'这个月'}预算</h3>
        <p>预算由你每个月单独填写。设置后 Airplane 会根据此前实际支出动态计算今天的控制额度。</p>
        <button class="primary-button" data-action="budget">设置${current?'本月':'该月'}预算</button>
      </section>
      ${recentCard()}
    </div>`;
  }
  const heroLabel = current ? '今日不宜超过' : '当月日均预算';
  const status = current ? (m.todayDelta>0 ? `<span class="negative">今日已超出 ${amount(m.todayDelta)}</span>` : `<span class="positive">今日还可支出 ${amount(Math.max(-m.todayDelta,0))}</span>`) : `<span class="muted">按当月预算平均计算</span>`;
  const planText = m.delta>0 ? `多支出 ${amount(m.delta)}` : `节省 ${amount(Math.abs(m.delta))}`;
  const planClass = m.delta>0 ? 'negative' : 'positive';
  const useRatio = current ? (m.dailyLimit>0 ? m.todayExpense/m.dailyLimit : (m.todayExpense>0?1:0)) : m.budgetProgress;
  return `<div class="stack">
    ${balanceCard()}
    <section class="card hero">
      <div class="eyebrow">${heroLabel}</div>
      <div class="big-money"><small>¥</small>${m.dailyLimit.toFixed(2)}</div>
      <div class="hero-status">${status}</div>
      ${current?`<div class="metric-grid"><div class="metric"><div class="metric-label">今日已支出</div><div class="metric-value">${amount(m.todayExpense)}</div></div><div class="metric"><div class="metric-label">今日动态额度</div><div class="metric-value">${amount(m.dailyLimit)}</div></div></div>`:''}
      <div class="progress-row"><div class="progress-meta"><span>${current?'今日':'月均'}使用</span><span>${pct(useRatio)}</span></div><div class="progress ${current&&m.todayDelta>0?'danger':''}"><span style="width:${Math.min(useRatio*100,100)}%"></span></div></div>
    </section>

    <section class="card budget-card">
      <div class="budget-top"><div><div class="eyebrow">本月预算</div><div class="budget-amount">${amount(m.expense)} <span class="of">/ ${amount(m.budget)}</span></div></div><button class="text-button" data-action="budget">编辑</button></div>
      <div class="progress-row"><div class="progress-meta"><span>预算使用 ${pct(m.budgetProgress)}</span><span>时间进度 ${pct(m.timeProgress)}</span></div><div class="progress ${m.budgetProgress>m.timeProgress?'danger':''}"><span style="width:${Math.min(m.budgetProgress*100,100)}%"></span></div></div>
      <div class="plan-grid">
        <div class="plan-tile"><div class="metric-label">本月较计划</div><strong class="${planClass}">${planText}</strong></div>
        <div class="plan-tile"><div class="metric-label">剩余预算</div><strong class="${m.remainingBudget<0?'negative':''}">${amount(m.remainingBudget)}</strong></div>
      </div>
    </section>
    ${recentCard()}
  </div>`;
}

function recentCard(){
  const items=[...txForMonth(ui.selectedMonth)].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).slice(0,5);
  return `<div class="section-head"><h2>最近记录</h2>${items.length?'<button class="text-button" data-action="go-records">全部</button>':''}</div>
  <section class="card transaction-list">${items.length?items.map(txRow).join(''):`<div class="empty"><div class="empty-icon">${icon('list')}</div><h3>还没有记录</h3><p>点击下方绿色 ＋ 记下第一笔。</p></div>`}</section>`;
}

function txRow(t, actions=false){
  const c=txSnapshotCategory(t); const sign=t.type==='expense'?'-':'+'; const cls=t.type==='expense'?'':'positive';
  return `<div class="tx-row">
    <div class="category-symbol" style="color:${c.color};background:${tint(c.color)}">${icon(c.icon)}</div>
    <div class="tx-main"><div class="tx-title">${escapeHTML(c.name)}</div><div class="tx-sub">${escapeHTML(t.note||dateDisplay(t.date))}</div>${actions?`<div class="swipe-actions"><button class="row-action" data-edit-tx="${t.id}">编辑</button><button class="row-action delete" data-delete-tx="${t.id}">删除</button></div>`:''}</div>
    <div><div class="tx-money ${cls}">${sign}${amount(t.amount)}</div><div class="tx-time">${escapeHTML(t.time||'')}</div></div>
  </div>`;
}

function renderRecords(){
  let tx=[...txForMonth(ui.selectedMonth)];
  if(ui.recordFilter!=='all') tx=tx.filter(t=>t.type===ui.recordFilter);
  tx.sort((a,b)=>(b.date+(b.time||'')).localeCompare(a.date+(a.time||'')));
  const groups=Object.groupBy ? Object.groupBy(tx,t=>t.date) : tx.reduce((g,t)=>((g[t.date]??=[]).push(t),g),{});
  const body=Object.keys(groups).sort().reverse().map(date=>{
    const rows=groups[date], sum=rows.reduce((s,t)=>s+(t.type==='expense'?-Number(t.amount):Number(t.amount)),0);
    return `<div class="day-group"><div class="day-head"><span>${dateDisplay(date)} ${weekday(date)}</span><span class="${sum>=0?'positive':'negative'}">${sum>=0?'+':'-'}${amount(Math.abs(sum))}</span></div><section class="card transaction-list">${rows.map(t=>txRow(t,true)).join('')}</section></div>`;
  }).join('');
  return `<div class="stack"><div class="section-head"><h2>明细</h2><span class="muted" style="font-size:12px">${monthLabel(ui.selectedMonth)}</span></div>
    <div class="filters"><button class="filter ${ui.recordFilter==='all'?'active':''}" data-filter="all">全部</button><button class="filter ${ui.recordFilter==='expense'?'active':''}" data-filter="expense">支出</button><button class="filter ${ui.recordFilter==='income'?'active':''}" data-filter="income">收入</button></div>
    ${body||`<section class="card empty"><div class="empty-icon">${icon('list')}</div><h3>这个月还没有记录</h3><p>记账后会按日期自动整理在这里。</p></section>`}
  </div>`;
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

function renderSettings(){
  const b=budgetFor(ui.selectedMonth);
  const protection=storageProtectionStatus();
  return `<div class="stack"><div class="section-head"><h2>设置</h2></div>
    <section class="card settings-section">
      <button class="setting-row" data-action="balance"><span class="mini-icon">${icon('wallet')}</span><span class="setting-copy"><span class="setting-title">当前余额</span><span class="setting-sub">${hasInitialBalance()?amount(currentBalance()):'未设置初始余额'}</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="budget"><span class="mini-icon">${icon('calendar')}</span><span class="setting-copy"><span class="setting-title">月预算</span><span class="setting-sub">${monthLabel(ui.selectedMonth)} · ${b?amount(b):'未设置'}</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="categories"><span class="mini-icon">${icon('list')}</span><span class="setting-copy"><span class="setting-title">分类管理</span><span class="setting-sub">默认分类 + 自定义收入/支出分类</span></span><span class="chevron">${icon('chevron')}</span></button>
    </section>
    <div class="section-head"><h2>数据</h2></div>
    <section class="card settings-section">
      <button class="setting-row" data-action="export-json"><span class="mini-icon">${icon('download')}</span><span class="setting-copy"><span class="setting-title">完整备份</span><span class="setting-sub">导出 JSON，可完整恢复预算、分类和账单</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="export-csv"><span class="mini-icon">${icon('file')}</span><span class="setting-copy"><span class="setting-title">导出明细 CSV</span><span class="setting-sub">方便在 Excel / Numbers 中查看</span></span><span class="chevron">${icon('chevron')}</span></button>
      <button class="setting-row" data-action="import"><span class="mini-icon">${icon('upload')}</span><span class="setting-copy"><span class="setting-title">恢复备份</span><span class="setting-sub">从 Airplane JSON 备份恢复</span></span><span class="chevron">${icon('chevron')}</span></button>
    </section>
    <div class="section-head"><h2>安装与隐私</h2></div>
    <section class="card settings-section">
      <button class="setting-row" data-action="storage-persist"><span class="mini-icon">${icon('shield')}</span><span class="setting-copy"><span class="setting-title">本地数据保护</span><span class="setting-sub ${protection.cls}">${protection.label}</span></span><span class="chevron">${icon('chevron')}</span></button>
    </section>
    <section class="card"><div class="helper"><strong style="color:var(--text)">iPhone 安装：</strong>Safari 打开 Airplane → 分享 → 添加到主屏幕。安装后请长期从主屏幕 Airplane 使用；Safari 网页与主屏幕 App 在 iOS 上属于不同的本地数据空间，不会自动同步。<br><br>主屏幕 Airplane 在联网启动时会检查程序更新；更新只替换程序缓存，不会重建余额、预算、分类或账单。Airplane 也会自动申请持久化存储。人为清除网站数据、删除 App 或换手机前仍请先做“完整备份”。<br><br>当前程序版本：${APP_VERSION}</div></section>
    <button class="danger-button" data-action="reset">清空本机全部数据</button>
  </div>`;
}

function bindViewEvents(){
  document.querySelectorAll('[data-action="budget"]').forEach(b=>b.onclick=()=>openBudgetModal());
  document.querySelectorAll('[data-action="balance"]').forEach(b=>b.onclick=()=>openBalanceModal());
  document.querySelector('[data-action="go-records"]')?.addEventListener('click',()=>{ui.tab='records';render();});
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{ui.recordFilter=b.dataset.filter;render();});
  document.querySelectorAll('[data-edit-tx]').forEach(b=>b.onclick=()=>openTransactionModal(data.transactions.find(t=>t.id===b.dataset.editTx)));
  document.querySelectorAll('[data-delete-tx]').forEach(b=>b.onclick=()=>deleteTransaction(b.dataset.deleteTx));
  document.querySelector('[data-action="categories"]')?.addEventListener('click',openCategoryManager);
  document.querySelector('[data-action="export-json"]')?.addEventListener('click',exportJSON);
  document.querySelector('[data-action="export-csv"]')?.addEventListener('click',exportCSV);
  document.querySelector('[data-action="import"]')?.addEventListener('click',()=>document.getElementById('importInput').click());
  document.querySelector('[data-action="storage-persist"]')?.addEventListener('click',()=>ensurePersistentStorage(true));
  document.querySelector('[data-action="reset"]')?.addEventListener('click',resetAll);
}

function hydrateIcons(){
  document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
}

function openModal(content){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-grabber"></div>${content}</div></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();});
  root.querySelectorAll('[data-close]').forEach(b=>b.onclick=closeModal);
}
function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
function modalHead(title,saveLabel='保存'){ return `<div class="modal-head"><button class="cancel" data-close>取消</button><h2>${title}</h2><button class="save" id="modalSave">${saveLabel}</button></div>`; }

function openMonthModal(){
  openModal(`${modalHead('选择月份','完成')}<section class="card input-card"><label>查看月份</label><input id="monthInput" class="large-input" type="month" value="${ui.selectedMonth}"></section>`);
  document.getElementById('modalSave').onclick=()=>{const v=document.getElementById('monthInput').value;if(v){ui.selectedMonth=v;closeModal();render();}};
}

function openBudgetModal(){
  const existing=budgetFor(ui.selectedMonth);
  openModal(`${modalHead('月预算')}<section class="card input-card"><label>${monthLabel(ui.selectedMonth)}支出预算</label><input id="budgetInput" class="large-input" inputmode="decimal" placeholder="例如 2000" value="${existing||''}"><div class="helper">每个月可以单独设置和修改。当前月会按“剩余预算 ÷ 包含今天在内的剩余天数”动态计算“今日不宜超过”；收入不会自动提高预算。</div></section>`);
  const input=document.getElementById('budgetInput'); input.focus();
  document.getElementById('modalSave').onclick=()=>{const v=Number(input.value.replace(',','.')); if(!Number.isFinite(v)||v<0){toast('请输入有效预算');return;} data.budgets[ui.selectedMonth]=Math.round(v*100)/100;saveData();closeModal();render();toast('月预算已保存');};
}

function openBalanceModal(){
  const initialized=hasInitialBalance();
  const current=currentBalance();
  if(!initialized){
    openModal(`${modalHead('设置初始余额')}<section class="card input-card"><label>开始使用 Airplane 时已有的总余额</label><input id="balanceInput" class="large-input" inputmode="decimal" placeholder="例如 10000"><div class="helper">初始余额只用于建立起点。之后收入会增加余额、支出会减少余额；两者都不会改变你手动设置的月预算。</div></section>`);
    const input=document.getElementById('balanceInput'); input.focus();
    document.getElementById('modalSave').onclick=()=>{const v=Number(input.value.replace(',','.')); if(!Number.isFinite(v)){toast('请输入有效余额');return;} data.prefs.initialBalance=Math.round(v*100)/100;saveData();closeModal();render();toast('初始余额已保存');};
    return;
  }
  openModal(`${modalHead('调整当前余额')}<section class="card input-card"><label>Airplane 当前余额</label><div class="budget-amount">${amount(current)}</div><label style="margin-top:8px">调整为</label><input id="balanceInput" class="large-input" inputmode="decimal" value="${current.toFixed(2)}"><div class="helper">适合补记遗漏造成的余额偏差。余额调整不计入收入、支出，也不会占用月预算。</div></section>`);
  const input=document.getElementById('balanceInput'); input.focus(); input.select();
  document.getElementById('modalSave').onclick=()=>{const target=Number(input.value.replace(',','.')); if(!Number.isFinite(target)){toast('请输入有效余额');return;} const delta=Math.round((target-current)*100)/100; if(Math.abs(delta)>=0.01)data.balanceAdjustments.push({id:uid('bal'),delta,targetBalance:Math.round(target*100)/100,createdAt:new Date().toISOString()});saveData();closeModal();render();toast(Math.abs(delta)>=0.01?'当前余额已调整':'余额没有变化');};
}

function openTransactionModal(existing=null){
  let type=existing?.type||'expense';
  let selected=existing?.categoryId||data.categories.find(c=>c.type===type&&!c.hidden)?.id;
  const currentTime=new Date().toTimeString().slice(0,5);
  openModal(`${modalHead(existing?'编辑记录':'记一笔')}<div class="segmented"><button id="expenseTab" class="expense">支出</button><button id="incomeTab" class="income">收入</button></div><div class="amount-box"><div class="amount-line"><span>¥</span><input id="txAmount" inputmode="decimal" placeholder="0.00" value="${existing?Number(existing.amount).toFixed(2):''}"></div></div><div class="section-head"><h2>选择分类</h2><button class="text-button" id="quickAddCategory">＋ 添加分类</button></div><div id="categoryChooser" class="category-grid"></div><div class="form-card"><div class="form-row"><label>日期</label><input id="txDate" type="date" value="${existing?.date||localISO()}"></div><div class="form-row"><label>时间</label><input id="txTime" type="time" value="${existing?.time||currentTime}"></div><div class="form-row"><label>备注</label><textarea id="txNote" placeholder="可选">${escapeHTML(existing?.note||'')}</textarea></div></div><button id="txSubmit" class="primary-button" style="margin-top:14px">${existing?'保存修改':'完成'}</button>${existing?'<button id="txDelete" class="danger-button" style="margin-top:10px">删除这笔记录</button>':''}`);
  const renderChooser=()=>{
    document.getElementById('expenseTab').className=`expense ${type==='expense'?'active':''}`;
    document.getElementById('incomeTab').className=`income ${type==='income'?'active':''}`;
    const cats=data.categories.filter(c=>c.type===type&&!c.hidden).sort((a,b)=>a.order-b.order);
    if(!cats.some(c=>c.id===selected)) selected=cats[0]?.id;
    document.getElementById('categoryChooser').innerHTML=cats.map(c=>`<button class="category-choice ${c.id===selected?'selected':''}" data-cat="${c.id}" style="--choice-color:${c.color}"><span class="category-symbol" style="color:${c.color};background:${tint(c.color)}">${icon(c.icon)}</span><small>${escapeHTML(c.name)}</small></button>`).join('');
    document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{selected=b.dataset.cat;renderChooser();});
  };
  document.getElementById('expenseTab').onclick=()=>{type='expense';selected=null;renderChooser();};
  document.getElementById('incomeTab').onclick=()=>{type='income';selected=null;renderChooser();};
  document.getElementById('quickAddCategory').onclick=()=>openCategoryEditor(type,null,()=>openTransactionModal(existing));
  renderChooser();
  const submit=()=>{
    const value=Number(document.getElementById('txAmount').value.replace(',','.')); const c=categoryById(selected);
    if(!value||value<=0){toast('请输入金额');return;} if(!c){toast('请选择分类');return;}
    const record={id:existing?.id||uid('tx'),type,amount:Math.round(value*100)/100,categoryId:c.id,categoryName:c.name,categoryIcon:c.icon,categoryColor:c.color,note:document.getElementById('txNote').value.trim(),date:document.getElementById('txDate').value||localISO(),time:document.getElementById('txTime').value||currentTime,createdAt:existing?.createdAt||new Date().toISOString()};
    if(existing){const i=data.transactions.findIndex(t=>t.id===existing.id);data.transactions[i]=record;} else data.transactions.push(record);
    saveData();closeModal();render();toast(existing?'记录已修改':'已记下');
  };
  document.getElementById('txSubmit').onclick=submit;
  document.getElementById('modalSave').onclick=submit;
  document.getElementById('txDelete')?.addEventListener('click',()=>{closeModal();deleteTransaction(existing.id);});
  setTimeout(()=>document.getElementById('txAmount')?.focus(),50);
}

function deleteTransaction(id){
  const t=data.transactions.find(x=>x.id===id); if(!t) return;
  if(!confirm(`删除这笔 ${amount(t.amount)} 的记录？`)) return;
  data.transactions=data.transactions.filter(x=>x.id!==id);saveData();render();toast('记录已删除');
}

function openCategoryManager(initialType='expense'){
  let type=initialType;
  const draw=()=>{
    openModal(`${modalHead('分类管理','完成')}<div class="segmented"><button id="catExpense" class="expense ${type==='expense'?'active':''}">支出分类</button><button id="catIncome" class="income ${type==='income'?'active':''}">收入分类</button></div><section class="card" style="margin-top:14px" id="categoryManageList"></section><button class="secondary-button" id="addCategory" style="margin-top:12px;color:var(--green)">＋ 添加自定义分类</button>`);
    document.getElementById('modalSave').onclick=closeModal;
    document.getElementById('catExpense').onclick=()=>{type='expense';draw();};
    document.getElementById('catIncome').onclick=()=>{type='income';draw();};
    const list=data.categories.filter(c=>c.type===type).sort((a,b)=>a.order-b.order);
    document.getElementById('categoryManageList').innerHTML=list.map(c=>`<div class="category-manage-row"><span class="category-symbol" style="width:38px;height:38px;color:${c.color};background:${tint(c.color)}">${icon(c.icon)}</span><span class="name">${escapeHTML(c.name)} ${c.custom?'':'<span class="pill">默认</span>'}</span><button class="pill" data-toggle-cat="${c.id}">${c.hidden?'显示':'隐藏'}</button>${c.custom?`<button class="pill" data-edit-cat="${c.id}">编辑</button><button class="pill negative" data-remove-cat="${c.id}">删除</button>`:''}</div>`).join('');
    document.querySelectorAll('[data-toggle-cat]').forEach(b=>b.onclick=()=>{const c=categoryById(b.dataset.toggleCat);c.hidden=!c.hidden;saveData();draw();});
    document.querySelectorAll('[data-edit-cat]').forEach(b=>b.onclick=()=>openCategoryEditor(type,categoryById(b.dataset.editCat),()=>openCategoryManager(type)));
    document.querySelectorAll('[data-remove-cat]').forEach(b=>b.onclick=()=>removeCategory(b.dataset.removeCat,type));
    document.getElementById('addCategory').onclick=()=>openCategoryEditor(type,null,()=>openCategoryManager(type));
  }; draw();
}

function openCategoryEditor(type,existing=null,onDone=null){
  let selectedIcon=existing?.icon||(type==='expense'?'coffee':'coins'); let selectedColor=existing?.color||(type==='expense'?'#EFA06D':'#4CB487');
  const iconOptions=['food','car','bag','game','house','book','health','travel','gift','coffee','briefcase','laptop','award','coins','trend','refund','more'];
  const colors=['#F29B69','#E8B45F','#72B77A','#65BFA3','#6FA8DC','#7797DB','#AA82E3','#E77BA6','#E78378','#9AA09A','#5F9FE5','#4CB487'];
  openModal(`${modalHead(existing?'编辑分类':'添加分类')}<section class="card input-card"><label>分类名称</label><input id="catName" class="large-input" maxlength="8" placeholder="例如 咖啡" value="${escapeHTML(existing?.name||'')}"></section><div class="section-head" style="margin-top:14px"><h2>图标</h2></div><section class="card"><div class="icon-palette" id="iconPalette"></div></section><div class="section-head"><h2>颜色</h2></div><section class="card"><div class="color-palette" id="colorPalette"></div></section>`);
  const draw=()=>{
    document.getElementById('iconPalette').innerHTML=iconOptions.map(i=>`<button class="icon-choice ${i===selectedIcon?'selected':''}" data-icon-choice="${i}">${icon(i)}</button>`).join('');
    document.getElementById('colorPalette').innerHTML=colors.map(c=>`<button class="color-swatch ${c===selectedColor?'selected':''}" data-color="${c}" style="background:${c}"></button>`).join('');
    document.querySelectorAll('[data-icon-choice]').forEach(b=>b.onclick=()=>{selectedIcon=b.dataset.iconChoice;draw();});
    document.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{selectedColor=b.dataset.color;draw();});
  }; draw();
  document.getElementById('modalSave').onclick=()=>{
    const name=document.getElementById('catName').value.trim(); if(!name){toast('请输入分类名称');return;}
    if(existing){existing.name=name;existing.icon=selectedIcon;existing.color=selectedColor;} else {const order=Math.max(-1,...data.categories.filter(c=>c.type===type).map(c=>c.order))+1;data.categories.push({id:uid('cat'),name,type,icon:selectedIcon,color:selectedColor,custom:true,hidden:false,order});}
    saveData();closeModal();onDone?.();toast(existing?'分类已修改':'分类已添加');
  };
}

function removeCategory(id,type){
  const c=categoryById(id); if(!c?.custom) return;
  if(!confirm(`删除自定义分类“${c.name}”？历史账单会继续保留原来的分类名称和图标。`)) return;
  data.categories=data.categories.filter(x=>x.id!==id);saveData();openCategoryManager(type);toast('分类已删除，历史账单已保留');
}

function downloadBlob(filename,content,type){ const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=filename;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500); }
function exportJSON(){ const backup={app:'Airplane',exportedAt:new Date().toISOString(),data}; downloadBlob(`Airplane-backup-${localISO()}.json`,JSON.stringify(backup,null,2),'application/json');toast('完整备份已导出'); }
function exportCSV(){
  const rows=[['日期','时间','类型','金额','分类','备注'],...data.transactions.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(t=>[t.date,t.time||'',t.type==='expense'?'支出':'收入',Number(t.amount).toFixed(2),t.categoryName||txSnapshotCategory(t).name,t.note||''])];
  const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');downloadBlob(`Airplane-records-${localISO()}.csv`,csv,'text/csv;charset=utf-8');toast('CSV 已导出');
}
function resetAll(){ if(!confirm('确定清空这台设备里的所有 Airplane 数据？建议先导出完整备份。'))return; if(!confirm('再次确认：余额、预算、分类和账单都会被清空。'))return; data=freshData();saveData();ui.selectedMonth=monthKey(new Date());render();toast('本机数据已清空'); }
function toast(msg){ document.querySelector('.toast')?.remove(); const d=document.createElement('div');d.className='toast';d.textContent=msg;document.body.appendChild(d);setTimeout(()=>d.remove(),2200); }

// Global navigation
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{ui.tab=b.dataset.tab;render();window.scrollTo({top:0,behavior:'smooth'});});
document.getElementById('addButton').onclick=()=>openTransactionModal();
document.getElementById('monthButton').onclick=openMonthModal;
document.getElementById('quickBudgetButton').onclick=openBudgetModal;
document.getElementById('importInput').addEventListener('change', async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{const parsed=JSON.parse(await file.text());const incoming=normalizeData(parsed.data||parsed);if(!confirm('恢复此备份会替换当前设备上的 Airplane 数据。继续吗？'))return;data=incoming;saveData();render();toast('备份已恢复');}catch(err){toast('无法识别这个 Airplane 备份');}
});

async function registerAirplaneServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  try{
    // updateViaCache:'none' keeps the Service Worker update check independent of HTTP cache.
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    // Installed Home Screen Web Apps keep their own local ledger. We update only the
    // program shell; localStorage/IndexedDB are intentionally untouched.
    await registration.update();
  }catch(err){
    console.warn('Airplane Service Worker registration/update failed',err);
  }
}

window.addEventListener('load',registerAirplaneServiceWorker);
render();
ensurePersistentStorage();
