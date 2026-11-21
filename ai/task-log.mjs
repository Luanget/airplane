import {estimatedCost,modelRates,usageTokens} from './usage.mjs';

const terminal=new Set(['done','skipped','cancelled','failed','blocked','partial']);
const completed=new Set(['done','skipped']);
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
  task.attempts++;
  task.status='running';task.finishedAt=null;
 }else if(event.type==='request'){
  task.requests.push(event.request);
 }else if(event.type==='confirm'){
  task.confirmations++;
 }else if(event.type==='step'){
  const next=event.step;
  const index=task.steps.findIndex(item=>item.id===next.id);
  const row={...(task.steps[index]??{}),...next,updatedAt:now};
  if(index<0)task.steps.push(row);else task.steps[index]=row;
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
  const request=indexedDB.open('airplane-agent-tasks-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('tasks');
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>resolve(request.result);
  request.onblocked=()=>reject(Error('本机任务日志暂不可用'));
 });
}

export function taskJournal(account={}){
 const owner=account.id??'device',prefix=owner+':';
 const seal=value=>account.id&&account.seal?account.seal('health',value):value;
 const open=value=>value&&account.id&&account.open?account.open('health',value):value;
 async function transact(mode,operation){
  const db=await database();
  try{
   return await new Promise((resolve,reject)=>{
    const tx=db.transaction('tasks',mode),store=tx.objectStore('tasks');
    let result,failure;
    const guard=fn=>value=>{
     try{result=fn(value);}catch(error){failure=error;tx.abort();}
    };
    operation(store,guard);
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(failure??tx.error??Error('任务日志存储失败'));
   });
  }finally{db.close();}
 }
 return {
  write(id,event){
   if(!id)return Promise.resolve();
   return transact('readwrite',(store,guard)=>{
    const key=prefix+id,read=store.get(key);
    read.onsuccess=guard(()=>store.put(seal(updateTask(open(read.result),id,event)),key));
   });
  },
  list(){
   return transact('readonly',(store,guard)=>{
    const read=store.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));
    read.onsuccess=guard(()=>read.result.map(open).sort((a,b)=>b.updatedAt-a.updatedAt));
   });
  }
 };
}

export function tracedStep(step,result){
 const evidence=step.kind==='receipt'?[
  clean(step.receipt.paymentEvidence),clean(step.receipt.totalEvidence),
  step.receipt.images?.length?'附件 '+step.receipt.images.join('、'):null
 ]:step.kind==='finance'?[clean(step.evidence)]:step.action.steps.map(row=>clean(row.evidence));
 return {id:step.id,kind:step.kind,dependsOn:[...step.dependsOn],evidence:evidence.filter(Boolean),
  status:result?.state??'running',receipt:result?.receipt??null,
  ...(result?.reason?{reason:clean(result.reason),failure:failureKind(result.reason)}:{reason:null,failure:null})};
}
