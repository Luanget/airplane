import {localClock,syncCalendarFields} from '../calendar.mjs';
import {addConfirmedTransactions,freshData,readFinance,replaceFinance} from '../finance-storage.mjs';
import {validFinanceEntry} from '../health/contract.mjs';

export function financeReview(container,entry,today,store=localStorage,direct=false){
 if(!entry)return null;
 const {primary,payload}=readFinance(store);
 const read=financeFields(container,entry,today,payload??freshData());
 return ()=>{
  const current=readFinance(store);
  if(current.primary!==primary)throw Error('账本已变更，请重新生成候选');
  const next=current.payload??freshData();
  const saved=read();
  addConfirmedTransactions(next,[saved]);
  replaceFinance(store,next,primary);
  return direct?'已记录'+(saved.type==='income'?'收入':'支出')+' ¥'+saved.amount.toFixed(2)+' · '+saved.categoryName+
   (saved.note?' · '+saved.note:'')+'（'+saved.date+'）。':'财务记录已保存。';
 };
}
export function financeFields(container,entry,today,ledger){
 if(!entry)return null;
 const categories=ledger.categories.filter(c=>!c.hidden);
 const title=document.createElement('h3');title.textContent='收支记录';container.append(title);
 const fields=document.createElement('div');fields.className='form-grid';container.append(fields);
 function field(label,control,parent=fields){
  const row=document.createElement('label');row.append(label,control);parent.append(row);return control;
 }
 function input(label,type,value,parent){
  const control=document.createElement('input');control.type=type;control.value=value;control.required=type!=='text';
  return field(label,control,parent);
 }
 const type=field('收支方向',document.createElement('select'));
 type.add(new Option('支出','expense'));type.add(new Option('收入','income'));type.value=entry.type;
 const amount=input('金额 ¥','number',entry.amount);amount.min='0.01';amount.max='100000000';amount.step='0.01';
 const date=input('日期','date',entry.date);date.max=today;
 const category=field('分类',document.createElement('select'));category.required=true;
 const note=input('备注','text',entry.note,container);note.maxLength=200;
 const budget=document.createElement('input');budget.type='checkbox';
 const budgetLabel=document.createElement('span');
 field(budgetLabel,budget,container).parentElement.className='checkbox';
 function applyBudget(){
  const selected=categories.find(c=>c.id===category.value);
  budgetLabel.textContent=type.value==='income'?'同步增加预算':'计入日常预算';
  budget.checked=type.value==='income'||!selected?.budgetExcludedDefault;
 }
 function applyType(){
  const options=categories.filter(c=>c.type===type.value);
  category.replaceChildren(new Option('请选择分类',''),...options.map(c=>new Option(c.name,c.id)));
  const exactId=options.find(c=>c.id===entry.categoryId);
  const names=options.filter(c=>c.name===entry.categoryId);
  if(exactId||names.length===1)category.value=(exactId??names[0]).id;
  applyBudget();
 }
 applyType();type.onchange=applyType;category.onchange=applyBudget;syncCalendarFields(container);
 const id='tx-'+crypto.randomUUID();
 return ()=>{
  const selected=categories.find(c=>c.id===category.value&&c.type===type.value);
  const fields={type:type.value,amount:amount.valueAsNumber,date:date.value,categoryId:category.value};
  if(!selected||!validFinanceEntry(fields,{date:today,categories}))throw Error('请核对收支类型、金额、日期和分类');
  const now=new Date();
  return {...fields,id,note:note.value.trim(),time:localClock(now),createdAt:now.toISOString(),
   categoryName:selected.name,categoryIcon:selected.icon,categoryColor:selected.color,
   budgetSync:fields.type==='income'&&budget.checked,budgetExcluded:fields.type==='expense'&&!budget.checked};
 };
}

const FINANCE_AUTO='airplane-ai-daily-finance-v1';
export function financeAutomation(store){
 try{
  const value=JSON.parse(store.getItem(FINANCE_AUTO));
  if(value&&Number.isSafeInteger(value.limitCents)&&value.limitCents>=1&&value.limitCents<=1e8)
   return {enabled:value.enabled===true,limitCents:value.limitCents};
 }catch{}
 return {enabled:false,limitCents:30000};
}
export function setFinanceAutomation(store,enabled,limitCents){
 if(!Number.isSafeInteger(limitCents)||limitCents<1||limitCents>1e8)throw Error('请填写有效的单笔金额上限（最多两位小数）');
 store.setItem(FINANCE_AUTO,JSON.stringify({enabled:!!enabled,limitCents}));
}

const normal=text=>String(text??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function chooseFinanceCategory(ledger,{type,hint='',merchant='',name='',kind='',explicit=false}){
 const enabled=ledger.categories.filter(row=>row.type===type&&!row.hidden);
 const exact=enabled.find(row=>row.id===hint||normal(row.name)===normal(hint)&&!!hint);
 if(explicit&&exact)return exact;
 const vendor=normal(merchant),product=normal(name),votes=new Map();
 const available=new Set(enabled.map(row=>row.id));
 for(const row of ledger.transactions.slice(-240).reverse()){
  if(row.type!==type||!available.has(row.categoryId))continue;
  const sameMerchant=!!vendor&&(normal(row.receiptMerchant)===vendor||normal(row.note).includes(vendor));
  const sameItem=product.length>1&&(normal(row.note).includes(product)||(row.receiptProducts??[]).some(item=>normal(item)===product));
  if(row.receiptUnallocated||!(sameItem||sameMerchant))continue;
  const knownKind=row.receiptKind;
  if(kind&&knownKind&&kind!==knownKind)continue;
  if(kind&&!knownKind&&!sameItem)continue;
  const score=sameItem?5:2;
  votes.set(row.categoryId,(votes.get(row.categoryId)??0)+score);
 }
 const ranked=[...votes].sort((a,b)=>b[1]-a[1]);
 if(ranked.length&&(ranked.length===1||ranked[0][1]>ranked[1][1]))return enabled.find(row=>row.id===ranked[0][0]);
 if(exact)return exact;
 const patterns={food:/餐饮|买菜|生鲜|食品|食材|伙食/,nonfood:/日用|百货|家居|购物/,shipping:/运费|配送|快递/,
  refund:/退款|退货|退费/,unallocated:/未分摊|待分类|其他|购物/};
 const generic=patterns[kind];
 return generic?enabled.find(row=>generic.test(row.name))??null:null;
}
export function financeEntry({id,type,amount,date,time,note,category,budgetSync,budgetExcluded,...extra}){
 return {id,type,amount,date,time,note,categoryId:category.id,categoryName:category.name,categoryIcon:category.icon,
  categoryColor:category.color,budgetSync:type==='income'&&(budgetSync??true),
  budgetExcluded:type==='expense'&&(budgetExcluded??!!category.budgetExcludedDefault),...extra};
}
