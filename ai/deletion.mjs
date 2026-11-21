import {displayDay,normalizeClock,syncCalendarFields} from '../calendar.mjs';
import {readFinance} from '../finance-storage.mjs';
import {deleteEvent,events,inventoryWithMoves,round,validDate} from '../health/core.mjs';
import {purchaseForTransaction} from '../health/purchases.mjs';
import {deleteUnlinkedTransactions} from '../health/purchase-sync.mjs';
import {displayStockQuantity,stockMeasure} from '../health/inventory.mjs';

const kinds={food:'饮食记录',plan:'饮食计划',weight:'体重记录',activity:'运动记录',finance:'收支记录'};
const lists={food:'foods',plan:'foods',weight:'weights',activity:'activities'};
const normalize=value=>String(value??'').trim().toLowerCase();

export function healthDeletion(state,key,ids){
 const current=new Set(events(state,key).map(row=>row.id));
 if(!ids.length||ids.some(id=>!current.has(id)))throw Error('原记录已变更，请重新核对');
 const next=structuredClone(state);
 for(const id of ids)deleteEvent(next,key,id);
 return next;
}

export async function deleteReview(container,proposal,workspace,today,foodDate,direct=false){
 const {kind,query,meal,selection}=proposal.result;
 const key=lists[kind];
 const state=await workspace.readHealth();
 const finance=kind==='finance'?readFinance(workspace.finance):null;
 const categories=new Map(finance?.payload?.categories.map(row=>[row.id,row.name]));
 const transactions=(finance?.payload?.transactions??[]).filter(row=>row.id).map(row=>{
  const category=categories.get(row.categoryId)||row.categoryName||'未分类';
  return {...row,title:row.note||category,details:[row.type==='expense'?'支出':'收入','¥'+row.amount,category],
   linked:!!purchaseForTransaction(state,row.id)};
 });
 const candidates=key?events(state,key):transactions;
 const label=document.createElement('label'),date=document.createElement('input');
 const title=document.createElement('h3'),rows=document.createElement('div'),preview=document.createElement('p');
 title.textContent='核对要删除的'+kinds[kind];
 rows.className='assistant-delete-list';preview.className='assistant-delete-preview';
 date.type='date';date.dataset.shortDate='';
 date.value=validDate(proposal.date)?proposal.date:(kind==='food'&&validDate(foodDate)?foodDate:'');
 label.textContent='日期';label.append(date);
 container.append(title,label,rows,preview);
 syncCalendarFields(container);

 function selected(){return [...rows.querySelectorAll('input:checked:not(:disabled)')].map(input=>input.value);}
 function updatePreview(){
  const ids=new Set(selected()),counts=new Map();
  if(kind==='food')for(const move of state.local.stockMoves){
   if(!ids.has(move.linkedFoodId))continue;
   counts.set(move.foodId,(counts.get(move.foodId)??0)-move.delta);
  }
  const changes=inventoryWithMoves(state).filter(row=>counts.has(row.id)).map(row=>
   row.name+' 恢复 '+round(displayStockQuantity(row,counts.get(row.id)),3)+' '+stockMeasure(row).unit);
  preview.textContent=ids.size?('已选 '+ids.size+' 条'+(changes.length?' · '+changes.join('、'):'')):'请勾选要删除的原记录。';
 }
 function render(){
  rows.replaceChildren();
  const term=normalize(query);
  if(!date.value&&!term){
   preview.textContent='请选择日期后核对该日记录。';
   return;
  }
  const matches=candidates.filter(row=>
   (!date.value||row.date===date.value)&&(kind==='plan'||row.date<=today)&&
   (!meal||row.meal===meal)&&
   (kind!=='plan'||row.status==='plan')&&(kind!=='food'||row.status!=='plan')&&
   (!term||normalize([row.title??row.name,row.kg,...(row.details??[])].filter(Boolean).join(' ')).includes(term)));
  matches.sort((a,b)=>b.date.localeCompare(a.date)||normalizeClock(b.time).localeCompare(normalizeClock(a.time)));
  for(const row of matches){
   const item=document.createElement('label'),check=document.createElement('input');
   const text=document.createElement('span'),name=document.createElement('strong'),sub=document.createElement('small');
   check.type='checkbox';check.value=row.id;check.disabled=!!row.linked;check.onchange=updatePreview;
   name.textContent=row.title??row.name??(row.kg+' kg');
   sub.textContent=[displayDay(row.date),normalizeClock(row.time),row.meal,row.portion,
    ...(kind==='activity'?[row.minutes==null?null:row.minutes+' 分钟',row.kcal==null?null:row.kcal+' kcal']:[]),
    ...(row.details??[]),row.linked?'到库存页撤销关联采购':''].filter(Boolean).join(' · ');
   text.append(name,sub);item.append(check,text);rows.append(item);
  }
  if(direct){
   if(!matches.length)throw Error('找不到要删除的原记录，请补充日期或名称。');
   if(selection!=='all'&&matches.length!==1)throw Error('找到多条匹配的记录，请指明要删哪条。');
   if(matches.some(row=>row.linked))throw Error('该支出关联采购，请指定撤销对应的采购订单。');
   for(const check of rows.querySelectorAll('input'))check.checked=true;
  }
  if(matches.length)updatePreview();
  else preview.textContent='没有找到符合条件的记录。可核对日期或换个关键词。';
 }
 date.addEventListener('change',render);
 render();
 return async()=>{
  const ids=selected();
  if(!ids.length)throw Error('请先勾选要删除的记录');
  if(key)await workspace.saveHealth(healthDeletion(state,key,ids),state.revision??0);
  else await deleteUnlinkedTransactions(workspace.account,ids,finance.primary);
  const receipt='已删除 '+ids.length+' 条'+kinds[kind]+'。';
  if(!direct)return receipt;
  const dropped=candidates.filter(row=>ids.includes(row.id));
  return receipt+' '+dropped.map(row=>[displayDay(row.date),row.meal,row.title??row.name??(row.kg+' kg')]
   .filter(Boolean).join(' · ')).join('、')+'。';
 };
}
