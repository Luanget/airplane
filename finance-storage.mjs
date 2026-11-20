export const STORAGE_KEY='airplane-pwa-v1';
export const RECOVERY_KEY='airplane-pwa-recovery-v1';
export const DRAFT_KEY='airplane-transaction-draft-v1';
export const PRE_RESTORE_KEY='airplane-pre-restore-v1';

export function validateFinanceBackup(parsed){
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('not an object');
  let payload=null;
  // Current backups carry an explicit Airplane marker. A recognizable legacy
  // raw ledger is also accepted, but arbitrary JSON such as {} is rejected.
  if(parsed.app==='Airplane'&&parsed.data&&typeof parsed.data==='object'&&!Array.isArray(parsed.data))payload=parsed.data;
  else if(Array.isArray(parsed.transactions)&&Array.isArray(parsed.categories)&&parsed.budgets&&typeof parsed.budgets==='object'&&!Array.isArray(parsed.budgets))payload=parsed;
  else throw new Error('not an Airplane backup');
  if(!Array.isArray(payload.transactions)||!Array.isArray(payload.categories)||payload.categories.length<1)throw new Error('missing ledger arrays');
  if(!payload.budgets||typeof payload.budgets!=='object'||Array.isArray(payload.budgets))throw new Error('invalid budgets');
  if(!payload.categories.every(c=>c&&typeof c==='object'&&typeof c.id==='string'&&c.id&&typeof c.name==='string'&&c.name&&['income','expense'].includes(c.type)))throw new Error('invalid categories');
  if(!payload.transactions.every(t=>t&&typeof t==='object'&&['income','expense'].includes(t.type)&&Number.isFinite(Number(t.amount))&&Number(t.amount)>0&&typeof t.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(t.date)))throw new Error('invalid transactions');
  if(!Object.values(payload.budgets).every(v=>Number.isFinite(Number(v))&&Number(v)>=0))throw new Error('invalid budget values');
  return structuredClone(payload);
}

export function financeBackup(payload) {
 return {app:'Airplane',format:'airplane-backup',schemaVersion:4,exportedAt:new Date().toISOString(),data:payload};
}
export function readFinance(store) {
 const primary=store.getItem(STORAGE_KEY);
 const recovery=store.getItem(RECOVERY_KEY);
 for(const raw of [primary,recovery]){
  if(!raw)continue;
  try {return {primary,payload:validateFinanceBackup(JSON.parse(raw))};}
  catch {}
 }
 if(primary!==null || recovery!==null)throw Error('财务账本无法读取，请先在财务页处理恢复');
 return {primary,payload:null};
}
export function replaceFinance(store,payload,expected) {
 if(store.getItem(STORAGE_KEY)!==expected)throw Error('财务账本已变更，请重新预览');
 const raw=JSON.stringify(payload),recovery=store.getItem(RECOVERY_KEY);
 // Put the recovery copy first. Roll it back when the primary write is rejected.
 store.setItem(RECOVERY_KEY,raw);
 try {store.setItem(STORAGE_KEY,raw);}
 catch(err){
  if(recovery===null)store.removeItem(RECOVERY_KEY);else store.setItem(RECOVERY_KEY,recovery);
  throw err;
 }
}

export function addConfirmedTransactions(payload,entries) {
 const used=new Set(payload.transactions.map(tx=>tx.id));
 payload.prefs??={};
 for(const entry of entries){
  if(used.has(entry.id))throw Error('这条候选已保存');
  used.add(entry.id);
  payload.transactions.push(entry);
  payload.prefs[entry.type==='income'?'lastIncomeCategoryId':'lastExpenseCategoryId']=entry.categoryId;
 }
}

export const DEFAULT_CATEGORIES = [
  ['餐饮','expense','food','#F29B69'],['交通','expense','car','#6FA8DC'],['购物','expense','bag','#AA82E3'],['娱乐','expense','game','#E77BA6'],
  ['日用','expense','house','#E8B45F'],['学习','expense','book','#5F9FE5'],['医疗','expense','health','#65BFA3'],['旅行','expense','travel','#6EAED7'],
  ['人情','expense','gift','#E78378'],['其他','expense','more','#9AA09A'],
  ['工资','income','briefcase','#4CB487'],['兼职','income','laptop','#5C9FD6'],['奖学金','income','award','#C8A34C'],['奖金','income','coins','#E7A24A'],
  ['理财','income','trend','#7797DB'],['红包/转账','income','gift','#E47B8C'],['退款','income','refund','#6CB8A3'],['其他','income','more','#9AA09A']
].map((c,i)=>({id:`default-${i+1}`,name:c[0],type:c[1],icon:c[2],color:c[3],custom:true,hidden:false,order:i,budgetExcludedDefault:c[1]==='expense'?false:undefined}));

export function freshData(){
  return {version:4, transactions:[], categories:structuredClone(DEFAULT_CATEGORIES), budgets:{}, balanceAdjustments:[], prefs:{initialBalance:null}};
}
