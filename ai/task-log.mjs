import {estimatedCost,modelRates,usageTokens} from './usage.mjs';

const terminal=new Set(['done','skipped','cancelled','failed','blocked','partial']);
const completed=new Set(['done','skipped','saved','ok','undone']);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const clean=value=>typeof value==='string'?value.slice(0,360):null;

export function failureKind(error){
 const text=String(error?.message??error??'');
 return /已停止|abort|cancel/i.test(text)?'cancelled':
  /超时|秒没有|timeout/i.test(text)?'timeout':
  /HTTP 401|HTTP 403|API Key|权限|authorization/i.test(text)?'authorization':
  /HTTP 429|额度|quota|rate.limit/i.test(text)?'rate_or_quota':
  /格式|候选|schema|model result/i.test(text)?'invalid_response':
  /待同步|账本.{0,10}更新|保存|存储|revision|database/i.test(text)?'storage_or_conflict':
  /网络|离线|fetch|network/i.test(text)?'network':
  /金额|付款|退款|日期|多条|库存|单位|规格|重复/i.test(text)?'evidence_conflict':
  text?'other':null;
}

export function updateTask(previous,id,event,now=Date.now()){
 const task=previous?structuredClone(previous):{id,startedAt:now,status:'running',requests:[],steps:[],confirmations:0,attempts:0};
 task.updatedAt=now;
 if(event.type==='start'){
  task.route??=event.route;
  task.threadId??=event.threadId??null;
  task.attempts++;
  task.status='running';task.finishedAt=null;
 }else if(event.type==='thread'){
  task.threadId??=event.threadId??null;
 }else if(event.type==='context'){
  task.context={habits:event.habits,skills:event.skills};
 }else if(event.type==='request'){
  task.requests.push(event.request);
 }else if(event.type==='confirm'){
  task.confirmations++;
 }else if(event.type==='step'){
  const next=event.step;
  const index=task.steps.findIndex(item=>item.id===next.id);
  const row={...(task.steps[index]??{}),...next,updatedAt:now};
  if(index<0)task.steps.push(row);else task.steps[index]=row;
 }else if(event.type==='undo'){
  task.steps=task.steps.map(row=>matchesOperation(row,event.operation)?{...row,status:'undone',updatedAt:now}:row);
 }else if(event.type==='status'){
  task.status=event.status;
  task.failure=event.failure??null;
  if(terminal.has(event.status))task.finishedAt=now;
 }
 return task;
}

export function summarizeTasks(tasks){
 const requests=tasks.flatMap(task=>task.requests);
 const reports=requests.filter(call=>call.tokens!==null);
 const cached=reports.filter(call=>integer(call.tokens.cached));
 const priced=requests.filter(call=>integer(call.cost));
 const sum=(rows,pick)=>rows.reduce((total,row)=>total+pick(row),0);
 const closed=tasks.filter(task=>terminal.has(task.status));
 const eligibleSteps=closed.flatMap(task=>task.steps);
 return {tasks:tasks.length,finished:closed.length,completed:closed.filter(task=>task.status==='done'||task.status==='skipped').length,
  steps:eligibleSteps.length,stepsCompleted:eligibleSteps.filter(step=>completed.has(step.status)).length,
  confirmations:sum(tasks,row=>row.confirmations),requests:requests.length,reports:reports.length,priced:priced.length,
  input:sum(reports,call=>call.tokens.input),output:sum(reports,call=>call.tokens.output),
  cacheReports:cached.length,cacheHits:cached.filter(call=>call.tokens.cached>0).length,
  cacheEligibleInput:sum(cached,call=>call.tokens.input),cachedInput:sum(cached,call=>call.tokens.cached),
  cacheWritten:sum(reports,call=>call.tokens.written??0),estimatedPicoUsd:sum(priced,call=>call.cost),
  durations:closed.map(task=>(task.finishedAt??task.updatedAt)-task.startedAt)};
}

export function requestMetric({model,servedModel,body,elapsedMs,error,bytes,rates,httpStatus}){
 const tokens=usageTokens(body?.usage),prices=rates??modelRates();
 const name=servedModel&&Object.hasOwn(prices,servedModel)?servedModel:model;
 const [input,cached,output]=prices[name]??[];
 return {model,servedModel:servedModel??null,bytes,elapsedMs:Math.round(elapsedMs),httpStatus:httpStatus??null,
  tokens,cost:estimatedCost(name,body?.usage,prices),rates:input===undefined?null:{input,cached,output},
  status:error?'failed':'done',failure:failureKind(error),reportedAt:Date.now()};
}

function database(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('airplane-agent-tasks-v1',3);
  request.onupgradeneeded=event=>{
   if(event.oldVersion===0)request.result.createObjectStore('tasks');
   if(event.oldVersion<2)request.result.createObjectStore('recent');
   if(event.oldVersion<3)request.result.createObjectStore('runs');
  };
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>resolve(request.result);
  request.onblocked=()=>reject(Error('本机任务日志暂不可用'));
 });
}

export function taskJournal(account={}){
 const owner=account.id??'device',prefix=owner+':';
 const accountKeys=()=>IDBKeyRange.bound(prefix,prefix+'\uffff');
 const seal=value=>account.id&&account.seal?account.seal('health',value):value;
 const open=value=>value&&account.id&&account.open?account.open('health',value):value;
 async function transact(mode,operation,table='tasks'){
  const db=await database();
  try{
   return await new Promise((resolve,reject)=>{
    const tx=db.transaction([table,'recent'],mode),store=tx.objectStore(table);
    let result,failure;
    const guard=fn=>value=>{
     try{result=fn(value);}catch(error){failure=error;tx.abort();}
    };
    operation(store,guard,tx.objectStore('recent'));
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(failure??tx.error??Error('任务日志存储失败'));
   });
  }finally{db.close();}
 }
 return {
  saveRun(run){
   return transact('readwrite',store=>store.put(seal(run),prefix+run.id),'runs');
  },
  readRun(id){
   return transact('readonly',(store,guard)=>{
    const read=store.get(prefix+id);
    read.onsuccess=guard(()=>open(read.result));
   },'runs');
  },
  removeRun(id){
   return transact('readwrite',store=>store.delete(prefix+id),'runs');
  },
  write(id,event){
   if(!id)return Promise.resolve();
   return transact('readwrite',(store,guard,recent)=>{
    const key=prefix+id,read=store.get(key),index=recent.get(owner);
    read.onsuccess=guard(()=>store.put(seal(updateTask(open(read.result),id,event)),key));
    index.onsuccess=guard(()=>{
     const touch=keys=>recent.put([key,...keys.filter(item=>item!==key)].slice(0,40),owner);
     if(Array.isArray(index.result)){touch(index.result);return;}
     // Older task records keep their payload format. Seed this device's index once on upgrade.
     const legacy=store.getAll(accountKeys());
     legacy.onsuccess=guard(()=>touch(legacy.result.map(open).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,39)
      .map(row=>prefix+row.id)));
    });
   });
  },
  recent(){
   return transact('readonly',(store,guard,recent)=>{
    const index=recent.get(owner),rows=[];
    index.onsuccess=guard(()=>{
     for(const key of index.result??[]){
      const entry=store.get(key);
      entry.onsuccess=guard(()=>{if(entry.result)rows.push(open(entry.result));return rows;});
     }
     return rows;
    });
   });
  },
  async undo(operation){
   const rows=await this.list();
   for(const task of rows.filter(row=>row.steps.some(step=>matchesOperation(step,operation))))
    await this.write(task.id,{type:'undo',operation});
  },
  list(){
   return transact('readonly',(store,guard)=>{
    const read=store.getAll(accountKeys());
    read.onsuccess=guard(()=>read.result.map(open).sort((a,b)=>b.updatedAt-a.updatedAt));
   });
  }
 };
}

export function tracedStep(step,result,operationId){
 const evidence=step.kind==='receipt'?[
  clean(step.receipt.paymentEvidence),clean(step.receipt.totalEvidence),
  step.receipt.images?.length?'附件 '+step.receipt.images.join('、'):null
 ]:step.kind==='finance'?[step.entry.date,step.entry.type]:step.action.steps.map(row=>row.date).filter(Boolean);
 const objects=step.kind==='receipt'?[step.receipt.merchant,...step.receipt.lines.map(row=>row.name)]:
  step.kind==='finance'?[step.entry.categoryId]:step.action.steps.map(row=>row.name);
 const tool=step.kind==='health'?'health_action':step.kind==='finance'?'finance_write':'receipt_order';
 const intent=step.kind==='health'?step.action.steps.map(row=>row.kind):[step.kind];
 return {id:step.id,kind:step.kind,tool,intent,operationId,objects:objects.filter(Boolean).slice(0,8).map(value=>value.slice(0,74)),
  dependsOn:[...step.dependsOn],evidence:evidence.filter(Boolean),
  status:result?.state??'running',receipt:result?.receipt??null,
  retryable:['pending','waiting'].includes(result?.state),
  ...(result?.reason?{reason:clean(result.reason),failure:failureKind(result.reason)}:{reason:null,failure:null})};
}

export function healthTraceReceipt(record){
 if(!record)return null;
 const {edits,...tables}=record.changes??{};
 const ids=changes=>changes.map(([id])=>id).slice(0,18);
 const records=Object.fromEntries(Object.entries(tables).filter(([,changes])=>Array.isArray(changes)).map(([table,changes])=>[table,ids(changes)]));
 for(const [table,changes] of Object.entries(edits??{}))records[table]=[...new Set([...(records[table]??[]),...ids(changes)])].slice(0,18);
 return {operationId:record.id,revision:record.revision,source:'health_action',records,undone:!!record.undone};
}
const matchesOperation=(step,id)=>step.operationId===id||step.receipt?.operationId===id||
 step.receipt?.orderId===id||step.receipt?.transactionIds?.includes(id);
const relevantTerm=(text,object)=>Boolean(object)&&[...object].length>1&&
 (text.includes(object)||[...object.matchAll(/[\p{Script=Han}]{2}|[a-z0-9]{3,}/giu)].some(match=>text.includes(match[0])));

export function relatedTaskSummaries(tasks,{text='',threadId,profile,health,ledger}={}){
 const rows=tasks.filter(task=>task.threadId&&task.threadId===threadId||task.steps.some(step=>
  (step.objects??[]).some(object=>relevantTerm(text,object))||
  profile==='receipt'&&step.kind==='receipt'&&['pending','review'].includes(task.status)));
 return rows.slice(0,5).flatMap(task=>{
  const steps=task.steps.slice(0,8).filter(row=>row.status!=='running'||task.status==='pending').map(step=>{
   const {receipt}=step;
   let verification=null;
   if(receipt?.transactionIds?.length&&ledger)
    verification=receipt.transactionIds.every(id=>ledger.transactions.some(row=>row.id===id))?'present':'missing_or_changed';
   if(receipt?.purchaseId&&health&&!health.local.purchases?.some(row=>row.id===receipt.purchaseId&&row.status!=='cancelled'))
    verification='missing_or_changed';
   if(receipt?.operationId&&health){
    const saved=health.local.assistantActions?.find(row=>row.id===receipt.operationId);
    const reference=saved?.reference?.recordId;
    const foodPresent=reference&&(health.local.foods.some(row=>row.id===reference)||
     health.legacy?.foods?.some(row=>row.id===reference&&health.local.edits?.foods?.[reference]!==null));
    verification=saved?.undone?'undone':!saved?'check_ledger':reference&&!foodPresent?'missing_or_changed':'present';
   }
   if(receipt?.reportId&&health)verification=health.local.medical?.reports?.some(row=>row.id===receipt.reportId)?'present':'missing_or_changed';
   if(receipt?.symptomId&&health)verification=health.local.medical?.symptoms?.some(row=>row.id===receipt.symptomId)?'present':'missing_or_changed';
   return {id:step.id,tool:step.tool??step.kind,operationId:step.operationId,objects:step.objects,
    status:verification==='undone'?'undone':step.status,dependsOn:step.dependsOn,
    retryable:step.retryable??step.status==='pending',failure:step.failure,
    ...(receipt?{receipt,verification}:{}),...(step.reason?{reason:step.reason}:{})};
  });
  return steps.length?[{taskId:task.id,status:task.status,at:new Date(task.updatedAt).toISOString(),steps}]:[];
 });
}
