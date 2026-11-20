import {inventoryWithMoves,numeric,round} from './core.mjs';
import {stockAlerts} from './inventory.mjs';

export function addLowStock(state,today){
 const list=state.local.shoppingList??=[];
 for(const sku of stockAlerts(state,today).low){
  if(list.some(row=>row.foodId===sku.id))continue;
  const quantity=Math.max(sku.minimum-sku.qty,sku.minimum>0?sku.minimum:1);
  list.push({foodId:sku.id,quantity,selected:false});
 }
}
export function setShoppingItem(state,foodId,value,selected=false){
 const quantity=numeric(value);
 if(!(quantity>0)||!inventoryWithMoves(state).some(x=>x.id===foodId&&x.active))throw Error('请选择食品并填写补货数量');
 const list=state.local.shoppingList??=[];
 const row=list.find(x=>x.foodId===foodId);
 if(row)Object.assign(row,{quantity,selected});
 else list.push({foodId,quantity,selected});
}
export function settleShopping(state,items,selected){
 const amounts=new Map();
 for(const row of items)amounts.set(row.foodId,(amounts.get(row.foodId)??0)+row.quantity);
 state.local.shoppingList=(state.local.shoppingList??[]).flatMap(row=>{
  if(!selected.has(row.foodId))return [row];
  const quantity=round(row.quantity-(amounts.get(row.foodId)??0),6);
  return quantity>0?[{...row,quantity,selected:false}]:[];
 });
}

export function attachShopping({getState,commit,notify,today,openOrder}){
 const form=document.querySelector('#shopping-form'),list=document.querySelector('#shopping-list');
 const panel=form.closest('details'),draft=panel.querySelector('[data-to-purchase]');
 let saving=false;
 const action=async change=>{
  if(saving)return;
  saving=true;draft.disabled=true;
  try{const next=structuredClone(getState());change(next);await commit(next,'补货清单已保存');}
  catch(err){notify(err.message);}
  finally{saving=false;draft.disabled=false;}
 };
 const button=(text,fn)=>{
  const el=document.createElement('button');el.type='button';el.className='btn btn-text';el.textContent=text;el.onclick=fn;return el;
 };
 form.onsubmit=e=>{
  e.preventDefault();
  action(next=>setShoppingItem(next,form.elements.foodId.value,form.elements.quantity.value));
 };
 panel.querySelector('[data-low-stock]').onclick=()=>action(next=>addLowStock(next,today()));
 draft.onclick=()=>{
  const items=(getState().local.shoppingList??[]).filter(x=>x.selected);
  if(!items.length){notify('请先勾选要采购的食品');return;}
  openOrder(items);
 };
 return ()=>{
  const state=getState(),items=inventoryWithMoves(state);
  const rows=(state.local.shoppingList??[]).map(row=>{
   const item=items.find(i=>i.id===row.foodId);
   if(!item)return null;
   const line=document.createElement('div');line.className='event-row shopping-row';
   const label=document.createElement('label');label.className='checkbox';
   const check=document.createElement('input');check.type='checkbox';check.checked=row.selected;
   check.onchange=()=>action(next=>{next.local.shoppingList.find(x=>x.foodId===row.foodId).selected=check.checked;});
   label.append(check,item.name);
   const qty=document.createElement('input');Object.assign(qty,{type:'number',min:'0.000001',step:'any',value:row.quantity});
   qty.setAttribute('aria-label',item.name+' 补货数量（'+item.unit+'）');
   qty.onchange=()=>action(next=>setShoppingItem(next,row.foodId,qty.value,row.selected));
   line.append(label,qty,document.createTextNode(item.unit),button('移除',()=>action(next=>{
    next.local.shoppingList=next.local.shoppingList.filter(x=>x.foodId!==row.foodId);
   })));
   return line;
  }).filter(Boolean);
  list.replaceChildren(...(rows.length?rows:[document.createTextNode('清单为空')]));
 };
}
