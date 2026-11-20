import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,inventoryWithMoves,addFood,batchBalances} from '../health/core.mjs';
import {saveSku,splitBatch} from '../health/inventory.mjs';
import {recordPurchase,revisePurchase,purchaseForTransaction,orderBatchId} from '../health/purchases.mjs';
import {projectedExpense} from '../health/purchase-sync.mjs';
import {addLowStock,setShoppingItem,settleShopping} from '../health/shopping.mjs';
import {displayDay,localClock,localDate,normalizeClock} from '../calendar.mjs';

const date='2030-05-04';
function fixture(){
 const state=newState(),sku=saveSku(state,{name:'合成食材',unit:'g',basisUnit:'g',basisAmount:100,minimum:200});
 const tx={id:'expense-fixture',type:'expense',amount:30,date,time:'08:05',note:'测试采购',budgetExcluded:true,categoryId:'test-cat'};
 const order=recordPurchase(state,{id:'purchase-fixture',date,time:'08:05',financeId:tx.id,note:'测试采购',totalCents:3000,
  items:[{foodId:sku.id,quantity:600,costCents:3000,expires:null}]},tx);
 return {state,sku,order,tx,batchId:orderBatchId(order,order.items[0],0)};
}
test('purchase correction preserves IDs, recalculates descendant batch and meal cost, and patches the existing expense',()=>{
 const {state,sku,order,tx,batchId}=fixture();
 const [split]=splitBatch(state,{date,batchId,quantity:200,count:2});
 const meal=addFood(state,{date,name:'合成餐',foodId:sku.id,batchId:split.id,stockQty:100});
 assert.equal(meal.cost,5);
 const updated={...order,totalCents:3600,note:'更正采购',time:'09:10',
  items:[{...order.items[0],batchId,quantity:600,costCents:3600}]};
 const result=revisePurchase(state,order.id,updated);
 assert.equal(result.next.local.foods[0].cost,6);
 assert.equal(result.next.local.stockMoves.filter(m=>m.linkedFoodId===meal.id).length,1);
 assert.equal(inventoryWithMoves(result.next)[0].qty,500);
 assert.equal(batchBalances(result.next).find(b=>b.id===split.id).costCents,1200);
 assert.equal(result.order.items[0].batchId,batchId);
 assert.equal(result.order.history[0].totalCents,3000);
 const change=projectedExpense(order,result.order,tx);
 assert.equal(change.after.id,tx.id);
 assert.equal(change.after.amount,36);assert.equal(change.after.time,'09:10');
 assert.equal(change.after.budgetExcluded,true);assert.equal(change.after.categoryId,'test-cat');
 assert.throws(()=>revisePurchase(state,order.id,{...updated,items:[{...updated.items[0],quantity:399}]}),/已使用/);
 assert.throws(()=>revisePurchase(state,order.id,null),/已有摄入/);
 assert.equal(inventoryWithMoves(state)[0].qty,500);
});
test('cancelling an unused order rolls back an unconsumed split tree exactly once',()=>{
 const {state,order,tx,batchId}=fixture();
 splitBatch(state,{date,batchId,quantity:100,count:3});
 const {next}=revisePurchase(state,order.id,null);
 assert.equal(inventoryWithMoves(next)[0].qty,0);assert.equal(next.local.batches.length,0);
 assert.equal(next.local.stockMoves.length,0);assert.equal(next.local.purchases[0].status,'cancelled');
 assert.equal(purchaseForTransaction(next,tx.id),undefined);
 assert.deepEqual(projectedExpense(order,null,tx),{id:tx.id,before:tx,after:null});
 assert.throws(()=>revisePurchase(next,order.id,null),/已撤销/);
});
test('low-stock suggestions merge once and only confirmed quantities leave the shopping list',()=>{
 const {state,sku}=fixture(),s=newState();
 s.local.inventory=[{...sku,qty:100}];
 addLowStock(s,date);addLowStock(s,date);
 assert.equal(s.local.shoppingList.length,1);
 setShoppingItem(s,sku.id,300,true);
 settleShopping(s,[{foodId:sku.id,quantity:125}],new Set([sku.id]));
 assert.deepEqual(s.local.shoppingList,[{foodId:sku.id,quantity:175,selected:false}]);
});
test('shared calendar uses device-local dates and normalizes legacy time strings without guessing blanks',()=>{
 const local=new Date(2030,4,4,0,5);
 assert.equal(localDate(local),date);
 assert.equal(localClock(local),'00:05');
 assert.equal(displayDay(date,true),'2030年5月4日');
 assert.equal(normalizeClock('下午 6:07'),'18:07');
 assert.equal(normalizeClock('8:05:00'),'08:05');
 assert.equal(normalizeClock(''),'');
 assert.equal(normalizeClock('24:30'),'');
});
