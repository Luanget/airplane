import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLedger, dayIntake, cycleForDate, energyForDay, addFood, inventoryWithMoves, localStockChange, newState, weightTrend, isActualStatus, carbReference} from '../health/core.mjs';

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
