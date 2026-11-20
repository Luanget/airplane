import {inventoryWithMoves} from '../health/core.mjs';
import {saveSku} from '../health/inventory.mjs';
import {freshData,STORAGE_KEY} from '../finance-storage.mjs';
import {readState,saveState} from '../health/storage.mjs';

// A per-tab namespace lets all three demo pages show the same fictitious ledger.
export async function demoWorkspace(today){
 const slot='airplane-demo-session-v1';
 const previous=sessionStorage.getItem(slot);
 const id=/^demo-[0-9a-f-]{36}$/.test(previous??'')?previous:'demo-'+crypto.randomUUID();
 sessionStorage.setItem(slot,id);
 const finance={getItem:key=>sessionStorage.getItem(id+':'+key),setItem:(key,value)=>sessionStorage.setItem(id+':'+key,value),
  removeItem:key=>sessionStorage.removeItem(id+':'+key)};
 // The demo namespace stores public sample data and never opens the device ledger.
 const account={id,demo:true,finance,seal:(_slot,data)=>data,open:(_slot,data)=>data};
 if(!finance.getItem(STORAGE_KEY)){
  const ledger=freshData();
  ledger.transactions.push({id:'demo-1',type:'expense',amount:12,date:today,note:'演示早餐'});
  finance.setItem(STORAGE_KEY,JSON.stringify(ledger));
 }
 const health=await readState(account);
 if(!health.revision){
  for(const [name,qty,kcal,protein] of [['燕麦',450,375,13],['鸡胸肉',520,120,23],['牛奶',750,62,3.3]]){
   const row=saveSku(health,{name,unit:'g',basisUnit:'g',basisAmount:100,kcal,protein,quality:'estimated',source:'演示'});
   row.qty=qty;
  }
  try{await saveState(health,0,account);}
  catch(err){if(!(await readState(account)).revision)throw err;}
 }
 const workspace={account,finance,readHealth:()=>readState(account),saveHealth:(next,expected)=>saveState(next,expected,account),
  readSkill:()=>finance.getItem('skill')??'',saveSkill:value=>finance.setItem('skill',value)};
 async function respond(input,{allowRead,continuation}={}){
  const text=input.text;
  const focus=inventoryWithMoves(await workspace.readHealth()).find(s=>text.includes(s.name)),name=focus?.name??'燕麦';
  const quantity=Number(text.match(/(\d+(?:\.\d+)?)\s*(?:g|克)/i)?.[1]??300);
  const propose=(reply,mode,result)=>({reply,proposal:{mode,result,date:null}});
  const call=(scope,query='')=>({call:{args:{scope,query},item:{call_id:'demo'}}});
  if(/偏好|高蛋白|skill/i.test(text))return propose('我整理了一条可长期使用的饮食偏好。','skill',{text:'晚餐优先安排高蛋白食材，搭配易采购的蔬菜。'});
  if(/花了|支出|收入|记账/.test(text)&&/\d+(?:\.\d+)?\s*元/.test(text)){
   const amount=Number(text.match(/(\d+(?:\.\d+)?)\s*元/)[1]),type=text.includes('收入')?'income':'expense';
   return propose('金额已提取。可以核对日期、分类和预算选项。','finance',{note:'',entry:{type,amount,date:today,note:'演示收支',categoryId:type==='income'?'工资':'餐饮'}});
  }
  if(/盘点|补货/.test(text)){
   if(allowRead&&!continuation)return call('stock',name);
   return propose('可以核对数量，再应用到演示账本。','inventory',{operation:text.includes('补货')?'shopping':'count',name,quantity,unit:'g'});
  }
  if(/晚餐|搭配|规划/.test(text)){
   if(allowRead&&!continuation)return call('meal');
   const candidates=(continuation?.summary.stock??[{name:'鸡胸肉'},{name:'燕麦'}]).filter(row=>row.name!=='牛奶');
   const items=candidates.map((s,i)=>({name:s.name,sku:null,action:'plan',amount:i===0?60:180,unit:'g',
    packageSize:null,packageUnit:null,basisAmount:100,basisUnit:'g',nutrients:{kcal:null,protein:null,carbs:null,fat:null,sodium:null},
    uncertainty:'演示搭配，使用本地食品营养基础计算。',weighing:null}));
   return propose('这里是一份可以调整的晚餐计划。','plan',{note:'计划可稍后转为实际摄入。',items});
  }
  if(/查.*库存/.test(text)){
   if(allowRead&&!continuation)return call('stock',focus?.name??'');
   const rows=continuation?.summary.stock;
   return {reply:rows?.length?rows.map(row=>row.name+' '+(row.qty??'数量未知')+' '+row.unit).join('，'):'可开启本轮账本查询，查看演示库存。',proposal:null};
  }
  if(/今天.*(?:花|收支)|查.*支出/.test(text)){
   if(allowRead&&!continuation)return call('expenses');
   const sum=continuation?.summary;
   return {reply:sum?'今天在演示账本记了 '+sum.count+' 笔，支出 '+sum.expense+' 元，收入 '+sum.income+' 元。':'可开启本轮账本查询，读取演示日汇总。',proposal:null};
  }
  return {reply:'演示支持盘点、补货、晚餐计划、记账和修改 Skill。可以选一项示例试试。',proposal:null};
 }
 return {...workspace,respond};
}
