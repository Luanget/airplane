import {freshData} from '../finance-storage.mjs';
import {newState} from '../health/core.mjs';
import {saveSku} from '../health/inventory.mjs';
import {action,proposal} from './health-action-fixture.mjs';

export function orderState(today){
 const state=newState();
 state.settings.cycleAnchor=today;
 saveSku(state,{id:'fixture-milk',name:'合成脱脂牛奶',unit:'mL',basisAmount:100,basisUnit:'mL',
  packageSize:1000,packageUnit:'mL',packageKind:'盒',kcal:35,protein:3.5});
 return state;
}
export function orderFinance(today){
 const ledger=freshData();
 ledger.categories.find(row=>row.id==='default-1').hidden=true;
 ledger.categories.push(
  {id:'fixture-groceries',name:'家庭食材',type:'expense',hidden:false,budgetExcludedDefault:true},
  {id:'fixture-shipping',name:'配送费',type:'expense',hidden:false});
 ledger.transactions.push({id:'fixture-previous-expense',type:'expense',amount:8,date:today,
  categoryId:'fixture-groceries',categoryName:'家庭食材',note:'合成商店 · 合成脱脂牛奶'});
 ledger.budgets[today.slice(0,7)]=421;
 return ledger;
}
export function item(name,kind,patch={}){
 return {name,kind,quantity:1,unit:'个',packAmount:null,packUnit:null,gross:null,net:null,skuId:null,
  category:null,specification:null,...patch};
}
export function orderReceipt(date,overrides={}){
 return {merchant:'合成商店',orderNo:'SYNTH-START-001',date,state:'paid',currency:'CNY',paid:34,discount:4,shipping:3,
  paymentEvidence:'支付成功',totalEvidence:'实付 ¥34.00',refund:null,refundNo:null,images:[1],lines:[
   item('合成脱脂牛奶','food',{quantity:2,unit:'盒',packAmount:500,packUnit:'mL',gross:15,net:13,category:'餐饮'}),
   item('合成纸巾','food',{gross:20,net:18,category:'日用'})
  ],...overrides};
}
export const receiptStep=(receipt,id='order')=>({kind:'receipt',id,receipt,dependsOn:[]});
export const conversation='晨重72.4kg，识别购物截图，食品入库，再安排晚餐';
export function combinedTask(receipt){
 return {steps:[
  {id:'dinner',dependsOn:['order','weight'],kind:'health',action:proposal(action('next_meal','安排晚餐',{meal:'晚餐',preferences:[]}))},
  receiptStep(receipt),
  {id:'weight',dependsOn:[],kind:'health',action:proposal(action('weight','晨重72.4kg',{kg:72.4,morning:'yes'}))}
 ]};
}
