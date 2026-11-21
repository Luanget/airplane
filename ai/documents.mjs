import {DRAFT_KEY,PRE_RESTORE_KEY,freshData,readFinance,validateFinanceBackup} from '../finance-storage.mjs';
import {APP_DOCUMENTS,documentEditSchema,matches} from '../health/contract.mjs';
import {newState,validateAppState} from '../health/core.mjs';
import {unpackBackup} from '../health/backup.mjs';
import {readRestoreSnapshot,replaceRestoreSnapshot} from '../health/storage.mjs';
import {writeFinanceWithPurchaseCheck} from '../health/purchase-sync.mjs';
import {CHAT_HISTORY_KEY} from './context.mjs';
import {CHAT_MODEL_KEY} from './models.mjs';
import {MEMORY_KEY,validMemory} from './memory.mjs';
import {SKILLS_KEY} from './skills.mjs';
import {THREADS_KEY} from './threads.mjs';
import {editDocument,readDocumentPath} from './document-patch.mjs';
import {replaceUsage,totalUsage} from './usage.mjs';

const ACCESS_KEY='airplane-ai-document-access-v1';
export const hasDocumentAccess=store=>store.getItem(ACCESS_KEY)==='direct';
export function setDocumentAccess(store,allowed){
 if(allowed)store.setItem(ACCESS_KEY,'direct');
 else store.removeItem(ACCESS_KEY);
}

const names={
 finance:'财务账本',health:'健康账本',finance_backup:'财务恢复快照',health_backup:'恢复快照',
 finance_draft:'财务录入草稿',memory:'记忆',skills:'旧版偏好备份',legacy_skill:'旧版个人 Skill',
 conversations:'完整对话',model:'模型设置',history:'上下文设置',local_usage:'本机用量估算'
};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const changed=()=>Error('原数据已有更新，请重新查询后再修改。');
function localDocument(store,key,parse=JSON.parse,format=JSON.stringify){
 const raw=store.getItem(key);
 return {
  value:raw===null?null:parse(raw),
  write(next){
   if(store.getItem(key)!==raw)throw changed();
   if(next===null)store.removeItem(key);
   else store.setItem(key,format(next));
  }
 };
}
const preference=(store,key)=>localDocument(store,key,value=>value,value=>value);
async function openDocument(workspace,name){
 const {finance,account}=workspace;
 switch(name){
  case 'finance': {
   const {primary,payload}=readFinance(finance);
   return {value:payload??freshData(),
    write:next=>writeFinanceWithPurchaseCheck(account,primary,[],()=>next??freshData())};
  }
  case 'health': {
   const value=await workspace.readHealth();
   return {value,write:next=>workspace.saveHealth(next??newState(),value.revision??0)};
  }
  case 'health_backup': {
   const value=await readRestoreSnapshot(account)??null;
   return {value,write:next=>replaceRestoreSnapshot(account,JSON.stringify(value),next)};
  }
  case 'finance_backup': return localDocument(finance,PRE_RESTORE_KEY);
  case 'finance_draft': return localDocument(finance,DRAFT_KEY);
  case 'memory': {
   workspace.memory.list();
   const document=localDocument(finance,MEMORY_KEY);
   return {value:document.value,write:next=>document.write(next??[])};
  }
  case 'skills': return localDocument(finance,SKILLS_KEY);
  case 'legacy_skill': return preference(finance,account.demo?'skill':'airplane-ai-skill-v1');
  case 'conversations': return localDocument(finance,THREADS_KEY);
  case 'model': return preference(finance,CHAT_MODEL_KEY);
  case 'history': return preference(finance,CHAT_HISTORY_KEY);
  case 'local_usage': {
   if(account.demo)return localDocument(finance,'demo-ai-usage');
   const value=await totalUsage();
   return {value,write:next=>replaceUsage(value,next)};
  }
  default: throw Error('找不到这个 Airplane 数据文档');
 }
}

function shape(value){
 if(Array.isArray(value))return {type:'array',length:value.length};
 if(object(value))return {type:'object',fields:Object.fromEntries(Object.entries(value).map(([key,entry])=>
  [key,Array.isArray(entry)?'array':entry===null?'null':typeof entry]))};
 return {type:value===null?'null':typeof value};
}

export async function readAppDocument(workspace,{document,path,view}){
 if(!hasDocumentAccess(workspace.finance))throw Error('完整数据权限已关闭');
 if(document==='catalog')return {documents:names};
 const {value}=await openDocument(workspace,document);
 const item=readDocumentPath(value,path);
 return {document,path,...(view==='shape'?{shape:shape(item)}:{value:item})};
}

function validateDocument(name,value){
 if(value===null)return;
 const valid={
  finance:()=>{validateFinanceBackup(value);return ['transactions','categories','budgets'].every(key=>Object.hasOwn(value,key));},
  health:()=>validateAppState(value),
  health_backup:()=>Boolean(unpackBackup(value)),
  finance_backup:()=>Boolean(validateFinanceBackup(value)),
  finance_draft:()=>object(value),
  memory:()=>validMemory(value),
  skills:()=>object(value)&&object(value.overrides)&&Array.isArray(value.personal)&&Array.isArray(value.folders??[]),
  legacy_skill:()=>typeof value==='string',
  conversations:()=>Array.isArray(value.threads)&&value.threads.every(thread=>
   object(thread)&&typeof thread.id==='string'&&typeof thread.title==='string'&&Array.isArray(thread.messages)&&
   thread.messages.every(message=>object(message)&&['user','assistant'].includes(message.role)&&typeof message.text==='string')&&
   (thread.photos==null||Array.isArray(thread.photos.jobs)&&thread.photos.jobs.every(job=>object(job)&&typeof job.reply==='string'))),
  model:()=>typeof value==='string',
  history:()=>typeof value==='string',
  local_usage:()=>Number.isSafeInteger(value)&&value>=0
 };
 try{if(valid[name]())return;}catch{}
 throw Error(names[name]+'修改后的格式无效。');
}

export async function prepareDocumentEdit(workspace,result,finishReview){
 if(!hasDocumentAccess(workspace.finance))throw Error('完整数据权限已关闭');
 if(!matches(documentEditSchema,result)||!APP_DOCUMENTS.includes(result.document))throw Error('原始数据修改格式无效');
 const operations=JSON.parse(result.patch);
 const {document:name}=result;
 const {value:before}=await openDocument(workspace,name);
 const next=editDocument(before,operations)??null;
 validateDocument(name,next);
 const message=names[name]+'已保存。';
 return {name:names[name],operations,async save(){
  if(!hasDocumentAccess(workspace.finance))throw Error('完整数据权限已关闭');
  const latest=await openDocument(workspace,name);
  if(!equal(latest.value,before))throw changed();
  const value=structuredClone(next);
  finishReview?.(value,message);
  const modified=!equal(before,next);
  if(!equal(before,value))await latest.write(value);
  return modified?message:names[name]+'没有变化。';
 }};
}
