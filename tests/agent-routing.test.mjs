import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localAgentCommand,routeAgent,routedSkills,scopedHistory} from '../ai/routing.mjs';
import {saveChatModel} from '../ai/models.mjs';
import {modelRequest,parseResult,pendingLedgerRead} from '../ai/responses.mjs';
import {memoryKind,memoryLibrary} from '../ai/memory.mjs';
import {selectSkills,skillCatalog} from '../ai/skills.mjs';
import {requestMetric,summarizeTasks,tracedStep,updateTask} from '../ai/task-log.mjs';
import {estimatedCost,modelRates,saveModelRates,usageTokens} from '../ai/usage.mjs';
import {STORAGE_KEY,freshData} from '../finance-storage.mjs';
import {executeAgentTask} from '../ai/agent-executor.mjs';
import {orderReceipt,receiptStep} from './order-agent-fixture.mjs';

const day='2034-04-04';
function makeStore(){
 const values=new Map([[STORAGE_KEY,JSON.stringify(freshData())]]);
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
test('route local deterministic writes and current reads, avoid ambiguous or unauthorized inputs',()=>{
 const finance=makeStore(),options={today:day,allowRead:true};
 const route=text=>localAgentCommand({finance},{...options,text});
 assert.deepEqual(route('我的余额是多少？'),{query:{scope:'balance',query:''}});
 assert.deepEqual(route('昨天吃了什么'),{query:{scope:'foods',date:'2034-04-03',query:''}});
 assert.deepEqual(route('查看今日收支'),{query:{scope:'expenses',query:''}});
 assert.equal(route('记晨重72.4kg').proposal.result.steps[0].kg,72.4);
 assert.equal(route('牛肉酱现在310g').proposal.result.steps[0].gross,310);
 assert.equal(route('记一笔支出 餐饮 23元').proposal.result.steps[0].entry.amount,23);
 for(const text of ['鸡胸大概剩330g','昨天牛奶现在310g','如果牛肉酱现在300g','我昨天吃了多少','删除今天晨重',
  '记支出 分类不存在 23元','记录晨重70kg，帮我记账','牛肉酱现在310g，顺便记一笔收入'])
  assert.equal(route(text),null,text);
 assert.equal(localAgentCommand({finance},{...options,allowRead:false,text:'记晨重72.4kg'}),null);
});
test('automatic tier selection and explicit override apply to ordinary, visual and medical turns',()=>{
 const finance=makeStore(),choose=(text,extra)=>routeAgent(finance,{text,...extra});
 assert.equal(choose('我晚餐吃了两盘菜').model,'gpt-6-luna');
 assert.equal(choose('识别订单截图',{photos:1}).profile,'receipt');
 assert.equal(choose('识别订单截图',{photos:1}).model,'gpt-6.1-terra');
 assert.equal(choose('晨重72.4kg，识别购物截图，食品入库，再安排晚餐',{photos:1,today:day}).model,'gpt-6.1-terra');
 assert.equal(choose('记录晨重并分析整月收支结构，比较营养与消费变化',{photos:0,today:day}).model,'gpt-6.2-sol');
 assert.equal(choose('提取指标',{medical:'extract',photos:1}).model,'gpt-6.1-terra');
 saveChatModel(finance,'gpt-6-luna');
 assert.equal(choose('识别订单截图',{photos:1}).model,'gpt-6-luna');
 assert.equal(choose('识别订单截图',{photos:1}).manual,true);
 saveChatModel(finance,'auto');
 assert.equal(choose('识别订单截图',{photos:1}).manual,false);
});
test('receipt schemas cache the same static instructions and reject an unoffered read',()=>{
 const finance=makeStore(),catalog=skillCatalog(finance),photo='data:image/jpeg;base64,/9j/AAAA';
 const make=(text,skills)=>modelRequest({mode:'chat',text,date:day,history:[],photo},
  {allowRead:true,profile:'receipt',agentTasks:true,receiptInput:true,skills});
 const rawA=make('处理这张采购截图',routedSkills(selectSkills(catalog,{text:'订单截图',photos:true}),'receipt'));
 const rawB=make('处理另一张已付截图',[]);
 assert.equal(rawA.instructions,rawB.instructions);
 assert.deepEqual(rawA.text.format,rawB.text.format);
 assert.equal(rawA.tools,undefined);
 assert.equal(JSON.parse(rawA.input[0].content[0].text).activeSkills.includes('receipts'),true);
 assert.ok(!rawA.instructions.includes('receipts v1'));
 const tool={status:'completed',output:[{type:'function_call',name:'read_packages',call_id:'fake-read',
  arguments:JSON.stringify({query:'',skuId:null,containerId:null,includeClosed:'no'})}]};
 assert.throws(()=>pendingLedgerRead(tool,{allowRead:true,profile:'receipt'}));
 assert.ok(pendingLedgerRead(tool,{allowRead:true,profile:'health'}));
 assert.throws(()=>pendingLedgerRead(tool,{allowRead:false,profile:'health'}));
 const invalid={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({
  reply:'记账',proposal:{mode:'finance',date:null,result:{note:'',entry:null}}
 })}]}]};
 assert.throws(()=>parseResult(invalid,{mode:'chat',date:day,text:'订单截图',history:[],photo},
  {allowRead:true,profile:'receipt',agentTasks:true}));
 const financeReq=modelRequest({mode:'chat',date:day,text:'消费趋势',history:[],photo:null},
  {allowRead:true,profile:'finance'});
 assert.deepEqual(financeReq.tools.find(tool=>tool.name==='read_ledger').parameters.properties.scope.enum,['balance','budget','expenses']);
});
test('focused memory keeps current ledger facts and tentative plans outside context and replaces a habit',()=>{
 const store=makeStore(),memory=memoryLibrary(store);
 memory.prepare(null,{name:'缴费观察',text:'当前余额 30 元',kind:'habit'},'add').commit();
 memory.prepare(null,{name:'晚餐安排',text:'今晚打算吃鸡胸',kind:'plan'},'add').commit();
 memory.prepare(null,{name:'酱料习惯',text:'平时牛肉酱少放',kind:'habit'},'add').commit();
 assert.deepEqual(memory.list().map(memoryKind),['fact','plan','habit']);
 assert.equal(JSON.stringify(memory.relevant('当前余额、鸡胸、牛肉酱')).includes('30 元'),false);
 assert.deepEqual(memory.rememberFromTurn([{name:'酱料习惯',text:'平时牛肉酱放一勺',evidence:'以后牛肉酱放一勺'}],'以后牛肉酱放一勺'),[]);
 assert.equal(memory.relevant('牛肉酱')[0].text,'平时牛肉酱少放');
 assert.deepEqual(memory.rememberFromTurn([{name:'退款余额',text:'当前余额 5 元',evidence:'以后记住余额 5 元'}],'以后记住余额 5 元'),[]);
 const turns=Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',text:'之前的反复文本'.repeat(100)}));
 assert.equal(scopedHistory('receipt','识别这张截图',{turns,summary:'总结'}).turns.length,12);
 assert.deepEqual(scopedHistory('health','正常问题',{turns,summary:'总结'}),{turns,summary:'总结'});
});
test('usage distinguishes cache misses from absent reports and estimates with editable rate snapshots',()=>{
 const store=makeStore();
 const usage={input_tokens:2000,output_tokens:500,input_tokens_details:{cached_tokens:1400,cache_write_tokens:100,
  cache_write_tokens_details:{ttl_12h_tokens:60}}};
 const defaultEstimate=estimatedCost('gpt-6-luna',usage);
 saveModelRates(store,'gpt-6-luna',[2,1,10]);
 const cost=estimatedCost('gpt-6-luna',usage,modelRates(store));
 assert.ok(cost>defaultEstimate);
 assert.deepEqual(usageTokens({input_tokens:7,output_tokens:1}),{input:7,output:1,cached:null,written:0,longWrite:0});
 const key='demo';
 let record=updateTask(null,key,{type:'start',route:'receipt'},100);
 const call=(details,error)=>requestMetric({model:'gpt-6-luna',body:details?{usage:details}:undefined,elapsedMs:60,error,rates:modelRates(store)});
 for(const [details,error] of [[usage,null],[{input_tokens:500,output_tokens:50,input_tokens_details:{cached_tokens:0}},null],
   [{input_tokens:8,output_tokens:0},null],[null,Error('HTTP 429')]])
  record=updateTask(record,key,{type:'request',request:call(details,error)},150);
 record=updateTask(record,key,{type:'confirm'},170);
 record=updateTask(record,key,{type:'status',status:'done'},200);
 const report=summarizeTasks([record]);
 assert.equal(report.requests,4);assert.equal(report.reports,3);
 assert.equal(report.cacheReports,2);assert.equal(report.cacheHits,1);assert.equal(report.cachedInput,1400);
 assert.equal(report.confirmations,1);assert.deepEqual(report.durations,[100]);
 assert.equal(record.requests.at(-1).failure,'rate_or_quota');
});
test('a deferred order checkpoint exposes evidence and waits without allowing a dependent save',async()=>{
 const finance=makeStore(),receipt=orderReceipt(day,{state:'unknown'}),steps=[];
 const execute=await executeAgentTask({finance,readHealth:async()=>({local:{}}),resumeReceipt:async()=>{}},{
  steps:[receiptStep(receipt),{...receiptStep(receipt,'second'),dependsOn:['order']}]
 },{id:'synth',today:day,text:'',mediaKey:'fixture',clock:'12:00',onStepEvent:event=>steps.push(event)});
 assert.deepEqual(execute.rows.map(row=>row.state),['blocked','waiting']);
 assert.equal(steps[0].status,'running');
 assert.ok(tracedStep(receiptStep(receipt)).evidence.includes('支付成功'));
 assert.equal(steps[1].receipt,null);
 assert.deepEqual(steps.at(-1).dependsOn,['order']);
});

test('execution memory verifies pertinent health and finance receipts from current books',async()=>{
 const {healthTraceReceipt,relatedTaskSummaries}=await import('../ai/task-log.mjs');
 const record=healthTraceReceipt({id:'operation',revision:5,changes:{foods:[['food1',null]],edits:{foods:[['legacy1',true,null]]}}});
 assert.deepEqual(record.records.foods,['food1','legacy1']);
 let task=updateTask(null,'task-one',{type:'start',route:'mixed',threadId:'thread-one'},100);
 task=updateTask(task,'task-one',{type:'step',step:{id:'health',kind:'health',objects:['牛肉酱'],status:'done',receipt:record}},110);
 task=updateTask(task,'task-one',{type:'step',step:{id:'purchase',kind:'receipt',dependsOn:['health'],status:'pending',retryable:true}},120);
 const health={local:{assistantActions:[{id:'operation',undone:true}]}};
 const [verified]=relatedTaskSummaries([task],{text:'继续',threadId:'thread-one',health});
 assert.equal(verified.steps[0].status,'undone');
 assert.equal(verified.steps[1].retryable,true);
 assert.deepEqual(relatedTaskSummaries([task],{text:'月度预算',threadId:'different-thread'}),[]);
 assert.equal(relatedTaskSummaries([task],{text:'那瓶牛肉酱'})[0].taskId,'task-one');
 assert.equal(updateTask(task,'task-one',{type:'undo',operation:'operation'},130).steps[0].status,'undone');
});
