import {financeBackup,readFinance,replaceFinance,validateFinanceBackup,DRAFT_KEY} from '../finance-storage.mjs';
import {validateAppState} from './core.mjs';
import {exportState,readRestoreSnapshot,saveState} from './storage.mjs';
import {localDate} from '../calendar.mjs';

export function combinedBackup(health,finance) {
 return {format:'airplane-combined-v1',exportedAt:new Date().toISOString(),
  ...(health?{health}:{}),...(finance?{finance:financeBackup(finance)}:{})};
}
export function unpackBackup(input) {
 if(input?.format!=='airplane-combined-v1')throw Error('请选择 Airplane 统一备份');
 const finance=input.finance?validateFinanceBackup(input.finance):null;
 const health=input.health??null;
 if(health&&!validateAppState(health)||!health&&!finance)throw Error('备份结构无效');
 return {finance,health};
}
export function bindBackupExports(panel,{getState,notify,download}) {
 const included=name=>panel.querySelector('[name='+name+']').checked;
 const account=globalThis.airplaneAccount;
 panel.querySelector('[data-export]').onclick=()=>{
  try {
   const finance=included('finance')?readFinance(account.finance).payload:null;
   const health=included('health')?getState():null;
   if(!finance&&!health)throw Error('请选择已有账本');
   if(health&&!finance)download('airplane-health-backup-'+localDate()+'.json',exportState(health));
   else if(finance&&!health)download('airplane-finance-backup-'+localDate()+'.json',JSON.stringify(financeBackup(finance),null,2));
   else download('airplane-combined-backup.json',JSON.stringify(combinedBackup(health,finance),null,2));
  }catch(err){notify(err.message);}
 };
 panel.querySelector('[data-snapshot]').onclick=async()=>{
  try {
   const previous=await readRestoreSnapshot(account);
   if(!previous)throw Error('暂无恢复前快照');
   download('airplane-before-restore-backup.json',JSON.stringify(previous,null,2));
  }catch(err){notify(err.message);}
 };
}

export async function restoreBackup(current,{health,finance,financeRevision},account,setState) {
 const previous=finance?readFinance(account.finance):null;
 if(previous&&previous.primary!==financeRevision)throw Error('财务账本已变更，请重新预览文件');
 const saved=await saveState(health??current,current.revision??0,account,combinedBackup(current,previous?.payload));
 try{
  if(finance)replaceFinance(account.finance,finance,previous.primary);
 }catch(err){
  setState(await saveState(current,saved.revision,account));
  throw err;
 }
 setState(saved);
 if(finance)account.finance.removeItem(DRAFT_KEY);
}
