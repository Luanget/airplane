import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAgentTools} from '../ai/agent-tools.mjs';
import {setDocumentAccess} from '../ai/documents.mjs';
import {identifyAttachments} from '../ai/conversation-evidence.mjs';
import {orderReceipt} from './order-agent-fixture.mjs';
import {createOwnerData} from '../ai/owner.mjs';
import {readFinance} from '../finance-storage.mjs';
import {events,inventoryWithMoves,dayIntake} from '../health/core.mjs';
import {historicalDate,ownerDate,ownerFixture,ownerContext,edit,changes,search} from './owner-fixture.mjs';

const ledger=workspace=>readFinance(workspace.finance).payload;
const stock=(workspace,id)=>inventoryWithMoves(workspace.state).find(row=>row.id===id);
const commands=workspace=>{
 const tools=createAgentTools(workspace);
 return (name,args,id=name)=>tools(name,args,ownerContext(id));
};

test('owner tools reuse the legacy grant and require the current turn’s local access',async()=>{
 const workspace=ownerFixture(false),tools=createAgentTools(workspace);
 assert.equal(tools.definitions.some(row=>row.name==='mutate_records'),false);
 await assert.rejects(tools('list_data_sources',{},ownerContext()),/已关闭/);
 setDocumentAccess(workspace.finance,true);
 assert.ok(tools.definitions.some(row=>row.name==='apply_json_patch'));
 await assert.rejects(tools('list_data_sources',{},ownerContext('off',false)),/已关闭/);
 const catalog=(await tools('list_data_sources',{},ownerContext())).data;
 for(const key of ['medical_reports','conversation_messages','transactions','purchases','containers','sync_sources'])
  assert.ok(catalog.datasets[key]);
});

test('net refund correction changes the same old transaction and linked payment only',async()=>{
 const workspace=ownerFixture(),call=commands(workspace);
 const original=structuredClone(workspace.state.local.purchases[0].items);
 const found=(await call('query_records',search('transactions',{since:historicalDate,until:historicalDate}))).data;
 assert.equal(found.rows[0].id,'old-expense');
 const input=changes(edit('transactions','old-expense','update',{amountAdjustment:{gross:39.67,refund:.07}}));
 const saved=await call('mutate_records',input,'net-refund');
 assert.equal(saved.status,'saved');
 assert.equal((await call('mutate_records',input,'net-refund')).replayed,true);
 assert.deepEqual(ledger(workspace).transactions.map(row=>[row.id,row.amount]),[['old-expense',39.6]]);
 assert.equal(workspace.state.local.purchases[0].paymentCents,3960);
 assert.deepEqual(workspace.state.local.purchases[0].items,original);
 const result=(await call('get_change_history',{id:'net-refund',offset:0,limit:100})).data;
 assert.ok(result.rows.some(row=>row.path.endsWith('/amount')&&row.before===39.67&&row.after===39.6));
});

test('replace a scale count without rewriting 200 g historical intake or other lines',async()=>{
 const workspace=ownerFixture(),call=commands(workspace);
 assert.equal(stock(workspace,'egg').qty,1800);
 const before=structuredClone(events(workspace.state,'foods')[0]);
 const order=structuredClone(workspace.state.local.purchases[0]);
 await call('mutate_records',changes(edit('inventory','egg','update',{unit:'个',quantity:30,
  basisAmount:1,basisUnit:'个',nutrition:{kcal:75,protein:6}})),'count');
 assert.deepEqual([stock(workspace,'egg').id,stock(workspace,'egg').unit,stock(workspace,'egg').qty],['egg','个',30]);
 assert.deepEqual(events(workspace.state,'foods')[0],before);
 assert.deepEqual(workspace.state.local.purchases[0].items.slice(1),order.items.slice(1));
 assert.equal(workspace.state.local.purchases[0].financeId,'old-expense');
 assert.equal(workspace.state.local.stockMoves.filter(row=>row.foodId==='egg'&&row.stockArchived).length,2);
 assert.equal(ledger(workspace).transactions[0].amount,39.67);
 await call('mutate_records',changes(edit('foods','today-egg','add',{name:'合成鸡蛋',foodId:'egg',amount:2,amountUnit:'个',
  meal:'午餐',nutrition:{kcal:150,protein:12}})),'lunch');
 assert.equal(stock(workspace,'egg').qty,28);
 await call('mutate_records',changes(edit('foods','historical-egg','update',{meal:'晚餐',amount:150,amountUnit:'g'})),'old-intake');
 const historical=events(workspace.state,'foods').find(row=>row.id==='historical-egg');
 assert.equal(historical.nutrition.kcal,150);
 assert.equal(historical.meal,'晚餐');
 assert.equal(stock(workspace,'egg').qty,28);
});

test('changing one linked order line leaves other batches and the expense intact',async()=>{
 const workspace=ownerFixture(),call=commands(workspace);
 const before=structuredClone(workspace.state.local.batches.filter(row=>row.foodId!=='egg'));
 const saved=await call('mutate_records',changes(edit('purchases','mixed-order','update',{itemEdits:[
  {batchId:'batch-egg',action:'update',fields:{quantity:1900}}
 ]})),'one-line');
 assert.equal(saved.status,'saved');
 assert.equal(stock(workspace,'egg').qty,1700);
 assert.deepEqual(workspace.state.local.batches.filter(row=>row.foodId!=='egg'),before);
 assert.deepEqual(ledger(workspace).transactions.map(row=>row.amount),[39.67]);
});

test('batch fails before commit on invalid dependency, then atomic retry and targeted undo',async()=>{
 const workspace=ownerFixture(),call=commands(workspace);
 const old=structuredClone(workspace.state);
 const food=edit('foods','outside','add',{date:historicalDate,name:'合成外食',status:'actual',amount:50,amountUnit:'g',
  meal:'晚餐',nutrition:{kcal:120}});
 await assert.rejects(call('mutate_records',changes(food,edit('transactions','missing','update',{amount:12})),'combined'),/找不到/);
 assert.deepEqual(workspace.state,old);
 await call('mutate_records',changes(food,edit('transactions','old-expense','update',{amount:39.6})),'combined');
 assert.equal(events(workspace.state,'foods').find(row=>row.id==='outside').foodId,null);
 assert.equal(ledger(workspace).transactions[0].amount,39.6);
 await call('mutate_records',changes(edit('transactions','old-expense','update',{note:'后续备注'})),'later');
 await call('undo_change',{id:'combined'},'undo');
 assert.deepEqual(events(workspace.state,'foods').map(row=>row.id),['historical-egg']);
 assert.deepEqual(ledger(workspace).transactions.map(row=>[row.amount,row.note]),[[39.67,'后续备注']]);
});

test('historical report and symptoms, future plan, cross-document JSON patch, query paging',async()=>{
 const workspace=ownerFixture(),call=commands(workspace);
 await call('mutate_records',changes(edit('medical_symptoms','old-symptom','add',{date:historicalDate,
  description:'合成症状自述',source:'user',kind:'symptoms'}),edit('foods','plan-old','add',{date:'2027-02-01',name:'明年计划',
  meal:'晚餐',status:'plan',amount:60,amountUnit:'g',nutrition:{kcal:120}})),'report-and-plan');
 const patch={reason:'同批更正',documents:[
  {document:'health',id:null,patch:JSON.stringify([{op:'replace',path:'/local/foods/1/amount',value:50}])},
  {document:'finance',id:null,patch:JSON.stringify([{op:'test',path:'/transactions/0/id',value:'old-expense'},
   {op:'replace',path:'/transactions/0/note',value:'已核对'}])}
 ]};
 assert.equal((await call('apply_json_patch',patch)).status,'saved');
 assert.equal((await call('query_records',search('medical_symptoms'))).data.rows[0].id,'old-symptom');
 assert.equal((await call('query_records',search('foods',{limit:1}))).data.nextOffset,1);
 assert.equal(dayIntake(workspace.state,'2027-02-01').totals.kcal,null);
 await assert.rejects(call('apply_json_patch',{...patch,documents:[{document:'keys',id:null,patch:'[]'}]},'credentials'),/不在/);
});

test('owner transaction supports more than the old eight health actions',async()=>{
 const workspace=ownerFixture(),owner=createOwnerData(workspace);
 const input=changes(...Array.from({length:15},(_,i)=>edit('foods','batch-'+i,'add',
  {name:'合成食品'+i,date:historicalDate,meal:'加餐',amount:i+1,amountUnit:'g',nutrition:{kcal:10}})));
 const result=await owner.mutate(input,ownerContext('many'));
 assert.equal(result.data.length,15);
 assert.equal(events(workspace.state,'foods').length,16);
});

test('existing memory topic can be corrected by an owner without an automatic-memory grant',async()=>{
 const workspace=ownerFixture(),call=commands(workspace);
 workspace.finance.setItem('airplane-ai-auto-memory-v1','off');
 const saved=await call('remember_habit',{topic:'breakfast-test',name:'早餐习惯',text:'早餐优先选择燕麦。',constraint:null,evidence:'用户早餐偏好'},'habit');
 assert.equal(saved.status,'saved');
 assert.equal(workspace.memory.activeHabits()[0].text,'早餐优先选择燕麦。');
 assert.ok(saved.undo?.id);
});

test('owner records the user symptom even when description and date refer to an earlier message',async()=>{
 const workspace=ownerFixture(),call=commands(workspace);
 const saved=await call('write_medical_symptom',{date:historicalDate,time:null,description:'头痛',
  change:null,visit:null,evidence:'补充上一份报告',uncertainty:null,existingId:null});
 assert.equal(saved.status,'saved');
 assert.equal(workspace.state.local.medical.symptoms[0].source,'user');
 assert.equal(workspace.state.local.medical.symptoms[0].date,historicalDate);
});

test('historical attachment selection sends only the chosen file and leaves archive untouched',async()=>{
 const w=ownerFixture(),groupId='media:older-than-30-days';
 const raw=[{key:'synthetic-first',input:{type:'input_image',image_url:'data:image/png;base64,AAAA'},name:'合成标签.png'},
  {key:'synthetic-second',input:{type:'input_image',image_url:'data:image/png;base64,BBBB'},name:'其他合成图片.png'}];
 const {group,files}=identifyAttachments(raw,groupId);
 const book={list:()=>[{id:'archived-thread',messages:[{date:historicalDate,role:'user',text:'合成旧照片',attachmentGroup:group}]}]};
 const base=w.ownerStore.read;
 w.ownerStore.read=part=>part.document==='attachments'?Promise.resolve({id:groupId,attachments:files}):base(part);
 const tools=createAgentTools(w,{book}),context=ownerContext();
 const attachments=(await tools('query_records',search('attachments'),context)).data.rows;
 assert.equal(attachments[0].id,groupId);
 assert.ok(!JSON.stringify(attachments).includes('data:image'));
 assert.equal((await tools('owner_send_attachment',{id:files[0].id},context)).data.state,'attached');
 assert.deepEqual(context.run.attachments.map(row=>row.key),['synthetic-first']);
});

test('owner staged receipt creates exactly one linked purchase and has one rollback',async()=>{
 const w=ownerFixture(),tools=createAgentTools(w),context=ownerContext('owner-synthetic-screenshot');
 context.run.attachments=[{key:'synthetic-screenshot'}];context.run.messages=['支付成功。这笔新订单记账并入库。'];
 context.run.clock='14:00';
 const result=await tools('write_receipt',{...orderReceipt(ownerDate),inventoryLink:'distinct'},context);
 assert.equal(result.status,'saved',JSON.stringify(result));
 assert.equal(w.state.local.purchases.length,2);
 assert.equal(ledger(w).transactions.length,4);
 assert.equal(result.undo.kind,'owner_change');
 assert.equal((await tools('write_receipt',{...orderReceipt(ownerDate),inventoryLink:'distinct'},context)).replayed,true);
 await tools('undo_change',{id:result.undo.id},ownerContext('undo-screenshot'));
 assert.equal(w.state.local.purchases.length,1);
 assert.deepEqual(ledger(w).transactions.map(row=>row.id),['old-expense']);
});

test('exact same new record instruction with two request IDs is deduplicated',async()=>{
 const w=ownerFixture(),tools=createAgentTools(w);
 const original=ownerContext('one'),retry=ownerContext('two');
 retry.run.id='second-request';
 const add=id=>changes(edit('foods',id,'add',{name:'合成重复请求',status:'actual',amount:12,amountUnit:'g'}));
 assert.equal((await tools('mutate_records',add('duplicate-a'),original)).status,'saved');
 assert.equal((await tools('mutate_records',add('duplicate-b'),retry)).replayed,true);
 assert.equal(events(w.state,'foods').filter(row=>row.name==='合成重复请求').length,1);
});

test('owner can remove one old purchased item without deleting its consumed history',async()=>{
 const w=ownerFixture(),call=commands(w);
 await call('mutate_records',changes(edit('purchases','mixed-order','update',{itemEdits:[
  {batchId:'batch-egg',action:'delete',fields:{}}
 ]})),'delete-one-line');
 assert.deepEqual(w.state.local.purchases[0].items.map(row=>row.foodId),['milk','celery']);
 assert.equal(stock(w,'egg').qty,0);
 assert.equal(events(w.state,'foods')[0].amount,200);
 assert.equal(ledger(w).transactions[0].amount,39.67);
 assert.equal(w.state.local.batches.find(row=>row.id==='batch-egg').stockArchived,true);
});

test('turning a saved future plan into actual intake consumes only the matching amount',async()=>{
 const w=ownerFixture(),call=commands(w);
 const plan=edit('foods','planned-egg','add',{date:'2026-11-25',name:'合成鸡蛋',foodId:'egg',
  amount:120,amountUnit:'g',meal:'晚餐',status:'plan'});
 await call('mutate_records',changes(plan),'save-plan');
 assert.equal(stock(w,'egg').qty,1800);
 assert.equal(dayIntake(w.state,'2026-11-25').reported,false);
 await call('mutate_records',changes(edit('foods','planned-egg','update',{status:'actual'})),'execute-plan');
 assert.equal(stock(w,'egg').qty,1680);
 assert.equal(dayIntake(w.state,'2026-11-25').totals.kcal,120);
 assert.equal(events(w.state,'foods').filter(row=>row.id==='planned-egg').length,1);
});

const healthPatch=(...steps)=>({reason:'修订合成账本',documents:[{
 document:'health',id:null,patch:JSON.stringify(steps)
}]});
const replace=(path,value)=>({op:'replace',path,value});
const foodPath='/local/foods/0';
const patchHealth=(workspace,...steps)=>commands(workspace)('apply_json_patch',healthPatch(...steps));
const eggFood=w=>events(w.state,'foods').find(row=>row.id==='historical-egg');

test('Patch actual to plan reverses stock and daily intake, and converts back once',async()=>{
 const w=ownerFixture(),call=commands(w);
 const planned=await call('apply_json_patch',healthPatch(replace(foodPath+'/status','plan')),'plan');
 assert.equal(planned.status,'saved');
 assert.equal(eggFood(w).status,'plan');
 assert.equal(eggFood(w).stockQty,null);
 assert.equal(stock(w,'egg').qty,2000);
 assert.equal(dayIntake(w.state,historicalDate).totals.kcal,null);
 const request=healthPatch(replace(foodPath+'/status','actual'));
 assert.equal((await call('apply_json_patch',request,'actual')).status,'saved');
 assert.equal((await call('apply_json_patch',request,'actual')).replayed,true);
 assert.equal(stock(w,'egg').qty,1800);
 assert.equal(dayIntake(w.state,historicalDate).totals.kcal,200);
});

test('Patch amount recomputes linked stock, recorded nutrients, cost, history and undo',async()=>{
 const w=ownerFixture(),call=commands(w);
 const saved=await call('apply_json_patch',healthPatch(replace(foodPath+'/amount',50)),'less-egg');
 assert.equal(stock(w,'egg').qty,1950);
 const row=eggFood(w);
 assert.deepEqual([row.amount,row.portion,row.nutrition.kcal,row.nutrition.protein,row.cost],[50,'50 g',50,5,.44]);
 assert.deepEqual(w.state.local.stockMoves.filter(move=>move.linkedFoodId===row.id).map(move=>move.delta),[-50]);
 const undo=await call('undo_change',{id:saved.undo.id},'undo-amount');
 assert.equal(undo.status,'saved');
 assert.equal(eggFood(w).amount,200);
 assert.equal(eggFood(w).cost,1.77);
 assert.equal(stock(w,'egg').qty,1800);
});

test('Patch SKU releases old stock, only uses a known conversion and switches nutrition basis',async()=>{
 const w=ownerFixture(),call=commands(w);
 eggFood(w).foodGroup='egg';
 const result=await call('apply_json_patch',healthPatch(replace(foodPath+'/foodId','milk')),'sku-unknown');
 assert.equal(result.status,'saved');
 assert.deepEqual([stock(w,'egg').qty,stock(w,'milk').qty],[2000,1000]);
 assert.equal(eggFood(w).name,'合成牛奶');
 assert.equal(eggFood(w).foodGroup,undefined);
 assert.equal(eggFood(w).stockAssociation,'pending');
 assert.equal(eggFood(w).stockQty,null);
 assert.equal(eggFood(w).nutrition.kcal,null);
 assert.equal(eggFood(w).cost,null);
 await call('apply_json_patch',healthPatch(replace(foodPath+'/amountUnit','mL')),'sku-converted');
 assert.deepEqual([stock(w,'egg').qty,stock(w,'milk').qty],[2000,800]);
 assert.deepEqual([eggFood(w).stockQty,eggFood(w).nutrition.kcal,eggFood(w).cost],[200,200,2.4]);
 assert.ok(w.state.local.stockMoves.filter(move=>move.linkedFoodId==='historical-egg').every(move=>move.foodId==='milk'));
});

test('Patch deleting an order removes current stock and unused lots, preserving paid finance and consumed evidence',async()=>{
 const w=ownerFixture(),call=commands(w);
 const beforeFinance=structuredClone(ledger(w));
 const saved=await call('apply_json_patch',healthPatch({op:'remove',path:'/local/purchases/0'}),'delete-order');
 assert.equal(saved.status,'saved');
 assert.deepEqual(w.state.local.purchases,[]);
 assert.deepEqual(w.state.local.batches.map(row=>[row.id,row.stockArchived]),[['batch-egg',true]]);
 assert.deepEqual(['egg','milk','celery'].map(id=>stock(w,id).qty),[0,0,0]);
 assert.equal(eggFood(w).nutrition.kcal,200);
 assert.deepEqual(ledger(w),beforeFinance);
 await call('undo_change',{id:saved.undo.id},'undo-order');
 assert.equal(w.state.local.purchases[0].financeId,'old-expense');
 assert.deepEqual(['egg','milk','celery'].map(id=>stock(w,id).qty),[1800,1000,600]);
});

test('clearing or relinking dependent movements is rejected without a staged finance write',async()=>{
 const w=ownerFixture();
 const previous=structuredClone(w.state),finance=structuredClone(ledger(w));
 const bad=healthPatch(replace('/local/stockMoves',[]));
 bad.documents.unshift({document:'finance',id:null,patch:JSON.stringify([replace('/transactions/0/amount',39.6)])});
 await assert.rejects(commands(w)('apply_json_patch',bad,'invalid-mixed'),/关联校验.*批次入库/);
 await assert.rejects(patchHealth(w,replace('/local/stockMoves/3/linkedFoodId','missing-food')),/没有关联的实际饮食/);
 assert.deepEqual(w.state,previous);
 assert.deepEqual(ledger(w),finance);
 assert.deepEqual(await w.ownerStore.list(),[]);
});

test('one Patch can correct an intake and procurement quantity while unrelated lots stay byte-identical',async()=>{
 const w=ownerFixture();
 const otherLots=structuredClone(w.state.local.batches.slice(1));
 const result=await patchHealth(w,replace('/local/purchases/0/items/0/quantity',150),
  replace(foodPath+'/amount',50));
 assert.equal(result.status,'saved');
 assert.equal(stock(w,'egg').qty,100);
 assert.equal(eggFood(w).cost,5.89);
 assert.deepEqual(w.state.local.batches.slice(1),otherLots);
 assert.equal(ledger(w).transactions[0].amount,39.67);
});

test('a historical missing receipt does not block unrelated corrections',async()=>{
 const w=ownerFixture();
 w.state.local.stockMoves=w.state.local.stockMoves.filter(row=>row.batchId!=='batch-milk');
 const result=await patchHealth(w,replace(foodPath+'/amount',50));
 assert.equal(result.status,'saved');
 assert.equal(stock(w,'egg').qty,1950);
 assert.equal(stock(w,'milk').qty,0);
});

test('new finance undo history stores changed rows and keeps unrelated later entries',async()=>{
 const w=ownerFixture(),call=commands(w),{STORAGE_KEY,replaceFinance}=await import('../finance-storage.mjs');
 const full=ledger(w);
 for(let i=0;i<10000;i++)full.transactions.push({...full.transactions[0],id:'unrelated-'+i,note:'模拟历史交易 '+i});
 replaceFinance(w.finance,full,w.finance.getItem(STORAGE_KEY));
 const saved=await call('mutate_records',changes(edit('transactions','old-expense','update',{amount:39.6})),'small-audit');
 const audit=await w.ownerStore.get(saved.undo.id);
 assert.ok(JSON.stringify(full).length>1_000_000);
 assert.ok(JSON.stringify(audit).length<3000);
 assert.equal(audit.parts[0].before.payload.transactions.length,1);
 await call('mutate_records',changes(edit('transactions','unrelated-100','update',{note:'后来改过'})),'later-row');
 await call('undo_change',{id:saved.undo.id},'undo-small-audit');
 assert.equal(ledger(w).transactions[0].amount,39.67);
 assert.equal(ledger(w).transactions.find(row=>row.id==='unrelated-100').note,'后来改过');
});

test('packaged purchase deletion removes unused containers and rejects corrupt close-event stock',async()=>{
 const w=ownerFixture(),{confirmPackageAction,ensureContainers,packagesFor}=await import('../health/containers.mjs');
 Object.assign(w.state.local.inventory.find(row=>row.id==='milk'),{packageSize:1000,packageUnit:'mL',packageKind:'盒'});
 ensureContainers(w.state);
 const carton=packagesFor(w.state,'milk')[0];
 assert.equal(carton.origin,'batch');
 const consumed=confirmPackageAction(w.state,{containerId:carton.id,id:'carton-consumption',action:'whole',date:historicalDate}).next;
 const shell=ownerFixture();
 Object.assign(shell.state,consumed);
 const moves=shell.state.local.stockMoves,closeIndex=moves.findIndex(row=>row.containerId===carton.id);
 assert.ok(closeIndex>=0);
 await assert.rejects(patchHealth(shell,replace('/local/stockMoves/'+closeIndex+'/delta',-1)),/包装事件数量/);
 assert.equal(stock(shell,'milk').qty,0);
 await patchHealth(w,{op:'remove',path:'/local/purchases/0'});
 assert.ok(!w.state.local.containers.some(row=>row.id===carton.id));
 assert.equal(stock(w,'milk').qty,0);
});

test('changing an imported legacy actual to a plan keeps original rows but removes consumption from summaries',async()=>{
 const w=ownerFixture(),row=w.state.local.foods.pop();
 w.state.legacy.foods.push({...row,source:'legacy',actual:true,status:'已吃'});
 await patchHealth(w,replace('/legacy/foods/0/status','plan'));
 assert.equal(w.state.legacy.foods[0].status,'已吃');
 assert.equal(eggFood(w).status,'plan');
 assert.equal(dayIntake(w.state,historicalDate).totals.kcal,null);
 assert.equal(stock(w,'egg').qty,2000);
});

test('owner-corrected food and stock survive a repeated external ledger round trip',async()=>{
 const w=ownerFixture(),{externalBase,projectExternalLedger,createSyncPackage}=await import('../health/sync-io.mjs');
 const {planHealthMerge}=await import('../health/sync.mjs'),{importSource}=await import('../health/sync-source.mjs');
 const raw={canonical_source:'health_tracker_261121.1.json',handoff_version:'261121.1',updated_at:ownerDate,
  tables:{food_events:[],food_inventory:[],weight_events:[]}};
 const base=projectExternalLedger(raw,w.state,{version:'261121.1',id:'synthetic-owner-file'});
 await patchHealth(w,replace(foodPath+'/amount',50));
 const pkg=createSyncPackage(w.state,{id:'synthetic-owner-phone',version:'0.9.23'}),incoming=importSource(pkg);
 const {state,sourceId}=externalBase(base),preview=planHealthMerge(state,incoming,{baseSource:sourceId});
 const choices=Object.fromEntries(preview.unresolved.map(row=>[row.id,'take']));
 const merged=planHealthMerge(state,incoming,{baseSource:sourceId,choices});
 assert.deepEqual(merged.problems,[]);
 assert.deepEqual(merged.unresolved,[]);
 const newer=projectExternalLedger(base,merged.next,{version:'261122.1',id:'synthetic-owner-file'});
 const reopened=externalBase(newer).state;
 assert.deepEqual(events(reopened,'foods').map(row=>[row.amount,row.nutrition.kcal]),[[50,50]]);
 assert.equal(inventoryWithMoves(reopened).find(row=>row.id==='egg').qty,1950);
 assert.equal(planHealthMerge(reopened,incoming).changed,false);
});
