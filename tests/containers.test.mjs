import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addFood,dayIntake,deleteEvent,events,inventoryWithMoves,newState,normalizeLedger,validateAppState} from '../health/core.mjs';
import {confirmPackageAction,cookPortions,ensureContainers,packagesFor,planPackageDay,previewPackageAction,revisePackageFood,selectPackage} from '../health/containers.mjs';
import {addBatch,registerPortions,saveSku} from '../health/inventory.mjs';
import {recordPurchase,revisePurchase} from '../health/purchases.mjs';
import {planHealthMerge} from '../health/sync.mjs';
import {importSource} from '../health/sync-source.mjs';
import {createSyncPackage,externalBase,projectExternalLedger} from '../health/sync-io.mjs';

const date='2031-05-16',meal='午餐';
function sku(state,fields={}){
 return saveSku(state,{id:'synthetic-bottle',name:'合成调味酱',unit:'瓶',basisAmount:100,basisUnit:'g',
  packageSize:200,packageUnit:'g',price:6,kcal:200,protein:5,carbs:12,fat:15,sodium:35,...fields});
}
function bottled(count=2){
 const state=newState(),row=sku(state);row.qty=count;
 return ensureContainers(state);
}
const op=(state,id,fields)=>confirmPackageAction(state,{date,meal,id,...fields}).next;
const apply=(state,input,choices={})=>planHealthMerge(state,importSource(input),{choices});
const keep=plan=>Object.fromEntries(plan.unresolved.map(row=>[row.id,'keep']));
const ready=plan=>{assert.deepEqual(plan.unresolved,[]);assert.deepEqual(plan.problems,[]);return plan.next;};

test('successive gross weights become the next baseline; stable retry and equal gross never write another meal',()=>{
 let state=bottled();
 const [first,second]=packagesFor(state).map(row=>row.id);
 state=op(state,'a0',{containerId:first,action:'baseline',gross:360});
 assert.equal(selectPackage(state,{foodId:'synthetic-bottle'}).id,first);
 state=op(state,'a1',{containerId:first,gross:322.2});
 const retry=op(state,'a1',{containerId:first,gross:322.2});
 assert.strictEqual(retry,state);
 assert.strictEqual(op(state,'duplicate-other-id',{containerId:first,gross:322.2}),state);
 state=op(state,'a2',{containerId:first,gross:310,expectedHead:'a1'});
 const view=packagesFor(state).find(row=>row.id===first);
 assert.deepEqual(view.measurements.map(row=>row.gross),[360,322.2,310]);
 assert.equal(view.eaten,50);
 assert.equal(view.net,null);
 assert.equal(view.spent,150);
 assert.equal(dayIntake(state,date).totals.kcal,100);
 assert.equal(inventoryWithMoves(state)[0].qty,2);
 assert.throws(()=>op(state,'stale',{containerId:first,gross:305,expectedHead:'a1'}),/已更新/);
 assert.throws(()=>previewPackageAction(state,{containerId:second,gross:310,date}),/初始毛重/);
 assert.equal(validateAppState(state),true);
});

test('actual consumption can exceed the label; independent bottles require selection and close separately',()=>{
 let state=bottled();
 const [a,b]=packagesFor(state).map(row=>row.id);
 state=op(state,'a-start',{containerId:a,action:'baseline',gross:360});
 state=op(state,'b-start',{containerId:b,action:'baseline',gross:388});
 assert.throws(()=>selectPackage(state,{foodId:'synthetic-bottle'}),/具体包装/);
 state=op(state,'a-diff',{containerId:a,gross:150});
 assert.equal(packagesFor(state)[0].eaten,210);
 assert.equal(packagesFor(state)[0].status,'open');
 assert.equal(packagesFor(state)[0].net,null);
 assert.equal(inventoryWithMoves(state)[0].qty,2);
 state=op(state,'a-done',{containerId:a,action:'empty',tare:150});
 assert.equal(inventoryWithMoves(state)[0].qty,1);
 const [done,other]=packagesFor(state);
 assert.equal(done.status,'empty');
 assert.equal(done.initialGross-done.tare,210);
 assert.equal(other.gross,388);
 assert.equal(other.status,'open');
});

test('refill, loss, reweigh and unmeasured disposal never create calories',()=>{
 let state=bottled(1);
 const [a]=packagesFor(state);
 state=op(state,'start',{containerId:a.id,action:'baseline',gross:325});
 assert.throws(()=>op(state,'wrong',{containerId:a.id,gross:340}),/毛重增加/);
 state=op(state,'refill',{containerId:a.id,action:'refill',gross:340});
 state=op(state,'reweigh',{containerId:a.id,action:'reweigh',gross:339,reason:'换秤'});
 state=op(state,'spill',{containerId:a.id,action:'loss',gross:329});
 state=op(state,'discard',{containerId:a.id,action:'discard'});
 const [last]=packagesFor(state);
 assert.deepEqual([last.status,last.eaten,last.lost,last.unknownLoss],['discarded',0,10,true]);
 assert.equal(dayIntake(state,date).totals.kcal,null);
 assert.equal(inventoryWithMoves(state)[0].qty,0);
});

test('migration links existing whole milk and portions, with no extra nutrition, volume estimate or movement',()=>{
 const state=newState();
 const milk=sku(state,{id:'synthetic-milk',name:'合成脱脂奶1L盒装',unit:'mL',basisUnit:'mL',packageSize:1000,packageUnit:'mL',price:null,kcal:34});
 milk.qty=3000;
 const prior=addFood(state,{name:milk.name,meal,date,kcal:340,foodId:milk.id,amount:1000,amountUnit:'mL',stockQty:1000});
 const chicken=sku(state,{id:'synthetic-chicken',name:'合成熟鸡胸',unit:'g',packageSize:null,kcal:120});
 chicken.qty=0;
 for(const [i,n] of [208.4,228,234.7,250.5,219.3].entries())addBatch(state,{id:'cooked-'+i,foodId:chicken.id,date,quantity:n,portion:true,costCents:200});
 addFood(state,{name:chicken.name,meal,date,kcal:250.08,foodId:chicken.id,batchId:'cooked-0',amount:208.4,amountUnit:'g',stockQty:208.4});
 const priorFood=structuredClone(state.local.foods),priorStock=structuredClone(state.local.stockMoves);
 ensureContainers(state);
 assert.deepEqual(state.local.foods,priorFood);
 assert.deepEqual(state.local.stockMoves,priorStock);
 const cartons=packagesFor(state,milk.id);
 assert.deepEqual(cartons.map(row=>row.status),['empty','sealed','sealed']);
 assert.deepEqual(cartons[0].foodIds,[prior.id]);
 assert.equal(cartons[0].measurements.length,0);
 assert.equal(cartons[0].volumeMl,1000);
 let next=op(state,'milk0',{containerId:cartons[1].id,action:'baseline',gross:1080});
 let preview=previewPackageAction(next,{containerId:cartons[1].id,gross:980,date});
 assert.equal(preview.food.kcal,null);
 preview=previewPackageAction(next,{containerId:cartons[1].id,gross:980,date,volumeMl:95});
 assert.equal(preview.food.kcal,32.3);
 const bags=packagesFor(state,chicken.id);
 assert.deepEqual(bags.slice(1).map(row=>row.net),[228,234.7,250.5,219.3]);
 assert.equal(inventoryWithMoves(state).find(row=>row.id===chicken.id).qty,932.5);
 const migrated=structuredClone(state);
 assert.deepEqual(ensureContainers(state),migrated);
});

test('same-day vegetable planning preserves inventory; only confirmed portions alter consumption',()=>{
 let state=normalizeLedger({tables:{food_events:[],weight_events:[],food_inventory:[
  {食品ID:'synthetic-veg',名称:'合成分装菜',库存值:1000,库存单位:'g（剩2份×500g）',标准份量:'100g',kcal:10}]}});
 ensureContainers(state);
 const [a,b]=packagesFor(state);
 assert.deepEqual([a.estimated,b.estimated,a.net,b.net],[true,true,500,500]);
 state=planPackageDay(state,{id:'two-meals',containerId:a.id,date,lunchGrams:250,dinnerGrams:250});
 assert.equal(events(state,'foods').filter(row=>row.plannedContainerId===a.id).length,2);
 assert.equal(dayIntake(state,date).totals.kcal,null);
 assert.equal(inventoryWithMoves(state)[0].qty,1000);
 state=op(state,'lunch',{containerId:a.id,action:'net',grams:250});
 assert.equal(packagesFor(state)[0].net,250);
 assert.equal(packagesFor(state)[1].net,500);
 assert.equal(dayIntake(state,date).totals.kcal,25);
 assert.equal(inventoryWithMoves(state)[0].qty,750);
});

test('making new batches transfers raw quantity/cost once and repurchase keeps the active SKU identity',()=>{
 let state=newState();
 const raw=sku(state,{id:'meat-raw',name:'合成生肉',unit:'g',packageSize:null});
 const cooked=sku(state,{id:'meat-cooked',name:'合成熟肉',unit:'g',packageSize:null,kcal:160});
 recordPurchase(state,{id:'one',date,totalCents:1500,items:[{foodId:raw.id,quantity:1000,costCents:1500}]});
 const first={id:'cook-1',date,rawFoodId:raw.id,rawBatchId:'one-0',cookedFoodId:cooked.id,rawGrams:400,weights:[105,120]};
 state=cookPortions(state,first);
 state=cookPortions(state,first);
 state=cookPortions(state,{...first,id:'cook-2',rawGrams:350,weights:[101,103,107]});
 assert.deepEqual(inventoryWithMoves(state).map(row=>row.qty),[250,536]);
 const parts=packagesFor(state,cooked.id);
 assert.deepEqual(parts.map(row=>row.actualNetGrams),[105,120,101,103,107]);
 assert.deepEqual([parts.slice(0,2),parts.slice(2)].map(g=>g.reduce((sum,r)=>sum+r.costCents,0)),[600,525]);
 assert.equal(sku(state,{id:undefined,name:cooked.name,unit:'g',packageSize:null}).id,cooked.id);
 assert.throws(()=>revisePurchase(state,'one',null),/已有/);
 cooked.active=false;
 state.local.inventory.find(row=>row.id===cooked.id).active=false;
 assert.throws(()=>sku(state,{id:undefined,name:cooked.name,unit:'g',packageSize:null}),/已停用/);
});

test('correcting the latest food updates portion and cost; void preserves physical evidence of any later reading',()=>{
 let state=bottled(1);
 const id=packagesFor(state)[0].id;
 state=op(state,'base',{containerId:id,action:'baseline',gross:400});
 state=op(state,'first',{containerId:id,gross:360});
 const first=events(state,'foods')[0].id;
 state=revisePackageFood(state,{foodId:first,id:'revision',gross:370,date,meal}).next;
 assert.deepEqual([packagesFor(state)[0].gross,packagesFor(state)[0].eaten,dayIntake(state,date).totals.kcal],[370,30,60]);
 state=op(state,'second',{containerId:id,gross:350});
 deleteEvent(state,'foods',first);
 assert.deepEqual([packagesFor(state)[0].gross,packagesFor(state)[0].eaten,dayIntake(state,date).totals.kcal],[350,20,40]);
 assert.equal(packagesFor(state)[0].unassigned.length,1);
 deleteEvent(state,'foods',events(state,'foods')[0].id);
 assert.deepEqual([packagesFor(state)[0].gross,packagesFor(state)[0].eaten,dayIntake(state,date).totals.kcal],[370,0,null]);
 assert.equal(validateAppState(state),true);
});

test('package journals merge independently, conflicting heads hold their food and external replay is idempotent',()=>{
 const raw={ledger_id:'fixture-stock',handoff_version:'310516.1',updated_at:date+'T00:00:00Z',
  tables:{food_events:[],weight_events:[],food_inventory:[{食品ID:'pk',名称:'合成瓶',库存值:2,库存单位:'瓶',标准份量:'100g',kcal:100}]}};
 let base=ensureContainers(externalBase(raw).state);
 const [a,b]=packagesFor(base).map(row=>row.id);
 base=op(base,'one',{containerId:a,action:'baseline',gross:400});
 base=op(base,'two',{containerId:b,action:'baseline',gross:480});
 const left=op(base,'east',{containerId:a,gross:350});
 let right=op(base,'west',{containerId:a,gross:352});
 right=op(right,'south',{containerId:b,gross:410,meal:'晚餐'});
 const pkg=createSyncPackage(right,{id:'fixture-branch',version:'0.9.11'});
 const preview=apply(left,pkg);
 assert.equal(preview.unresolved.filter(row=>row.kind==='containerEvents').length,1);
 const merged=ready(apply(left,pkg,keep(preview)));
 assert.deepEqual(packagesFor(merged).map(row=>row.gross),[350,410]);
 assert.equal(dayIntake(merged,date).totals.kcal,120);
 assert.equal(apply(merged,pkg).changed,false);
 const external=projectExternalLedger(raw,merged,{id:'fixture-export',version:'310516.2',today:'2031-05-17'});
 assert.equal(external.tables.food_events.length,2);
 const round=externalBase(external).state;
 assert.deepEqual(packagesFor(round).map(row=>row.gross),[350,410]);
 assert.equal(apply(round,pkg).changed,false);
 assert.deepEqual(ready(apply(round,external)).local.containerEvents,round.local.containerEvents);
});

test('closing a package survives old descriptive stock units on another device',()=>{
 const raw={ledger_id:'fixture-legacy-units',handoff_version:'310516.1',tables:{
  food_events:[],weight_events:[],food_inventory:[{食品ID:'pk',名称:'合成瓶',库存值:2,库存单位:'瓶（两瓶）',标准份量:'100g',kcal:100}]}};
 const base=ensureContainers(externalBase(raw).state),phone=structuredClone(base);
 phone.legacy.inventory[0].unit='瓶（两瓶）';
 const id=packagesFor(phone)[0].id;
 const open=op(phone,'begin',{containerId:id,action:'baseline',gross:325});
 const eaten=op(open,'individual-eat',{containerId:id,gross:280});
 const closed=op(eaten,'finished',{containerId:id,action:'empty'});
 const source=createSyncPackage(closed,{id:'legacy-unit-phone',version:'0.9.11'});
 const merged=ready(apply(base,source));
 assert.equal(inventoryWithMoves(merged)[0].qty,1);
 assert.deepEqual(packagesFor(merged).map(row=>row.status),['empty','sealed']);
 assert.equal(dayIntake(merged,date).totals.kcal,45);
 assert.equal(apply(merged,source).changed,false);
});

test('same product after stock is exhausted receives a new purchase package and preserves the old audit',()=>{
 let state=bottled(1);
 const id=packagesFor(state)[0].id;
 state=op(state,'closed',{containerId:id,action:'discard'});
 assert.equal(inventoryWithMoves(state)[0].qty,0);
 const oldSku=sku(state,{id:undefined});
 assert.equal(oldSku.id,'synthetic-bottle');
 recordPurchase(state,{id:'second-order',date,totalCents:900,items:[{foodId:oldSku.id,quantity:1,costCents:900}]});
 ensureContainers(state);
 assert.equal(state.local.inventory.length,1);
 const rows=packagesFor(state);
 assert.deepEqual(rows.map(row=>[row.status,row.costCents]),[['discarded',600],['sealed',900]]);
 state=op(state,'started',{containerId:rows[1].id,action:'baseline',gross:490});
 assert.throws(()=>revisePurchase(state,'second-order',null),/已有包装/);
});

test('legacy packaged prices correct loose oats and ration bottle cost without altering imported records',()=>{
 const date='2031-05-16',raw={handoff_version:'310516.1',tables:{food_events:[],weight_events:[],food_inventory:[
  {食品ID:'FD_RYE_FLAKES_055',名称:'合成黑麦片',库存单位:'g',库存值:884,'单价(CNY)':1.65,价格基准:'g',kcal:100},
  {食品ID:'FD_SAUCE_HUBANG_BEEF_CHILI_20261120',名称:'合成辣椒酱',库存单位:'瓶',库存值:2,标准份量:'200g/瓶',kcal:100}
 ]}};
 let state=ensureContainers(normalizeLedger(raw));
 const oats=state.legacy.inventory[0].id,sauce=state.legacy.inventory[1].id;
 assert.equal(inventoryWithMoves(state)[0].looseCostEstimateCents,2652);
 assert.equal(addFood(state,{date,name:'合成黑麦片',meal,foodId:oats,stockQty:50,kcal:50}).cost,1.5);
 const containerId=packagesFor(state,sauce)[0].id;
 state=op(state,'price-opening',{containerId,action:'baseline',gross:360});
 state=op(state,'price-first',{containerId,gross:322.2});
 assert.equal(state.local.foods.at(-1).cost,1.89);
 assert.equal(state.local.foods.at(-1).costSource,'estimated_package');
 state=op(state,'price-over-nominal',{containerId,gross:150});
 assert.equal(packagesFor(state,sauce)[0].spent,1000);
 assert.equal(packagesFor(state,sauce)[0].status,'open');
 const second=packagesFor(state,sauce)[1].id;
 state=op(state,'price-discard',{containerId:second,action:'discard'});
 assert.equal(packagesFor(state,sauce)[1].lossCost,1000);
 assert.equal(state.local.foods.length,3);
 assert.deepEqual(state.legacy.sourceSnapshot.tables,raw.tables);
 recordPurchase(state,{id:'price-purchase',date,totalCents:1700,items:[{foodId:sauce,quantity:1,costCents:1700}]});
 assert.equal(packagesFor(ensureContainers(state),sauce).at(-1).costCents,1700);
});

test('audited disposal and gift are retained against a stale same-lineage opening balance',()=>{
 const fixture={ledger_id:'fixture-dispositions',handoff_version:'310516.1',updated_at:date+'T11:00:00Z',tables:{
  food_events:[],weight_events:[],inventory_transactions_audit:[],food_inventory:[
   {食品ID:'fixture-discard',名称:'合成醋',库存单位:'g毛重',库存值:1200,kcal:null},
   {食品ID:'fixture-gift',名称:'合成调味汁',库存单位:'瓶（270g/瓶）',库存值:2,kcal:null}
  ]
 }};
 const local=structuredClone(fixture);
 Object.assign(local.tables.food_inventory[0],{active:'否',库存值:0});
 Object.assign(local.tables.food_inventory[1],{库存单位:'g毛重（含开封瓶）',库存值:283.2});
 local.tables.inventory_transactions_audit=[
  {food_id:'fixture-discard',date,event:'discarded',qty_delta:-1200,prior_balance:1200,remaining_balance:0,affects_calorie_totals:false},
  {food_id:'fixture-gift',date,event:'unopened_bottle_given_away',qty_delta:-1,prior_balance:2,remaining_balance:1,
   remaining_status:'opened_bottle_gross_weight_only',affects_calorie_totals:false}
 ];
 const fromPhone=ensureContainers(normalizeLedger(local));
 const merged=ready(apply(fromPhone,fixture));
 assert.equal(inventoryWithMoves(merged).find(row=>row.id==='fixture-discard').qty,0);
 const [bottle]=packagesFor(merged,'fixture-gift');
 assert.equal(bottle.gross,283.2);
 assert.equal(bottle.net,null);
 assert.equal(merged.local.foods.length,0);
 assert.equal(merged.local.stockMoves.length,0);
 assert.equal(apply(merged,fixture).changed,false);
 const conflicting=structuredClone(fixture);
 conflicting.tables.inventory_transactions_audit.push({food_id:'fixture-gift',date,event:'counted',remaining_balance:2,affects_calorie_totals:false});
 assert.ok(apply(merged,conflicting).unresolved.some(row=>row.kind==='inventory'));
});

test('unknown conversion or net contents do not become a zero-cost intake',async()=>{
 const {apportionedCost}=await import('../health/package-price.mjs');
 assert.equal(apportionedCost(1000,null,200),null);
 assert.equal(apportionedCost(1000,37.8,null),null);
 assert.equal(apportionedCost(1000,50,210,990),10);
});
