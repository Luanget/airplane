import {addDays,addFood,inventoryWithMoves} from '../health/core.mjs';
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
  const yesterday=addDays(today,-1);
  for(const [name,qty,kcal,protein] of [['燕麦',450,375,13],['鸡胸肉',520,120,23],['牛奶',750,62,3.3]]){
   const row=saveSku(health,{name,unit:'g',basisUnit:'g',basisAmount:100,kcal,protein,quality:'estimated',source:'演示'});
   row.qty=qty;
   if(name==='牛奶'||name==='燕麦'){
    const amount=name==='牛奶'?250:60;
    addFood(health,{date:yesterday,time:'08:15',meal:'早餐',name,portion:amount+' g',amount,stockQty:amount,foodId:row.id,
     kcal:kcal*amount/100,protein:protein*amount/100,quality:'estimated'});
   }
  }
  try{await saveState(health,0,account);}
  catch(err){if(!(await readState(account)).revision)throw err;}
 }
 const workspace={account,finance,readHealth:()=>readState(account),saveHealth:(next,expected)=>saveState(next,expected,account),
  readSkill:()=>finance.getItem('skill')??'',saveSkill:value=>finance.setItem('skill',value)};
 async function respond(input,{allowRead,continuation=[],applied=[]}={}){
  const latest=continuation.at(-1);
  const text=input.text;
  const focus=inventoryWithMoves(await workspace.readHealth()).find(s=>text.includes(s.name)),name=focus?.name??'燕麦';
  const quantity=Number(text.match(/(\d+(?:\.\d+)?)\s*(?:g|克)/i)?.[1]??300);
  const propose=(reply,mode,result)=>({reply,proposal:{mode,result,date:null}});
  const call=(scope,query='')=>({call:{args:{scope,query},item:{call_id:'demo-'+scope}}});
  if(text.includes('查库存和今日支出')){
   if(allowRead&&!latest)return call('stock');
   if(latest?.scope==='stock')return call('expenses');
   const stock=continuation.find(step=>step.scope==='stock')?.summary.stock;
   const expense=latest?.summary.expense;
   if(stock&&expense!==undefined)return {reply:'查到 '+stock.length+' 种食品，今天已支出 '+expense+' 元。',proposal:null};
   return {reply:'可开启本轮账本查询，逐项查看库存和今日支出。',proposal:null};
  }
  const chineseDate=text.match(/(\d{1,2})月(\d{1,2})日/);
  const date=text.match(/\d{4}-\d{2}-\d{2}/)?.[0]??(chineseDate?
   input.date.slice(0,4)+'-'+chineseDate[1].padStart(2,'0')+'-'+chineseDate[2].padStart(2,'0'):
   text.includes('前天')?addDays(input.date,-2):
   text.includes('昨天')?addDays(input.date,-1):text.includes('今天')?input.date:null);
  const dinnerItem=(row,amount)=>({name:row.name,sku:null,action:'plan',amount,unit:'g',
   packageSize:null,packageUnit:null,basisAmount:100,basisUnit:'g',
   nutrients:{kcal:null,protein:null,carbs:null,fat:null,sodium:null},
   uncertainty:'演示搭配，使用本地食品营养基础计算。',weighing:null});
  const expense=Number(text.match(/(\d+(?:\.\d+)?)\s*元/)?.[1]);
  if(text.includes('牛奶')&&date&&Number.isFinite(expense)&&/安排晚餐/.test(text)){
   if(!applied.length)return propose('请一起核对牛奶更正和午餐支出，保存后我会用更新后的库存安排晚餐。','batch',{
    next:'continue',operations:[
     {mode:'food_edit',date,result:{name:'牛奶',amount:quantity,unit:'g',meal:null,time:null}},
     {mode:'finance',date:null,result:{note:'',entry:{type:'expense',amount:expense,date:input.date,note:'演示午餐',categoryId:'餐饮'}}}
    ]
   });
   if(!latest)return call('meal');
   const {stock}=latest.summary,milk=stock.find(row=>row.name==='牛奶');
   const items=stock.filter(row=>row.name!=='牛奶'&&row.unit==='g'&&row.qty>0)
    .map(row=>dinnerItem(row,Math.min(row.qty,row.name==='鸡胸肉'?180:60)));
   return propose((milk?'更新后的牛奶库存是 '+milk.qty+' '+milk.unit+'。':'')+'这里是基于最新库存的晚餐计划。','plan',{
    note:'计划可稍后转为实际摄入。',items
   });
  }
  if(focus&&/改成|改为|更正/.test(text)&&/\d\s*(?:g|克)\b/i.test(text.replace('克','g'))){
   return {reply:'我会按你选中的原记录更正份量，请核对下面的变化。',proposal:{mode:'food_edit',date,
    result:{name,amount:quantity,unit:'g',meal:null,time:null}}};
  }
  if(date&&/吃了(?:什么|啥)|喝了什么|饮食记录|查.*饮食/.test(text)){
   if(allowRead&&!latest)return {call:{args:{scope:'foods',date,query:focus?.name??''},item:{call_id:'demo-foods'}}};
   const rows=latest?.summary.foods;
   return {reply:rows?.length?'记录里有'+rows.map(row=>row.name+' '+row.portion).join('、')+'。':
    rows?'这一天没有匹配的实际饮食记录。':'请开启本轮账本查询。',proposal:null};
  }
  if(/偏好|高蛋白|skill/i.test(text))return propose('我整理了一条可长期使用的饮食偏好。','skill',{text:'晚餐优先安排高蛋白食材，搭配易采购的蔬菜。'});
  if(/花了|支出|收入|记账/.test(text)&&/\d+(?:\.\d+)?\s*元/.test(text)){
   const amount=Number(text.match(/(\d+(?:\.\d+)?)\s*元/)[1]),type=text.includes('收入')?'income':'expense';
   return propose('金额已提取。可以核对日期、分类和预算选项。','finance',{note:'',entry:{type,amount,date:today,note:'演示收支',categoryId:type==='income'?'工资':'餐饮'}});
  }
  if(/盘点|补货/.test(text)){
   if(allowRead&&!latest)return call('stock',name);
   return propose('可以核对数量，再应用到演示账本。','inventory',{operation:text.includes('补货')?'shopping':'count',name,quantity,unit:'g'});
  }
  if(/晚餐|搭配|规划/.test(text)){
   if(allowRead&&!latest)return call('meal');
   const candidates=(latest?.summary.stock??[{name:'鸡胸肉'},{name:'燕麦'}]).filter(row=>row.name!=='牛奶');
   const items=candidates.map((row,i)=>dinnerItem(row,i===0?60:180));
   return propose('这里是一份可以调整的晚餐计划。','plan',{note:'计划可稍后转为实际摄入。',items});
  }
  if(/查.*库存/.test(text)){
   if(allowRead&&!latest)return call('stock',focus?.name??'');
   const rows=latest?.summary.stock;
   return {reply:rows?.length?rows.map(row=>row.name+' '+(row.qty??'数量未知')+' '+row.unit).join('，'):'可开启本轮账本查询，查看演示库存。',proposal:null};
  }
  if(/今天.*(?:花|收支)|查.*支出/.test(text)){
   if(allowRead&&!latest)return call('expenses');
   const sum=latest?.summary;
   return {reply:sum?'今天在演示账本记了 '+sum.count+' 笔，支出 '+sum.expense+' 元，收入 '+sum.income+' 元。':'可开启本轮账本查询，读取演示日汇总。',proposal:null};
  }
  return {reply:'演示支持盘点、补货、晚餐计划、记账和修改 Skill。可以选一项示例试试。',proposal:null};
 }
 return {...workspace,respond};
}
