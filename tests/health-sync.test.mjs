import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dayIntake,energyForDay,events,inventoryWithMoves,addFood,deleteEvent,localStockChange,newState,normalizeLedger,recordEvent} from '../health/core.mjs';
import {readAppData} from '../ai/data.mjs';
import {saveSku} from '../health/inventory.mjs';
import {recordPurchase,revisePurchase} from '../health/purchases.mjs';
import {combinedBackup} from '../health/backup.mjs';
import {freshData} from '../finance-storage.mjs';
import {importSource} from '../health/sync-source.mjs';
import {planHealthMerge,verifyMergeConsistency} from '../health/sync.mjs';
import {createSyncPackage,externalBase,projectExternalLedger} from '../health/sync-io.mjs';

const day='2030-11-20',tomorrow='2030-11-21';
const lunch=[['米粉',180,220],['牛肉',100,140],['鸡蛋',50,80],['鸡腿',90,130],['额外续粉',70,90]];
const row=(name,amount,kcal,{date=day,meal='午餐',status='实际',id}={})=>({
 日期:date,餐次:meal,'食物/饮品':name,'份量/重量':amount+'g',状态:status,kcal,
 ...(id?{'记录ID':id}:{})
});
const legacy=(foodRows,extra={},version='301120.1')=>({canonical_source:'health_tracker_'+version+'.json',handoff_version:version,
 updated_at:day+'T12:00:00+08:00',tables:{food_events:foodRows,weight_events:[],food_inventory:[],...extra}});
const choicesFor=(plan,value='keep')=>Object.fromEntries(plan.unresolved.map(issue=>
 [issue.id,issue.options.some(option=>option.value===value)?value:issue.options[0].value]));
const plan=(state,input,choices={},finance)=>planHealthMerge(state,importSource(input),{choices,finance});
const clean=preview=>{assert.deepEqual(preview.problems,[]);assert.deepEqual(preview.unresolved,[]);return preview.next;};
function logFood(state,name,amount,kcal,meal='午餐',date=day){
 return addFood(state,{name,date,meal,portion:amount+' g',kcal});
}

test('overlapping five-item lunch is one meal, phone dinner wins intake and repeated external files are idempotent',()=>{
 const phone=newState();
 const phoneLunch=lunch.map(([name,amount,kcal])=>logFood(phone,name,amount,kcal));
 logFood(phone,'已吃晚餐',200,400,'晚餐');
 const rows=lunch.map(item=>row(...item));
 rows.push(row('外部晚餐方案',180,500,{meal:'晚餐',status:'计划'}));
 const external=legacy(rows,{daily_summaries:[{日期:day,kcal:660}],activity_events:[]});
 const preview=plan(phone,external);
 const merged=clean(preview);
 assert.equal(preview.rows.filter(item=>item.kind==='foods'&&item.status==='same').length,5);
 assert.deepEqual(merged.local.foods.map(item=>item.id),phone.local.foods.map(item=>item.id));
 assert.ok(phoneLunch.every(item=>events(merged,'foods').some(current=>current.id===item.id)));
 assert.equal(dayIntake(merged,day).totals.kcal,1060);
 assert.equal(events(merged,'foods').length,7);
 assert.equal(plan(merged,external).changed,false);
 external.tables.food_events.reverse();
 external.handoff_version='301120.2';
 assert.equal(events(clean(plan(merged,external)),'foods').length,7);
});

test('three-way corrections do not overwrite a concurrent phone edit or resurrect a deletion',()=>{
 const old=legacy([row('合成鸡蛋',50,85,{id:'egg-one'})],{daily_summaries:[{日期:day,kcal:85}]});
 const initial=importSource(old).health;
 const anchored=clean(plan(initial,old));
 const original=events(anchored,'foods')[0];
 addFood(anchored,{...original,status:'actual',portion:'60 g',kcal:102},original.id);
 logFood(anchored,'手机补报鸡胸',100,150,'晚餐',tomorrow);
 const refreshed=legacy([row('合成鸡蛋',55,94,{id:'egg-one'}),row('外部补报配菜',70,35,{date:tomorrow})],{},'301120.2');
 const preview=plan(anchored,refreshed);
 const conflict=preview.unresolved.find(item=>item.kind==='foods');
 assert.equal(conflict.status,'conflict');
 assert.equal(conflict.before.nutrition.kcal,102);
 const held=clean(plan(anchored,refreshed,choicesFor(preview)));
 assert.equal(dayIntake(held,day).totals.kcal,102);
 assert.equal(dayIntake(held,tomorrow).totals.kcal,185);
 assert.equal(plan(held,refreshed).changed,false);
 const stale=plan(held,old);
 assert.match(stale.problems.join(' '),/早于/);
 deleteEvent(held,'foods',original.id);
 assert.equal(plan(held,refreshed).changed,false);
 assert.ok(!events(held,'foods').some(item=>item.id===original.id));
});

test('unknown legacy identities require review and off-record summaries cannot silently overlap replayed events',()=>{
 const base=importSource(legacy([],{daily_summaries:[{日期:day,kcal:200}]})).health;
 const raw=legacy([row('合成主食',100,200)],{daily_summaries:[{日期:day,kcal:200}]},'301120.2');
 const preview=plan(base,raw);
 const candidate=preview.unresolved.find(item=>item.kind==='foods');
 assert.ok(candidate);
 const held=clean(plan(base,raw,{[candidate.id]:'keep'}));
 assert.equal(dayIntake(held,day).totals.kcal,200);
 assert.equal(events(held,'foods').length,0);
 const separate={[candidate.id]:'separate'};
 const unresolved=plan(base,raw,separate).unresolved.find(item=>item.kind==='baselines');
 assert.ok(unresolved);
 const resolved=clean(plan(base,raw,{...separate,[unresolved.id]:'take'}));
 assert.equal(dayIntake(resolved,day).totals.kcal,200);
 const added=legacy([row('合成主食',120,240),row('合成主食',120,240)],{},'301120.3');
 const duplicates=plan(resolved,added);
 assert.ok(duplicates.unresolved.some(item=>item.kind==='foods'&&item.status==='suspect'));
});

test('external aliases, actual unit prices, purchase corrections and audit are normalized data; finance stays separate',async()=>{
 const phone=newState();
 const finance=freshData();
 finance.transactions.push({id:'expense-example',type:'expense',date:day,amount:12,categoryId:'default-1'});
 const milk=saveSku(phone,{id:'milk-local',name:'合成牛奶',unit:'g',basisUnit:'g',basisAmount:100,kcal:62});
 const sauce=saveSku(phone,{id:'sauce-local',name:'合成调味酱',unit:'瓶',basisUnit:'g',basisAmount:100,kcal:140});
 milk.qty=1200;sauce.qty=1;
 addFood(phone,{name:milk.name,date:day,meal:'午餐',portion:'200 g',foodId:milk.id,stockQty:200,kcal:124});
 const external=legacy([row(milk.name,200,124)],{
  food_inventory:[{食品ID:'ext-milk',名称:milk.name,库存值:1000,库存单位:'g',标准份量:'每100g',kcal:62},
   {食品ID:'ext-sauce',名称:sauce.name,库存值:1,库存单位:'瓶',标准份量:'每100g',kcal:140}],
  food_aliases:[{食品ID:'ext-milk',规范名称:milk.name,别名:'白色饮品'}],
  price_catalog:[{食品ID:'ext-milk',食品名称:milk.name,'单价(CNY)':0.02,单位:'g',日期:day}],
  purchase_events:[{采购ID:'order-23',日期:day,名称:milk.name,'金额(CNY)':12}],
  inventory_audit:[{流水ID:'audit-23',日期:day,名称:sauce.name,备注:'合成盘点'}],
  rules:[{Key:'example-rule',状态:'active',当前值:'测试规则',说明:'合成'}]
 });
 const beforeFinance=structuredClone(finance);
 const first=plan(phone,combinedBackup(importSource(external).health,finance),{},finance);
 assert.ok(first.rows.some(item=>item.kind==='purchaseEvents'));
 const firstRaw=plan(phone,external,{},finance);
 const merged=clean(plan(phone,external,choicesFor(firstRaw),finance));
 assert.deepEqual(finance,beforeFinance);
 assert.equal(merged.local.stockMoves.length,1);
 assert.equal(merged.local.purchases?.length??0,0);
 assert.equal(inventoryWithMoves(merged).find(item=>item.id===milk.id).qty,1000);
 assert.equal(inventoryWithMoves(merged).find(item=>item.id===milk.id).pricePerUnit,0.02);
 assert.deepEqual(inventoryWithMoves(merged).find(item=>item.id===milk.id).aliases,['白色饮品']);
 let catalog=await readAppData({readHealth:()=>merged},null,{dataset:'sync_catalog',query:'合成调味酱',date:null,id:null,fields:[]});
 assert.ok(catalog.rows.some(item=>item.kind==='inventoryAudit'));
 external.tables.purchase_events[0]['金额(CNY)']=14;
 external.handoff_version='301120.2';
 const revised=plan(merged,external,{},finance);
 const reconciled=clean(plan(merged,external,choicesFor(revised),finance));
 assert.equal(reconciled.legacy.catalogs.purchaseEvents[0].totalCents,1400);
 assert.deepEqual(finance,beforeFinance);
 assert.equal(plan(reconciled,external,{},finance).changed,false);
});

test('native purchase corrections keep stable lots and use original cost allocation without finance replay',()=>{
 const phone=newState(),sku=saveSku(phone,{name:'合成鲜奶',unit:'g',basisAmount:100,basisUnit:'g',kcal:60});
 const purchase=recordPurchase(phone,{id:'purchase-fixture',date:day,totalCents:800,items:[{foodId:sku.id,quantity:400,costCents:800}]});
 addFood(phone,{date:day,name:sku.name,meal:'晚餐',portion:'100 g',kcal:60,foodId:sku.id,
  batchId:'purchase-fixture-0',stockQty:100});
 const corrected=revisePurchase(phone,purchase.id,{totalCents:1200,items:[{foodId:sku.id,quantity:400,costCents:1200,batchId:'purchase-fixture-0'}]}).next;
 const initial=plan(phone,corrected);
 const choices=choicesFor(initial,'take');
 const state=clean(plan(phone,corrected,choices));
 assert.equal(state.local.purchases.length,1);
 assert.equal(state.local.batches.length,1);
 assert.equal(state.local.stockMoves.length,2);
 assert.equal(inventoryWithMoves(state)[0].qty,300);
 assert.equal(state.local.foods[0].cost,3);
 assert.equal(plan(state,corrected).changed,false);
});

test('external JSON round trip retains phone additions, removals, updated totals and explicit input version',()=>{
 const raw=legacy([row('旧合成记录',50,100,{id:'external-original'})],{energy_balance:[{
  饮食日期:day,'摄入(kcal)':100,'估计总消耗(kcal)':2300,结算状态:'已封账'
 }]});
 const phone=clean(plan(newState(),raw,{}));
 const original=events(phone,'foods')[0];
 deleteEvent(phone,'foods',original.id);
 logFood(phone,'手机晚餐',100,300,'晚餐');
 recordEvent(phone,'activities',{date:day,name:'合成骑行',km:8,kcal:200,includedInBase:false});
 const exported=createSyncPackage(phone,{id:'phone-synthetic',version:'0.9.9',now:'2030-11-21T01:00:00Z'});
 assert.equal(exported.anchor.sources['external:health_tracker'].version,'301120.1');
 assert.ok(exported.changes.some(item=>item.action==='delete'));
 const base=externalBase(raw).state;
 const check=plan(base,exported);
 const applied=clean(plan(base,exported,choicesFor(check,'take')));
 assert.equal(energyForDay(applied,day,tomorrow).tdee,2500);
 const output=projectExternalLedger(raw,applied,{version:'301121.1',id:'external-synthetic',today:tomorrow});
 assert.equal(output.handoff_version,'301121.1');
 assert.deepEqual(output.tables.food_events.map(item=>item['食物/饮品']),['手机晚餐']);
 assert.equal(output.tables.daily_summaries[0].kcal,300);
 const repeat=externalBase(output);
 assert.equal(plan(repeat.state,exported).changed,false);
});

test('returning a phone package uses its shared anchor to retain a newer external correction and apply a phone-only correction',()=>{
 const raw=legacy([row('合成米粉',120,200,{id:'rice'}),
  row('合成牛肉',60,100,{id:'beef'})]);
 const synced=clean(plan(newState(),raw));
 const beef=events(synced,'foods').find(item=>item.externalId==='beef');
 addFood(synced,{...beef,status:'actual',kcal:120,portion:'72 g'},beef.id);
 logFood(synced,'手机新增晚餐',100,150,'晚餐',tomorrow);
 const later=legacy([row('合成米粉',130,220,{id:'rice'}),
  row('合成牛肉',60,100,{id:'beef'})],{},'301120.2');
 const base=externalBase(later);
 const exported=createSyncPackage(synced,{id:'fixture-portable',version:'0.9.9'});
 const result=clean(planHealthMerge(base.state,importSource(exported),{baseSource:base.sourceId}));
 assert.equal(dayIntake(result,day).totals.kcal,340);
 assert.equal(dayIntake(result,tomorrow).totals.kcal,150);
});

test('older backups with null optional health tables can merge without replacing live records',()=>{
 const phone=newState();
 logFood(phone,'保留本机记录',100,100);
 const old=newState();
 old.local.weights=null;
 old.local.stockMoves=null;
 old.local.purchases=null;
 old.legacy.rules=null;
 old.legacy.daily=null;
 old.settings.sodiumTarget=null;
 const state=clean(plan(phone,combinedBackup(old,freshData())));
 assert.equal(events(state,'foods')[0].name,'保留本机记录');
 assert.equal(state.settings.sodiumTarget,phone.settings.sodiumTarget);
});

test('a reordered tidy baseline matches archived names and duplicate copies without adding historical intake',()=>{
 const a=row('合成米饭 100g',100,200),b=row('合成鱼肉 150g',150,240);
 const archived=row('日期未知的合成方案',50,100,{date:'',status:'计划'});
 const raw=legacy([a,b,{...a},archived],{daily_summaries:[{日期:day,kcal:640}]});
 const tidy=structuredClone(raw);
 tidy.handoff_version+='-整理';
 tidy.tables.food_events=[b,a,archived,a].map(original=>({...original,
  '食物/饮品':original['食物/饮品'].replace(/ \d+g$/,''),
  '原食物/饮品名称':original['食物/饮品']}));
 const phone=normalizeLedger(tidy);
 assert.deepEqual(projectExternalLedger(raw,phone,{id:'test-fixture',version:'301120.2',today:tomorrow}).tables,raw.tables);
 logFood(phone,'合成手机独有晚餐',100,160,'晚餐',tomorrow);
 for(const [current,source] of [[phone,raw],[externalBase(raw).state,phone]]){
  const preview=plan(current,source);
  const next=clean(preview);
  assert.equal(preview.rows.filter(change=>change.kind==='foods'&&change.status==='same').length,4);
  assert.equal(events(next,'foods').length,5);
  assert.equal(dayIntake(next,day).totals.kcal,640);
  assert.equal(dayIntake(next,tomorrow).totals.kcal,160);
  assert.equal(plan(next,source).changed,false);
 }
 const portable=createSyncPackage(phone,{id:'tidy-fixture',version:'0.9.10'});
 const merged=clean(plan(externalBase(raw).state,portable));
 assert.equal(events(merged,'foods').length,5);
 assert.equal(plan(merged,portable).changed,false);
});

test('same-edition unknown inherited rows cannot be silently added or approved as independent records',()=>{
 const master=legacy([row('合成原名',100,200)]);
 const phone=importSource(master).health;
 const mislabeled=structuredClone(master);
 mislabeled.tables.food_events[0]['食物/饮品']='无原名字段的整理副本';
 const preview=plan(phone,mislabeled);
 const issue=preview.unresolved.find(change=>change.kind==='foods');
 assert.equal(issue.status,'suspect');
 assert.ok(!issue.options.some(choice=>choice.value==='separate'));
 const kept=clean(plan(phone,mislabeled,choicesFor(preview)));
 assert.equal(dayIntake(kept,day).totals.kcal,200);
 assert.equal(events(kept,'foods').length,1);
 assert.equal(plan(kept,mislabeled).changed,false);
});

test('edits on both sides of a shared original do not overwrite each other, even when the base has no ID',()=>{
 const raw=legacy([row('合成可更正食物',100,200)]);
 const a=importSource(raw).health,b=importSource(raw).health;
 addFood(a,{...a.legacy.foods[0],status:'actual',portion:'110 g',kcal:220},a.legacy.foods[0].id);
 addFood(b,{...b.legacy.foods[0],status:'actual',portion:'120 g',kcal:240},b.legacy.foods[0].id);
 const conflict=plan(a,b);
 assert.equal(conflict.unresolved.find(change=>change.kind==='foods').status,'conflict');
 assert.equal(dayIntake(clean(plan(a,b,choicesFor(conflict))),day).totals.kcal,220);
});

test('business verification rejects unreviewed historical intake, TDEE, weights and stock changes',()=>{
 const raw=legacy([row('合成面条',100,200)],{
  weight_events:[{日期:day,数值:80,纳入趋势:'是'}],
  energy_balance:[{饮食日期:day,'估计总消耗(kcal)':2300,'摄入(kcal)':200}],
  food_inventory:[{食品ID:'fixture-pack',名称:'合成面条',库存值:5,库存单位:'包'}]
 });
 const state=importSource(raw).health;
 const allowed=plan(state,raw).authorization;
 const changed=structuredClone(state);
 changed.legacy.energy[day].tdee=2800;
 changed.legacy.energy[day].intake=400;
 changed.legacy.weights[0].kg=81;
 changed.legacy.inventory[0].qty=3;
 changed.legacy.foods.push({...changed.legacy.foods[0],id:'unreviewed'});
 const errors=verifyMergeConsistency(state,changed,allowed).join('\n');
 for(const expectation of [/饮食发生未经预览/,/历史营养基线/,/历史总消耗/,/体重发生未经预览/,/库存期初/])
  assert.match(errors,expectation);
});

test('zero-change projection retains every original table and incremental projection patches only affected fields',()=>{
 const first={...row('合成旧记录',100,200,{status:'已吃'}),追溯:'原始凭据'};
 const historical={日期:day,kcal:200,记录完整性:'历史质量',说明:'原始摘要'};
 const energy={饮食日期:day,'摄入(kcal)':200,'估计总消耗(kcal)':2137.6,
  '当日缺口(kcal)':1937.6,结算状态:'临时封账',依据:'历史手表'};
 const raw=legacy([first,row('无日期的旧方案',70,100,{date:'',status:'计划'})],{
  daily_summaries:[historical],energy_balance:[energy],
  weight_events:[{日期:'',数值:88,状态:'保留档案'}],
  activity_events:[{日期:'',项目:'历史无日期记录',来源:'原始'}],
  rules:[{Key:'old',状态:'inactive',当前值:'历史'}],
  inventory_transactions_audit:[{id:'audit-demo',food_id:'sku',date:day,qty_delta:-1,source:'原始审计'}]
 });
 const version='301121.1',id='fixture-ledger';
 const state=externalBase(raw).state;
 assert.deepEqual(projectExternalLedger(raw,state,{version,id,today:tomorrow}).tables,raw.tables);
 const original=events(state,'foods')[0];
 addFood(state,{...original,status:'actual',portion:'120 g',kcal:240},original.id);
 const extra=logFood(state,'合成补报',55,80,'晚餐',tomorrow);
 const patched=projectExternalLedger(raw,state,{version,id,today:tomorrow});
 assert.equal(patched.tables.food_events[0].状态,'已吃');
 assert.equal(patched.tables.food_events[0].追溯,first.追溯);
 assert.deepEqual(patched.tables.food_events[1],raw.tables.food_events[1]);
 assert.equal(patched.tables.food_events[0].kcal,240);
 assert.equal(patched.tables.daily_summaries.length,2);
 assert.equal(patched.tables.daily_summaries[0].说明,'原始摘要');
 assert.deepEqual(patched.tables.energy_balance,[{...energy,'摄入(kcal)':240,'当日缺口(kcal)':1897.6}]);
 for(const name of ['weight_events','activity_events','rules','inventory_transactions_audit'])
  assert.deepEqual(patched.tables[name],raw.tables[name]);
 const reopened=externalBase(patched).state;
 assert.deepEqual(projectExternalLedger(patched,reopened,{version,id,today:tomorrow}).tables,patched.tables);
 addFood(reopened,{...original,status:'actual',portion:'125 g',kcal:250},original.id);
 deleteEvent(reopened,'foods',extra.id);
 const roundTrip=projectExternalLedger(patched,reopened,{version:'301121.2',id,today:tomorrow});
 assert.equal(roundTrip.tables.food_events[0].kcal,250);
 assert.equal(roundTrip.tables.food_events.length,2);
 assert.equal(roundTrip.tables.energy_balance.length,1);
});

test('real audit column types and unresolved bottle weighing survive merge without a fabricated deduction',async()=>{
 const raw=legacy([],{
  food_inventory:[{食品ID:'bottle-fixture',名称:'合成瓶装酱',库存值:1,库存单位:'瓶',标准份量:'每100g'}],
  inventory_transactions_audit:[{id:'audit-fixture',food_id:'bottle-fixture',date:day,event:'盘点',
   qty_delta:-1,unit:'瓶',remaining_balance:1,finance_id:'order-fixture',food_event_already_recorded:true}]
 });
 const phone=importSource(raw).health;
 const food=addFood(phone,{name:'合成瓶装酱',foodId:'bottle-fixture',date:tomorrow,meal:'晚餐',portion:'30 g',kcal:60,
  weighing:{beforeGross:330,afterGross:300}});
 const target=externalBase(raw).state;
 const preview=plan(target,phone);
 assert.ok(preview.unresolved.some(change=>change.kind==='stockLinks'));
 const merged=clean(plan(target,phone,choicesFor(preview)));
 assert.equal(dayIntake(merged,tomorrow).totals.kcal,60);
 assert.equal(merged.sync.pendingStock[0].id,food.id);
 assert.equal(merged.local.stockMoves.length,0);
 assert.equal(inventoryWithMoves(merged)[0].qty,1);
 assert.equal(plan(merged,phone).changed,false);
 const audit=await readAppData({readHealth:()=>merged},null,{dataset:'sync_catalog',id:'audit-fixture',date:null,query:'',fields:[]});
 assert.equal(audit.rows[0].quantityDelta,-1);
 assert.equal(audit.rows[0].financeId,'order-fixture');
 assert.deepEqual(audit.rows[0].original,raw.tables.inventory_transactions_audit[0]);
});

test('adopting an external stock count retains later local consumption and never replays older movements',()=>{
 const inventory={食品ID:'case-milk',名称:'合成盒装奶',库存值:10,库存单位:'盒',标准份量:'每盒'};
 const base=legacy([],{food_inventory:[inventory]});
 const phone=importSource(base).health;
 localStockChange(phone,{foodId:inventory.食品ID,date:day,delta:-1});
 localStockChange(phone,{foodId:inventory.食品ID,date:tomorrow,delta:-2});
 const fresh=legacy([],{food_inventory:[{...inventory,库存值:8}]},'301120.2');
 const review=plan(phone,fresh);
 assert.ok(review.unresolved.some(change=>change.kind==='inventory'));
 const merged=clean(plan(phone,fresh,choicesFor(review,'take')));
 assert.equal(inventoryWithMoves(merged)[0].qty,6);
 assert.deepEqual(merged.local.stockMoves,phone.local.stockMoves);
 assert.equal(plan(merged,fresh).changed,false);
});
