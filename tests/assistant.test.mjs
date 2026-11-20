import {modelRequest} from '../ai/responses.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newState, validDate, validateAppState, inventoryWithMoves, dayIntake, energyForDay, cycleForDate} from '../health/core.mjs';
import {confirmItems,resolveItem} from '../health/candidates.mjs';
import {matches,resultSchema,validInput,assistantInput} from '../health/contract.mjs';
import {accountKeys,privateAccount} from '../account.mjs';
import nacl from '../vendor/nacl-fast.min.js';
import {randomBytes} from 'node:crypto';

const nutrition={kcal:100,protein:10,carbs:8,fat:3,sodium:20};
const part={name:'样品',sku:null,amount:2,unit:'包',action:'eat',basisAmount:100,basisUnit:'g',
  packageSize:50,packageUnit:'g',nutrients:nutrition,uncertainty:'合成标签'};
const date='2030-01-01';
test('same browser keeps two account ledgers encrypted and guest data intact',async()=>{
  const values=new Map([['old','guest']]);
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const a=privateAccount(await accountKeys(randomBytes(32).toString('hex')),nacl,storage);
  const b=privateAccount(await accountKeys(randomBytes(32).toString('hex')),nacl,storage);
  a.finance.setItem('old','account A');
  assert.equal(b.finance.getItem('old'),null);
  b.finance.setItem('old','account B');
  assert.equal(a.finance.getItem('old'),'account A');
  assert.equal(values.get('old'),'guest');
  assert.ok(![...values.values()].includes('account A'));
  assert.throws(()=>b.open('health',a.seal('health',{value:1})));
  assert.throws(()=>a.open('other',a.seal('health',{value:1})));
});
test('empty ledger can receive a packaged SKU, reuse label and deduct locally',()=>{
  const start=newState();
  const stocked=confirmItems(start,[{...part,action:'add',amount:5}],date,'午餐');
  const sku=inventoryWithMoves(stocked)[0];
  const c={...part,sku:sku.id,nutrients:{...nutrition,kcal:999},packageSize:999};
  assert.deepEqual(resolveItem(stocked,c).nutrition,nutrition);
  const eaten=confirmItems(stocked,[c],date,'午餐');
  assert.equal(inventoryWithMoves(eaten)[0].qty,3);
  assert.equal(dayIntake(eaten,date).totals.kcal,100);
  assert.equal(inventoryWithMoves(stocked)[0].qty,5);
  assert.throws(()=>confirmItems(stocked,[c,{...c,amount:20}],date,'午餐'));
  assert.equal(stocked.local.foods.length,0);
  const plan=confirmItems(eaten,[{...c,action:'plan'}],date,'晚餐');
  assert.equal(inventoryWithMoves(plan)[0].qty,3);
  assert.equal(dayIntake(plan,date).totals.kcal,100);
});
test('explicit gram and mL units require a defensible conversion',()=>{
  const state=newState();
  state.legacy.inventory.push({id:'milk',name:'牛奶',active:true,standard:'每100mL',unit:'mL',nutritionBasis:'per100ml',qty:1000,nutrition});
  assert.throws(()=>confirmItems(state,[{...part,sku:'milk',amount:533,unit:'g'}],date,'早餐'));
  assert.equal(confirmItems(state,[{...part,sku:'milk',amount:533,unit:'mL'}],date,'早餐').local.foods[0].nutrition.kcal,533);
});
test('requests never serialize the health snapshot, financial data or historical identifiers',()=>{
  const state=newState();state.legacy.sourceSnapshot={privateField:'local-only'};
  const data=assistantInput({mode:'entry',text:'测试',state});
  assert.ok(validInput(data));assert.equal(data.summary,null);
  assert.ok(!JSON.stringify(data).includes('local-only'));
  const finance=assistantInput({mode:'finance',text:'测试',date});
  finance.categories=[{id:'fixture-id',name:'本地私有分类',type:'expense'}];
  assert.deepEqual(JSON.parse(modelRequest(finance).input[0].content[0].text),{mode:'finance',text:'测试',date});
  const plan=assistantInput({mode:'plan',text:'测试'});
  plan.catalog=[{id:'fixture-id',name:'本地私有食品',unit:'g',standard:'100g',basis:'per100g',qty:100,price:5,priceBasis:'g',nutrients:null}];
  assert.deepEqual(JSON.parse(modelRequest(plan).input[0].content[0].text),{mode:'plan',text:'测试'});
  assert.ok(validInput(assistantInput({mode:'plan',text:'只用我输入的食材'})));
  assert.ok(!validInput({...data,ledger:state}));assert.ok(!validInput({...data,photo:'https://example.invalid'}));
  assert.ok(!matches(resultSchema,{items:[{...part,amount:-1}],note:''}));
});
test('six-day boundary, next-day closing and missing days, with imported energy-only baseline',()=>{
  const state=newState(); state.settings.cycleAnchor=date;state.settings.cycleDays=6;
  assert.equal(cycleForDate(state,'2030-01-07','2030-01-07').start,'2030-01-07');
  state.legacy.energy[date]={intake:800,tdee:null};
  const next=confirmItems(state,[part],date,'晚餐');
  assert.equal(energyForDay(next,date,date).closed,false);
  assert.equal(energyForDay(next,date,'2030-01-03').intake,900);
  assert.equal(energyForDay(next,date,'2030-01-03').tdee,2200);
  assert.equal(cycleForDate(next,date,'2030-01-03').unreported,1);
  assert.ok(!validDate('2030-02-30')); assert.ok(!validateAppState({...state,local:{foods:[]}}));
});
