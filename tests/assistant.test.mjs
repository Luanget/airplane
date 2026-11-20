import {threadBook} from '../ai/threads.mjs';
import {modelRequest,parseResult,pendingLedgerRead} from '../ai/responses.mjs';
import {readResponseStream,ResponseStreamError} from '../ai/stream.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addDays,addFood,batchBalances,newState,normalizeLedger,validDate,validateAppState,inventoryWithMoves,dayIntake,energyForDay,cycleForDate} from '../health/core.mjs';
import {addBatch,saveSku} from '../health/inventory.mjs';
import {summarizeFoodHistory,reviseFoodPortion} from '../health/food-history.mjs';
import {readLedger} from '../ai/workspace.mjs';
import {contextFor,HISTORY_OPTIONS} from '../ai/context.mjs';
import {dataEdit,readAppData} from '../ai/data.mjs';
import {healthDeletion} from '../ai/deletion.mjs';
import {estimatedCost,displayUsage} from '../ai/usage.mjs';
import {skillLibrary} from '../ai/skills.mjs';
import {confirmItems,resolveItem} from '../health/candidates.mjs';
import {matches,resultSchema,validInput,assistantInput} from '../health/contract.mjs';
import {accountKeys,privateAccount} from '../account.mjs';
import nacl from '../vendor/nacl-fast.min.js';
import {randomBytes} from 'node:crypto';
import {STORAGE_KEY,freshData} from '../finance-storage.mjs';
import {monthlyMetrics,currentBalanceFor} from '../finance-metrics.mjs';
import {displayStockQuantity,stockMeasure} from '../health/inventory.mjs';

const nutrition={kcal:100,protein:10,carbs:8,fat:3,sodium:20};
const part={name:'样品',sku:null,amount:2,unit:'包',action:'eat',basisAmount:100,basisUnit:'g',
  packageSize:50,packageUnit:'g',nutrients:nutrition,uncertainty:'合成标签'};
const date='2030-01-01';
test('default rules, legacy preferences and individual Skills remain independent',()=>{
 const data=new Map([['airplane-ai-skill-v1','保留旧的个人偏好']]);
 const library=skillLibrary({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)});
 const defaults=library.list().filter(item=>item.preset);
 assert.equal(defaults.length,6);
 assert.equal(library.active().length,6);
 assert.equal(library.active().at(-1).text,'保留旧的个人偏好');
 assert.equal(data.size,1);
 const stock=defaults.find(item=>item.id==='l-stock');
 library.enable(stock.id,false);
 library.save({id:stock.id,name:stock.name,text:'本机修改的库存规则'},stock);
 assert.equal(library.active().some(row=>row.name===stock.name),false);
 assert.throws(()=>library.save({id:stock.id,name:stock.name,text:'旧编辑器'},stock),/已变更/);
 library.restore(stock.id);
 library.enable(stock.id,true);
 assert.equal(library.active().find(row=>row.name===stock.name).text,stock.text);
 library.save({name:'新偏好',text:'回答先给结论'});
 const input={mode:'chat',text:'下一餐怎么吃',date,photo:null,history:[]};
 const payload=JSON.parse(modelRequest(input,{skills:library.active()}).input[0].content[0].text);
 assert.deepEqual(payload.skills,library.active());
 assert.equal(payload.skills.some(row=>row.name==='L · 餐食偏好'),false);
 assert.deepEqual(payload.skills.at(-1),{name:'新偏好',text:'回答先给结论'});
});

test('scoped progress queries use local weight and cycle reports without exporting history',async()=>{
 const state=newState(),today='2030-04-09',yesterday='2030-04-08';
 state.settings.cycleAnchor=yesterday;
 state.settings.cycleDays=4;
 state.settings.cycleTarget=4200;
 state.settings.baselineTdee=2600;
 for(let i=0;i<8;i++)state.local.weights.push({source:'manual',date:addDays(today,i-7),kg:88-i/4,isMorning:true});
 state.local.weights.push({source:'manual',date:addDays(today,1),kg:100,isMorning:true});
 addFood(state,{date:yesterday,meal:'午餐',name:'测试食品',kcal:1500,nutrition});
 const workspace={readHealth:async()=>state};
 const weight=await readLedger(workspace,{scope:'weight',query:''},today);
 assert.deepEqual(weight,{asOf:today,latest:{date:today,kg:86.25,tentative:false},change:-0.25,count:7,last7:87,previous7:87.25,delta:-0.25});
 const cycle=await readLedger(workspace,{scope:'cycle',query:''},today);
 assert.equal(cycle.days,4);
 assert.equal(cycle.goal,4200);
 assert.equal(cycle.closedThrough,yesterday);
 assert.equal(cycle.deficit,1100);
 assert.equal(cycle.today.conditionalDeficit,null);
 assert.equal('entries' in cycle,false);
});
test('same browser keeps two account ledgers encrypted and guest data intact',async()=>{
  const values=new Map([['old','guest']]);
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const a=privateAccount(await accountKeys(randomBytes(32).toString('hex')),nacl,storage);
  const b=privateAccount(await accountKeys(randomBytes(32).toString('hex')),nacl,storage);
  a.finance.setItem('old','account A');
  assert.equal(b.finance.getItem('old'),null);
  b.finance.setItem('old','account B');
  assert.equal(a.finance.getItem('old'),'account A');
  assert.equal(values.get('old'),'guest');
  assert.ok(![...values.values()].includes('account A'));
  assert.throws(()=>b.open('health',a.seal('health',{value:1})));
  assert.throws(()=>a.open('other',a.seal('health',{value:1})));
});
test('empty ledger can receive a packaged SKU, reuse label and deduct locally',()=>{
  const start=newState();
  const stocked=confirmItems(start,[{...part,action:'add',amount:5}],date,'午餐');
  const sku=inventoryWithMoves(stocked)[0];
  const c={...part,sku:sku.id,nutrients:{...nutrition,kcal:999},packageSize:999};
  assert.deepEqual(resolveItem(stocked,c).nutrition,nutrition);
  const eaten=confirmItems(stocked,[c],date,'午餐');
  assert.equal(inventoryWithMoves(eaten)[0].qty,3);
  assert.equal(dayIntake(eaten,date).totals.kcal,100);
  assert.equal(inventoryWithMoves(stocked)[0].qty,5);
  assert.throws(()=>confirmItems(stocked,[c,{...c,amount:20}],date,'午餐'));
  assert.equal(stocked.local.foods.length,0);
  const plan=confirmItems(eaten,[{...c,action:'plan'}],date,'晚餐');
  assert.equal(inventoryWithMoves(plan)[0].qty,3);
  assert.equal(dayIntake(plan,date).totals.kcal,100);
});
test('explicit gram and mL units require a defensible conversion',()=>{
  const state=newState();
  state.legacy.inventory.push({id:'milk',name:'牛奶',active:true,standard:'每100mL',unit:'mL',nutritionBasis:'per100ml',qty:1000,nutrition});
  assert.throws(()=>confirmItems(state,[{...part,sku:'milk',amount:533,unit:'g'}],date,'早餐'));
  assert.equal(confirmItems(state,[{...part,sku:'milk',amount:533,unit:'mL'}],date,'早餐').local.foods[0].nutrition.kcal,533);
});
test('a documented count converts individual servings while retaining the stored box ledger',()=>{
 const state=normalizeLedger({tables:{food_events:[],weight_events:[],food_inventory:[
  {'食品ID':'fixture-pieces','名称':'合成食品','库存值':2,'库存单位':'盒','标准份量':'200g/盒；10个/盒；按100g标签',kcal:100}
 ]}});
 const sku=inventoryWithMoves(state)[0];
 assert.deepEqual(stockMeasure(sku),{unit:'个',factor:10});
 const change={...part,sku:sku.id,name:sku.name,amount:6,unit:'个'};
 const eaten=confirmItems(state,[change],date,'午餐');
 assert.equal(eaten.local.foods[0].portion,'6 个');
 assert.equal(eaten.local.foods[0].nutrition.kcal,120);
 const remaining=inventoryWithMoves(eaten)[0];
 assert.equal(remaining.qty,1.4);
 assert.equal(displayStockQuantity(remaining,remaining.qty),14);
 assert.deepEqual(stockMeasure({...sku,unitDescription:'11个/盒'}),{unit:'盒',factor:1});
});
test('expense habit analysis returns only approved date buckets and spending summaries',async()=>{
 const data=freshData();
 data.transactions=[
  {id:'private-id',note:'private memo',type:'expense',amount:8.15,date,categoryId:'default-5'},
  {type:'expense',amount:10,date:'2030-01-03',categoryId:'default-5'},
  {type:'expense',amount:18.75,date:'2030-01-03',categoryId:'default-1'},
  {type:'income',amount:50,date:'2030-01-03'},
  {type:'expense',amount:1,date:'2029-12-31',categoryId:'default-5'}
 ];
 const workspace={finance:{getItem:key=>key===STORAGE_KEY?JSON.stringify(data):null}};
 const call={type:'function_call',name:'read_expense_summary',call_id:'fixture-summary',
  arguments:'{"start":"2030-01-01","end":"2030-01-03","groupBy":"category"}'};
 const {args}=pendingLedgerRead({status:'completed',output:[call]});
 assert.deepEqual(await readLedger(workspace,args,'2030-01-04'),{
  start:date,end:'2030-01-03',groupBy:'category',expense:36.90,count:3,
  rows:[{label:'餐饮',expense:18.75,count:1},{label:'日用',expense:18.15,count:2}]
 });
 await assert.rejects(readLedger(workspace,args,'2030-01-02'));
});
test('one-day food lookup sends every matching record and its full selected fields',async()=>{
 const state=newState(),previous=addDays(date,-1);
 for(let i=0;i<12;i++)addFood(state,{date,meal:'早餐',name:'牛奶 '+i,time:'08:10',portion:'250 g',kcal:155});
 const last=state.local.foods.at(-1);
 last.name+='（'+'原名称'.repeat(30)+'）';
 last.portion+=' · '+'原份量描述'.repeat(10);
 last.time='上午 8:10:15';
 addFood(state,{date:previous,name:'无关日期',portion:'250 g'});
 addFood(state,{date,name:'计划餐',portion:'100 g',status:'plan'});
 const summary=await readLedger({readHealth:async()=>state},{scope:'foods',date,query:''},date);
 assert.deepEqual(summary.foods[0],{name:'牛奶 0',portion:'250 g',meal:'早餐',time:'08:10'});
 assert.equal(summary.foods.length,12);
 assert.deepEqual(summary.foods.at(-1),{name:last.name,portion:last.portion,meal:last.meal,time:last.time});
 assert.ok(!JSON.stringify(summary).includes('无关日期'));
 assert.ok(!JSON.stringify(summary).includes('计划餐'));
 assert.equal(summarizeFoodHistory(state,date,'牛奶 11').foods.length,1);
 const call={type:'function_call',name:'read_food_history',call_id:'fixture',arguments:JSON.stringify({date,query:'牛奶'})};
 const parsed=pendingLedgerRead({status:'completed',output:[call]});
 assert.deepEqual(parsed.args,{scope:'foods',date,query:'牛奶'});
 const input={mode:'chat',text:'查饮食',date,photo:null,history:[]};
 const request=modelRequest(input,{allowRead:true,continuation:[{item:parsed.item,summary}]});
 assert.deepEqual(JSON.parse(request.input.at(-1).output),summary);
 assert.ok(!Object.hasOwn(request,'max_output_tokens'));
 await assert.rejects(readLedger({readHealth:async()=>state},{...parsed.args,date:addDays(date,1)},date));
});
test('a second ledger read keeps both approved results in call order',()=>{
 const input={mode:'chat',text:'查库存和支出',date,photo:null,history:[]};
 const steps=[
  {item:{type:'function_call',name:'read_ledger',call_id:'stock',arguments:'{"scope":"stock","query":"牛奶"}'},
   summary:{stock:[{name:'牛奶',qty:750,unit:'g'}]}},
  {item:{type:'function_call',name:'read_ledger',call_id:'expenses',arguments:'{"scope":"expenses","query":""}'},
   summary:{date,expense:12,income:0,count:1}}
 ];
 const request=modelRequest(input,{allowRead:true,continuation:steps});
 assert.equal(request.tool_choice,'auto');
 assert.equal(request.parallel_tool_calls,false);
 assert.deepEqual(request.input.slice(1),steps.flatMap(({item,summary})=>
  [item,{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(summary)}]));
});
test('batch candidates share the individual schemas and validate each entry',()=>{
 const input={mode:'chat',text:'补记午餐和盘点',date,photo:null,history:[]};
 const finance={mode:'finance',date:null,result:{note:'',entry:{type:'expense',amount:28,date,note:'午餐',categoryId:'餐饮'}}};
 const inventory={mode:'inventory',date:null,result:{operation:'count',name:'牛奶',quantity:450,unit:'g'}};
 const operations=[finance,inventory];
 const response=value=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
 const batch={reply:'请核对。',proposal:{mode:'batch',date:null,result:{operations,next:'continue'}}};
 assert.deepEqual(parseResult(response(batch),input),batch);
 assert.deepEqual(JSON.parse(modelRequest(input,{allowRead:true,applied:['finance','inventory']}).input[0].content[0].text),
  {text:input.text,date,history:[],applied:['finance','inventory']});
 batch.proposal.result.operations=[];
 assert.throws(()=>parseResult(response(batch),input));
 batch.proposal.result.operations=operations;
 finance.result.entry.date='2030-01-02';
 assert.throws(()=>parseResult(response(batch),input));
});
test('stream decodes split UTF-8 and JSON escapes and reveals only reply text before completion',async()=>{
 const encoder=new TextEncoder(),preview=[];
 let stream;
 const response={body:new ReadableStream({start(controller){stream=controller;}})};
 const frame=event=>{
  const bytes=encoder.encode('data: '+JSON.stringify(event)+'\r\n\r\n');
  for(let i=0;i<bytes.length;i+=2)stream.enqueue(bytes.slice(i,i+2));
 };
 let showFirst;
 const first=new Promise(resolve=>{showFirst=resolve;});
 const completed=readResponseStream(response,{onReply:text=>{preview.push(text);showFirst(text);}});
 const delta=delta=>frame({type:'response.output_text.delta',output_index:0,content_index:0,delta});
 delta('{"re');
 delta('ply":"先显示\\uD83');
 assert.equal(await first,'先显示');
 delta('D\\uDE00\\n\\"好了\\"","proposal":{"note":"候选内容"}}');
 const final={status:'completed',output:[]};
 frame({type:'response.completed',response:final});
 stream.close();
 assert.deepEqual(await completed,final);
 assert.deepEqual(preview,['先显示','先显示😀\n"好了"']);
});
test('a stream without a terminal response rejects even after emitting partial reply text',async()=>{
 const preview=[];
 const response=new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'{"reply":"半条回复'})+'\n\n');
 await assert.rejects(readResponseStream(response,{onReply:text=>preview.push(text)}),ResponseStreamError);
 assert.deepEqual(preview,['半条回复']);
});
test('inventory lookup preserves all matches and full names',async()=>{
 const state=newState(),description='原标签'.repeat(20);
 for(let n=0;n<7;n++){
  const sku=saveSku(state,{name:'牛奶 '+n+description,unit:'g',basisUnit:'g',basisAmount:100});
  sku.qty=n+1;
 }
 const {stock}=await readLedger({readHealth:async()=>state},{scope:'stock',query:'牛奶'},date);
 assert.equal(stock.length,7);
 assert.deepEqual(stock.at(-1),{name:'牛奶 6'+description,qty:7,unit:'g'});
});
test('food and purchase response schemas preserve all recognized items',()=>{
 const items=Array.from({length:11},(_,i)=>({...part,name:'样品 '+i,weighing:null}));
 const input={mode:'chat',text:'识别清单',date,photo:null,history:[]};
 const schema=modelRequest(input).text.format.schema;
 assert.ok(matches(schema,{reply:'已识别，等待核对',proposal:{mode:'entry',date,result:{note:'',items:items.map(item=>({...item,stockSource:'one_off'}))}}}));
 assert.ok(matches(schema,{reply:'已识别，等待核对',proposal:{mode:'purchase',date,result:{note:'',total:null,
  items:items.map(row=>({...row,action:'add',itemCost:null}))}}}));
});
test('food correction preserves the original entry and replaces its inventory allocation',()=>{
 const state=newState();
 const sku=saveSku(state,{name:'牛奶',unit:'g',basisUnit:'g',basisAmount:100,kcal:62});
 const lot=addBatch(state,{foodId:sku.id,date,quantity:750,costCents:750});
 const row=addFood(state,{date,time:'08:15',meal:'早餐',name:'牛奶',portion:'250 g',
  foodId:sku.id,batchId:lot.id,stockQty:250,kcal:155,protein:8.25});
 const draft=reviseFoodPortion(state,{id:row.id,date,amount:300,unit:'g'});
 assert.equal(state.local.foods[0].portion,'250 g');
 assert.deepEqual(draft.stock,{name:'牛奶',unit:'g',before:500,after:450});
 assert.equal(draft.next.local.foods.length,1);
 assert.equal(draft.after.id,row.id);assert.equal(draft.after.time,'08:15');
 assert.equal(draft.after.nutrition.protein,9.9);
 assert.equal(draft.after.nutrition.sodium,null);
 assert.equal(dayIntake(draft.next,date).totals.kcal,186);
 assert.equal(batchBalances(draft.next)[0].remaining,450);
 assert.deepEqual(draft.next.local.stockMoves.filter(m=>m.linkedFoodId===row.id).map(m=>m.delta),[-300]);
 assert.throws(()=>reviseFoodPortion(draft.next,{id:row.id,date,amount:300,unit:'g'}),/没有变化/);
 assert.throws(()=>reviseFoodPortion(draft.next,{id:row.id,date,amount:1000,unit:'g'}),/库存不足/);
 assert.throws(()=>reviseFoodPortion(state,{id:row.id,date,amount:300,unit:'mL'}),/原记录的单位/);
});
test('an imported intake embedded in stock is corrected without a second deduction',()=>{
 const state=normalizeLedger({tables:{food_events:[{日期:date,'食物/饮品':'牛奶',食品ID:'milk','份量/重量':'250 g',状态:'已喝',kcal:155}],
  food_inventory:[{食品ID:'milk',名称:'牛奶',库存值:500,库存单位:'g'}],
  daily_summaries:[{日期:date,kcal:355}],weight_events:[]}});
 const {next,stock}=reviseFoodPortion(state,{id:state.legacy.foods[0].id,date,amount:300,unit:'g'});
 assert.equal(dayIntake(next,date).totals.kcal,386);
 assert.equal(inventoryWithMoves(next)[0].qty,500);
 assert.equal(stock,null);
 assert.equal(next.local.stockMoves.length,0);
});
test('requests never serialize the health snapshot, financial data or historical identifiers',()=>{
  const state=newState();state.legacy.sourceSnapshot={privateField:'local-only'};
  const data=assistantInput({mode:'entry',text:'测试',state});
  assert.ok(validInput(data));assert.equal(data.summary,null);
  assert.ok(!JSON.stringify(data).includes('local-only'));
  const finance=assistantInput({mode:'finance',text:'测试',date});
  finance.categories=[{id:'fixture-id',name:'本地私有分类',type:'expense'}];
  assert.deepEqual(JSON.parse(modelRequest(finance).input[0].content[0].text),{mode:'finance',text:'测试',date});
  const plan=assistantInput({mode:'plan',text:'测试'});
  plan.catalog=[{id:'fixture-id',name:'本地私有食品',unit:'g',standard:'100g',basis:'per100g',qty:100,price:5,priceBasis:'g',nutrients:null}];
  assert.deepEqual(JSON.parse(modelRequest(plan).input[0].content[0].text),{mode:'plan',text:'测试'});
  assert.ok(validInput(assistantInput({mode:'plan',text:'只用我输入的食材'})));
  assert.ok(!validInput({...data,ledger:state}));assert.ok(!validInput({...data,photo:'https://example.invalid'}));
  assert.ok(!matches(resultSchema,{items:[{...part,amount:-1}],note:''}));
});
test('six-day boundary, next-day closing and missing days, with imported energy-only baseline',()=>{
  const state=newState(); state.settings.cycleAnchor=date;state.settings.cycleDays=6;
  assert.equal(cycleForDate(state,'2030-01-07','2030-01-07').start,'2030-01-07');
  state.legacy.energy[date]={intake:800,tdee:null};
  const next=confirmItems(state,[part],date,'晚餐');
  assert.equal(energyForDay(next,date,date).closed,false);
  assert.equal(energyForDay(next,date,'2030-01-03').intake,900);
  assert.equal(energyForDay(next,date,'2030-01-03').tdee,2200);
  assert.equal(cycleForDate(next,date,'2030-01-03').unreported,1);
  assert.ok(!validDate('2030-02-30')); assert.ok(!validateAppState({...state,local:{foods:[]}}));
});

test('assistant deletes a plan independently and restores only stock linked to the deleted intake',()=>{
 const state=newState(),sku=saveSku(state,{name:'测试食品',unit:'g',basisUnit:'g',basisAmount:100,kcal:100});
 addBatch(state,{foodId:sku.id,date,quantity:500,costCents:1000});
 const actual=addFood(state,{name:sku.name,date,foodId:sku.id,stockQty:120,kcal:120});
 const plan=addFood(state,{name:sku.name,date,status:'plan',foodId:sku.id,stockQty:130,kcal:130});
 const withoutPlan=healthDeletion(state,'foods',[plan.id]);
 assert.equal(dayIntake(withoutPlan,date).totals.kcal,120);
 assert.equal(inventoryWithMoves(withoutPlan)[0].qty,380);
 const cleared=healthDeletion(withoutPlan,'foods',[actual.id]);
 assert.equal(dayIntake(cleared,date).totals.kcal,null);
 assert.equal(inventoryWithMoves(cleared)[0].qty,500);
 assert.equal(cleared.local.foods.length,0);
 assert.equal(state.local.foods.length,2);
 assert.throws(()=>healthDeletion(cleared,'foods',[actual.id]),/原记录已变更/);
 const input={mode:'chat',text:'删除那条计划',date,history:[],photo:null};
 const result={reply:'请核对。',proposal:{mode:'delete_record',date,result:{kind:'plan',query:'测试食品',meal:null}}};
 const response={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]};
 assert.deepEqual(parseResult(response,input),result);
});

test('old messages become a rolling summary and recent messages are retained in full',()=>{
 const long=Array.from({length:50},(_,i)=>({role:'user',carry:true,text:i+'营'.repeat(400)+'尾'}));
 const thread={messages:long};
 const plan=contextFor(thread);
 assert.ok(plan.history.length>20);
 assert.deepEqual(plan.history.at(-1),{role:'user',text:long.at(-1).text});
 assert.ok(plan.compact.history.length>0);
 assert.equal(plan.compact.history[0].text,long[0].text);
 assert.deepEqual(contextFor(thread,HISTORY_OPTIONS[0]).history,[]);
 assert.equal(contextFor(thread,HISTORY_OPTIONS[2]).history.length,50);
 const memo='保留的目标和待完成事项';
 const next=contextFor({...thread,context:{summary:memo,through:plan.compact.through}});
 assert.equal(next.summary,memo);
 assert.equal(next.compact,null);
 assert.equal(next.history[0].text,long[plan.compact.through].text);
 assert.equal(thread.messages.length,50);
 const input={mode:'chat',text:'整理这段对话',date,photo:null,history:plan.compact.history};
 const req=modelRequest(input,{compacting:true,contextSummary:memo});
 assert.equal(req.text.format.name,'airplane_context_summary');
 assert.equal(req.tools,undefined);
 assert.deepEqual(JSON.parse(req.input[0].content[0].text),{summary:memo,older:plan.compact.history});
 assert.equal(JSON.parse(modelRequest(input,{contextSummary:memo}).input[0].content[0].text).contextSummary,memo);
});

test('app data changes preview against the specific dataset and preserve unrelated fields',async()=>{
 const original=newState();
 let state=original;
 const workspace={
  readHealth:async()=>state,
  saveHealth:async(next,revision)=>{
   assert.equal(revision,state.revision??0);
   state={...next,revision:revision+1};
  }
 };
 const appData=(dataset,id,action,changes)=>({dataset,id,action,changes:JSON.stringify(changes)});
 const settings=await readAppData(workspace,null,{dataset:'health_settings',id:null,date:null,query:''});
 assert.equal(settings.rows[0].baselineTdee,original.settings.baselineTdee);
 const candidate=await dataEdit(workspace,null,appData('health_settings',null,'update',{cycleDays:6}),date);
 assert.equal(candidate.previous.cycleDays,7);
 assert.equal(candidate.updated.cycleDays,6);
 assert.equal(state.settings.cycleDays,7);
 await candidate.commit();
 assert.equal(state.settings.cycleDays,6);
 assert.equal(state.settings.calorieTarget,original.settings.calorieTarget);
 await assert.rejects(dataEdit(workspace,null,appData('health_settings',null,'update',{cycleDays:5.5}),date),/cycleDays/);
 await assert.rejects(dataEdit(workspace,null,{...appData('health_settings',null,'update',{}),changes:'{"__proto__":{"deleted":true}}'},date),/__proto__/);
 const add=await dataEdit(workspace,null,appData('weights',null,'add',{kg:72.2,date,isMorning:true}),date);
 await add.commit();
 const event=state.local.weights[0];
 const update=await dataEdit(workspace,null,appData('weights',event.id,'update',{kg:71.5}),date);
 await update.commit();
 assert.equal(state.local.weights.length,1);
 assert.equal(state.local.weights[0].id,event.id);
 assert.equal(state.local.weights[0].kg,71.5);
 const del=await dataEdit(workspace,null,appData('weights',event.id,'delete',{}),date);
 await del.commit();
 assert.equal(state.local.weights.length,0);
 const plan=await dataEdit(workspace,null,appData('foods',null,'add',{
  date:addDays(date,1),name:'明天的计划',status:'plan',meal:'晚餐',nutrition:{kcal:200}
 }),date);
 await plan.commit();
 const edit=await dataEdit(workspace,null,appData('foods',plan.updated.id,'update',{name:'改过的计划'}),date);
 await edit.commit();
 assert.equal(state.local.foods[0].status,'plan');
 assert.equal(dayIntake(state,addDays(date,1)).totals.kcal,null);
 const guide=await readAppData(workspace,null,{dataset:'guide',id:null,date:null,query:'foods'});
 assert.deepEqual(guide.options.foodStatus,['actual','plan','cancelled']);

});

test('local USD estimates count regular, cached and written tokens once at model rates',()=>{
 const usage={input_tokens:1000,output_tokens:100,
  input_tokens_details:{cached_tokens:100,cache_write_tokens:200,cache_write_tokens_details:{ttl_12h_tokens:50}}};
 assert.equal(estimatedCost('gpt-6-luna',usage),152250000);
 assert.equal(estimatedCost('gpt-6.1-terra',usage),1517500000);
 assert.equal(estimatedCost('gpt-6.2-sol',{input_tokens:300000,output_tokens:10000}),1350000000000);
 assert.equal(estimatedCost('gpt-6-luna',{input_tokens:5,output_tokens:1,input_tokens_details:{cached_tokens:10}}),null);
 assert.equal(displayUsage(null),'');
 assert.equal(displayUsage(152250000),'本机已用约 US$0.000152');
});

test('balance and budget tools share the finance page calculations and return scoped summaries',async()=>{
 const ledger=freshData(),today='2030-01-10';
 ledger.prefs.initialBalance=125.45;
 ledger.balanceAdjustments=[{delta:20.55}];
 ledger.budgets['2030-01']=200;
 ledger.transactions=[
  {id:'added-income',type:'income',date:today,amount:30,budgetSync:true,note:'synthetic income memo'},
  {id:'day-expense',type:'expense',date:today,amount:3,note:'synthetic private memo'},
  {id:'outside-budget',type:'expense',date:today,amount:4,budgetExcluded:true},
  {id:'future-expense',type:'expense',date:'2030-02-01',amount:99}
 ];
 const workspace={finance:{getItem:key=>key===STORAGE_KEY?JSON.stringify(ledger):null}};
 assert.equal(currentBalanceFor(ledger,today),169);
 assert.deepEqual(await readLedger(workspace,{scope:'balance',query:''},today),{balance:169,currency:'CNY'});
 const metrics=monthlyMetrics(ledger,'2030-01',today);
 assert.equal(metrics.dailyLimit,200/22+30);
 const budget=await readLedger(workspace,{scope:'budget',query:'2030-01'},today);
 assert.equal(budget.budget,230);
 assert.equal(budget.remainingBudget,227);
 assert.equal(budget.dailyLimit,39.09);
 assert.equal(budget.excludedExpense,4);
 assert.equal(budget.todayExpense,3);
 assert.ok(!JSON.stringify(budget).includes('synthetic'));
 const selection=await readAppData(workspace,null,{
  dataset:'transactions',id:null,date:'2030-01',query:'',fields:['amount','type']
 });
 assert.deepEqual(selection.rows,[{id:'added-income',type:'income',amount:30},
  {id:'day-expense',type:'expense',amount:3},{id:'outside-budget',type:'expense',amount:4}]);
});

test('nutrition queries omit inventory and matching saved chat queries omit other conversations',async()=>{
 const state=newState();
 addFood(state,{name:'合成餐食',date,kcal:100,protein:15,cost:2});
 const workspace={readHealth:async()=>state};
 const summary=await readLedger(workspace,{scope:'nutrition',query:date},addDays(date,1));
 assert.equal(summary.kcal,100);
 assert.equal(summary.protein,15);
 assert.equal(summary.deficit,2100);
 assert.equal(summary.cost,2);
 assert.equal(summary.closed,true);
 assert.ok(!Object.hasOwn(summary,'stock'));
 const book={list:()=>[{id:'first',title:'测试',messages:[{role:'assistant',text:'合成体重趋势',carry:true},
  {role:'assistant',text:'另一个主题'}]},{id:'second',title:'无关',messages:[{role:'user',text:'合成体重秘密'}]}]};
 const chat=await readAppData(workspace,book,{dataset:'conversation_messages',id:'first',date:null,query:'体重',fields:['text']});
 assert.deepEqual(chat.rows,[{text:'合成体重趋势'}]);
});

test('leaving a thread preserves its partial reply and only the matching ticket can finish it',()=>{
 const values=new Map(),store={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const first=threadBook(store),ticket=first.begin('测试消息',{text:'测试消息',hasPhoto:false});
 first.checkpoint(ticket,'已收到的部分');
 const reopened=threadBook(store);
 assert.equal(reopened.current.pending.partial,'已收到的部分');
 const retry=reopened.begin('测试消息',{text:'测试消息',hasPhoto:false},true);
 assert.equal(reopened.current.messages.length,1);
 assert.equal(first.finish(ticket,'旧响应',null,null),false);
 assert.equal(reopened.finish(retry,'完成',null,{proposal:{mode:'plan'}}),true);
 assert.equal(threadBook(store).current.review.proposal.mode,'plan');
 assert.deepEqual(threadBook(store).current.messages.map(row=>row.text),['测试消息','完成']);
});

test('skill folders migrate old rules and AI can move rules into a new folder',async()=>{
 const values=new Map([['airplane-ai-skill-v1','旧偏好']]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const skills=skillLibrary(storage),personal=skills.list().find(row=>!row.preset);
 assert.equal(personal.folderId,'personal');
 const request={dataset:'skill_folders',action:'add',id:null,changes:JSON.stringify({name:'我的训练',skillIds:[personal.id]})};
 await (await dataEdit({skills},null,request,date)).commit();
 const folder=skills.folders().find(row=>row.name==='我的训练');
 assert.equal(skills.list().find(row=>row.id===personal.id).folderId,folder.id);
 const add={dataset:'skills',action:'add',id:null,changes:JSON.stringify({name:'训练安排',text:'优先查询近期记录',folderId:folder.id})};
 await (await dataEdit({skills},null,add,date)).commit();
 assert.equal(skills.list().filter(row=>row.folderId===folder.id).length,2);
});

test('a changed default only prompts a merge for a customized preset and the baseline advances on confirmation',()=>{
 const initial={overrides:{'l-stock':{text:'保留自己的盘点规则',baseText:'先前的默认版本'}},personal:[]};
 const values=new Map([['airplane-ai-skills-v2',JSON.stringify(initial)]]);
 const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const skills=skillLibrary(storage);
 const info=skills.mergeInfo('l-stock');
 assert.equal(info.previous,'先前的默认版本');
 assert.equal(info.personal,'保留自己的盘点规则');
 assert.ok(info.current.includes('同款标签'));
 assert.equal(skills.mergeInfo('l-progress'),null);
 const request=modelRequest({mode:'chat',text:'融合 Skill',date,history:[],photo:null},{skillMerge:info,allowRead:true});
 assert.equal(request.tools,undefined);
 assert.deepEqual(Object.keys(JSON.parse(request.input[0].content[0].text).skillMerge),['name','previous','current','personal']);
 skills.resolveDefault(info,'沿用自己的盘点规则，也核对同款标签');
 assert.equal(skills.mergeInfo('l-stock'),null);
 assert.equal(skills.list().find(row=>row.id==='l-stock').text,'沿用自己的盘点规则，也核对同款标签');
});
