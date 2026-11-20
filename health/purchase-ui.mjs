import {readFinance} from '../finance-storage.mjs';
import {inventoryWithMoves,numeric} from './core.mjs';
import {cents,newPurchaseId,purchaseForTransaction,purchaseTransactionId,recordPurchase} from './purchases.mjs';

export function attachPurchases({getState,commit,notify,switchTab,today}) {
 const account=window.airplaneAccount;
 const form=document.querySelector('#purchase-form'),lines=form.querySelector('[data-lines]');
 const output=document.querySelector('#purchases-list');
 const button=form.querySelector('[type=submit]');
 const finance=()=>readFinance(account.finance).payload?.transactions.filter(t=>t.type==='expense')??[];
 const params=new URL(location.href).searchParams;
 let orderId=newPurchaseId();
 const label=(name,input)=>{
  const l=document.createElement('label');l.append(name,input);return l;
 };
 function addLine(){
  const row=document.createElement('fieldset');row.className='form-grid';
  const sku=document.createElement('select');sku.name='foodId';
  for(const item of inventoryWithMoves(getState()).filter(s=>s.active))sku.add(new Option(item.name+' · '+item.unit,item.id));
  const input=(name,type,required=false)=>{
   const el=document.createElement('input');Object.assign(el,{name,type,required});
   if(type==='number')Object.assign(el,{min:name==='quantity'?'0.000001':'0',step:name==='quantity'?'any':'0.01'});
   return el;
  };
  row.append(label('食品',sku),label('数量',input('quantity','number',true)),
   label('该项金额 ¥',input('cost','number')),label('到期日',input('expires','date')));
  const del=document.createElement('button');del.type='button';del.textContent='移除该项';del.className='btn btn-text';
  del.onclick=()=>{if(lines.children.length>1)row.remove();};
  row.append(del);lines.append(row);
 }
 function refreshLinks(){
  const select=form.elements.financeId,selected=select.value;
  select.replaceChildren(new Option('先保存采购', ''));
  try{
   for(const tx of finance().filter(t=>!purchaseForTransaction(getState(),t.id)).slice().reverse())
    select.add(new Option(tx.date+' · '+tx.amount+' 元 · '+(tx.note||tx.categoryName||'支出'),tx.id));
  }catch(err){notify(err.message);}
  if([...select.options].some(o=>o.value===selected))select.value=selected;
 }
 function openFinance(order){
  const url=new URL('../index.html',location.href);
  if(account.id)url.searchParams.set('private','1');
  url.searchParams.set('purchase',order.id);
  location.href=url.href;
 }
 function render(){
  let transactions=[];
  try {transactions=finance();}catch {}
  const els=(getState().local.purchases??[]).slice().reverse().map(order=>{
   const tx=transactions.find(t=>t.id===purchaseTransactionId(order));
   const p=document.createElement('p');
   p.textContent=order.date+' · ¥'+(order.totalCents/100).toFixed(2)+' · '+order.items.length+' 项 · '+(order.note||'采购');
   if(tx){
    const linked=cents(tx.amount)===order.totalCents;
    p.append(linked?' · 已关联支出':' · 关联支出金额待核对');
   } else if(!order.financeId && order.totalCents>0){
    const action=document.createElement('button');action.type='button';action.className='btn btn-text';action.textContent='去财务确认支出';
    action.onclick=()=>openFinance(order);p.append(' ',action);
   }else if(order.financeId)p.append(' · 关联支出待恢复');
   return p;
  });
  output.replaceChildren(...els);
  refreshLinks();
 }
 function reset(){
  form.reset();form.elements.date.value=today();orderId=newPurchaseId();
  lines.replaceChildren();addLine();render();
 }
 form.querySelector('[data-add-line]').onclick=addLine;
 const details=form.closest('details');
 details.addEventListener('toggle',()=>{if(details.open && !lines.firstChild)reset();});
 form.elements.financeId.onchange=()=>{
  const tx=finance().find(t=>t.id===form.elements.financeId.value);
  if(tx){form.elements.total.value=tx.amount;form.elements.date.value=tx.date;}
 };
 form.onsubmit=async e=>{
  e.preventDefault();
  if(button.disabled)return;
  button.disabled=true;
  try{
   const fields=new FormData(form),financeId=fields.get('financeId')||null;
   const order={id:orderId,date:fields.get('date'),totalCents:cents(fields.get('total')),financeId,note:fields.get('note'),
    items:[...lines.children].map(row=>({
     foodId:row.querySelector('[name=foodId]').value,quantity:numeric(row.querySelector('[name=quantity]').value),
     costCents:row.querySelector('[name=cost]').value===''?null:cents(row.querySelector('[name=cost]').value),
     expires:row.querySelector('[name=expires]').value||null
    }))};
   const tx=financeId?finance().find(t=>t.id===financeId):null,next=structuredClone(getState());
   const saved=recordPurchase(next,order,tx);
   const go=form.elements.createExpense.checked&&!financeId&&saved.totalCents>0;
   await commit(next,financeId?'订单已入库并关联支出':'订单已入库');
   reset();
   if(go)openFinance(saved);
  }catch(err){notify(err.message);}
  finally{button.disabled=false;}
 };
 render();
 if(params.has('financeTx')){
  switchTab('inventory');details.open=true;reset();
  if(purchaseForTransaction(getState(),params.get('financeTx')))notify('这笔支出已关联采购');
  else{
   form.elements.financeId.value=params.get('financeTx');
   form.elements.financeId.onchange();
  }
  details.scrollIntoView();
 }
 return ()=>{
  // Populate product choices lazily, after the food library exists.
  for(const select of lines.querySelectorAll('[name=foodId]')){
   const previous=select.value;
   select.replaceChildren(...inventoryWithMoves(getState()).filter(s=>s.active).map(s=>new Option(s.name+' · '+s.unit,s.id)));
   if([...select.options].some(o=>o.value===previous))select.value=previous;
  }
  render();
 };
}
