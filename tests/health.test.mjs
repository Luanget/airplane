import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLedger, recoverLegacyPortions, batchBalances, availableBatches, deleteEvent, dayIntake, cycleForDate, energyForDay, addFood, inventoryWithMoves, localStockChange, newState, weightTrend, isActualStatus, carbReference} from '../health/core.mjs';
import {registerPortions} from '../health/inventory.mjs';

const synthetic = () => ({
  tables: {
    food_events: [
      {'日期':'2024-01-02','时间':'12:00','餐次':'午餐','食物/饮品':'示例午餐','份量/重量':'1份','状态':'已吃','kcal':600,'蛋白质(g)':40,'碳水(g)':60,'脂肪(g)':20,'钠(mg)':200},
      {'日期':'2024-01-02','餐次':'晚餐','食物/饮品':'仅为计划','状态':'计划','kcal':900}
    ],
    weight_events: [
      {'日期':'2024-01-01','数值':80,'纳入趋势':'是'},
      {'日期':'2024-01-02','数值':79.7,'纳入趋势':'是'}
    ],
    activity_events: [],
    food_inventory: [{'食品ID':'test-food','名称':'测试食物','库存值':5,'库存单位':'包','标准份量':'每份','kcal':100,'P(g)':10}],
    daily_summaries: [{'日期':'2024-01-02','kcal':600,'蛋白质(g)':40,'碳水(g)':60,'脂肪(g)':20,'钠(mg)':200}],
    energy_balance: [{'饮食日期':'2024-01-02','摄入(kcal)':600,'估计总消耗(kcal)':2400,'当日缺口(kcal)':1800,'结算状态':'已封账'}],
    cycle_parameters:{'周期日期':'2024-01-01–2024-01-06','无运动基线TDEE':2400,'周期天数':6,'6天目标缺口':5400},
    rules: []
  }
});

test('example state contains neither financial storage keys nor real private records',()=>{
 const raw=JSON.stringify(newState());
 for(const k of ['airplane-pwa-v1','airplane-pwa-recovery-v1','airplane-transaction-draft-v1']) assert.equal(raw.includes(k),false);
 assert.equal(newState().legacy.foods.length,0);
});

test('opening portions restore only the matching current snapshot and never add stock',()=>{
 const raw=synthetic();
 raw.updated_at='2024-01-03T16:00:00+08:00';
 raw.tables.food_inventory=[{'食品ID':'example-portions','名称':'合成分装食品','库存值':620,'库存单位':'g熟重',
  '库存基准':'余3袋 [300,200,250] | 余3袋 [180,220,220]','库存份数估算':3}];
 const state=normalizeLedger(raw),foodId='example-portions',date='2024-01-03';
 const portions=availableBatches(state,foodId,date);
 assert.deepEqual(portions.map(b=>b.remaining),[180,220,220]);
 assert.equal(inventoryWithMoves(state)[0].qty,620);
 const meal={date,meal:'午餐',name:'合成分装食品',foodId,stockQty:220,batchId:portions[2].id};
 const saved=addFood(state,meal);
 assert.equal(inventoryWithMoves(state)[0].qty,400);
 assert.deepEqual(availableBatches(state,foodId,date).map(b=>b.id),portions.slice(0,2).map(b=>b.id));
 assert.equal(availableBatches(state,foodId,date,saved.id).at(-1).remaining,220);
 deleteEvent(state,'foods',saved.id);
 assert.equal(inventoryWithMoves(state)[0].qty,620);
 assert.equal(batchBalances(recoverLegacyPortions(state),foodId).length,3);
 const old=normalizeLedger(raw);
 delete old.legacy.portionsRecovered;
 delete old.local.batches;
 localStockChange(old,{foodId,delta:-50,date});
 assert.equal(batchBalances(recoverLegacyPortions(old),foodId).length,0);
 assert.equal(inventoryWithMoves(old)[0].qty,570);
 const inconsistent=structuredClone(raw);
 inconsistent.tables.food_inventory[0]['库存值']=619;
 assert.equal(batchBalances(normalizeLedger(inconsistent)).length,0);
});

test('different portions reclassify loose stock without changing its quantity',()=>{
 const state=normalizeLedger(synthetic()),foodId='test-food',date='2024-01-03';
 assert.throws(()=>registerPortions(state,{foodId,date,quantities:[1,5]}),/余量/);
 assert.equal(state.local.stockMoves.length,0);
 registerPortions(state,{foodId,date,quantities:[1,1.5,2]});
 assert.deepEqual(batchBalances(state,foodId).map(batch=>batch.remaining),[1,1.5,2]);
 assert.equal(inventoryWithMoves(state)[0].qty,5);
});
test('plans and discarded records do not count as intake',()=>{
 assert.equal(isActualStatus('计划'),false);
 assert.equal(isActualStatus('作废'),false);
 assert.equal(isActualStatus('计划已被实际覆盖'),false);
 assert.equal(isActualStatus('已吃'),true);
 const state=normalizeLedger(synthetic());
 assert.equal(dayIntake(state,'2024-01-02').totals.kcal,600);
 assert.equal(state.legacy.foods.filter(x=>x.actual).length,1);
});
test('historical import applies cycle parameters, closes on next day',()=>{
 const s=normalizeLedger(synthetic());
 assert.equal(s.settings.cycleDays,6);
 assert.equal(s.settings.cycleTarget,5400);
 assert.equal(s.settings.baselineTdee,2400);
 assert.equal(energyForDay(s,'2024-01-02','2024-01-02').closed,false);
 assert.equal(energyForDay(s,'2024-01-02','2024-01-03').deficit,1800);
 assert.equal(cycleForDate(s,'2024-01-03','2024-01-03').deficit,1800);
 assert.equal(weightTrend(s).last.kg,79.7);
});
test('legacy nutrition preferences set the ordinary-day carbohydrate reference',()=>{
 const raw=synthetic();
 raw.tables.rules.push({Key:'04_diet_targets_preferences',状态:'active',当前值:'普通日约1800kcal；蛋白质125–145g；脂肪尽量≥40–55g'});
 const {settings}=normalizeLedger(raw);
 assert.equal(settings.calorieTarget,1800);
 assert.equal(settings.fatMin,40);
 assert.deepEqual(carbReference(settings),{low:195,high:215});
 raw.tables.cycle_parameters.calorieTarget=2200;
 assert.equal(normalizeLedger(raw).settings.calorieTarget,2200);
 assert.equal(carbReference({...settings,calorieTarget:500}),null);
});
test('confirmed additions adjust energy, plans cannot reduce stock',()=>{
 const s=normalizeLedger(synthetic());
 addFood(s,{date:'2024-01-02',meal:'晚餐',name:'计划食物',kcal:200,protein:10,carbs:20,fat:5,sodium:100,foodId:'test-food',stockQty:1,status:'plan'});
 assert.equal(inventoryWithMoves(s)[0].qty,5);
 addFood(s,{date:'2024-01-02',meal:'晚餐',name:'实际食物',kcal:200,protein:10,carbs:20,fat:5,sodium:100,foodId:'test-food',stockQty:1,status:'actual'});
 assert.equal(inventoryWithMoves(s)[0].qty,4);
 assert.equal(dayIntake(s,'2024-01-02').totals.kcal,800);
 assert.equal(energyForDay(s,'2024-01-02','2024-01-03').deficit,1600);
});
test('stock changes validate overdrafts',()=>{
 const s=normalizeLedger(synthetic());
 assert.throws(()=>localStockChange(s,{foodId:'test-food',delta:-6,date:'2024-01-02',reason:'使用'}));
 localStockChange(s,{foodId:'test-food',delta:-2,date:'2024-01-02',reason:'使用'});
 assert.equal(inventoryWithMoves(s)[0].qty,3);
});
