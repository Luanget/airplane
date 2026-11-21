import {tracedStep} from './task-log.mjs';
import {normalizeClock} from '../calendar.mjs';
import {addConfirmedTransactions,freshData,readFinance} from '../finance-storage.mjs';
import {agentTaskSchema,matches,validFinanceEntry} from '../health/contract.mjs';
import {cents} from '../health/purchases.mjs';
import {AssistantSyncPending,writeFinanceWithPurchaseCheck} from '../health/purchase-sync.mjs';
import {hash,same} from '../health/sync-source.mjs';
import {chooseFinanceCategory,financeAutomation,financeEntry} from './finance.mjs';
import {executeHealthAction,hasHealthAuto,undoHealthAction} from './health-actions.mjs';
import {executeReceipt,undoReceipt} from './receipts.mjs';
import {assertSkillAction,skillCatalog} from './skills.mjs';

const terminal=new Set(['done','skipped']);
const labels={health:'健康',finance:'记账',receipt:'截图订单'};
const statuses={done:'已处理',skipped:'已跳过',pending:'可重试',waiting:'等待前置步骤',review:'待确认',blocked:'需核对'};
const hasOwn=(record,id)=>Object.hasOwn(record,id);
const clean=text=>String(text).normalize('NFKC').replace(/\s/g,'');
const yuan=value=>'¥'+Number(value).toFixed(2);

export function orderAgentTasks(plan){
 if(!matches(agentTaskSchema,plan))throw Error('任务计划格式无效，账本未更改。');
 const tasks=new Map();
 for(const step of plan.steps){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(step.id)||tasks.has(step.id)||new Set(step.dependsOn).size!==step.dependsOn.length)
   throw Error('任务标识或依赖重复，账本未更改。');
  tasks.set(step.id,step);
 }
 if(plan.steps.some(step=>step.dependsOn.some(id=>!tasks.has(id))))throw Error('任务引用了不存在的前置步骤。');
 const ordered=[],done=new Set();
 while(ordered.length<tasks.size){
  const ready=plan.steps.filter(step=>!done.has(step.id)&&step.dependsOn.every(id=>done.has(id)));
  if(!ready.length)throw Error('任务依赖形成循环，账本未更改。');
  for(const step of ready){ordered.push(step);done.add(step.id);}
 }
 return ordered;
}

async function executeFinance(workspace,step,options){
 const {entry,evidence}=step,{id,today,clock,text,guard,confirmed}=options;
 const stamp='agent-finance-'+hash(id);
 const current=readFinance(workspace.finance),ledger=current.payload??freshData();
 const active=ledger.categories.filter(row=>!row.hidden);
 const category=chooseFinanceCategory(ledger,{type:entry.type,hint:entry.categoryId,name:entry.note,explicit:true});
 const amount=cents(entry.amount);
 const phrase=clean(evidence),message=clean(text);
 const income=/收入|收到|收了|到账|工资|奖金|报销到账|退款到账/.test(phrase);
 const expense=/支出|付款|付了|花了|花费|买了|消费/.test(phrase);
 const quotes=phrase.replace(/(?<=\d)[,，](?=\d{3}(?!\d))/g,'').match(/\d+(?:\.\d+)?/g)??[];
 if(!validFinanceEntry({...entry,categoryId:category?.id},{date:today,categories:active})||
    !category||!phrase||!message.includes(phrase)||!quotes.some(value=>Number(value)===entry.amount)||
    !/记[一笔账帐下]|记到|付款|付了|花了|花费|支出|收入|收到|报销|买了/.test(phrase)||
    (income&&expense||income&&entry.type!=='income'||expense&&entry.type!=='expense')||
    (/余额|转账|批量|删除|清空|覆盖/.test(phrase)))

  return {state:'blocked',reason:'请明确这笔收支的方向、金额和已启用的分类。'};
 const entryRow=financeEntry({id:stamp,type:entry.type,amount:amount/100,date:entry.date,
  time:normalizeClock(clock),note:entry.note,category});
 const present=ledger.transactions.find(row=>row.id===stamp);
 if(present&&!same(present,entryRow))return {state:'blocked',reason:'此任务对应的交易已改动，请核对原记录。'};
 if(!present){
  if(!confirmed&&(!income&&!expense||/只(?:识别|看看|预览)|不要(?:记|保存)|先(?:预览|别记)/.test(text)))
   return {state:'review',reason:'请确认这笔收支。',detail:category.name+' '+yuan(entry.amount)+' · '+entry.note};
  const grant=financeAutomation(workspace.finance);
  if(!confirmed&&(!grant.enabled||amount>grant.limitCents))
   return {state:'review',reason:grant.enabled?'金额超过财务自动执行单笔上限。':'日常财务自动执行未开启。',
    detail:category.name+' '+yuan(entry.amount)+' · '+entry.date+' · '+entry.note};
  await (workspace.writeFinance??writeFinanceWithPurchaseCheck)(workspace.account,current.primary,[],payload=>{
   guard({total:amount});
   addConfirmedTransactions(payload,[entryRow]);
   return payload;
  });
 }
 const saved=readFinance(workspace.finance).payload?.transactions.find(row=>row.id===stamp);
 if(!saved||!same(saved,entryRow))throw Error('未验证财务保存回执，请用原消息重试。');
 return {state:'done',text:(saved.type==='expense'?'已记支出':'已记收入')+' '+yuan(saved.amount)+' · '+saved.categoryName,
  detail:saved.date+' · '+saved.note,receipt:{transactionIds:[saved.id]},undo:{kind:'finance',id:stamp,entry:saved}};
}

export async function executeAgentTask(workspace,plan,options){
 const steps=orderAgentTasks(plan),results=Object.create(null);
 for(const [id,value] of Object.entries(options.prior??{}))results[id]=value;
 let reference=options.healthOptions?.reference;
 for(const step of steps){
  if(hasOwn(results,step.id)&&terminal.has(results[step.id]?.state)){
   reference=results[step.id].reference??reference;
   continue;
  }
  if(options.signal?.aborted)break;
  const missing=step.dependsOn.filter(id=>results[id]?.state!=='done');
  if(missing.length){
   results[step.id]={state:'waiting',reason:'前置步骤未完成：'+missing.join('、')};
   options.onStepEvent?.(tracedStep(step,results[step.id]));
   continue;
  }
  const confirmed=options.approved?.includes(step.id)===true;
  const id=options.id+':'+step.id;
  const check=()=>{options.signal?.throwIfAborted();options.guard?.();};
  const guard=({total,health})=>{
   check();
   assertSkillAction(skillCatalog(workspace.finance),step.kind==='finance'?'finance_write':'receipt_order');
   const grant=financeAutomation(workspace.finance);
   if(!confirmed&&(!grant.enabled||total>grant.limitCents||health&&!hasHealthAuto(workspace.finance)))
    throw Error('执行授权或金额上限已更改，账本待重新核对。');
  };
  try{
   check();
   options.onStep?.(labels[step.kind]);
   options.onStepEvent?.(tracedStep(step));
   if(step.kind==='receipt'){
    assertSkillAction(skillCatalog(workspace.finance),'receipt_order');
    results[step.id]=await executeReceipt(workspace,step.receipt,{...options,id,confirmed,guard,
     grant:financeAutomation(workspace.finance),healthAuto:hasHealthAuto(workspace.finance)});
   }else if(step.kind==='finance'){
    assertSkillAction(skillCatalog(workspace.finance),'finance_write');
    results[step.id]=await executeFinance(workspace,step,{...options,id,confirmed,guard});
   }else{
    const base=await workspace.readHealth();
    const result=await executeHealthAction(workspace,base,step.action,{...options.healthOptions,id,
     text:options.text,today:options.today,clock:options.clock??'12:00',reference,confirmed,signal:options.signal,
     mediaKey:(options.mediaKey??'')+':'+step.id,auto:hasHealthAuto(workspace.finance),guard:()=>{
      check();
      if(!confirmed&&!hasHealthAuto(workspace.finance))throw Error('健康自动执行已关闭。');
      for(const action of step.action.steps)assertSkillAction(skillCatalog(workspace.finance),action.kind);
     }});
    reference=result.record?.reference??reference;
    const undo=result.record&&!result.record.undone&&(!result.duplicate||result.record.id===id)?{kind:'health',id:result.record.id}:null;
    results[step.id]=result.preview==='confirm'?{state:'review',reason:'健康自动执行未开启。',detail:result.text}:
     {state:'done',text:result.text.split('\n')[0],detail:[result.text,result.source?.text].filter(Boolean).join('\n'),undo,reference,
      receipt:result.record?{operationId:result.record.id,revision:result.record.revision,undone:!!result.record.undone}:null};
   }
  }catch(err){
   const retry=err instanceof AssistantSyncPending||options.signal?.aborted||
    /待同步|已变更|未验证|未能验证|存储|保存回执|constraint|quota|abort|write|interrupted/i.test(err.message);
   results[step.id]={state:retry?'pending':'blocked',reason:err.message||'无法完成该步骤。'};
  }
  options.progress?.(results);
  options.onStepEvent?.(tracedStep(step,results[step.id]));
 }
 for(const step of steps)if(!hasOwn(results,step.id)){
  results[step.id]={state:'pending',reason:'执行已停止，可用原消息重试。'};
  options.onStepEvent?.(tracedStep(step,results[step.id]));
 }
 options.progress?.(results);
 const rows=steps.map(step=>({id:step.id,label:labels[step.kind],...results[step.id]}));
 return {results,reference,rows,
  text:rows.map(row=>row.text||statuses[row.state]+' · '+row.label+' · '+row.reason).join('\n'),
  detail:rows.map(row=>row.label+' · '+statuses[row.state]+'\n'+(row.detail||row.text||row.reason)).join('\n\n'),
  undo:rows.flatMap(row=>row.undo?[{...row.undo,label:row.label}]:[])};
}

export async function undoAgentTask(workspace,undo){
 if(undo.kind==='health')return undoHealthAction(workspace,undo.id);
 if(undo.kind==='receipt')return undoReceipt(workspace,undo.id);
 if(undo.kind!=='finance')throw Error('无法识别撤销项。');
 const {primary,payload}=readFinance(workspace.finance);
 const previous=payload?.transactions.find(row=>row.id===undo.id);
 if(!previous)return '已撤销这笔收支。';
 if(!same(previous,undo.entry))throw Error('这笔记录已更改，请在财务页核对。');
 await (workspace.writeFinance??writeFinanceWithPurchaseCheck)(workspace.account,primary,[undo.id],ledger=>{
  ledger.transactions=ledger.transactions.filter(row=>row.id!==undo.id);
  return ledger;
 });
 if(readFinance(workspace.finance).payload?.transactions.some(row=>row.id===undo.id))
  throw Error('未验证撤销回执，请重新核对。');
 return '已撤销这笔收支。';
}
