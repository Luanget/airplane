import {displayDay,localClock,normalizeClock,syncCalendarFields} from '../calendar.mjs';
import {dayIntake,inventoryWithMoves,isOnHand,isStockReference,localStockChange,numeric,validDate} from '../health/core.mjs';
import {matchFoodRecords,reviseFoodPortion} from '../health/food-history.mjs';
import {setShoppingItem} from '../health/shopping.mjs';
import {displayStockQuantity,portionSources,registerPortions,stockMeasure,storedStockQuantity} from '../health/inventory.mjs';
import {quantityInUnit} from '../health/candidates.mjs';
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
export function portionReview(container,proposal,current,today){
 const {name,quantities,unit}=proposal.result;
 heading(container,'记录库存分装');
 const stock=inventoryWithMoves(current).filter(isOnHand);
 const item=field(container,'食品',document.createElement('select'));
 item.required=true;item.dataset.pickerSearch='';
 item.add(new Option('选择在库食品',''));
 for(const sku of stock)item.add(new Option(sku.name,sku.id));
 const matches=stock.filter(sku=>sku.name===name);
 if(matches.length===1)item.value=matches[0].id;
 const sources=field(container,'原库存',document.createElement('select'));
 const weights=field(container,'各份数量（'+unit+'）',document.createElement('textarea'));
 weights.rows=2;weights.required=true;weights.value=quantities.join('、');
 const date=validDate(proposal.date)&&proposal.date<=today?proposal.date:today;
 const preview=document.createElement('p');container.append(preview);
 function read(currentState=current){
  const sku=inventoryWithMoves(currentState).find(row=>row.id===item.value);
  if(!sku||!isOnHand(sku))throw Error('请选择仍有库存的食品');
  const parts=weights.value.normalize('NFKC').trim().split(/[,、;；\s]+/).map(value=>quantityInUnit(sku,numeric(value),unit,sku.unit));
  const next=structuredClone(currentState);
  registerPortions(next,{foodId:sku.id,batchId:sources.value,date,quantities:parts});
  return next;
 }
 function update(){
  try{read();preview.textContent=displayDay(date)+' · 分装后库存总量不变';}
  catch(err){preview.textContent=err.message;}
 }
 function updateSources(){
  const sku=stock.find(row=>row.id===item.value),selected=sources.value;
  const available=portionSources(current,sku,date);
  sources.replaceChildren(...available.map(source=>new Option(
   (source.date?displayDay(source.date):'未分批库存')+' · 余 '+displayStockQuantity(sku,source.remaining)+' '+stockMeasure(sku).unit,source.id)));
  if(available.some(source=>source.id===selected))sources.value=selected;
  update();
 }
 item.onchange=updateSources;sources.onchange=update;weights.oninput=update;
 updateSources();
 return {apply:read,label:'确认分装',saved:'已保存分装重量。'};
}
export function inventoryReview(container,proposal,current,today){
 const {operation,name,quantity,unit}=proposal.result,shopping=operation==='shopping';
 heading(container,shopping?'更新补货清单':'盘点库存');
 const stock=inventoryWithMoves(current).filter(s=>s.active&&!isStockReference(s));
 const item=field(container,'食品',document.createElement('select'));
 item.add(new Option('请选择已有食品',''));
 for(const row of stock)item.add(new Option(row.name+' · '+stockMeasure(row).unit,row.id));
 const matches=stock.filter(s=>s.name===name&&(s.unit===unit||stockMeasure(s).unit===unit));
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
  const stored=shopping?(current.local.shoppingList??[]).find(x=>x.foodId===row?.id)?.quantity:row?.qty;
  const previous=displayStockQuantity(row,stored);
  preview.textContent=row?
   (shopping?'原清单':'原库存')+' '+(previous??'未知')+' → '+(qty.value||'待填')+' '+stockMeasure(row).unit
   +(date?.value?' · '+displayDay(date.value):''):
   '助手建议「'+name+'」'+quantity+' '+unit+'，请选择食品并核对数量单位。';
 }
 function fillQuantity(){
  const row=selection();
  qty.value=row&&(row.unit===unit||stockMeasure(row).unit===unit)?
   String(row.unit===unit?displayStockQuantity(row,quantity):quantity):'';
  update();
 }
 item.onchange=fillQuantity;
 qty.oninput=update;if(date)date.onchange=update;
 fillQuantity();syncCalendarFields(container);
 return (state=current)=>{
  const row=selection(),value=qty.valueAsNumber;
  if(!row||!Number.isFinite(value)||value<0||value>100000)throw Error('请核对食品和数量');
  const next=structuredClone(state);
  if(shopping)setShoppingItem(next,row.id,storedStockQuantity(row,value));
  else {
   if(!validDate(date.value)||date.value>today)throw Error('请核对盘点日期');
   localStockChange(next,{foodId:row.id,delta:storedStockQuantity(row,value),date:date.value,time:localClock(),count:true,reason:'助手盘点 · 已确认'});
  }
  return next;
 };
}

export function foodEditReview(container,proposal,current,today,lastFoodDate){
 const date=proposal.date??lastFoodDate;
 if(!validDate(date)||date>today)throw Error('请先指定日期，或查询那天的饮食记录');
 const {name,amount,unit,meal,time}=proposal.result;
 if(!name.trim())throw Error('请指定要更正的食品');
 const rows=matchFoodRecords(current,date,name).filter(row=>
  (!meal||row.meal===meal)&&(!time||normalizeClock(row.time)===time));
 if(!rows.length)throw Error(displayDay(date)+'没有找到匹配的「'+name+'」记录，请核对日期或餐次');
 heading(container,'更正原饮食记录');
 const selection=field(container,'原记录',document.createElement('select'));
 if(rows.length>1)selection.add(new Option('找到多条，请选择一条',''));
 for(const row of rows)selection.add(new Option([row.name,row.meal,normalizeClock(row.time),row.portion].filter(Boolean).join(' · '),row.id));
 selection.required=true;
 const quantity=field(container,'新份量（'+unit+'）',document.createElement('input'));
 Object.assign(quantity,{type:'number',required:true,min:'0.001',max:'100000',step:'any',value:amount});
 const preview=document.createElement('div');
 preview.className='food-edit-diff';preview.setAttribute('aria-live','polite');
 container.append(preview);
 function calculate(state=current){
  return reviseFoodPortion(state,{id:selection.value,date,amount:quantity.valueAsNumber,unit});
 }
 function update(){
  preview.replaceChildren();
  if(!selection.value)return;
  try{
   const {before,after,stock,next}=calculate();
   const list=document.createElement('dl');
   const pair=(label,value)=>{
    const dt=document.createElement('dt'),dd=document.createElement('dd');
    dt.textContent=label;dd.textContent=value;list.append(dt,dd);
   };
   const calories=v=>v===null?'未知':v+' kcal';
   pair('日期',[displayDay(date,true),before.meal,normalizeClock(before.time)].filter(Boolean).join(' · '));
   pair('份量',before.portion+' → '+after.portion);
   pair('热量',calories(before.nutrition.kcal)+' → '+calories(after.nutrition.kcal));
   for(const [key,label,measure] of [['protein','蛋白质','g'],['carbs','碳水','g'],['fat','脂肪','g'],['sodium','钠','mg']]){
    if(after.nutrition[key]!==null)pair(label,before.nutrition[key]+' → '+after.nutrition[key]+' '+measure);
   }
   pair('当日热量',calories(dayIntake(current,date).totals.kcal)+' → '+calories(dayIntake(next,date).totals.kcal));
   const sku=stock&&inventoryWithMoves(current).find(row=>row.id===before.foodId);
   pair('库存',stock?stock.name+' '+displayStockQuantity(sku,stock.before)+' → '+displayStockQuantity(sku,stock.after)+' '+stockMeasure(sku).unit:'原记录无关联扣库流水，库存不变');
   preview.append(list);
  }catch(err){preview.textContent=err.message;}
 }
 selection.onchange=update;quantity.oninput=update;update();
 return {
  apply:state=>calculate(state).next,
  label:'确认更正',
  saved:'已更正原饮食记录，并重新计算当日营养和关联库存。'
 };
}
