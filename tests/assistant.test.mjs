import {modelRequest,parseResult,pendingLedgerRead} from '../ai/responses.mjs';
import {readResponseStream,ResponseStreamError} from '../ai/stream.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addDays,addFood,batchBalances,newState,normalizeLedger,validDate,validateAppState,inventoryWithMoves,dayIntake,energyForDay,cycleForDate} from '../health/core.mjs';
import {addBatch,saveSku} from '../health/inventory.mjs';
import {summarizeFoodHistory,reviseFoodPortion} from '../health/food-history.mjs';
import {readLedger} from '../ai/workspace.mjs';
import {confirmItems,resolveItem} from '../health/candidates.mjs';
import {matches,resultSchema,validInput,assistantInput} from '../health/contract.mjs';
import {accountKeys,privateAccount} from '../account.mjs';
import nacl from '../vendor/nacl-fast.min.js';
import {randomBytes} from 'node:crypto';
import {STORAGE_KEY,freshData} from '../finance-storage.mjs';
import {displayStockQuantity,stockMeasure} from '../health/inventory.mjs';

const nutrition={kcal:100,protein:10,carbs:8,fat:3,sodium:20};
const part={name:'样品',sku:null,amount:2,unit:'包',action:'eat',basisAmount:100,basisUnit:'g',
  packageSize:50,packageUnit:'g',nutrients:nutrition,uncertainty:'合成标签'};
const date='2030-01-01';
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
