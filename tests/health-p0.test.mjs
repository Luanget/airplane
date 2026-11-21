import test from 'node:test';
import assert from 'node:assert/strict';
import {addFood,batchBalances,cycleForDate,dayIntake,deleteEvent,energyForDay,events,inventoryWithMoves,localStockChange,newState,normalizeLedger,recordEvent,setDayCompleteness,validateAppState} from '../health/core.mjs';
import {addBatch,convertCookingWeight,measuredGrams,saveSku,splitBatch} from '../health/inventory.mjs';
import {combinedBackup,unpackBackup} from '../health/backup.mjs';

const day='2030-05-05';
const food={name:'合成餐食',date:day,meal:'午餐',kcal:100,protein:12,carbs:0,fat:2,sodium:40};
test('historical corrections subtract and replace inside the baseline summary, including cross-day edits',()=>{
 const raw={tables:{food_events:[{'日期':day,'状态':'实际','食物/饮品':'样例','kcal':100}],weight_events:[],food_inventory:[],
  daily_summaries:[{'日期':day,kcal:150}],cycle_parameters:{'周期天数':5,'周期目标缺口':4100,'日摄入参考':1950,'起始日期':day}}};
 const s=normalizeLedger(raw);
 assert.equal(s.settings.cycleDays,5);assert.equal(s.settings.cycleTarget,4100);assert.equal(s.settings.calorieTarget,1950);
 const id=events(s,'foods')[0].id;
 addFood(s,{...food,kcal:180,date:'2030-05-06'},id);
 assert.equal(dayIntake(s,day).totals.kcal,50);
 assert.equal(dayIntake(s,'2030-05-06').totals.kcal,180);
 assert.equal(s.legacy.sourceSnapshot.tables.food_events[0].kcal,100);
 assert.equal(s.local.stockMoves.length,0);
 deleteEvent(s,'foods',id);assert.equal(dayIntake(s,'2030-05-06').totals.kcal,null);
 assert.ok(validateAppState(s));
});
test('chicken batch split and meal edits conserve mass and actual cost; milk tare and cooking conversion are explicit',()=>{
 const s=newState();
 const sku=saveSku(s,{name:'合成鸡胸',unit:'g',basisUnit:'g',basisAmount:100});
 const source=addBatch(s,{foodId:sku.id,date:day,quantity:600,costCents:3001,raw:600,cooked:450});
 const [split]=splitBatch(s,{batchId:source.id,date:day,quantity:200,count:3});
 assert.equal(batchBalances(s).reduce((sum,b)=>sum+b.remaining,0),600);
 assert.equal(batchBalances(s).filter(b=>b.parent).reduce((sum,b)=>sum+b.costCents,0),3001);
 assert.equal(convertCookingWeight(150,'cooked','raw',source.raw,source.cooked),200);
 assert.equal(measuredGrams({before:940,after:407}),533);
 assert.equal(measuredGrams({before:605,tare:72}),533);
 assert.throws(()=>measuredGrams({before:20,tare:30}));
 const plan=addFood(s,{...food,foodId:sku.id,stockQty:200,batchId:split.id,status:'plan'});
 assert.equal(inventoryWithMoves(s)[0].qty,600);
 const actual=addFood(s,{...food,foodId:sku.id,stockQty:200,batchId:split.id},plan.id);
 assert.equal(inventoryWithMoves(s)[0].qty,400);
 assert.equal(actual.cost,split.costCents/100);
 assert.throws(()=>addFood(s,{...food,foodId:sku.id,stockQty:300,batchId:split.id},actual.id));
 assert.equal(inventoryWithMoves(s)[0].qty,400);
 deleteEvent(s,'foods',actual.id);assert.equal(inventoryWithMoves(s)[0].qty,600);
 localStockChange(s,{foodId:sku.id,delta:450,count:true,date:day});assert.equal(inventoryWithMoves(s)[0].qty,450);
});
test('an unknown intake does not close a day; watch total suppresses duplicate activity calories',()=>{
 const s=newState(),tomorrow='2030-05-06';s.settings.cycleAnchor=day;
 const row=addFood(s,{...food,kcal:''});
 assert.equal(energyForDay(s,day,tomorrow).closed,false);
 recordEvent(s,'activities',{date:day,kcal:300,includedInBase:false});
 recordEvent(s,'activities',{date:day,kcal:2400,energyKind:'total'});
 addFood(s,food,row.id);
 assert.equal(energyForDay(s,day,day).closed,false);
 assert.equal(energyForDay(s,day,tomorrow).tdee,2400);
 assert.equal(cycleForDate(s,day,tomorrow).deficit,0);
 setDayCompleteness(s,day,'complete');
 assert.equal(cycleForDate(s,day,tomorrow).deficit,2300);
});
test('combined backup accepts partial choices and requires a valid source ledger',()=>{
 const s=newState();
 assert.deepEqual(unpackBackup(combinedBackup(s,null)),{health:s,finance:null});
 assert.throws(()=>unpackBackup({format:'airplane-combined-v1',finance:{transactions:[]}}));
});

test('a historical supplement cannot use a batch acquired later',()=>{
 const s=newState();
 const sku=saveSku(s,{name:'合成食品',unit:'g',basisUnit:'g',basisAmount:100});
 addBatch(s,{foodId:sku.id,date:'2030-05-06',quantity:400});
 assert.throws(()=>addFood(s,{...food,foodId:sku.id,stockQty:100}));
 assert.equal(inventoryWithMoves(s)[0].qty,400);
});
