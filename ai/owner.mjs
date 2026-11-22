import {addConfirmedTransactions,freshData,STORAGE_KEY,validateFinanceBackup} from '../finance-storage.mjs';
import {events,recordEvent,deleteEvent,validateAppState,validDate} from '../health/core.mjs';
import {confirmPackageAction,ensureContainers} from '../health/containers.mjs';
import {ensureMedical,medicalData,saveMedicalNote,verifyMedicalState} from '../health/medical.mjs';
import {verifyGraph} from '../health/sync.mjs';
import {listOwnerChanges,readOwnerChange} from '../health/storage.mjs';
import {resumeOwnerLedgers,updateOwnerLedgers} from '../health/purchase-sync.mjs';
import {hash,stable} from '../health/sync-source.mjs';
import {orderBatchId,cents} from '../health/purchases.mjs';
import {readDocumentPath,editDocument,documentPath} from './document-patch.mjs';
import {documentNames,hasDocumentAccess,validateDocument} from './documents.mjs';
import {financeRows,healthRows,updateFinance} from './data.mjs';
import {ownerFinancePart,readOwnerPart,samePart} from './owner-store.mjs';
import {ownerFood,ownerPurchase,ownerSku,reconcileFinanceLinks} from './owner-health.mjs';
import {attachmentGroups} from './conversation-evidence.mjs';
import {MEMORY_KEY,memoryLibrary} from './memory.mjs';
import {auditSafe} from './audit.mjs';

const entry=(document,path='',key='id')=>({document,path,key});
export const ownerDatasets=Object.freeze({
 transactions:entry('finance','/transactions'),categories:entry('finance','/categories'),budgets:entry('finance','/budgets','map'),
 balances:entry('finance','/balanceAdjustments'),finance_settings:entry('finance','/prefs','singleton'),
 foods:entry('health','','events'),weights:entry('health','','events'),activities:entry('health','','events'),
 inventory:entry('health','','sku'),purchases:entry('health','/local/purchases'),batches:entry('health','/local/batches'),
 stock_moves:entry('health','/local/stockMoves'),containers:entry('health','/local/containers'),weighings:entry('health','/local/containerEvents'),
 productions:entry('health','/local/productions'),shopping:entry('health','/local/shoppingList','foodId'),
 templates:entry('health','/local/templates'),health_settings:entry('health','/settings','singleton'),
 day_status:entry('health','/local/dayCompleteness'),health_actions:entry('health','/local/assistantActions'),
 receipt_audit:entry('health','/local/agentReceipts'),medical_reports:entry('health','/local/medical/reports'),
 medical_measurements:entry('health','/local/medical/measurements'),medical_symptoms:entry('health','/local/medical/symptoms'),
 medical_diagnoses:entry('health','/local/medical/diagnoses'),medical_profile:entry('health','/local/medical/profile'),
 medical_attachments:entry('health','/local/medical/attachments'),
 legacy_days:entry('health','/legacy/daily','map'),legacy_energy:entry('health','/legacy/energy','map'),
 legacy_rules:entry('health','/legacy/rules','key'),sync_sources:entry('health','/sync/sources','map'),
 sync_tombstones:entry('health','/sync/tombstones'),sync_lineage:entry('health','/sync/lineage','singleton'),
 import_info:entry('health','/importInfo','singleton'),aliases:entry('health','/legacy/catalogs/aliases'),
 prices:entry('health','/legacy/catalogs/prices'),inventory_audit:entry('health','/legacy/catalogs/inventoryAudit'),
 external_purchases:entry('health','/legacy/catalogs/purchaseEvents'),pending_stock:entry('health','/sync/pendingStock'),
 memory:entry('memory'),skills:entry('skills','/personal'),skill_folders:entry('skills','/folders'),skill_overrides:entry('skills','/overrides','map'),
 conversations:entry('conversations','/threads'),conversation_messages:entry('conversations','','messages'),
 tasks:entry('tasks'),attachments:entry('attachments')
});
const documentNamesAll={...documentNames,tasks:'任务日志',attachments:'聊天附件（归档）',
 prices:'模型费率',auto_memory:'自动记忆设置',sync_status:'文件同步状态'};
const has=(value,key)=>Object.hasOwn(value,key);
const same=samePart;
const esc=key=>String(key).replaceAll('~','~0').replaceAll('/','~1');
const defaultDoc={memory:[],skills:{overrides:{},personal:[],folders:[],runtime:{}},conversations:{threads:[],active:null}};
const readAt=(value,path)=>{try{return readDocumentPath(value,path);}catch{return null;}};
const dateOf=row=>row.date??row.reportDate??row.time??row.updatedAt??row.createdAt??row.issuedAt??row.id;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function stripBinary(value){
 if(Array.isArray(value))return value.map(stripBinary);
 if(!isObject(value))return value;
 return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='data'&&typeof item==='string'&&
  ['image/jpeg','image/png','image/webp','application/pdf'].includes(value.type)?'[原件仅按需读取]':stripBinary(item)]));
}
const safeResult=value=>auditSafe(stripBinary(value));
const redacted=row=>row==null?row:safeResult(row);
const apiRow=row=>({id:row.id,...redacted(row)});
const shape=value=>Array.isArray(value)?{type:'array',length:value.length,exampleFields:shape(value.find(isObject)??null).fields}:
 isObject(value)?{type:'object',fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
  Array.isArray(item)?'array':item===null?'null':typeof item]))}:{type:value===null?'null':typeof value};
const bytes=async input=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input))),
 byte=>byte.toString(16).padStart(2,'0')).join('');

function rowsFor(value,set,info,args){
 if(info.key==='events'||info.key==='sku')return healthRows(value,set);
 if(info.key==='messages'){
  return (value?.threads??[]).filter(thread=>!args.parentId||thread.id===args.parentId).flatMap(thread=>
   thread.messages.map((message,index)=>({...message,id:message.id??thread.id+':message:'+index,threadId:thread.id,index})));
 }
 const rows=readAt(value,info.path);
 if(info.key==='map')return Object.entries(rows??{}).map(([id,row])=>({...isObject(row)?row:{amount:row},id}));
 if(info.key==='singleton')return rows==null?[]:[{...isObject(rows)?rows:{value:rows},id:set}];
 return (Array.isArray(rows)?rows:[]).map((row,index)=>({...row,id:row[info.key]??set+':'+index}));
}

function defaultValue(name,before){
 return name==='finance'?before.payload??freshData():before??structuredClone(defaultDoc[name]??null);
}
function ensurePath(value,path){
 if(value===null)value={};
 let at=value;
 const segments=documentPath(path);
 for(const segment of segments.slice(0,-1))at=at[segment]??={};
 return {value,at,key:segments.at(-1)};
}
function updateArray(rows,id,key,action,fields,fallback){
 const position=id==null?-1:rows.findIndex((row,index)=>(row[key]??fallback+':'+index)===id);
 if(action==='add'){
  if(position>=0)throw Error('目标记录 ID 已存在');
  rows.push({...fields,[key]:id});return rows.at(-1);
 }
 if(position<0)throw Error('找不到 '+id+'，请重新查询原记录');
 if(action==='delete')return rows.splice(position,1)[0];
 return rows[position]={...rows[position],...fields,[key]:rows[position][key]??id};
}
function safeJson(value,label){
 if(typeof value!=='string')throw Error(label+'应为 JSON');
 return JSON.parse(value);
}
function protectThreads(before,after){
 if(!after)return;
 const controls=['pending','agentQueue','review','photos','followUp'];
 for(const thread of after.threads??[]){
  const prior=before?.threads?.find(row=>row.id===thread.id);
  for(const key of controls){
   if(prior&&has(prior,key))thread[key]=prior[key];else delete thread[key];
  }
  for(const message of thread.messages??[])delete message.agentUndo;
  for(const [index,message] of (thread.messages??[]).entries()){
   const original=prior?.messages.find(row=>row.role===message.role&&
    (row.id&&row.id===message.id||row.taskId&&row.taskId===message.taskId))??prior?.messages[index];
   if(original?.agentUndo&&(original.id===message.id&&original.taskId===message.taskId))message.agentUndo=original.agentUndo;
  }
 }
 if(!after.threads?.some(thread=>thread.id===after.active))after.active=after.threads?.[0]?.id??null;
}
async function validateOwnerDocument(name,value,before){
 if(name==='conversations')protectThreads(before,value);
 if(name==='tasks'){
  if(value!==null&&(!Array.isArray(value.steps)||!Array.isArray(value.requests)||typeof value.id!=='string'))throw Error('任务日志格式无效');
  return;
 }
 if(name==='attachments'){
  if(value===null)return;
  if(!value.id?.startsWith('media:')||!Array.isArray(value.attachments))throw Error('请提供归档附件结构');
  for(const file of value.attachments){
   const data=file.input?.image_url??file.input?.file_data;
   if(typeof data!=='string'||!/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/i.test(data)||
    await bytes(data)!==file.key)throw Error('附件仅接受完整的本机图片或 PDF');
  }
  return;
 }
 if(has(documentNames,name))validateDocument(name,value);
 if(name==='health'||name==='health_backup')verifyMedicalState(name==='health'?value:value?.health);
}

// Reverse only the pieces this operation changed. Record IDs keep unrelated later rows intact.
export function inverseOwnerChange(before,after,current,path=''){
 if(same(before,after))return current;
 if(same(after,current))return structuredClone(before);
 if([before,after,current].every(isObject)){
  const updated={...current};
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
   const value=inverseOwnerChange(before[key],after[key],current[key],path+'/'+esc(key));
   if(value===undefined)delete updated[key];else updated[key]=value;
  }
  return updated;
 }
 const recordArray=value=>Array.isArray(value)&&value.every(row=>isObject(row)&&typeof row.id==='string')&&
  new Set(value.map(row=>row.id)).size===value.length;
 if([before,after,current].every(recordArray)){
  const maps=[before,after,current].map(rows=>new Map(rows.map(row=>[row.id,row])));
  const order=[...new Set([...maps[2].keys(),...maps[0].keys()])];
  return order.flatMap(id=>{
   const result=inverseOwnerChange(...maps.map(map=>map.get(id)),path+'/'+esc(id));
   return result===undefined?[]:[result];
  });
 }
 throw Error('撤销遇到之后的修改：'+(path||'/')+'。当前数据已保留，可按字段更正。');
}

function page(rows,{offset=0,limit=25}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)throw Error('分页参数无效');
 const end=offset+Math.min(limit,100);
 return {rows:rows.slice(offset,end),total:rows.length,nextOffset:end<rows.length?end:null};
}
// Store before/after only for changed sections. Unchanged external baselines and photo bytes stay in their original store.
function changedSections(before,after){
 if(!isObject(before)||!isObject(after))return [before,after];
 const old={},next={};
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(same(before[key],after[key]))continue;
  const [a,b]=changedSections(before[key],after[key]);
  if(a!==undefined)old[key]=a;
  if(b!==undefined)next[key]=b;
 }
 return [old,next];
}

function differences(before,after,path=''){
 if(same(before,after))return [];
 if(isObject(before)&&isObject(after))return [...new Set([...Object.keys(before),...Object.keys(after)])]
  .flatMap(key=>key==='revision'?[]:differences(before[key],after[key],path+'/'+esc(key)));
 if(Array.isArray(before)&&Array.isArray(after)&&[...before,...after].every(row=>isObject(row)&&typeof row.id==='string')){
  const maps=[before,after].map(list=>new Map(list.map(row=>[row.id,row])));
  return [...new Set([...maps[0].keys(),...maps[1].keys()])].flatMap(id=>differences(...maps.map(map=>map.get(id)),path+'/'+esc(id)));
 }
 return [{path,before:before===undefined?null:safeResult(before),after:after===undefined?null:safeResult(after)}];
}

function mergingBusinessReceipt(result){
 const business=result.data;
 if(!business?.status)return result;
 if(result.status!=='saved')return business;
 return {...business,receipt:{...business.receipt,...result.receipt},undo:result.undo,replayed:result.replayed};
}

export function createOwnerData(workspace,{book,journal,authorized=()=>true}={}){
 const account=workspace.account??{finance:workspace.finance};
 const guard=context=>{
  context.signal?.throwIfAborted();
  if(!context.run.allowRead||!authorized(context.run)||!hasDocumentAccess(workspace.finance))throw Error('所有者完全控制未开启，或本轮已关闭本机访问');
 };
 const store={
  read:workspace.ownerStore?.read??(part=>readOwnerPart(account,part)),
  list:workspace.ownerStore?.list??(()=>listOwnerChanges(account)),
  saved:workspace.ownerStore?.saved??(id=>resumeOwnerLedgers(account,id)),
  get:workspace.ownerStore?.get??(id=>readOwnerChange(account,id)),
  commit:workspace.ownerStore?.commit??((state,revision,job,check)=>updateOwnerLedgers(account,state,revision,job,check))
 };
 const key=(document,id)=>document+(id?'\0'+id:'');
 const get=async(document,id=null)=>document==='health'?workspace.readHealth():defaultValue(document,await store.read({document,id}));
 async function transaction(context,summary,apply,{reverts=null,id=context.operationId,fingerprint=null}={}){
  guard(context);
  const recorded=await store.saved(id);
  if(recorded)return receipt(recorded,true);
  if(fingerprint){
   const cutoff=Date.now()-2*60*1000;
   const history=await store.list(),reversed=new Set(history.map(row=>row.reverts).filter(Boolean));
   const existing=history.find(row=>row.fingerprint===fingerprint&&Date.parse(row.at)>=cutoff&&
    !reversed.has(row.id)&&row.source?.taskId!==context.run.id);
   if(existing)return {...receipt(await store.get(existing.id),true),detail:'相同指令及新增内容已执行；再次购买或新增时请说明是另一笔。'};
  }
  const original=await workspace.readHealth();
  const working=new Map();
  const state={health:ensureMedical(structuredClone(original))};
  state.load=async(document,id=null)=>{
   if(document==='health')return state.health;
   const k=key(document,id);
   if(!working.has(k)){
    const before=await store.read({document,id});
    working.set(k,{document,id,before,next:structuredClone(defaultValue(document,before))});
   }
   return working.get(k).next;
  };
  state.put=(document,id,value)=>{
   if(document==='health')state.health=value;
   else working.get(key(document,id)).next=value;
  };
  const output=await apply(state);
  for(const item of working.values())if(!same(defaultValue(item.document,item.before),item.next))await validateOwnerDocument(item.document,item.next,
   item.document==='finance'?item.before.payload:item.before);
  const finance=working.get('finance');
  if(finance&&!same(finance.before.payload,finance.next))reconcileFinanceLinks(state.health,finance.before.payload??freshData(),finance.next??freshData());
  if(!state.health||!validateAppState(state.health))throw Error('修改后的健康数据结构无效');
  const problems=verifyGraph(state.health,original);
  if(problems.length)throw Error('关联校验：'+problems.slice(0,5).join('；'));
  if(!same(state.health.local.medical,original.local.medical)||!same(state.health.legacy.sourceSnapshot,original.legacy.sourceSnapshot))
   verifyMedicalState(state.health);
  ensureContainers(state.health);
  state.health.revision=original.revision;
  if(original.revision===undefined)delete state.health.revision;
  const parts=[...working.values()].map(({document,id,before,next})=>({document,id,before,
   after:document==='finance'?ownerFinancePart(next):next})).filter(part=>!same(part.before,part.after));
  const healthChanged=!same(original,state.health);
  if(!parts.length&&!healthChanged)return {status:'ok',data:output,detail:'当前数据已经是指定状态'};
  const [beforeHealth,afterHealth]=healthChanged?changedSections(original,state.health):[];
  const record={id,at:new Date().toISOString(),summary,reverts,fingerprint,data:output,source:{threadId:context.run.threadId??null,
   taskId:context.run.id??null,messageIds:(context.run.userSources??[]).filter(row=>row.current).map(row=>row.id)},
   ...(healthChanged?{beforeHealth,afterHealth}:{})};
  const saved=await store.commit(state.health,original.revision??0,{record,parts},()=>guard(context));
  if(parts.some(part=>part.document==='conversations'))book?.reload();
  return receipt(saved,false);
 }
 const receipt=(record,replayed)=>({status:'saved',replayed,receipt:{operationId:record.id,revision:record.revision,source:'owner',
  documents:[...(record.beforeHealth?['health']:[]),...(record.parts??[]).map(row=>row.document)],reverts:record.reverts??null},
  data:record.data,undo:{kind:'owner_change',id:record.id}});

 async function applyRecord(state,op,operationId,date){
  const {dataset,action,parentId=null}=op,info=ownerDatasets[dataset];
  if(!info||!['add','update','delete'].includes(action))throw Error('请选择数据目录中的集合与操作');
  const fields=safeJson(op.changes,'记录字段');
  if(!isObject(fields))throw Error('记录字段须为 JSON 对象');
  editDocument({},[{op:'add',path:'/fields',value:fields}]);
  let id=op.id??(action==='add'?operationId:null);
  if(action!=='add'&&id==null&&!['singleton','map'].includes(info.key))throw Error('请先查询并指定原记录 ID');
  const rowAction={id,action,fields,operationId,date};
  if(dataset==='inventory')return ownerSku(state.health,rowAction);
  if(dataset==='purchases'){
   const before=state.health.local.purchases?.find(row=>row.id===id);
   const linked=has(fields,'financeId')?fields.financeId:before?.financeId;
   let ledger;
   if(linked||before?.financeIds?.length)ledger=await state.load('finance');
   if(action==='add'&&linked){
    const tx=ledger.transactions.find(row=>row.id===linked);
    if(!tx||tx.type!=='expense')throw Error('请指定关联支出 ID');
    rowAction.fields={...fields,totalCents:fields.totalCents??cents(tx.amount),linkedTxn:tx};
   }
   if(linked){
    const tx=ledger.transactions.find(row=>row.id===linked);
    if(!tx||tx.type!=='expense'||(state.health.local.purchases??[]).some(row=>
     row.id!==id&&row.status!=='cancelled'&&(row.financeId===linked||row.financeIds?.includes(linked))))
     throw Error('指定财务记录无效或已关联其他采购');
   }
   if(action==='add')rowAction.fields={date,...rowAction.fields};
   const result=ownerPurchase(state.health,rowAction);state.health=result.state;
   if(result.value&&linked){
    if(action!=='add'&&fields.financeId!==undefined)result.value.financeId=fields.financeId;
    const tx=ledger.transactions.find(row=>row.id===linked);
    if(tx&&fields.totalCents!==undefined)tx.amount=fields.totalCents/100;
   }
   return result.value;
  }
  if(dataset==='foods'){
   if(action!=='add'&&!events(state.health,'foods').some(row=>row.id===id))throw Error('没有找到该饮食 ID');
   const result=ownerFood(state.health,rowAction);state.health=result.state;return result.value;
  }
  if(info.key==='events'){
   const prior=events(state.health,dataset).find(row=>row.id===id);
   if(action==='delete'){if(!prior)throw Error('没有找到原记录');deleteEvent(state.health,dataset,id);return {id};}
   const row=recordEvent(state.health,dataset,{date,...prior,...fields},action==='update'?id:undefined,id);
   if(prior?.createdAt)row.createdAt=prior.createdAt;
   if(prior?.source&&fields.source===undefined)row.source=prior.source;
   return row;
  }
  if(info.document==='finance'){
   const ledger=await state.load('finance'),prior=financeRows(ledger,dataset).find(row=>row.id===id);
   if(!prior&&action!=='add'&&info.key!=='singleton')throw Error('找不到原财务记录 ID');
   if(dataset==='transactions'&&fields.amountAdjustment){
    const {gross,refund}=fields.amountAdjustment;
    const amount=cents(gross)-cents(refund);
    if(amount<=0)throw Error('净支出须为正数；全额退款可删除或独立登记退款');
    fields.amount=amount/100;
    fields.note=fields.note??[prior?.note,'原价 '+Number(gross).toFixed(2)+'，退款 '+Number(refund).toFixed(2)].filter(Boolean).join(' · ');
    delete fields.amountAdjustment;
   }
   if(dataset==='transactions'&&action!=='delete'&&(!validDate(fields.date??prior?.date??date)||
    fields.amount!==undefined&&cents(fields.amount)<=0))throw Error('交易日期和金额应有效');
   if(dataset==='transactions'&&action==='add')fields.date??=date;
   if(info.key==='id')delete fields.id;
   if(action==='add'&&prior)throw Error('该财务记录 ID 已存在');
   const updated=updateFinance(ledger,dataset,prior?id:dataset==='budgets'?id:null,prior,fields,action,{owner:true});
   if(action==='add'&&updated&&info.key==='id')updated.id=id;
   validateFinanceBackup(ledger);
   return updated;
  }
  if(dataset==='batches'&&action==='update'){
   const order=state.health.local.purchases?.find(row=>row.status!=='cancelled'&&
    row.items.some((item,index)=>orderBatchId(row,item,index)===id));
   const affected=['quantity','costCents','expires','foodId'].filter(key=>has(fields,key));
   if(order&&affected.length){
    const purchaseFields=Object.fromEntries(affected.map(key=>[key,fields[key]]));
    const {state:next}=ownerPurchase(state.health,{id:order.id,action:'update',operationId,
     fields:{itemEdits:[{action:'update',batchId:id,fields:purchaseFields}]}});
    state.health=next;
    return next.local.batches.find(row=>row.id===id);
   }
  }
  if(dataset==='containers'&&action==='update'&&['empty','discarded'].includes(fields.status)){
   const result=confirmPackageAction(state.health,{id:operationId,date:fields.date??date,containerId:id,
    action:fields.status==='empty'?'empty':'discard',gross:fields.gross,tare:fields.tare,reason:fields.reason});
   state.health=result.next;
   return result.event;
  }
  if(dataset.startsWith('medical_'))state.health.local.medical??=medicalData(state.health);
  if(dataset==='medical_profile')id='personal';
  if(['medical_profile','medical_symptoms','medical_diagnoses'].includes(dataset)&&action!=='delete'){
   const table=info.path.split('/').at(-1),rows=state.health.local.medical[table];
   const prior=rows.find(row=>row.id===id);
   if(dataset!=='medical_profile'&&((action==='add'&&prior)||(action==='update'&&!prior)))throw Error('档案记录 ID 已存在或找不到原记录');
   if(prior)state.health.local.medical[table]=rows.filter(row=>row.id!==id);
   return saveMedicalNote(state.health,table,{...prior,...fields,id});
  }
  if(dataset==='medical_reports'&&action==='delete'){
   state.health.local.medical.measurements=state.health.local.medical.measurements.filter(row=>row.reportId!==id);
  }
  if(dataset==='medical_attachments'&&action==='delete'){
   for(const report of state.health.local.medical.reports)report.attachmentIds=report.attachmentIds.filter(key=>key!==id);
  }
  if(dataset==='medical_reports'&&action==='add'){
   Object.assign(fields,{date:fields.date??null,attachmentIds:fields.attachmentIds??[],institution:fields.institution??null,note:fields.note??null});
  }
  if(dataset==='medical_measurements'&&action==='add'){
   for(const key of ['value','code','result','unit','method','reference','evidence','uncertainty'])fields[key]??=null;
   fields.source??='manual';
  }
  if(['tasks','attachments'].includes(info.document)){
   if(info.document==='tasks'&&id===state.taskId)throw Error('正在执行的任务可在结束后编辑归档');
   const previous=await state.load(info.document,id);
   if(action==='add'&&previous||action!=='add'&&!previous)throw Error('记录已存在或已被删除，重新查询后再修改');
   const next=action==='delete'?null:{...previous,...fields,id};
   state.put(info.document,id,next);return next;
  }
  const value=await state.load(info.document);
  if(info.key==='messages'){
   const thread=value?.threads?.find(row=>row.id===parentId);
   if(!thread)throw Error('请提供消息所属对话 parentId');
   const useId=thread.messages.find((row,index)=>(row.id??thread.id+':message:'+index)===id)?.id??id;
   return updateArray(thread.messages,useId,'id',action,fields,thread.id+':message');
  }
  if(!info.path&&Array.isArray(value))return updateArray(value,id,info.key,action,fields,dataset);
  const {value:root,at,key:name}=ensurePath(value,info.path);
  state.put(info.document,null,root);
  if(info.key==='singleton'){
   if(action==='delete')delete at[name];else at[name]={...at[name],...fields};
   return at[name]??null;
  }
  if(info.key==='map'){
   if(!id)throw Error('请提供记录键');
   documentPath('/'+esc(id));
   const map=at[name]??={};
   if(action==='delete')delete map[id];else map[id]={...map[id],...fields};
   return map[id]??null;
  }
  const rows=at[name]??=[];
  const row=updateArray(rows,id,info.key,action,fields,dataset);
  if(dataset==='batches'&&action==='update'&&(fields.quantity!==undefined||fields.costCents!==undefined||fields.date!==undefined)){
   const move=state.health.local.stockMoves.find(item=>item.batchId===id&&item.delta>0);
   if(move&&fields.quantity!==undefined)move.delta=row.quantity;
   if(move&&fields.date!==undefined)move.date=row.date;
   for(const order of state.health.local.purchases??[])order.items.forEach((item,index)=>{
    if(orderBatchId(order,item,index)!==id)return;
    item.quantity=row.quantity;item.costCents=row.costCents;
   });
  }
  return row;
 }
 return {
  business(context,build){
   return transaction(context,'健康业务操作',async state=>{
    const {next,result}=await build(state.health);
    if(next)state.health=next;
    return safeResult(result);
   }).then(mergingBusinessReceipt);
  },
  executeHealth(context,apply,{receipt=false}={}){
   return transaction(context,receipt?'付款截图与采购':'健康记录、消耗或称重',async state=>{
    const finance=receipt?await state.load('finance'):null;
    const stagedStore=receipt?{getItem:key=>key===STORAGE_KEY?JSON.stringify(finance):workspace.finance.getItem(key)}:workspace.finance;
    const result=await apply({...workspace,finance:stagedStore,readHealth:async()=>structuredClone(state.health),
     resumeReceipt:async()=>{},
     updateReceipt:async(_account,next,revision,stamp,{pairs},check)=>{
      check?.();
      if(stamp!==stagedStore.getItem(STORAGE_KEY)||revision!==(state.health.revision??0)||
       !pairs.every(pair=>same(finance.transactions.find(row=>row.id===pair.id)??null,pair.before)))
       throw Error('采购对应账本已变更，请重新查询');
      const ids=new Set(pairs.map(pair=>pair.id));
      finance.transactions=finance.transactions.filter(row=>!ids.has(row.id));
      addConfirmedTransactions(finance,pairs.flatMap(pair=>pair.after?[pair.after]:[]));
      state.health={...structuredClone(next),revision:revision+1};
     },
     saveHealth:async(next,revision,check)=>{
      check?.();
      if(revision!==(state.health.revision??0))throw Error('健康记录已变更，请重新查询');
      state.health={...structuredClone(next),revision:revision+1};
     }});
    return safeResult(result);
   }).then(mergingBusinessReceipt);
  },
  remember(context,args){
   return transaction(context,'更新长期习惯',async state=>{
    let serialized=JSON.stringify(await state.load('memory'));
    const staged={getItem:key=>key===MEMORY_KEY?serialized:workspace.finance.getItem(key),
     setItem:(key,value)=>{if(key===MEMORY_KEY)serialized=value;}};
    const evidence=args.evidence||(context.run.messages??[]).at(-1)||args.text;
    const value=memoryLibrary(staged).learnHabit({...args,evidence},evidence,{owner:true});
    state.put('memory',null,JSON.parse(serialized));
    return {status:'saved',habit:{id:value.id,topic:value.topic,text:value.text}};
   }).then(mergingBusinessReceipt);
  },
  async catalog(context){
   guard(context);
   return {documents:documentNamesAll,datasets:ownerDatasets,
    notes:'记录级工具支持全部历史和跨集合原子批次。原始字段结构用 read_document。附件原件按 ID 单独发送。健康实际与计划用 foods.status，入库无金额用 purchases。'};
  },
  async query(args,context){
   guard(context);
   const info=ownerDatasets[args.dataset];
   if(!info)throw Error('请先查询数据源目录');
   let rows;
   if(info.document==='tasks')rows=await journal?.list()??[];
   else if(info.document==='attachments')rows=(book?.list()??[]).filter(row=>!args.parentId||row.id===args.parentId)
    .flatMap(thread=>attachmentGroups(thread).map(group=>({...group,threadId:thread.id})));
   else rows=rowsFor(await get(info.document),args.dataset,info,args);
   const term=args.query?.toLowerCase();
   const selected=rows.filter(row=>(!args.id||row.id===args.id)&&(!args.parentId||!row.reportId||row.reportId===args.parentId)&&(!args.since||String(dateOf(row))>=args.since)&&
    (!args.until||String(dateOf(row)).slice(0,10)<=args.until)&&(!term||JSON.stringify(redacted(row)).toLowerCase().includes(term)));
   const paged=page(selected,args);
   return {...paged,rows:paged.rows.map(row=>args.fields?.length?Object.fromEntries(Object.entries(apiRow(row))
    .filter(([key])=>key==='id'||args.fields.includes(key))):apiRow(row))};
  },
  async read(args,context){
   guard(context);
   if(!has(documentNamesAll,args.document))throw Error('请选择目录中的本机业务文档');
   if(args.document==='attachments'&&!args.id?.startsWith('media:'))throw Error('请先查询归档附件 ID');
   const root=stripBinary(await get(args.document,args.id)),value=readDocumentPath(root,args.path);
   if(args.view==='shape')return {shape:shape(value)};
   if(Array.isArray(value))return {...page(value,args),rows:page(value,args).rows.map(row=>auditSafe(row))};
   const safe=auditSafe(value);
   if(JSON.stringify(safe)?.length>120000)return {shape:shape(value),hint:'请定位字段路径或分页读取这份较大的文档'};
   return {value:safe};
  },
  mutate(args,context){
   const messages=context.run.messages??[];
   const fingerprint=args.operations.some(op=>op.action==='add')&&messages.some(text=>text?.trim())?
    hash(stable([context.run.threadId,context.run.date,messages.map(text=>text?.normalize('NFKC').trim()),
     (context.run.attachments??[]).map(row=>row.key),
     args.operations.map(({dataset,action,id,parentId,changes})=>[dataset,action,action==='add'?null:id,parentId??null,JSON.parse(changes)])])):null;
   return transaction(context,args.reason,async state=>{
   state.taskId=context.run.id;
   const result=[];
   for(const [index,op] of args.operations.entries())
    result.push({dataset:op.dataset,action:op.action,result:redacted(await applyRecord(state,op,context.operationId+':'+index,context.run.date))});
   return result;
  },{fingerprint});},
  patch(args,context){return transaction(context,args.reason,async state=>{
   const results=[];
   for(const part of args.documents){
    if(!has(documentNamesAll,part.document))throw Error('文档不在当前账本范围');
    if(part.document==='tasks'&&part.id===context.run.id)throw Error('正在执行的任务可在结束后编辑');
    const id=['tasks','attachments'].includes(part.document)?part.id:null;
    if(['tasks','attachments'].includes(part.document)&&!id)throw Error('请指定归档记录 ID');
    const prior=await state.load(part.document,id);
    const next=editDocument(prior,safeJson(part.patch,'JSON Patch'))??null;
    if(id&&next!==null&&next.id!==id)throw Error('文档内容 ID 必须与存储记录一致');
    if(part.document==='health'&&next){
     for(const sku of [...next.legacy.inventory,...(next.local.inventory??[])]){
      const original=[...prior.legacy.inventory,...(prior.local.inventory??[])].find(row=>row.id===sku.id);
      if(!original||sku.unit===original.unit)continue;
      const unit=sku.unit,quantity=sku.quantity??(sku.qty!==original.qty?sku.qty:undefined);
      Object.assign(sku,{unit:original.unit,qty:original.qty});delete sku.quantity;
      ownerSku(next,{id:sku.id,action:'update',fields:{unit,quantity},operationId:context.operationId+':'+sku.id,date:context.run.date});
     }
    }
    state.put(part.document,id,next);
    results.push({document:part.document,id});
   }
   return results;
  });},
  async history(args,context){
   guard(context);
   if(!args.id)return page(await store.list(),args);
   const record=await store.get(args.id);
   if(!record)throw Error('找不到变更回执');
   const {beforeHealth,afterHealth,parts,...header}=record;
   const changes=(beforeHealth?differences(beforeHealth,afterHealth,'/health'):[]).concat((parts??[])
    .flatMap(part=>differences(part.before,part.after,'/'+part.document+(part.id?'/'+esc(part.id):''))));
   return {...header,...page(changes,args)};
  },
  async undo(id,context){
   guard(context);
   const record=await store.get(id);
   if(!record)throw Error('找不到可恢复的变更');
   return transaction(context,'撤销 '+record.summary,async state=>{
    if(record.beforeHealth){
     const prior={...record.beforeHealth,revision:state.health.revision},after={...record.afterHealth,revision:state.health.revision};
     state.health=inverseOwnerChange(prior,after,state.health,'/health');
    }
    for(const part of record.parts){
     const current=await state.load(part.document,part.id);
     const before=defaultValue(part.document,part.before),after=defaultValue(part.document,part.after);
     state.put(part.document,part.id,inverseOwnerChange(before,after,current,'/'+part.document));
    }
    return {reverted:id};
   },{reverts:id});
  },
  async attachment(args,context){
   guard(context);
   const group=(book?.list()??[]).flatMap(attachmentGroups).find(value=>value.files.some(file=>file.id===args.id)||value.id===args.id);
   let stored,item;
   if(group){
    stored=await store.read({document:'attachments',id:group.id});
    const index=Math.max(0,group.files.findIndex(file=>file.id===args.id));
    item=stored?.attachments[index];
   }else{
    const health=await workspace.readHealth();
    const report=health.local.medical?.attachments?.find(row=>row.id===args.id);
    if(report){
     const data='data:'+report.type+';base64,'+report.data;
     item={key:args.id,input:report.type==='application/pdf'?{type:'input_file',filename:'owner-report.pdf',file_data:data}:
      {type:'input_image',image_url:data,detail:'auto'}};
    }
   }
   if(!item)return {id:args.id,state:'unavailable'};
   if(!context.run.attachments.some(row=>row.id===args.id)){
    context.run.attachments.push({...item,id:args.id,reused:true});
    (context.run.mediaDelivery??=[]).push(args.id);
   }
   return {id:args.id,state:'attached',index:context.run.attachments.findIndex(row=>row.id===args.id)+1};
  }
 };
}
