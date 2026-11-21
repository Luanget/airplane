import {readFinance} from '../finance-storage.mjs';
import {syncChoiceFields} from '../choice-picker.mjs';
import {confirmAction} from '../shell.mjs';
import {inventoryWithMoves,isStockReference} from './core.mjs';
import {cents,newPurchaseId,orderBatchId,purchaseForTransaction,purchaseTransactionId,recordPurchase,revisePurchase} from './purchases.mjs';
import {projectedExpense,readPendingPurchase,updatePurchaseLedgers,resumePurchaseUpdate,abandonPurchaseUpdate} from './purchase-sync.mjs';
import {settleShopping} from './shopping.mjs';
import {displayDay,localClock,normalizeClock,syncCalendarFields} from '../calendar.mjs';
import {displayStockQuantity,stockMeasure,storedStockQuantity} from './inventory.mjs';
import {stockName,stockUnit} from './presentation.mjs';

export function attachPurchases({getState,commit,setState,notify,switchTab,today}) {
 const account=window.airplaneAccount;
 const form=document.querySelector('#purchase-form'),lines=form.querySelector('[data-lines]');
 const output=document.querySelector('#purchases-list'),details=form.closest('details');
 const button=form.querySelector('[type=submit]'),cancelEdit=form.querySelector('[data-close-edit]');
 const home=document.createComment('采购录入表单');form.before(home);
 const pendingPanel=document.querySelector('#purchase-recovery');
 const params=new URL(location.href).searchParams;
 let orderId=newPurchaseId(),editing=null,shopping=new Set(),saving=false;
 const ledger=()=>readFinance(account.finance).payload?.transactions??[];
 const finance=()=>ledger().filter(t=>t.type==='expense');
 const label=(name,input)=>{
  const l=document.createElement('label');l.append(name,input);return l;
 };
 function action(text,handler,attrs={}){
  const el=document.createElement('button');
  Object.assign(el,{type:'button',className:'btn btn-text',textContent:text,...attrs});
  el.onclick=handler;return el;
 }
 const foods=retainedId=>inventoryWithMoves(getState()).filter(s=>s.active&&!isStockReference(s)||s.id===retainedId);
 function setFoodChoices(select,id){
  select.replaceChildren(...foods(id).map(s=>new Option(stockName(s)+' · '+stockUnit(stockMeasure(s).unit),s.id)));
  if([...select.options].some(option=>option.value===id))select.value=id;
 }
 function addLine(item={}){
  const row=document.createElement('fieldset');row.className='form-grid';
  if(item.batchId)row.dataset.batchId=item.batchId;
  const sku=document.createElement('select');sku.name='foodId';sku.dataset.picker='选择食品';sku.dataset.pickerSearch='';
  setFoodChoices(sku,item.foodId);
  const input=(name,type,value,required=false)=>{
   const el=document.createElement('input');Object.assign(el,{name,type,required,value:value??''});
   if(type==='number')Object.assign(el,{min:name==='quantity'?'0.000001':'0',step:name==='quantity'?'any':'0.01'});
   return el;
  };
  const food=()=>foods(sku.value).find(x=>x.id===sku.value),qty=input('quantity','number',displayStockQuantity(food(),item.quantity),true);
  const qtyTitle=document.createElement('span');
  const explainQuantity=()=>{
   const unit=stockUnit(stockMeasure(food()).unit);
   qtyTitle.textContent=unit?'数量（'+unit+'）':'数量';
  };
  explainQuantity();sku.onchange=()=>{qty.value='';explainQuantity();};
  row.append(label('食品',sku),label(qtyTitle,qty),
   label('该项金额 ¥',input('cost','number',item.costCents==null?'':item.costCents/100)),label('到期日',input('expires','date',item.expires)));
  row.append(action('移除该项',()=>{if(lines.children.length>1)row.remove();}));
  lines.append(row);syncCalendarFields(row);syncChoiceFields(row);
 }
 function refreshLinks(){
  if(editing)return;
  const select=form.elements.financeId,selected=select.value;
  select.replaceChildren(new Option('先保存采购', ''));
  try{
   for(const tx of finance().filter(t=>!t.receiptKey&&!purchaseForTransaction(getState(),t.id)).slice().reverse())
    select.add(new Option(displayDay(tx.date)+' · '+tx.amount+' 元 · '+(tx.note||tx.categoryName||'支出'),tx.id));
  }catch(err){notify(err.message);}
  if([...select.options].some(o=>o.value===selected))select.value=selected;
 }
 function openFinance(order){
  const url=new URL('../index.html',location.href);
  if(account.demo)url.searchParams.set('demo','1');
  url.searchParams.set('purchase',order.id);
  location.href=url.href;
 }
 function dockEditor(row){
  if(row){row.after(form);form.classList.add('inline-inventory-editor');}
  else{home.after(form);form.classList.remove('inline-inventory-editor');}
 }
 function render(){
  dockEditor(null);
  let transactions=[];
  try {transactions=finance();}catch {}
  const els=(getState().local.purchases??[]).slice().reverse().map(order=>{
   const tx=transactions.find(t=>t.id===purchaseTransactionId(order));
   const p=document.createElement('p');p.dataset.purchaseId=order.id;
   const amount='¥'+(order.totalCents/100).toFixed(2);
   const name=order.receiptId?(order.items.every(row=>row.costCents==null)?'食品成本未知':'食品已核实 '+amount):amount;
   p.textContent=displayDay(order.date)+(normalizeClock(order.time)?' '+normalizeClock(order.time):'')+' · '+name+' · '+order.items.length+' 项 · '+(order.note||'采购');
   if(order.status==='cancelled'){p.append(' · 已撤销');return p;}
   if(order.receiptId){
    const count=order.financeIds.filter(id=>transactions.some(row=>row.id===id)).length;
    p.append(' · 截图采购 · '+count+'/'+order.financeIds.length+' 笔关联支出');
    if(order.items.some(row=>row.costCents==null)&&order.items.some(row=>row.costCents!=null))p.append(' · 部分食品成本未知');
    return p;
   }
   if(tx){
    p.append(cents(tx.amount)===order.totalCents?' · 已关联支出':' · 关联支出金额待核对');
   } else if(!order.financeId&&order.totalCents>0){
    p.append(' ',action('去财务确认支出',()=>openFinance(order)));
   }else if(order.financeId)p.append(' · 关联支出待恢复');
   p.append(' ',action('编辑采购',()=>editing?.id===order.id?reset():openEdit(order),{'ariaExpanded':String(editing?.id===order.id)}),action('撤销采购',()=>void withdraw(order)));
   if(order.history?.length)p.append(' · '+order.history.length+' 次更正');
   return p;
  });
  output.replaceChildren(...els);
  if(editing)dockEditor(els.find(row=>row.dataset.purchaseId===editing.id));
  refreshLinks();
  syncChoiceFields(form);
 }
 function reset(items=[]){
  editing=null;shopping=new Set(items.map(i=>i.foodId));
  cancelEdit.hidden=true;form.elements.financeId.disabled=false;form.elements.createExpense.disabled=false;
  form.reset();form.elements.date.value=today();form.elements.time.value=localClock();orderId=newPurchaseId();button.textContent='确认采购入库';
  lines.replaceChildren();(items.length?items:[{}]).forEach(addLine);render();syncCalendarFields(form);
 }
 function reveal(){
  switchTab('inventory');details.open=true;details.scrollIntoView({block:'start'});
 }
 function openEdit(order,fromFinance=false){
  if(order.receiptId){notify('截图采购关联整单支出，请在原对话核对或撤销。');return;}
  form.reset();editing=order;shopping=new Set();
  button.textContent='保存采购更正';cancelEdit.hidden=false;
  form.elements.financeId.disabled=true;form.elements.createExpense.disabled=true;
  form.elements.date.value=order.date;form.elements.time.value=normalizeClock(order.time);form.elements.total.value=(order.totalCents/100).toFixed(2);form.elements.note.value=order.note;
  lines.replaceChildren();order.items.forEach((r,i)=>addLine({...r,batchId:orderBatchId(order,r,i)}));syncChoiceFields(form);
  details.open=true;render();syncCalendarFields(form);
  if(fromFinance){switchTab('inventory');form.scrollIntoView({block:'nearest'});}
 }
 function readItems(){
  const foods=new Map(inventoryWithMoves(getState()).map(row=>[row.id,row]));
  return [...lines.children].map(row=>{
   const foodId=row.querySelector('[name=foodId]').value;
   return {
   foodId,quantity:storedStockQuantity(foods.get(foodId),row.querySelector('[name=quantity]').value),
   costCents:row.querySelector('[name=cost]').value===''?null:cents(row.querySelector('[name=cost]').value),
   expires:row.querySelector('[name=expires]').value||null,
   ...(row.dataset.batchId?{batchId:row.dataset.batchId}:{})
   };
  });
 }
 async function showPending(){
  try {pendingPanel.hidden=!(await readPendingPurchase(account));}catch(err){notify(err.message);}
 }
 async function revision(order,fields){
  const current=getState(),{next,order:updated}=revisePurchase(current,order.id,fields);
  const tx=ledger().find(t=>t.id===purchaseTransactionId(order));
  const change=projectedExpense(order,updated,tx);
  const message=updated?'保存采购和关联支出的修改？':'撤销这笔采购及其关联支出？';
  const amounts=change?'\n支出 '+change.before.amount+' 元 → '+(change.after?.amount??0)+' 元。':'';
  if(!await confirmAction({title:updated?'核对采购修改':'撤销采购',message:message+amounts,
   action:updated?'确认修改':'确认撤销',danger:!updated}))return;
  const saved=await updatePurchaseLedgers(account,next,current.revision??0,change);
  setState(saved);reset();notify(updated?'采购已更正':'采购已撤销');
 }
 async function withdraw(order){
  if(saving)return;
  saving=true;
  try {await revision(order,null);}catch(err){notify(err.message);}
  finally{saving=false;await showPending();}
 }
 form.querySelector('[data-add-line]').onclick=()=>addLine();
 cancelEdit.onclick=()=>reset();
 details.addEventListener('toggle',()=>{if(details.open&&!lines.firstChild)reset();});
 form.elements.financeId.onchange=()=>{
  const tx=finance().find(t=>t.id===form.elements.financeId.value);
  if(tx){form.elements.total.value=tx.amount;form.elements.date.value=tx.date;form.elements.time.value=normalizeClock(tx.time);syncCalendarFields(form);}
 };
 form.onsubmit=async e=>{
  e.preventDefault();
  if(saving)return;
  saving=true;button.disabled=true;
  try{
   const fields=new FormData(form);
   const order={id:orderId,date:fields.get('date'),totalCents:cents(fields.get('total')),financeId:fields.get('financeId')||null,
    note:fields.get('note'),time:fields.get('time'),items:readItems()};
   if(editing){await revision(editing,order);return;}
   const tx=order.financeId?finance().find(t=>t.id===order.financeId):null,next=structuredClone(getState());
   const saved=recordPurchase(next,order,tx);
   if(shopping.size)settleShopping(next,saved.items,shopping);
   const go=form.elements.createExpense.checked&&!order.financeId&&saved.totalCents>0;
   await commit(next,order.financeId?'订单已入库并关联支出':'订单已入库');
   reset();
   if(go)openFinance(saved);
  }catch(err){notify(err.message);}
  finally{saving=false;button.disabled=false;await showPending();}
 };
 pendingPanel.querySelector('[data-resume]').onclick=async()=>{
  try {const saved=await resumePurchaseUpdate(account);setState(saved);notify('财务与健康账本已同步');}
  catch(err){notify(err.message);}
  finally{await showPending();}
 };
 pendingPanel.querySelector('[data-abandon]').onclick=async()=>{
  if(!await confirmAction({title:'放弃更新',message:'放弃尚未写入的账本更新？',action:'确认放弃',danger:true}))return;
  try {const saved=await abandonPurchaseUpdate(account);setState(saved);notify('已放弃本次更新');}
  catch(err){notify(err.message);}
  finally{await showPending();}
 };
 render();void showPending();
 if(params.has('financeTx')){
  reveal();reset();
  if(purchaseForTransaction(getState(),params.get('financeTx')))notify('这笔支出已关联采购');
  else{form.elements.financeId.value=params.get('financeTx');form.elements.financeId.onchange();}
 }
 if(params.has('editPurchase')){
  const match=getState().local.purchases?.find(x=>x.id===params.get('editPurchase')&&x.status!=='cancelled');
  if(match)openEdit(match,true);
 }
 return {
  openOrder(items){reset(items);reveal();},
  render(){
   for(const select of lines.querySelectorAll('[name=foodId]'))setFoodChoices(select,select.value);
   render();
  }
 };
}
