import {displayDay,localClock,syncCalendarFields} from '../calendar.mjs';
import {inventoryWithMoves,localStockChange,validDate} from '../health/core.mjs';
import {setShoppingItem} from '../health/shopping.mjs';
import {cleanSkill,SKILL_LIMIT} from './workspace.mjs';

function field(parent,name,control){
 const label=document.createElement('label');
 label.append(name,control);parent.append(label);return control;
}
function heading(parent,text){
 const title=document.createElement('h3');title.textContent=text;parent.append(title);
}
export function skillReview(container,current,suggested){
 heading(container,'更新 Skill');
 const before=document.createElement('p');before.textContent='原偏好：'+(current||'未设置');
 container.append(before);
 const edit=field(container,'新偏好',document.createElement('textarea'));
 edit.maxLength=SKILL_LIMIT;edit.rows=3;edit.value=suggested;edit.required=true;
 return ()=>cleanSkill(edit.value);
}
export function inventoryReview(container,proposal,current,today){
 const {operation,name,quantity,unit}=proposal.result,shopping=operation==='shopping';
 heading(container,shopping?'更新补货清单':'盘点库存');
 const stock=inventoryWithMoves(current).filter(s=>s.active);
 const item=field(container,'食品',document.createElement('select'));
 item.add(new Option('请选择已有食品',''));
 for(const row of stock)item.add(new Option(row.name+' · '+row.unit,row.id));
 const matches=stock.filter(s=>s.name===name&&s.unit===unit);
 if(matches.length===1)item.value=matches[0].id;
 item.required=true;
 const grid=document.createElement('div');grid.className='form-grid';container.append(grid);
 const qty=field(grid,shopping?'待采购数量':'实际库存',document.createElement('input'));
 Object.assign(qty,{type:'number',required:true,min:shopping?'0.000001':'0',max:'100000',step:'any'});
 const date=shopping?null:field(grid,'日期',document.createElement('input'));
 if(date)Object.assign(date,{type:'date',required:true,max:today,value:validDate(proposal.date)&&proposal.date<=today?proposal.date:today});
 const preview=document.createElement('p');container.append(preview);
 const selection=()=>stock.find(s=>s.id===item.value);
 function update(){
  const row=selection();
  const previous=shopping?(current.local.shoppingList??[]).find(x=>x.foodId===row?.id)?.quantity:row?.qty;
  preview.textContent=row?
   (shopping?'原清单':'原库存')+' '+(previous??'未知')+' → '+(qty.value||'待填')+' '+row.unit
   +(date?.value?' · '+displayDay(date.value):''):
   '助手建议「'+name+'」'+quantity+' '+unit+'，请选择食品并核对数量单位。';
 }
 qty.value=item.value?String(quantity):'';
 item.onchange=()=>{qty.value=selection()?.unit===unit?String(quantity):'';update();};
 qty.oninput=update;if(date)date.onchange=update;
 update();syncCalendarFields(container);
 return ()=>{
  const row=selection(),value=qty.valueAsNumber;
  if(!row||!Number.isFinite(value)||value<0||value>100000)throw Error('请核对食品和数量');
  const next=structuredClone(current);
  if(shopping)setShoppingItem(next,row.id,value);
  else {
   if(!validDate(date.value)||date.value>today)throw Error('请核对盘点日期');
   localStockChange(next,{foodId:row.id,delta:value,date:date.value,time:localClock(),count:true,reason:'助手盘点 · 已确认'});
  }
  return next;
 };
}
