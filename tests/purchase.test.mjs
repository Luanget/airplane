import test from 'node:test';
import assert from 'node:assert/strict';
import {newState,inventoryWithMoves} from '../health/core.mjs';
import {saveSku} from '../health/inventory.mjs';
import {recordPurchase,purchaseTransactionId,cents} from '../health/purchases.mjs';

test('receipt allocation, existing expense association, unknown cost and idempotent inventory intake',()=>{
 const state=newState();
 const item=saveSku(state,{name:'合成食品',unit:'包',basisUnit:'包',basisAmount:1});
 const date='2030-05-05';
 const tx={type:'expense',id:'test-fin',amount:12,date};
 const order={id:'test-order',totalCents:cents(tx.amount),financeId:tx.id,date,note:'合成',
  items:[{foodId:item.id,quantity:2,costCents:500},{foodId:item.id,quantity:1,costCents:null}]};
 assert.throws(()=>recordPurchase(state,order,{...tx,amount:11}));
 assert.equal(inventoryWithMoves(state)[0].qty,0);
 const saved=recordPurchase(state,order,tx);
 assert.equal(purchaseTransactionId(saved),tx.id);
 assert.equal(state.local.batches[1].costCents,null);
 assert.equal(inventoryWithMoves(state)[0].qty,3);
 assert.equal(recordPurchase(state,order,tx),saved);
 assert.equal(inventoryWithMoves(state)[0].qty,3);
 assert.throws(()=>recordPurchase(state,{...order,id:'test-other'},tx));
});
