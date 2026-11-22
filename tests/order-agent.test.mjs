import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFinance,replaceFinance,STORAGE_KEY} from '../finance-storage.mjs';
import {ensureContainers,packagesFor} from '../health/containers.mjs';
import {dayIntake,energyForDay,inventoryWithMoves,validateAppState} from '../health/core.mjs';
import {unpackBackup,combinedBackup} from '../health/backup.mjs';
import {createSyncPackage} from '../health/sync-io.mjs';
import {importSource} from '../health/sync-source.mjs';
import {planHealthMerge} from '../health/sync.mjs';
import {createAgentTools} from '../ai/agent-tools.mjs';
import {executeAgentTask,orderAgentTasks,undoAgentTask} from '../ai/agent-executor.mjs';
import {financeAutomation,setFinanceAutomation} from '../ai/finance.mjs';
import {setHealthAuto} from '../ai/health-actions.mjs';
import {modelRequest,parseResult} from '../ai/responses.mjs';
import {AssistantSyncPending} from '../health/purchase-sync.mjs';
import {action,proposal} from './health-action-fixture.mjs';
import {combinedTask,conversation,item,orderFinance,orderReceipt,orderState,receiptStep} from './order-agent-fixture.mjs';

const date='2031-01-03',today='2031-01-04';
const prefs={id:'fixture-agent',today,clock:'12:00',text:'',attachmentKeys:['photo-1','photo-2'],mediaKey:'photo-1:photo-2'};
const make=()=>{
 const finance=new Map([[STORAGE_KEY,JSON.stringify(orderFinance(today))]]);
 finance.getItem=key=>finance.get(key)??null;
 finance.setItem=(key,value)=>finance.set(key,value);
 finance.removeItem=key=>finance.delete(key);
 const account={finance};
 let state=orderState(today),pending=null;
 const save=async(next,rev,guard)=>{
  guard?.();
  if(rev!==(state.revision??0))throw Error('账本已变更');
  assert.ok(validateAppState(next));
  state=ensureContainers({...structuredClone(next),revision:rev+1});
 };
 const check=(record,expected)=>assert.equal(record.primary,expected);
 const workspace={account,finance,readHealth:async()=>structuredClone(state),saveHealth:async(...args)=>{
   if(pending)throw Error('有待同步的账本更新，请先在库存页处理');
   return save(...args);
  },
  writeFinance:async(_account,expected,_ids,project)=>{
   const financeRecord=readFinance(finance);check(financeRecord,expected);
   replaceFinance(finance,project(financeRecord.payload),expected);
  },
  updateReceipt:async(_account,next,rev,expected,{pairs,operation},guard)=>{
   guard?.();
   const record=readFinance(finance);check(record,expected);
   for(const row of pairs)assert.deepEqual(record.payload.transactions.find(item=>item.id===row.id)??null,row.before);
   const ids=new Set(pairs.map(row=>row.id));
   record.payload.transactions=record.payload.transactions.filter(row=>!ids.has(row.id)).concat(pairs.flatMap(row=>row.after?[row.after]:[]));
   replaceFinance(finance,record.payload,expected);
   if(workspace.interrupt){pending={next,rev,operation};throw new AssistantSyncPending('财务已保存，健康账本待同步。');}
   await save(next,rev);
  },
  resumeReceipt:async(_account,operation)=>{
   if(pending?.operation===operation&&!workspace.interrupt){await save(pending.next,pending.rev);pending=null;}
  }};
 return workspace;
};
function authorize(workspace,limit=10000){
 setFinanceAutomation(workspace.finance,true,limit);
 setHealthAuto(workspace.finance,true);
}
const run=(workspace,receipt,more={})=>executeAgentTask(workspace,{steps:[receiptStep(receipt)]},{...prefs,...more});
const ledger=workspace=>readFinance(workspace.finance).payload;

test('paid mixed receipt honors corrected custom taxonomy, paid discounts, unknown costs and new lot specs',async()=>{
 const w=make();authorize(w);
 const result=await run(w,orderReceipt(today,{images:[1,2]}));
 assert.equal(result.rows[0].state,'done',result.text);
 const data=ledger(w),entries=data.transactions.filter(row=>row.receiptKey);
 assert.deepEqual(entries.map(row=>[row.categoryId,row.amount,row.budgetExcluded]),[
  ['fixture-groceries',13,true],['default-5',18,false],['fixture-shipping',3,false]]);
 assert.equal(data.budgets[today.slice(0,7)],421);
 const state=await w.readHealth(),milk=inventoryWithMoves(state).find(row=>row.id==='fixture-milk');
 assert.equal(milk.qty,1000);assert.equal(state.local.purchases.length,1);
 assert.equal(state.local.inventory.length,1);
 assert.equal(state.local.batches[0].costCents,1300);
 assert.deepEqual(packagesFor(state,milk.id).map(row=>row.nominal.value),[500,500]);
 assert.equal(milk.packageSize,1000);
 assert.equal(state.local.foods.length,0);
 const duplicate=await run(w,orderReceipt(today),{id:'new-turn'});
 assert.match(duplicate.text,/未重复写入/);
 assert.deepEqual(await w.readHealth(),state);
 const wrongNumber=await run(w,orderReceipt(today,{orderNo:'WRONG-001'}));
 assert.match(wrongNumber.text,/订单号不一致/);
 const newOrder=await run(w,orderReceipt(today,{orderNo:'SYNTH-NEW-002',images:[2],
  lines:[item('合成脱脂牛奶','food',{quantity:2,unit:'盒',packAmount:250,packUnit:'mL'})],
  shipping:null,discount:null}),{id:'new-purchase',attachmentKeys:['new-bag','new-receipt'],mediaKey:'new-bag:new-receipt'});
 assert.equal(newOrder.rows[0].state,'done',newOrder.text);
 const next=await w.readHealth();
 assert.equal(next.local.inventory.length,1);
 assert.equal(next.local.batches.at(-1).costCents,null);
 assert.deepEqual(packagesFor(next,milk.id).map(row=>[row.nominal.value,row.costCents]),[[500,650],[500,650],[250,null],[250,null]]);
});
test('cart, conflicting payments, incomplete image references and unproven allocation cannot write',async()=>{
 const w=make();authorize(w);const original=ledger(w);
 const cases=[
  [{state:'unpaid',paymentEvidence:'购物车待付款'},'skipped'],
  [{state:'unknown'},'blocked'],
  [{state:'paid',paymentEvidence:'Payment pending / unpaid'},'blocked'],
  [{state:'paid',paymentEvidence:'实付款'},'blocked'],
  [{images:[3]},'blocked'],
  [{totalEvidence:'实付 34.004'},'blocked'],
  [{shipping:4},'blocked'],
  [{lines:[item('商品名称无法读取','unknown')]},'blocked']
 ];
 for(const [change,status] of cases){
  const result=await run(w,orderReceipt(today,change));
  assert.equal(result.rows[0].state,status,result.text);
 }
 assert.deepEqual(ledger(w),original);
 assert.equal((await w.readHealth()).local.purchases,undefined);
});
test('pure receipt preserves unallocated paid balance separately and records one linked partial refund',async()=>{
 const w=make();authorize(w);
 const first=await run(w,orderReceipt(today,{lines:[],discount:null,shipping:null}));
 assert.equal(first.rows[0].state,'done');
 const entry=ledger(w).transactions.at(-1);
 assert.equal(entry.amount,34);
 assert.equal(entry.receiptUnallocated,true);
 const refund=orderReceipt(today,{state:'partial_refund',paymentEvidence:'退款成功',refund:11,refundNo:'RETURN-42',
  totalEvidence:'退款 ¥11',lines:[],discount:null,shipping:null,images:[2]});
 const result=await run(w,refund,{id:'refund-task'});
 assert.equal(result.rows[0].state,'done',result.text);
 assert.equal(ledger(w).transactions.at(-1).type,'income');
 assert.equal(ledger(w).transactions.at(-1).budgetSync,false);
 const repeated=await run(w,refund,{id:'refund-replay'});
 assert.match(repeated.text,/未重复写入/);
 assert.equal(ledger(w).transactions.length,3);
 await assert.rejects(undoAgentTask(w,first.undo[0]),/已有退款/);
 await undoAgentTask(w,result.undo[0]);
 await undoAgentTask(w,first.undo[0]);
 assert.equal(ledger(w).transactions.length,1);
});
test('finance and health grants are separate, limits are enforced and plans require no write grant',async()=>{
 const w=make();
 assert.equal(financeAutomation(w.finance).enabled,false);
 const draft=orderReceipt(today);
 let result=await run(w,draft);
 assert.equal(result.rows[0].state,'review');
 setHealthAuto(w.finance,true);
 result=await run(w,draft);
 assert.equal(result.rows[0].state,'review');
 authorize(w,2000);
 result=await run(w,draft);
 assert.match(result.text,/单笔上限/);
 setFinanceAutomation(w.finance,true,4000);setHealthAuto(w.finance,false);
 result=await run(w,draft);
 assert.match(result.text,/需要健康授权/);
 result=await run(w,draft,{approved:['order']});
 assert.equal(result.rows[0].state,'done',result.text);
 assert.equal(ledger(w).transactions.filter(row=>row.receiptKey).length,3);
});
test('cross-ledger interruption is resumable and independent work keeps its receipt',async()=>{
 const w=make();authorize(w);
 w.interrupt=true;
 const plan=combinedTask(orderReceipt(today));
 assert.deepEqual(orderAgentTasks(plan).map(row=>row.id),['order','weight','dinner']);
 const options={...prefs,id:'partial-test',text:conversation};
 const first=await executeAgentTask(w,plan,options);
 assert.equal(first.results.order.state,'pending');
 assert.equal(first.results.weight.state,'pending');
 assert.equal(first.results.dinner.state,'waiting');
 assert.equal(ledger(w).transactions.filter(row=>row.receiptKey).length,3);
 assert.equal((await w.readHealth()).local.purchases,undefined);
 w.interrupt=false;
 const done=await executeAgentTask(w,plan,{...options,prior:first.results});
 assert.deepEqual(done.rows.map(row=>row.state),['done','done','done']);
 const state=await w.readHealth();
 assert.equal(state.local.weights.at(-1).kg,72.4);
 assert.match(done.detail,/下一餐建议/);
 assert.equal(state.local.foods.length,0);
 assert.equal(state.local.batches.length,1);
 await undoAgentTask(w,done.undo.find(row=>row.kind==='receipt'));
 await undoAgentTask(w,done.undo.find(row=>row.kind==='health'));
 assert.deepEqual((await w.readHealth()).local.weights,[]);
 assert.equal((await w.readHealth()).local.batches.length,0);
 assert.equal(ledger(w).transactions.length,1);
 const rerun=await run(w,orderReceipt(today));
 assert.match(rerun.text,/已经撤销/);
 assert.equal(ledger(w).transactions.length,1);
});
test('bad receipt blocks its own dependents and still records the independent morning weight',async()=>{
 const w=make();authorize(w);
 const original=ledger(w);
 const plan=combinedTask(orderReceipt(today,{state:'unknown'}));
 const result=await executeAgentTask(w,plan,{...prefs,text:conversation});
 assert.deepEqual(result.rows.map(row=>row.state),['blocked','done','waiting']);
 assert.equal((await w.readHealth()).local.weights.length,1);
 assert.deepEqual(ledger(w),original);
 const cyclic=structuredClone(plan);cyclic.steps[1].dependsOn=['dinner'];
 assert.throws(()=>orderAgentTasks(cyclic),/循环/);
});
test('worded finance operation verifies direction, text evidence, category and message retry',async()=>{
 const w=make();authorize(w);
 const expense='午饭花了28元';
 const create=(type='expense')=>({steps:[{kind:'finance',id:'finance',dependsOn:[],evidence:expense,
  entry:{type,date:today,categoryId:'家庭食材',amount:28,note:'测试午饭'}}]});
 const options={...prefs,text:expense};
 const bad=await executeAgentTask(w,create('income'),options);
 assert.equal(bad.rows[0].state,'blocked');
 const good=await executeAgentTask(w,create(),options);
 assert.equal(good.rows[0].state,'done',good.text);
 assert.equal(ledger(w).transactions.length,2);
 await executeAgentTask(w,create(),options);
 assert.equal(ledger(w).transactions.length,2);
 await undoAgentTask(w,good.undo[0]);
 assert.equal(ledger(w).transactions.length,1);
});
test('explicit day confirmation, historical compatibility, backup and health-only package replay',async()=>{
 const w=make();authorize(w);
 const state=await w.readHealth();
 state.local.foods.push({id:'synthetic-lunch',date,name:'合成午餐',meal:'午餐',status:'actual',nutrition:{kcal:700}});
 await w.saveHealth(state,0);
 assert.equal(energyForDay(await w.readHealth(),date,today).closed,false);
 const text='确认昨天全天饮食已记录';
 const task={steps:[{id:'close',dependsOn:[],kind:'health',action:proposal(action('day_status',text,{status:'complete',date}))}]};
 const result=await executeAgentTask(w,task,{...prefs,text});
 assert.equal(result.rows[0].state,'done',result.text);
 assert.equal(energyForDay(await w.readHealth(),date,today).closed,true);
 await run(w,orderReceipt(today));
 const next=await w.readHealth(),data=ledger(w);
 const reopened=unpackBackup(combinedBackup(next,data));
 assert.deepEqual(reopened.finance,data);
 assert.equal(dayIntake(reopened.health,date).totals.kcal,700);
 const sync=createSyncPackage(next,{id:'synthetic-sender',version:'0.9.14'});
 const fresh=orderState(today);
 const first=planHealthMerge(fresh,importSource(sync),{finance:data});
 assert.deepEqual(first.unresolved,[]);
 assert.deepEqual(first.problems,[]);
 const second=planHealthMerge(first.next,importSource(sync),{finance:data});
 assert.deepEqual(second.unresolved,[]);
 assert.equal(second.next.local.agentReceipts.length,1);
 assert.equal(second.next.local.batches.length,1);
 assert.equal(energyForDay(second.next,date,today).closed,true);
 assert.deepEqual(ledger(w),data);
});
test('Responses request includes receipt workflow with images and checks strict typed tasks',()=>{
 const input={mode:'chat',date:today,text:'',history:[],photo:'data:image/jpeg;base64,/9j/AAAA'};
 const options={allowRead:true,agentTasks:true,receiptInput:true};
 const request=modelRequest(input,options);
 assert.match(request.instructions,/每个独立订单一项/);
 assert.equal(request.input[0].content.filter(row=>row.type==='input_image').length,1);
 const value={reply:'将核对订单。',proposal:{mode:'agent_task',date:null,result:{steps:[receiptStep(orderReceipt(today))]}}};
 const mock={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]};
 assert.deepEqual(parseResult(mock,input,options),value);
 assert.throws(()=>parseResult(mock,input,{...options,allowRead:false}));
});

test('missing order number uses independent operation, image and product identities',async()=>{
 const w=make();authorize(w);
 const base=orderReceipt(today,{orderNo:null});
 const runWith=(receipt,id,text='')=>run(w,receipt,{id,text,attachmentKeys:[id],mediaKey:id});
 assert.equal((await runWith(base,'receipt-no-id')).rows[0].state,'done');
 assert.match((await runWith(base,'duplicate-short-window')).text,/疑似重复/);
 assert.equal((await w.readHealth()).local.purchases.length,1);
 await runWith(base,'second-purchase','我又买了一次');
 assert.equal((await w.readHealth()).local.purchases.length,2);
 await runWith(base,'second-purchase','我又买了一次');
 assert.equal((await w.readHealth()).local.purchases.length,2);
 const different={...base,lines:[{...base.lines[0],quantity:1},base.lines[1]]};
 await runWith(different,'different-groceries');
 assert.equal((await w.readHealth()).local.purchases.length,3);
 assert.equal(ledger(w).transactions.filter(row=>row.receiptKey).reduce((sum,row)=>sum+row.amount,0),102);
});

test('paid receipt uses a short default note and preserves a long user note without losing item details',async()=>{
 const w=make();authorize(w);
 const recognized=orderReceipt(today);
 const first=await run(w,recognized);
 assert.equal(first.rows[0].state,'done');
 const saved=ledger(w).transactions.filter(row=>row.receiptKey);
 assert.equal(saved[0].note,'合成脱脂牛奶');
 assert.equal(saved[0].receiptMerchant,'合成商店');
 const note='\n用户备注\n'+'长'.repeat(1000)+'\n';
 const second=await createAgentTools(w)('write_receipt',{...recognized,orderNo:'SYNTH-NOTE-002',note,inventoryLink:'distinct'},{
  operationId:'explicit-note',run:{allowRead:true,date:today,clock:'12:00',messages:['新订单，我又买了一次'],
   attachments:[{key:'different-proof'}]}
 });
 assert.equal(second.status,'saved',second.reason);
 const explicit=ledger(w).transactions.filter(row=>row.receiptKey&&row.receiptKey!==saved[0].receiptKey);
 assert.ok(explicit.length&&explicit.every(row=>row.note===note));
 const last=(await w.readHealth()).local.agentReceipts.at(-1);
 assert.deepEqual([last.lines[0].quantity,last.lines[0].packAmount,last.lines[0].net],[2,500,13]);
});
