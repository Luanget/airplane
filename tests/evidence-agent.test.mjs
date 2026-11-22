import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAgentRun,runAgent} from '../ai/agent-loop.mjs';
import {createAgentTools} from '../ai/agent-tools.mjs';
import {identifyAttachments} from '../ai/conversation-evidence.mjs';
import {setHealthAuto} from '../ai/health-actions.mjs';
import {setFinanceAutomation} from '../ai/finance.mjs';
import {memoryLibrary} from '../ai/memory.mjs';
import {threadBook} from '../ai/threads.mjs';
import {dayIntake,inventoryWithMoves,validateAppState} from '../health/core.mjs';
import {packagesFor} from '../health/containers.mjs';
import {saveSku} from '../health/inventory.mjs';
import {readFinance,replaceFinance,STORAGE_KEY} from '../finance-storage.mjs';
import {action,assistantFixture,proposal} from './health-action-fixture.mjs';
import {orderFinance,orderReceipt} from './order-agent-fixture.mjs';

const date='2035-04-22';
const message=id=>({id,kind:'message',note:null});
const turn=(id,text,sources=[])=>createAgentRun({id,model:'gpt-6.1-terra',date,clock:'12:05',text,sources});
function mock(initial=assistantFixture(date)){
 const values=new Map([[STORAGE_KEY,JSON.stringify(orderFinance(date))]]);
 const finance={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 let state=initial;
 const workspace={finance,account:{finance},memory:memoryLibrary(finance),get state(){return state;},
  readHealth:async()=>structuredClone(state),saveHealth:async(next,revision,guard)=>{
   guard?.();assert.equal(revision,state.revision??0);assert.ok(validateAppState(next));state={...structuredClone(next),revision:revision+1};
  },resumeReceipt:async()=>{},updateReceipt:async(_account,next,rev,stamp,{pairs},guard)=>{
   guard?.();const old=readFinance(finance);assert.equal(old.primary,stamp);
   const ids=new Set(pairs.map(row=>row.id));
   old.payload.transactions=old.payload.transactions.filter(row=>!ids.has(row.id)).concat(pairs.flatMap(row=>row.after?[row.after]:[]));
   replaceFinance(finance,old.payload,stamp);await workspace.saveHealth(next,rev);
  }};
 setHealthAuto(finance,true);setFinanceAutomation(finance,true,100000);
 return workspace;
}
const call=(tool,name,args,run,operationId=run.id)=>tool(name,args,{run,operationId});
const quantity=(w,id)=>inventoryWithMoves(w.state).find(row=>row.id===id)?.qty;
const line=(name,extras)=>({name,skuId:null,amount:null,unit:null,packAmount:null,packUnit:null,cost:null,portions:[],label:null,...extras});

test('cross-turn actual amounts convert liters and SKU package counts; one bad step does not suppress correct writes',async()=>{
 const w=mock(),tool=createAgentTools(w);
 Object.assign(w.state.local.inventory.find(row=>row.id==='fixture-noodles'),{packageSize:60,packageUnit:'g',pack:'包'});
 const run=turn('confirm','这些都是真实吃的，直接记录午饭。',[{id:'report',date,text:'午餐吃了一包荞麦面、喝了1L脱脂奶。'}]);
 const steps=proposal(action('eat','一包荞麦面',{name:'荞麦面',amount:60,unit:'g',meal:'午餐',source:'inventory',whole:'no'}),
  action('eat','1L脱脂奶',{name:'脱脂奶',amount:1000,unit:'mL',meal:'午餐',source:'inventory',whole:'no'}),
  action('eat','不确切的菜',{name:'豆腐',amount:999,unit:'g',meal:'午餐',whole:'no'}));
 const result=await call(tool,'write_health',{...steps,provenance:steps.steps.map((_,index)=>({index,refs:[message('report')]}))},run);
 assert.deepEqual(result.substeps.map(row=>row.status),['saved','saved','blocked']);
 assert.match(result.substeps[2].reason,/999 g/);
 assert.equal(quantity(w,'fixture-noodles'),5);assert.equal(quantity(w,'fixture-milk'),1000);
 assert.equal(dayIntake(w.state,date).totals.kcal,570);
 assert.equal(w.state.local.foods.filter(row=>row.date===date).length,2);
 const retry=await call(tool,'write_health',{...proposal({...steps.steps[0],amount:1,unit:'包'}),provenance:[{index:0,refs:[message('report')]}]},run,'same-cited-message');
 assert.equal(retry.receipt.operationId,result.substeps[0].receipt.operationId);
 assert.equal(quantity(w,'fixture-noodles'),5);
});

test('an archived photo is sent only when selected and missing IDs are explicitly reported',async()=>{
 const w=mock(),book=threadBook(w.finance),media='media:label',payload={key:'fixture',input:{type:'input_image',image_url:'data:image/png;base64,AA=='}},
  {group,files}=identifyAttachments([payload],media);
 book.append('user','这张是全脂奶标签',true,null,{id:'label',taskId:'label-task',attachmentGroup:group});
 const journal={readRun:async id=>id===media?{attachments:files}:null};
 const tool=createAgentTools(w,{book,journal});
 const run=turn('later','请使用之前标签。');run.threadId=book.current.id;
 const catalog=await call(tool,'read_conversation_evidence',{attachmentIds:[],limit:10},run);
 assert.equal(catalog.data.attachments[0].state,'local');assert.equal(run.attachments.length,0);
 let requests=0;
 await runAgent(run,{dispatch:tool,save:()=>{},request(value){
  if(++requests===1)return {status:'completed',output:[{type:'function_call',call_id:'files',name:'read_conversation_evidence',
   arguments:JSON.stringify({attachmentIds:[files[0].id,'media:missing:1'],limit:8})}]};
  assert.equal(JSON.parse(value.input.find(row=>row.call_id==='files'&&row.type==='function_call_output').output)
   .data.attachments.find(row=>row.id==='media:missing:1').state,'unavailable');
  assert.equal(value.input.at(-1).content.at(-1).image_url,payload.input.image_url);
  return {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'标签已找到。'}]}]};
 }});
});

test('stock-only receiving supports zero-stock SKU, measured portions and unknown amounts, with verified idempotency and undo',async()=>{
 const w=mock(),tool=createAgentTools(w);
 saveSku(w.state,{id:'celery-empty',name:'合成芹菜',unit:'g',basisUnit:'g',basisAmount:100});
 const run=turn('stock','合成芹菜新买三份，每份500g，入库。');
 const args={date,lines:[line('合成芹菜',{skuId:'celery-empty',amount:3,unit:'份',portions:Array.from({length:3},()=>
  ({amount:500,unit:'g',status:'sealed',gross:null}))})],note:null,sources:[message('stock')]};
 const priorFinance=w.finance.getItem(STORAGE_KEY);
 const saved=await call(tool,'receive_inventory',args,run);
 assert.equal(saved.status,'saved');
 assert.equal(saved.receipt.totalCents,null);assert.equal(quantity(w,'celery-empty'),1500);
 assert.deepEqual(packagesFor(w.state,'celery-empty').filter(row=>row.status==='sealed').map(row=>row.net),[500,500,500]);
 assert.equal((await call(tool,'receive_inventory',args,run,'retry-new-call')).status,'ok');
 assert.equal(w.finance.getItem(STORAGE_KEY),priorFinance);assert.equal(dayIntake(w.state,date).reported,false);
 const more=turn('stock-more','同批还有1L合成脱脂牛奶。',[{id:'stock',date,text:run.messages[0]}]);
 const merged=await call(tool,'receive_inventory',{...args,sources:[message('stock'),message('stock-more')],
  lines:[...args.lines,line('合成脱脂牛奶',{skuId:'fixture-milk',amount:1000,unit:'mL'})]},more);
 assert.equal(merged.status,'saved');assert.deepEqual(merged.receipt.reusedPurchaseIds,[saved.receipt.purchaseId]);
 assert.equal(quantity(w,'celery-empty'),1500);assert.equal(quantity(w,'fixture-milk'),3000);
 await tool.undo(saved.undo);assert.equal(quantity(w,'celery-empty'),0);
 assert.equal(w.state.local.purchases.find(row=>row.id===saved.receipt.purchaseId).status,'cancelled');
});

test('an order attaches to existing stock and its undo keeps the received lots',async()=>{
 const w=mock(),tool=createAgentTools(w);
 const inbound=turn('milk-in','新买两盒合成脱脂牛奶，每盒500mL，先入库。');
 const result=await call(tool,'receive_inventory',{date,lines:[line('合成脱脂牛奶',{skuId:'fixture-milk',amount:2,unit:'盒',
  packAmount:500,packUnit:'mL'})],note:null,sources:[message('milk-in')]},inbound);
 const beforeQuantity=quantity(w,'fixture-milk');
 assert.equal(result.status,'saved');
 const pay=turn('paid','这是刚才那笔入库的付款凭据。');pay.attachments=[{id:'receipt-image',key:'unique-payment'}];
 const receipt=orderReceipt(date);
 const conflict=await call(tool,'write_receipt',{...receipt,inventoryLink:null},pay);
 assert.match(conflict.reason,/已有相关入库/);
 const saved=await call(tool,'write_receipt',{...receipt,inventoryLink:result.receipt.purchaseId},pay);
 assert.equal(saved.status,'saved',saved.reason);assert.equal(quantity(w,'fixture-milk'),beforeQuantity);
 assert.equal(readFinance(w.finance).payload.transactions.filter(row=>row.receiptKey).length,3);
 await tool.undo(saved.undo);
 assert.equal(quantity(w,'fixture-milk'),beforeQuantity);assert.equal(w.state.local.purchases[0].totalCents,null);
 assert.equal(readFinance(w.finance).payload.transactions.filter(row=>row.receiptKey).length,0);
});

test('a natural correction can use the verified prior food record ID without touching other meals',async()=>{
 const w=mock(),book=threadBook(w.finance),tool=createAgentTools(w,{book});
 book.append('user','午餐吃了合成小青菜100g。',true,null,{id:'first'});
 const first=turn('first','午餐吃了合成小青菜100g。');first.threadId=book.current.id;
 const saved=await call(tool,'write_health',proposal(action('eat',first.messages[0],
  {name:'小青菜',amount:100,unit:'g',meal:'午餐',whole:'no'})),first);
 assert.equal(saved.status,'saved');
 book.append('assistant','已记录小青菜。',true,null,{taskId:first.id,agentUndo:[saved.undo]});
 const unrelated=turn('other','记录晨重72.1kg。');unrelated.threadId=first.threadId;
 assert.equal((await call(tool,'write_health',proposal(action('weight',unrelated.messages[0],{kg:72.1,morning:'yes'})),unrelated)).status,'saved');
 const fix=turn('fix','改一下刚才那份小青菜，其实没吃，是新买的100g。');fix.threadId=first.threadId;
 const corrected=await call(tool,'undo_operation',{id:saved.receipt.records.foods[0],mode:'correct_previous',evidence:fix.messages[0],sources:[message('fix')]},fix);
 assert.equal(corrected.status,'undone');assert.equal(dayIntake(w.state,date).reported,false);assert.equal(w.state.local.weights[0].kg,72.1);
 assert.equal((await call(tool,'receive_inventory',{date,sources:[message('fix')],note:null,
  lines:[line('合成小青菜',{skuId:'fixture-greens',amount:100,unit:'g'})]},fix,'corrected-stock')).status,'saved');
 assert.equal(quantity(w,'fixture-greens'),900);assert.equal(readFinance(w.finance).payload.transactions.length,1);
});

test('a later purchase cannot automatically remove an independently confirmed lunch of the same food',async()=>{
 const w=mock(),book=threadBook(w.finance),tool=createAgentTools(w,{book});
 book.append('user','午餐吃了合成小青菜100g。');
 const first=turn('first','午餐吃了合成小青菜100g。');first.threadId=book.current.id;
 const saved=await call(tool,'write_health',proposal(action('eat',first.messages[0],
  {name:'小青菜',amount:100,unit:'g',meal:'午餐',whole:'no'})),first);
 book.append('assistant','已记午餐。',true,null,{taskId:first.id,agentUndo:[saved.undo]});
 book.append('assistant','刚才的照片是包装标签。',true,null,{taskId:'photo'});
 const next=turn('next','这批小青菜是新买的，要入库。');next.threadId=first.threadId;
 const result=await call(tool,'undo_operation',{id:saved.undo.id,mode:'correct_previous',evidence:next.messages[0],sources:[message('next')]},next);
 assert.equal(result.code,'unrelated_previous_operation');assert.equal(w.state.local.foods.filter(row=>row.date===date).length,1);
});
