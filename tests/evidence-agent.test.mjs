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
import {readFoodCategories,categoryReader} from '../health/food-categories.mjs';
import {vegetableIntake} from '../ai/meal-planning.mjs';
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
 const args={date,lines:[line('合成芹菜',{skuId:'celery-empty',foodGroup:'vegetable',amount:3,unit:'份',portions:Array.from({length:3},()=>
  ({amount:500,unit:'g',status:'sealed',gross:null}))})],note:null,sources:[message('stock')]};
 const priorFinance=w.finance.getItem(STORAGE_KEY);
 const saved=await call(tool,'receive_inventory',args,run);
 assert.equal(saved.status,'saved');
 assert.equal(saved.receipt.totalCents,null);assert.equal(quantity(w,'celery-empty'),1500);
 assert.equal(w.state.local.inventory.find(row=>row.id==='celery-empty').foodGroup,'vegetable');
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
 const saved=await call(tool,'write_receipt',{...receipt,inventoryLink:result.receipt.purchaseId,
  foodGroups:[{name:'合成脱脂牛奶',foodGroup:'dairy'}]},pay);
 assert.equal(saved.status,'saved',saved.reason);assert.equal(quantity(w,'fixture-milk'),beforeQuantity);
 assert.equal(w.state.local.inventory.find(row=>row.id==='fixture-milk').foodGroup,'dairy');
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

test('native food classification travels with the intake call and persists only with a verified save',async()=>{
 const w=mock(),tool=createAgentTools(w);
 saveSku(w.state,{id:'grain',name:'合成杂粮份',unit:'g',basisUnit:'g',basisAmount:100,kcal:150}).qty=500;
 const text='午餐吃了100g合成杂粮份',run=turn('classify-intake',text);
 const args={...proposal(action('eat',text,{name:'合成杂粮份',skuId:'grain',amount:100,unit:'g',meal:'午餐',source:'inventory'})),
  provenance:[{index:0,refs:[message(run.id)]}],foodGroups:[{name:'合成杂粮份',foodGroup:'staple'}]};
 let requests=0;
 await runAgent(run,{dispatch:tool,save:()=>{},request(value){
  if(++requests===1)return {status:'completed',output:[{type:'function_call',call_id:'record-meal',name:'write_health',
   arguments:JSON.stringify(args)}]};
  assert.equal(value.receipts.at(-1).result.status,'saved');
  return {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'已记录。'}]}]};
 }});
 assert.equal(requests,2);
 const item=()=>w.state.local.inventory.find(row=>row.id==='grain');
 assert.equal(item().foodGroup,'staple');
 assert.equal(quantity(w,'grain'),400);
 await tool.undo(run.receipts.at(-1).result.undo);
 assert.equal(quantity(w,'grain'),500);
 assert.equal(item().foodGroup,undefined);

 const fixText='合成杂粮份按主食分类',fix=turn('correct-category',fixText);
 setHealthAuto(w.finance,false);
 const before=structuredClone(w.state);
 const argsForFix={skuId:'grain',recordId:null,foodGroup:'staple',evidence:fixText};
 assert.equal((await call(tool,'classify_food',argsForFix,fix)).status,'review');
 assert.deepEqual(w.state,before);
 setHealthAuto(w.finance,true);
 const saved=await call(tool,'classify_food',argsForFix,fix);
 assert.equal(saved.status,'saved');
 assert.deepEqual(w.state.local.stockMoves,before.local.stockMoves);
 const second=turn('reused-category',text);
 const inferred=await call(tool,'write_health',{...args,provenance:[{index:0,refs:[message(second.id)]}],
  foodGroups:[{name:'合成杂粮份',foodGroup:'vegetable'}]},second);
 assert.equal(inferred.status,'saved');
 assert.equal(item().foodGroup,'staple');
 assert.deepEqual(vegetableIntake(w.state.local.foods.filter(row=>row.date===date),new Map(inventoryWithMoves(w.state).map(row=>[row.id,row]))),
  {grams:0,knownItems:0,unmeasured:[]});
 await tool.undo(saved.undo);
 assert.equal(quantity(w,'grain'),400);
 assert.equal(item().foodGroup,undefined);
});

test('photo classification saves one-off food, protects mixed dishes and supports record correction',async()=>{
 const w=mock(),tool=createAgentTools(w),run=turn('meal-image','午餐这份芹菜炒牛肉300克，吃完了。');
 run.attachments=[{id:'image',key:'mixed-image'}];
 const picture={
  intent:'execute',date,meal:'午餐',steps:[],
  observations:[{dishKey:'mixed',name:'芹菜炒牛肉',role:'served',images:[1],amount:300,unit:'g',confidence:'measured',
   basisAmount:null,basisUnit:null,nutrition:null,uncertainty:'合成称重'}],
  foodGroups:[{name:'芹菜炒牛肉',foodGroup:'mixed',vegetableGrams:40}]
 };
 const revision=w.state.revision??0;
 const preview=await call(tool,'write_meal_photos',{...picture,intent:'preview'},run,'photo-preview');
 assert.equal(preview.status,'ok');
 assert.equal(w.state.revision??0,revision);
 const logged=await call(tool,'write_meal_photos',picture,run);
 assert.equal(logged.status,'saved');
 const intake=w.state.local.foods.at(-1);
 assert.equal(intake.foodGroup,'mixed');
 assert.equal(intake.foodId,null);
 assert.equal(vegetableIntake([intake],new Map()).grams,0);
 const correction='把这条一次性饮食的分类改为肉类',edited=await call(tool,'classify_food',{
  skuId:null,recordId:intake.id,foodGroup:'meat',evidence:correction
 },turn('photo-category-correction',correction));
 assert.equal(edited.status,'saved');
 assert.deepEqual(w.state.local.foods.at(-1),{...intake,foodGroup:'meat'});
 await tool.undo(edited.undo);
 assert.deepEqual(w.state.local.foods.at(-1),intake);

 saveSku(w.state,{id:'known-grain',name:'合成谷物',unit:'g',basisUnit:'g',basisAmount:100,category:'主食'}).qty=500;
 const known=turn('known-photo','外食一份合成谷物300克，吃完了。');
 known.attachments=[{id:'next-image',key:'next-image'}];
 const matched=await call(tool,'write_meal_photos',{
  ...picture,observations:[{...picture.observations[0],name:'合成谷物'}],foodGroups:[{name:'合成谷物',foodGroup:'staple'}]
 },known);
 assert.equal(matched.status,'saved');
 assert.equal(w.state.local.foods.at(-1).category,'主食');
 assert.equal(w.state.local.foods.at(-1).foodGroup,'staple');
 assert.equal(quantity(w,'known-grain'),500);
});

test('taxonomy reuses aliases, merges only category references and supports rename, undo and legacy group fill',async()=>{
 const w=mock(),tool=createAgentTools(w);
 const text='创建需要的食品类别并整理分类。',run=turn('category-admin',text);
 const manage=(operationId,args)=>call(tool,'manage_food_category',
  {action:'create',id:null,targetId:null,name:null,foodGroup:null,evidence:text,...args},run,operationId);
 const create=async(operationId,name,foodGroup)=>{
  const result=await manage(operationId,{name,foodGroup});assert.equal(result.status,'saved');return result.receipt.category.id;
 };
 const dumplings=await create('dumpling-type','水饺','mixed');
 const duplicate=await manage('duplicate-type',{name:' 水　饺 ',foodGroup:'mixed'});
 assert.equal(duplicate.data.category.id,dumplings);
 assert.equal(readFoodCategories(w.state).filter(category=>category.foodGroup==='mixed').length,1);

 const old=saveSku(w.state,{name:'牛肉芹菜水饺',unit:'g',basisUnit:'g',basisAmount:100,kcal:180,category:'牛肉水饺'});
 old.qty=600;
 const filled=await call(tool,'classify_food',{skuId:old.id,recordId:null,mode:'fill',foodGroup:'mixed',categoryId:dumplings,evidence:text},
  run,'fill-standard');
 assert.equal(filled.status,'saved');
 let current=w.state.local.inventory.find(row=>row.id===old.id);
 assert.equal(current.foodGroup,'mixed');
 assert.equal(current.category,'牛肉水饺');
 const legacyCategory=categoryReader(w.state)(current).categoryId;
 const mixedMeal=turn('mixed-meal','外食午餐吃了200g牛肉芹菜水饺');
 const log=await call(tool,'write_health',{
  ...proposal(action('eat',mixedMeal.messages[0],{name:old.name,amount:200,unit:'g',meal:'午餐',source:'one_off',
   nutrition:{kcal:360,protein:18,carbs:46,fat:12,sodium:870}})),
  foodGroups:[{name:old.name,foodGroup:'mixed',categoryId:dumplings}]
 },mixedMeal);
 assert.equal(log.status,'saved');
 assert.equal(categoryReader(w.state)(w.state.local.foods.at(-1)).categoryId,legacyCategory);

 const finance=w.finance.getItem(STORAGE_KEY),moves=structuredClone(w.state.local.stockMoves);
 const skuBefore=structuredClone(current),foodBefore=structuredClone(w.state.local.foods.at(-1));
 const merged=await manage('merge-type',{action:'merge',id:legacyCategory,targetId:dumplings});
 assert.equal(merged.status,'saved');
 assert.equal(merged.receipt.updatedReferences,2);
 assert.deepEqual(w.state.local.inventory.find(row=>row.id===old.id),{...skuBefore,categoryId:dumplings});
 assert.deepEqual(w.state.local.foods.at(-1),{...foodBefore,categoryId:dumplings});
 assert.deepEqual(w.state.local.stockMoves,moves);
 assert.equal(w.finance.getItem(STORAGE_KEY),finance);
 const alias=await manage('retry-alias',{name:'牛肉水饺',foodGroup:'mixed'});
 assert.equal(alias.data.category.id,dumplings);
 const renamed=await manage('rename-type',{action:'rename',id:dumplings,name:'冷冻水饺'});
 assert.equal(renamed.status,'saved');
 assert.equal(categoryReader(w.state)(w.state.local.foods.at(-1)).categoryName,'冷冻水饺');
 await tool.undo(renamed.undo);
 await tool.undo(merged.undo);
 assert.deepEqual(w.state.local.inventory.find(row=>row.id===old.id),skuBefore);
 assert.deepEqual(w.state.local.foods.at(-1),foodBefore);

 const dairy=await create('dairy-type','乳制品','dairy'),bread=await create('bread-type','牛乳面包','bakery');
 const revision=w.state.revision;
 await assert.rejects(manage('bad-merge',{action:'merge',id:dairy,targetId:bread}),/不同食品组/);
 assert.equal(w.state.revision,revision);
});

test('a classification correction recomputes vegetable weight and undo preserves the original nutrition',async()=>{
 const w=mock(),tool=createAgentTools(w),meal=turn('wrong-veg','午餐外食菠菜鸡蛋饼500g');
 const saved=await call(tool,'write_health',{
  ...proposal(action('eat',meal.messages[0],{name:'菠菜鸡蛋饼',amount:500,unit:'g',meal:'午餐',source:'one_off',
   nutrition:{kcal:800,protein:40,carbs:80,fat:30,sodium:800}})),
  foodGroups:[{name:'菠菜鸡蛋饼',foodGroup:'vegetable',vegetableBasis:'whole'}]
 },meal);
 assert.equal(saved.status,'saved');
 const intake=()=>w.state.local.foods.filter(row=>row.date===date),analytics=()=>vegetableIntake(intake(),new Map());
 const original=structuredClone(intake()[0]);
 assert.equal(analytics().grams,500);
 const corrected=turn('correct-veg','菠菜鸡蛋饼是混合菜，请更正。');
 const fix=await call(tool,'classify_food',{skuId:null,recordId:original.id,foodGroup:'mixed',evidence:corrected.messages[0]},corrected);
 assert.equal(fix.status,'saved');
 assert.equal(analytics().grams,0);
 assert.deepEqual(intake()[0].nutrition,original.nutrition);
 await tool.undo(fix.undo);
 assert.deepEqual(intake()[0],original);
 assert.equal(analytics().grams,500);
});
