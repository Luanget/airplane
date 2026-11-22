import assert from 'node:assert/strict';
import {readFinance,replaceFinance,STORAGE_KEY} from '../finance-storage.mjs';
import {MEMORY_KEY,memoryLibrary} from '../ai/memory.mjs';
import {setDocumentAccess} from '../ai/documents.mjs';
import {addFood,newState} from '../health/core.mjs';
import {saveSku} from '../health/inventory.mjs';
import {recordPurchase} from '../health/purchases.mjs';
import {orderFinance} from './order-agent-fixture.mjs';

export const ownerDate='2026-11-21';
export const historicalDate='2020-08-18';

export function seedOwnerLedger(state,finance){
 const expense={...finance.transactions[0],id:'old-expense',date:historicalDate,amount:39.67,note:'合成订单'};
 finance.transactions=[expense];
 for(const [id,name,unit] of [['egg','合成鸡蛋','g'],['milk','合成牛奶','mL'],['celery','合成芹菜','g']])
  saveSku(state,{id,name,unit,basisAmount:100,basisUnit:unit,kcal:100,protein:10,fat:4,carbs:2,sodium:30});
 const lines=[['egg',2000,1767],['milk',1000,1200],['celery',600,1000]];
 recordPurchase(state,{id:'mixed-order',date:historicalDate,financeId:expense.id,totalCents:3967,note:'合成订单',
  items:lines.map(([foodId,quantity,costCents])=>({foodId,quantity,costCents,batchId:'batch-'+foodId}))},expense);
 addFood(state,{date:historicalDate,name:'合成鸡蛋',meal:'午餐',status:'actual',foodId:'egg',stockQty:200,
  amount:200,amountUnit:'g',kcal:200,protein:20},undefined,'historical-egg');
}

export function attachOwnerStore(workspace,getHealth,setHealth){
 const originals=new Map(),history=new Map();
 workspace.ownerStore={
  read:async({document,id})=>{
   if(document==='finance'){
    const {primary,payload}=readFinance(workspace.finance);return {primary,payload};
   }
   if(document==='memory')return JSON.parse(workspace.finance.getItem(MEMORY_KEY));
   return structuredClone(originals.get(document+':'+id)??null);
  },
  list:async()=>[...history.values()],
  saved:async id=>structuredClone(history.get(id)??null),
  get:async id=>structuredClone(history.get(id)??null),
  commit:async(next,revision,{record,parts},guard)=>{
   guard();
   assert.equal(revision,getHealth().revision??0);
   for(const part of parts)assert.deepEqual(await workspace.ownerStore.read(part),part.before);
   for(const part of parts){
    if(part.document==='finance')replaceFinance(workspace.finance,part.after.payload,part.before.primary);
    else if(part.document==='memory')workspace.finance.setItem(MEMORY_KEY,JSON.stringify(part.after));
    else originals.set(part.document+':'+part.id,structuredClone(part.after));
   }
   setHealth({...structuredClone(next),revision:revision+1});
   const {historyParts,...audit}=structuredClone(record);
   const saved={...audit,parts:historyParts??structuredClone(parts),revision:revision+1};
   history.set(record.id,saved);
   return saved;
  }
 };
}

export function ownerFixture(enabled=true){
 const ledger=orderFinance(ownerDate);
 let state=newState();
 seedOwnerLedger(state,ledger);
 const entries=new Map([[STORAGE_KEY,JSON.stringify(ledger)]]);
 const finance={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
 const workspace={finance,memory:memoryLibrary(finance),readHealth:async()=>structuredClone(state),get state(){return state;}};
 setDocumentAccess(finance,enabled);
 attachOwnerStore(workspace,()=>state,next=>{state=next;});
 return workspace;
}
export function ownerContext(operationId='test-operation',allowRead=true){
 return {operationId,run:{id:'example-task',threadId:'example-thread',date:ownerDate,clock:'12:00',
  allowRead,messages:['用户明确要求修改本机账本。'],userSources:[],attachments:[],receipts:[]}};
}
export const edit=(dataset,id,action,fields={},parentId=null)=>({dataset,id,parentId,action,changes:JSON.stringify(fields)});
export const changes=(...operations)=>({reason:'修订合成账本',operations});
export const search=(dataset,fields={})=>({dataset,id:null,parentId:null,query:null,since:null,until:null,
 fields:[],offset:0,limit:25,...fields});
