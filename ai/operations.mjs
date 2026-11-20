import {displayDay,localClock,normalizeClock,syncCalendarFields} from '../calendar.mjs';
import {dayIntake,inventoryWithMoves,isStockReference,localStockChange,validDate} from '../health/core.mjs';
import {matchFoodRecords,reviseFoodPortion} from '../health/food-history.mjs';
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
 const stock=inventoryWithMoves(current).filter(s=>s.active&&!isStockReference(s));
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
 return (state=current)=>{
  const row=selection(),value=qty.valueAsNumber;
  if(!row||!Number.isFinite(value)||value<0||value>100000)throw Error('请核对食品和数量');
  const next=structuredClone(state);
  if(shopping)setShoppingItem(next,row.id,value);
  else {
   if(!validDate(date.value)||date.value>today)throw Error('请核对盘点日期');
   localStockChange(next,{foodId:row.id,delta:value,date:date.value,time:localClock(),count:true,reason:'助手盘点 · 已确认'});
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
   pair('库存',stock?stock.name+' '+stock.before+' → '+stock.after+' '+stock.unit:'原记录无关联扣库流水，库存不变');
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
