import {normalizeClock} from '../calendar.mjs';
import {freshData,readFinance,validateFinanceBackup} from '../finance-storage.mjs';
import {addFood,assertBalances,events,deleteEvent,inventoryWithMoves,makeId,NUTRIENTS,
 recordEvent,validateAppState,validDate} from '../health/core.mjs';
import {basis} from '../health/candidates.mjs';
import {displayStockQuantity,saveSku,stockMeasure} from '../health/inventory.mjs';
import {purchaseTransactionId,recordPurchase,revisePurchase} from '../health/purchases.mjs';
import {projectedExpense,updatePurchaseLedgers,writeFinanceWithPurchaseCheck} from '../health/purchase-sync.mjs';
import {eatingState} from '../health/presentation.mjs';
import {setShoppingItem} from '../health/shopping.mjs';
import {appDataEditSchema,matches} from '../health/contract.mjs';
import {HISTORY_OPTIONS,readHistoryOption,saveHistoryOption} from './context.mjs';
import {readChatModel,saveChatModel} from './models.mjs';
import {APP_VERSION} from '../shell.mjs';
import {totalUsage} from './usage.mjs';
import {dataGuide} from './data-guide.mjs';

const healthSets={
 health_settings:['健康设置',{calorieTarget:'nonnegative',proteinMin:'nonnegative',proteinMax:'nonnegative',
  fatMin:'nonnegative',sodiumTarget:'nonnegative',baselineTdee:'nonnegative',cycleTarget:'nonnegative',cycleDays:'cycleDays',cycleAnchor:'date'}],
 foods:['饮食与计划',{date:'date',time:'time',name:'name',meal:'meal',portion:'text',status:'foodStatus',
  nutrition:'nutrition',cost:'?money',amount:'?positive',amountUnit:'unit',uncertainty:'text',quality:'text'}],
 weights:['体重',{date:'date',time:'time',kg:'positive',isMorning:'bool',trendStatus:'text'}],
 activities:['运动',{date:'date',time:'time',name:'name',km:'?nonnegative',minutes:'?nonnegative',kcal:'?nonnegative',
  energyKind:'energyKind',includedInBase:'bool',quality:'text',uncertainty:'text'}],
 inventory:['食品资料',{name:'name',unit:'unit',basisAmount:'positive',basisUnit:'unit',nutrition:'nutrition',
  source:'text',quality:'text',active:'bool',pricePerUnit:'?nonnegative',minimum:'?nonnegative',
  packageSize:'?positive',packageUnit:'?packUnit',piecesPerPack:'?integer',stage:'stage',stockStage:'stage'}],
 batches:['库存批次',{expires:'?date',raw:'?positive',cooked:'?positive'}],
 stock_moves:['库存流水',{reason:'name'}],
 purchases:['采购',{date:'date',time:'time',totalCents:'cents',note:'text',items:'purchaseItems'}],
 shopping:['补货清单',{quantity:'positive',selected:'bool'}],
 templates:['餐食模板',{name:'name',date:'date',meal:'meal'}],
 legacy_days:['导入的当日基线汇总',{nutrition:'nutrition',note:'text'}],
 legacy_energy:['导入的消耗基线',{tdee:'?nonnegative',intake:'?nonnegative',deficit:'?number',status:'text'}],
 legacy_rules:['导入的规则',{desc:'text',value:'scalar'}]
};
const financeSets={
 transactions:['财务收支',{date:'date',time:'time',note:'text',amount:'money',type:'transactionType',
  categoryId:'name',budgetExcluded:'bool',budgetSync:'bool'}],
 categories:['收支分类',{name:'name',type:'transactionType',icon:'name',color:'color',order:'nonnegative',
  hidden:'bool',budgetExcludedDefault:'bool'}],
 budgets:['月基础预算',{amount:'money'}],
 balances:['余额调整',{delta:'number'}],
 finance_settings:['财务设置',{initialBalance:'?number',lastIncomeCategoryId:'?name',lastExpenseCategoryId:'?name'}]
};
const otherSets={
 skills:['Skill',{name:'name',text:'name',enabled:'bool'}],
 conversations:['对话',{title:'name'}],
 assistant_settings:['助手设置',{model:'name',history:'name'}]
};
const datasets={...healthSets,...financeSets,...otherSets};
const singletons=new Set(['health_settings','finance_settings','assistant_settings']);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const nonnegative=value=>Number.isFinite(value)&&value>=0;
const dateString=value=>typeof value==='string'&&validDate(value);
const cents=value=>Number.isSafeInteger(value)&&value>=0;
const units=['g','mL','包','个','份','盒','瓶','袋','克','毫升'];
const isChoice=(value,...choices)=>choices.includes(value);
const validators={
 nonnegative,positive:value=>nonnegative(value)&&value>0,number:Number.isFinite,
 cents, money:value=>nonnegative(value)&&Math.abs(value*100-Math.round(value*100))<1e-6,
 integer:value=>cents(value)&&value>0,bool:value=>typeof value==='boolean',
 name:value=>typeof value==='string'&&!!value.trim(),text:value=>typeof value==='string',
 date:dateString,time:value=>value===''||typeof value==='string'&&normalizeClock(value)===value,
 cycleDays:value=>Number.isInteger(value)&&value>=1&&value<=31,unit:value=>units.includes(value),
 packUnit:value=>isChoice(value,'g','mL'),stage:value=>isChoice(value,'raw','cooked'),
 foodStatus:value=>isChoice(value,'actual','plan','cancelled'),
 meal:value=>isChoice(value,'早餐','午餐','晚餐','加餐'),
 energyKind:value=>isChoice(value,'activity','total'),transactionType:value=>isChoice(value,'expense','income'),
 scalar:value=>value===null||['number','string','boolean'].includes(typeof value),
 color:value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value),
 nutrition:value=>plain(value)&&Object.keys(value).every(k=>NUTRIENTS.includes(k)&&(value[k]===null||nonnegative(value[k]))),
 purchaseItems:value=>Array.isArray(value)&&value.length>0&&value.every(item=>plain(item)&&
  Object.keys(item).every(k=>['foodId','quantity','costCents','expires','batchId'].includes(k))&&
  typeof item.foodId==='string'&&nonnegative(item.quantity)&&item.quantity>0&&
  (item.costCents===null||cents(item.costCents))&&(item.expires==null||dateString(item.expires))&&
  (item.batchId==null||typeof item.batchId==='string'))
};
function checkFields(dataset,fields){
 if(!plain(fields))throw Error('变更内容应为 JSON 对象');
 for(const [key,value] of Object.entries(fields)){
  const expected=datasets[dataset][1][key];
  if(typeof expected!=='string'||!(expected.startsWith('?')?
   value===null||validators[expected.slice(1)](value):validators[expected](value)))throw Error('请核对字段和单位：'+key);
 }
}
const rows=(values,key='id')=>values.map(value=>({...value,id:value[key]}));
const entries=(values,field)=>Object.entries(values??{}).map(([id,value])=>({...(field?{[field]:value}:value),id}));
const currentSettings=store=>({model:readChatModel(store).id,history:readHistoryOption(store).id});

function healthRows(state,dataset){
 switch(dataset){
  case 'health_settings':return [state.settings];
  case 'foods':case 'weights':case 'activities':return events(state,dataset);
  case 'inventory':return inventoryWithMoves(state);
  case 'shopping':return rows(state.local.shoppingList??[],'foodId');
  case 'legacy_days':return entries(state.legacy.daily);
  case 'legacy_energy':return entries(state.legacy.energy);
  case 'legacy_rules':return rows(state.legacy.rules,'key');
  default:return state.local[{stock_moves:'stockMoves'}[dataset]??dataset]??[];
 }
}
function financeRows(state,dataset){
 switch(dataset){
  case 'finance_settings':return [state.prefs??{}];
  case 'budgets':return entries(state.budgets,'amount');
  case 'balances':return state.balanceAdjustments??[];
  default:return state[dataset]??[];
 }
}
const fieldOptions={
 date:'YYYY-MM-DD',time:'HH:mm',cycleDays:'1–31 天整数',cents:'分，整数',money:'元，最多两位小数',
 foodStatus:['actual','plan','cancelled'],meal:['早餐','午餐','晚餐','加餐'],
 transactionType:['expense','income'],energyKind:['activity','total'],unit:units,packUnit:['g','mL'],
 stage:['raw','cooked'],nutrition:{kcal:'kcal',protein:'g',carbs:'g',fat:'g',sodium:'mg'}
};
function dataShape(dataset){
 const [label,fields]=datasets[dataset];
 const types=[...new Set(Object.values(fields).map(type=>type.replace(/^\?/,'')))];
 const options=Object.fromEntries(types.filter(type=>Object.hasOwn(fieldOptions,type)).map(type=>[type,fieldOptions[type]]));
 return {dataset,label,fields,...(Object.keys(options).length?{options}:{})};
}
const readableOnly={
 conversation_messages:'已保存对话的原文，用会话 ID 查询',
 local_usage:'本浏览器的美元费用估算',
 import_info:'已导入健康主账的来源、时间和记录数',
 app_info:'应用版本'
};
export async function readAppData(workspace,book,{dataset,id,date,query,fields=[]}){
 if(dataset==='guide'){
  const section=query.trim();
  if(Object.hasOwn(datasets,section))return dataShape(section);
  if(Object.hasOwn(dataGuide,section))return {section,text:dataGuide[section]};
  return {sections:Object.keys(dataGuide),
   datasets:{...Object.fromEntries(Object.entries(datasets).map(([key,[title]])=>[key,title])),...readableOnly}};
 }
 const month=typeof date==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(date);
 if(date!==null&&!month&&!dateString(date))throw Error('请选择有效日期或月份');
 const term=query.trim().toLowerCase();
 if(dataset==='conversation_messages'){
  if(!id)return {dataset,hint:'从 conversations 查会话 ID 后再查原文。可用关键词筛选。'};
  const thread=book?.list().find(row=>row.id===id);
  const rows=(thread?.messages??[]).filter(row=>row&&(!term||
   String(row.text).toLowerCase().includes(term)||String(row.source?.text??'').toLowerCase().includes(term)));
  return {dataset,id,title:thread?.title??null,rows:projectFields(rows.map(({role,text,source})=>({role,text,...(source?{source}:{})})),fields)};
 }
 if(dataset==='local_usage'){
  const cost=workspace.account?.demo?null:await totalUsage();
  return {dataset,estimatedUsd:cost===null?null:cost/1e12,currency:'USD',scope:'本机收到用量回执的 Airplane 请求'};
 }
 if(dataset==='import_info'){
  const {importInfo,importedAt}=await workspace.readHealth();
  return {dataset,importedAt,importInfo};
 }
 if(dataset==='app_info')return {dataset,version:APP_VERSION};

 const shape=dataShape(dataset);
 if(!id&&!date&&!term&&!singletons.has(dataset)&&!['categories','skills','budgets','legacy_rules'].includes(dataset))
  return {...shape,hint:'请选择 ID、记录日期、月份或关键词后查询。'};
 let found;
 if(Object.hasOwn(healthSets,dataset))found=healthRows(await workspace.readHealth(),dataset);
 else if(Object.hasOwn(financeSets,dataset))found=financeRows(readFinance(workspace.finance).payload??freshData(),dataset);
 else if(dataset==='skills')found=workspace.skills.list();
 else if(dataset==='conversations')found=book.list().map(({id,title,updatedAt})=>({id,title,updatedAt}));
 else found=[currentSettings(workspace.finance)];
 const filtered=found.filter(row=>{
  const day=row.date??(row.updatedAt??row.createdAt)?.slice(0,10)??row.id;
  return (id===null||row.id===id)&&(!date||(month?String(day??'').startsWith(date):day===date))&&
   (!term||JSON.stringify(row).toLowerCase().includes(term));
 });
 if(fields.length)return {dataset,label:shape.label,rows:projectFields(filtered,fields)};
 return {...shape,rows:filtered};
}

function projectFields(rows,fields){
 if(!fields.length)return rows;
 const selected=new Set(['id',...fields]);
 return rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>selected.has(key))));
}

function replaceRow(list,id,record){
 if(!record)return list.filter(row=>row.id!==id);
 if(!id)return [...list,record];
 return list.map(row=>row.id===id?record:row);
}
const healthLocal={batches:'batches',stock_moves:'stockMoves',templates:'templates'};
const own=(set,key)=>Object.hasOwn(set,key);
const check=(condition,message)=>{if(!condition)throw Error(message);};
function skuPatch(state,id,previous,values){
 const [basisAmount,basisUnit]=previous?basis(previous):[];
 const row={...previous,basisAmount,basisUnit,...values};
 return Object.assign(saveSku(state,{...row,...previous?.nutrition,...values.nutrition,id,
  ...(values.pricePerUnit!==undefined?{price:values.pricePerUnit}:previous?.priceBasis===previous?.unit?{price:previous?.pricePerUnit}:{})}),
  {active:values.active??previous?.active??true});
}
function updateHealth(state,dataset,id,previous,fields,action,today){
 if(dataset==='health_settings'){
  Object.assign(state.settings,fields);
  check(state.settings.proteinMin<=state.settings.proteinMax,'蛋白质下限不能大于上限');
  return state.settings;
 }
 if(dataset==='foods'){
  if(action==='delete'){deleteEvent(state,'foods',id);return null;}
  const row={...previous,...fields};
  const linked=state.local.stockMoves.filter(move=>move.linkedFoodId===id&&id);
  if(previous&&linked.length&&['amount','amountUnit','portion'].some(key=>own(fields,key)&&fields[key]!==previous[key]))
   throw Error('有扣库的份量更正请用饮食纠错，或先核对原批次');
  const status=fields.status??(previous?eatingState(previous):'actual');
  check(validators.foodStatus(status),'请指定实际、计划或取消的状态');
  check(status==='plan'||row.date<=today,'实际记录应使用今天或过去的日期');
  return addFood(state,{...row,...{...previous?.nutrition,...fields.nutrition},status,
   stockQty:linked.length||previous?.status==='plan'?row.stockQty:null,
   cost:own(fields,'cost')?fields.cost:row.costSource==='inventory'?null:row.cost},previous?.id);
 }
 if(dataset==='weights'||dataset==='activities'){
  if(action==='delete'){deleteEvent(state,dataset,id);return null;}
  const row={...previous,...fields};
  if(dataset==='weights'&&!own(row,'isMorning'))row.isMorning=/^(是|纳入|暂定纳入)/.test(row.trendStatus??'');
  if(dataset==='activities'&&row.energyKind==='total')row.includedInBase=false;
  check(dateString(row.date)&&(dataset==='weights'?validators.positive(row.kg):validators.name(row.name)),'请核对记录日期和数值');
  return recordEvent(state,dataset,row,previous?.id);
 }
 if(dataset==='inventory'){
  return skuPatch(state,previous?.id,previous,action==='delete'?{active:false}:fields);
 }
 if(dataset==='legacy_days'||dataset==='legacy_energy'){
  check(dateString(id),'请提供有效的基线日期');
  const table=state.legacy[dataset==='legacy_days'?'daily':'energy'];
  if(action==='delete'){delete table[id];return null;}
  const row={date:id,...previous,...fields};
  if(dataset==='legacy_days')row.nutrition={...previous?.nutrition,...fields.nutrition};
  delete row.id;
  return table[id]=row;
 }
 if(dataset==='legacy_rules'){
  check(typeof id==='string'&&!['__proto__','prototype','constructor'].includes(id),'请指定规则名称');
  const table=state.legacy.rules;
  const index=table.findIndex(row=>row.key===id);
  if(action==='delete'){table.splice(index,1);return null;}
  const row={key:id,desc:fields.desc??previous?.desc??'',value:own(fields,'value')?fields.value:previous?.value??null};
  if(index<0)table.push(row);else table[index]=row;
  return row;
 }
 if(dataset==='shopping'){
  check(typeof id==='string','请指定库存食品 ID');
  if(action==='delete'){state.local.shoppingList=state.local.shoppingList.filter(row=>row.foodId!==id);return null;}
  setShoppingItem(state,id,fields.quantity??previous?.quantity,fields.selected??previous?.selected??false);
  return state.local.shoppingList.find(row=>row.foodId===id);
 }
 if(dataset==='stock_moves'&&action==='delete'){
  const related=state.local.stockMoves.filter(row=>row.id===id||
   previous.actionId&&row.actionId===previous.actionId);
  check(related.every(row=>!row.linkedFoodId&&!row.opening&&!state.local.batches?.some(batch=>batch.parent&&
   batch.id.startsWith(row.id+'-'))&&!(row.delta>0&&row.batchId)), '关联入库、分装、首次盘点与摄入请从来源记录更正');
  state.local.stockMoves=state.local.stockMoves.filter(row=>!related.includes(row));
  for(const row of related)assertBalances(state,row.foodId);
  return null;
 }
 const key=healthLocal[dataset];
 if(dataset==='templates'&&action!=='delete'){
  let items=previous?.items;
  if(own(fields,'date')||own(fields,'meal')){
   check(dateString(fields.date)&&validators.meal(fields.meal),'重建模板需要日期和餐次');
   items=events(state,'foods').filter(row=>row.date===fields.date&&row.meal===fields.meal&&
    (row.status==='actual'||row.source==='legacy'&&row.actual));
  }
  check(items?.length&&(fields.name??previous?.name),'模板需要名称和实际餐食');
  const row={id:id??makeId('meal'),name:fields.name??previous.name,items};
  state.local[key]=replaceRow(state.local[key]??[],id,row);return row;
 }
 check(!(dataset==='batches'&&action!=='update')&&!(dataset==='stock_moves'&&action==='add'),'批次、入出库请从采购、分装或盘点操作');
 const updated=action==='delete'?null:{...previous,...fields};
 state.local[key]=replaceRow(state.local[key]??[],id,updated);
 return updated;
}

function updateFinance(state,dataset,id,previous,fields,action){
 if(dataset==='finance_settings'){
  const selected=state.prefs??={};
  for(const [key,type] of [['lastIncomeCategoryId','income'],['lastExpenseCategoryId','expense']]){
   check(!fields[key]||state.categories.some(row=>row.id===fields[key]&&row.type===type),'所选财务分类不匹配');
  }
  Object.assign(selected,fields);return selected;
 }
 if(dataset==='budgets'){
  check(/^\d{4}-(0[1-9]|1[0-2])$/.test(id??''),'预算 ID 应为年月');
  if(action==='delete'){delete state.budgets[id];return null;}
  check(fields.amount!==undefined,'请给出月基础预算金额');
  return {amount:state.budgets[id]=fields.amount};
 }
 const key=dataset==='balances'?'balanceAdjustments':dataset;
 let updated=action==='delete'?null:{id:id??makeId(dataset),...previous,...fields};
 if(dataset==='transactions'&&updated){
  const category=state.categories.find(row=>row.id===updated.categoryId&&row.type===updated.type);
  const sameCategory=previous&&previous.categoryId===updated.categoryId&&previous.type===updated.type;
  check(updated.amount>0&&updated.date&&updated.type&&(category||sameCategory),'请核对日期、金额和收支分类');
  if(!sameCategory)Object.assign(updated,{categoryName:category.name,categoryIcon:category.icon,categoryColor:category.color});
  if(updated.type==='income')updated.budgetExcluded=false;else updated.budgetSync=false;
 }
 if(dataset==='categories'&&updated){
  check(updated.name&&updated.type,'分类需要名称和收支类别');
  check(!previous||previous.type===updated.type,'变更分类类别请新建分类');
  updated={custom:true,order:state.categories.length,hidden:false,icon:'more',color:'#9AA09A',...updated};
 }
 if(dataset==='balances'&&updated){
  check(Number.isFinite(updated.delta),'请输入调整金额');
  updated.delta=Math.round(updated.delta*100)/100;
  if(previous?.targetBalance!=null)updated.targetBalance=Math.round((previous.targetBalance+updated.delta-previous.delta)*100)/100;
  updated.createdAt??=new Date().toISOString();
 }
 state[key]=replaceRow(state[key]??[],id,updated);
 if(dataset==='categories'){
  check(['income','expense'].every(type=>state.categories.some(row=>row.type===type&&!row.hidden)),'收入和支出至少各保留一个可用分类');
  if(action==='delete')for(const key of ['lastIncomeCategoryId','lastExpenseCategoryId'])if(state.prefs?.[key]===id)state.prefs[key]=null;
 }
 validateFinanceBackup(state);
 return updated;
}

export async function dataEdit(workspace,book,result,today){
 if(!matches(appDataEditSchema,result))throw Error('无法识别本机数据候选');
 const {dataset,id,action}=result;
 let fields;
 try{fields=JSON.parse(result.changes);}
 catch{throw Error('候选的字段格式无效，请重新生成');}
 checkFields(dataset,fields);
 check(action!=='delete'||!Object.keys(fields).length,'删除候选应保留原记录定位');
 check(!singletons.has(dataset)||action==='update'&&!id,'请指定需要调整的设置字段');
 check(!fields.date||dataset==='foods'&&(fields.status==='plan'||action==='update')||fields.date<=today,'这类记录应使用今天或过去的日期');
 const target=rows=>singletons.has(dataset)?rows[0]:rows.find(row=>row.id===id);
 const validate=previous=>{
  check(action==='add'?!previous:!!previous,'原条目已变更，或该 ID 已存在');
  check(action==='delete'||Object.keys(fields).length>0,'请选择要变更的内容');
 };
 let previous,updated,commit,extra='';
 if(own(healthSets,dataset)){
  const state=await workspace.readHealth();
  check(action!=='add'||!id||['legacy_days','legacy_energy','legacy_rules','shopping'].includes(dataset),'记录 ID 由本机生成');
  previous=target(healthRows(state,dataset));validate(previous);
  let next=structuredClone(state);
  if(dataset==='purchases'){
   const finance=readFinance(workspace.finance);
   if(action==='add'){
    check(!id,'新订单 ID 由本机生成');
    const saved=recordPurchase(next,{id:makeId('purchase'),note:'',...fields});
    updated=saved;
   }else{
    const revised=revisePurchase(state,id,action==='delete'?null:fields);
    next=revised.next;updated=revised.order;
    const tx=finance.payload?.transactions.find(row=>row.id===purchaseTransactionId(previous));
    const change=projectedExpense(previous,updated,tx);
    if(change)extra=updated?'关联支出 ¥'+change.before.amount+' → ¥'+change.after.amount+'。':'同时撤销关联支出 ¥'+change.before.amount+'。';
    commit=()=>updatePurchaseLedgers(workspace.account,revised.next,state.revision??0,change);
   }
  }else updated=updateHealth(next,dataset,id,previous,fields,action,today);
  check(validateAppState(next),'健康账本格式无效，请核对数据');
  if(['purchases','foods','stock_moves'].includes(dataset)){
   const before=new Map(inventoryWithMoves(state).map(row=>[row.id,row.qty]));
   const moves=inventoryWithMoves(next).filter(row=>row.qty!==before.get(row.id));
   for(const row of moves){
    const amount=value=>displayStockQuantity(row,value)??'未知';
    extra+=' '+row.name+' '+amount(before.get(row.id))+' → '+amount(row.qty)+' '+stockMeasure(row).unit+'。';
   }
  }
  commit??=()=>workspace.saveHealth(next,state.revision??0);
 }else if(own(financeSets,dataset)){
  const {primary,payload}=readFinance(workspace.finance);
  const next=payload??freshData();
  previous=structuredClone(target(financeRows(next,dataset)));validate(previous);
  check(action!=='add'||!id||dataset==='budgets','记录 ID 由本机生成');
  updated=updateFinance(next,dataset,id,previous,fields,action);
  commit=()=>writeFinanceWithPurchaseCheck(workspace.account,primary,dataset==='transactions'&&previous?[id]:[],()=>next);
 }else if(dataset==='skills'){
  previous=workspace.skills.list().find(row=>row.id===id);validate(previous);
  if(action==='add')check(!id&&fields.name&&fields.text,'新增 Skill 需要名称和工作规则');
  if(previous?.preset)check(action!=='delete'&&!fields.name,'预置 Skill 可以改规则或关闭');
  updated=action==='delete'?null:{...previous,...fields};
  commit=()=>workspace.skills.applyChanges(id,fields,previous,action);
 }else if(dataset==='conversations'){
  previous=book.list().map(({id,title})=>({id,title})).find(row=>row.id===id);validate(previous);
  check(action!=='add','开始对话请发送一条新消息');
  updated=action==='delete'?null:{...previous,...fields};
  commit=()=>action==='delete'?book.remove(id):book.rename(id,fields.title);
 }else{
  previous=currentSettings(workspace.finance);validate(previous);
  if(fields.history)check(HISTORY_OPTIONS.some(option=>option.id===fields.history),'历史档位为 current、rolling 或 extended');
  if(fields.model)check(['gpt-6-luna','gpt-6.1-terra','gpt-6.2-sol'].includes(fields.model),'请使用支持的模型 ID');
  updated={...previous,...fields};
  commit=()=>{
   check(JSON.stringify(currentSettings(workspace.finance))===JSON.stringify(previous),'助手设置已变更，请重新核对');
   if(fields.model)saveChatModel(workspace.finance,fields.model);
   try{if(fields.history)saveHistoryOption(workspace.finance,fields.history);}
   catch(err){
    if(fields.model)saveChatModel(workspace.finance,previous.model);
    throw err;
   }
  };
 }
 return {label:datasets[dataset][0],previous,updated,extra,commit};
}

export async function appDataReview(container,workspace,book,result,today){
 const draft=await dataEdit(workspace,book,result,today);
 const title=document.createElement('h3');
 title.textContent='核对'+draft.label+'变更';container.append(title);
 if(draft.extra){const p=document.createElement('p');p.textContent=draft.extra;container.append(p);}
 const prev=draft.previous??{},next=draft.updated??{};
 const keys=draft.previous&&draft.updated?new Set([...Object.keys(prev),...Object.keys(next)].filter(key=>
  JSON.stringify(prev[key])!==JSON.stringify(next[key]))):new Set(Object.keys(draft.updated??draft.previous??{}));
 const compare=document.createElement('pre');compare.className='assistant-data-review';
 const content=(object)=>JSON.stringify(Object.fromEntries([...keys].filter(k=>own(object,k)).map(k=>[k,object[k]])),null,2);
 compare.textContent=(draft.previous?'原记录\n'+content(prev):'新增记录')+'\n\n'+(draft.updated?'确认后\n'+content(next):'撤销或删除本条');
 container.append(compare);
 return async()=>{await draft.commit();return draft.label+'已更新。';};
}
