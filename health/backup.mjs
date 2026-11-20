import {financeBackup,readFinance,replaceFinance,validateFinanceBackup,DRAFT_KEY} from '../finance-storage.mjs';
import {validateAppState,events} from './core.mjs';
import {readRestoreSnapshot,saveState} from './storage.mjs';

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
export function attachCombinedBackup({getState,setState,notify,download}) {
 const panel=document.querySelector('#combined-backup'), picker=panel.querySelector('[type=file]');
 const included=name=>panel.querySelector('[name='+name+']').checked;
 const account=globalThis.airplaneAccount;
 panel.querySelector('[data-export]').onclick=()=>{
  try {
   const finance=included('finance')?readFinance(account.finance).payload:null;
   const health=included('health')?getState():null;
   if(!finance&&!health)throw Error('请选择已有账本');
   download('airplane-combined-backup.json',JSON.stringify(combinedBackup(health,finance),null,2));
  }catch(err){notify(err.message);}
 };
 panel.querySelector('[data-snapshot]').onclick=async()=>{
  try {
   const previous=await readRestoreSnapshot(account);
   if(!previous)throw Error('暂无恢复前快照');
   download('airplane-before-restore-backup.json',JSON.stringify(previous,null,2));
  }catch(err){notify(err.message);}
 };
 picker.onchange=async()=>{
  const file=picker.files[0];picker.value='';
  if(!file)return;
  const output=panel.querySelector('output');
  try {
   const result=unpackBackup(JSON.parse(await file.text()));
   const finance=included('finance')?result.finance:null, health=included('health')?result.health:null;
   if(!finance&&!health)throw Error('备份中没有所选账本');
   const current=getState(), previous=finance?readFinance(account.finance):null;
   const summary=[finance&&('财务 '+finance.transactions.length+' 笔交易'),health&&('健康 '+events(health,'foods').length+' 条饮食记录')].filter(Boolean).join('，');
   output.textContent=summary;
   if(!confirm('恢复 '+summary+'？当前数据会保存为恢复前快照。'))return;
   const saved=await saveState(health??current,current.revision??0,account,combinedBackup(current,previous?.payload));
   try {
    if(finance){
     replaceFinance(account.finance,finance,previous.primary);
     account.finance.removeItem(DRAFT_KEY);
    }
   }catch(err){
    setState(await saveState(current,saved.revision,account));
    throw err;
   }
   setState(saved);notify('已恢复 '+summary);
  }catch(err){notify(err.message);}
 };
}
