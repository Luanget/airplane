import {normalizeClock,syncCalendarFields} from '../calendar.mjs';
import {freshData,readFinance,replaceFinance} from '../finance-storage.mjs';
import {validFinanceEntry} from '../health/contract.mjs';

export function financeReview(container,entry,today,store=localStorage){
 if(!entry)return null;
 const {primary,payload}=readFinance(store);
 const ledger=payload??freshData(),categories=ledger.categories.filter(c=>!c.hidden);
 const title=document.createElement('h3');title.textContent='收支记录';container.append(title);
 const fields=document.createElement('div');fields.className='form-grid';container.append(fields);
 function field(label,control,parent=fields){
  const row=document.createElement('label');row.append(label,control);parent.append(row);return control;
 }
 function input(label,type,value,parent){
  const control=document.createElement('input');control.type=type;control.value=value;control.required=type!=='time'&&type!=='text';
  return field(label,control,parent);
 }
 const type=field('收支方向',document.createElement('select'));
 type.add(new Option('支出','expense'));type.add(new Option('收入','income'));type.value=entry.type;
 const amount=input('金额 ¥','number',entry.amount);amount.min='0.01';amount.max='100000000';amount.step='0.01';
 const date=input('日期','date',entry.date);date.max=today;
 const time=input('时间','time','');
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
  const match=options.find(c=>c.name===entry.categoryId||c.id===entry.categoryId);
  if(match)category.value=match.id;
  applyBudget();
 }
 applyType();type.onchange=applyType;category.onchange=applyBudget;syncCalendarFields(container);
 const id='tx-'+crypto.randomUUID();
 return ()=>{
  const selected=categories.find(c=>c.id===category.value&&c.type===type.value);
  const fields={type:type.value,amount:amount.valueAsNumber,date:date.value,categoryId:category.value};
  if(!selected||!validFinanceEntry(fields,{date:today,categories}))throw Error('请核对收支类型、金额、日期和分类');
  const current=readFinance(store);
  if(current.primary!==primary)throw Error('账本已变更，请重新生成候选');
  const next=current.payload??freshData();
  if(next.transactions.some(tx=>tx.id===id))throw Error('这条候选已保存');
  next.transactions.push({...fields,id,note:note.value.trim(),time:normalizeClock(time.value),createdAt:new Date().toISOString(),
   categoryName:selected.name,categoryIcon:selected.icon,categoryColor:selected.color,
   budgetSync:fields.type==='income'&&budget.checked,budgetExcluded:fields.type==='expense'&&!budget.checked});
  next.prefs??={};
  next.prefs[fields.type==='income'?'lastIncomeCategoryId':'lastExpenseCategoryId']=selected.id;
  replaceFinance(store,next,primary);
  return '财务记录已保存。';
 };
}
