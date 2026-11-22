import {displayDay} from '../calendar.mjs';
import {NUTRIENTS,actualFood,addDays,cycleForDate,energyForDay,events,foodCost,inventoryWithMoves,round,
 sampleNutrientSum,validDate,weightTrend} from '../health/core.mjs';
import {packagesFor} from '../health/containers.mjs';
import {dietGoals,isMealPlan,mealDay} from '../health/meal-status.mjs';
import {same} from '../health/sync-source.mjs';
import {planningGoals,vegetableIntake} from './meal-planning.mjs';
import {timelineGroup} from '../health/presentation.mjs';

const labels=['热量','蛋白','碳水','脂肪','钠'],units=['kcal','g','g','g','mg'];
const amount=value=>value==null?'未知':String(round(value,1));
const money=value=>value==null?'未知':'¥'+round(value,2);
const dietKeys=['早餐','午餐','晚餐','加餐'];
const fieldTotals=totals=>NUTRIENTS.map((key,index)=>labels[index]+' '+amount(totals[key])+' '+units[index]).join(' · ');
function cost(rows){
 const known=rows.filter(row=>row.cost!=null);
 return {known:known.length?round(known.reduce((sum,row)=>sum+row.cost,0),2):null,partial:known.length<rows.length,estimated:known.some(row=>row.costEstimated)};
}
function foodLine(row){
 return [row.name,row.portion??'',fieldTotals(row.nutrition??{}),'成本 '+(row.costEstimated?'约 ':'')+money(row.cost),
  ...(row.uncertainty?[row.uncertainty]:[])].filter(Boolean).join(' · ');
}
function mealRows(rows){
 return [...new Set([...dietKeys,...rows.map(row=>row.meal||'未注明餐次')])].flatMap(meal=>{
  const items=rows.filter(row=>(row.meal||'未注明餐次')===meal);
  return items.length?[{meal,rows:items.map(row=>({id:row.id,name:row.name,portion:row.portion,foodId:row.foodId,
   nutrition:row.nutrition,cost:row.cost,costEstimated:row.costEstimated,quality:row.quality??null,uncertainty:row.uncertainty??null,evidence:row.agentEvidence??null})),
   totals:sampleNutrientSum(items),cost:cost(items)}]:[];
 });
}
export function healthReport(state,date,today,{includeMeals=true,proposed=[]}={}){
 if(!validDate(date)||!validDate(today))throw Error('请选择有效的报告日期');
 const future=date>today;
 const all=events(state,'foods').filter(row=>row.date===date),actual=all.filter(row=>!future&&actualFood(row)).map(row=>{
  const cost=foodCost(state,row);
  return {...row,cost,costEstimated:row.costSource==='estimated_package'||row.cost==null&&cost!==null};
 });
 const actualMeals=new Set(actual.map(row=>row.meal));
 const newestMeals=new Set(proposed.map(row=>row.meal));
 const {remaining:pending,planned,projected,actual:intake}=mealDay(state,date,{today,foods:[...actual,
  ...all.filter(row=>isMealPlan(row)&&!newestMeals.has(row.meal)),
  ...proposed.map((row,index)=>({...row,id:'report-proposed:'+index,amountUnit:row.amountUnit??row.unit,status:'plan'}))]});
 const {kcal:calorieTarget,proteinMin,proteinMax,fatMin,sodiumTarget,carbs}=dietGoals(state);
 const targets={kcal:calorieTarget,proteinMin,proteinMax,fatMin,sodium:sodiumTarget,carbs};
 if(future)return {date,future,plans:includeMeals?mealRows(pending):undefined,targets,
  remainingPlanNutrition:planned,conditionalNutrition:pending.length?planned:null};
 const day=energyForDay(state,date,today);
 const cycle=cycleForDate(state,date,today),trend=weightTrend(state,date);
 const latest=trend.points.at(-1),previous=trend.points.at(-2);
 const difference={kcal:intake.totals.kcal==null?null:round(calorieTarget-intake.totals.kcal,1),
  protein:intake.totals.protein==null?null:round(proteinMin-intake.totals.protein,1),
  fat:intake.totals.fat==null?null:round(fatMin-intake.totals.fat,1),
  sodium:intake.totals.sodium==null?null:round(sodiumTarget-intake.totals.sodium,1)};
 return {date,...(includeMeals?{meals:mealRows(actual),plans:mealRows(pending)}:{}),actual:intake.totals,
  cost:{known:intake.cost,partial:intake.costPartial,estimated:intake.costEstimated},targets,difference,quality:{status:!intake.reported?'缺报':intake.incomplete.length?'部分营养数据待补':day.completeness.status==='complete'?'全天记录已确认':'摄入可能未记全',
   missingMeals:['午餐','晚餐'].filter(meal=>!actualMeals.has(meal)),
   unknown:intake.incomplete},remainingPlanNutrition:planned,conditionalNutrition:pending.length?projected:null,
  energy:{tdee:day.tdee,source:day.source,possibleOverestimate:day.possibleOverestimate,completeness:day.completeness,deficit:day.deficit},
  cycle:{start:cycle.start,end:cycle.end,days:cycle.days,reportedDays:cycle.reportedDays,unreported:cycle.unreported,
   deficit:cycle.deficit,goal:cycle.goal,possibleOverestimate:cycle.possibleOverestimate,
   progress:cycle.progress,fatEquivalent:cycle.fatEquivalent,remaining:cycle.remaining,daysRemaining:cycle.entries.filter(row=>row.date>=today).length},
  weight:{latest:latest?{date:latest.date,kg:latest.kg}:null,change:latest&&previous?round(latest.kg-previous.kg,2):null,
   count:Math.min(trend.points.length,7),last7:trend.points.length>=7?trend.last7:null,previous7:trend.previous7,delta:trend.delta}};
}
const costText=value=>(value.estimated?'约 ':'')+money(value.known)+(value.partial?'（部分价格未知）':'');
export function renderHealthReport(report){
 const {meals,plans,actual,cost,targets,difference,quality,energy,cycle,weight,conditionalNutrition}=report;
 const groups=(rows,plan)=>rows.flatMap(group=>[
  (plan?'计划 · ':'实际 · ')+group.meal,...group.rows.map(foodLine),
  '餐次合计 '+fieldTotals(group.totals)+' · 成本 '+costText(group.cost)
 ]);
 if(report.future)return [displayDay(report.date,true)+' · 饮食计划',...groups(plans??[],true),
  conditionalNutrition?'计划合计 '+fieldTotals(conditionalNutrition):'暂无饮食计划',
  '日参考 '+targets.kcal+' kcal · 蛋白 '+targets.proteinMin+'–'+targets.proteinMax+' g · 脂肪 ≥'+targets.fatMin+
   ' g · 钠 '+targets.sodium+' mg'].join('\n');
 const lines=[displayDay(report.date,true)+' · '+quality.status,...groups(meals??[],false),
  '全天实际 '+fieldTotals(actual)+' · 成本 '+costText(cost),...groups(plans??[],true)];
 if(conditionalNutrition)lines.push('执行尚未实际记录的餐单后 '+fieldTotals(conditionalNutrition));
 lines.push('日参考 '+targets.kcal+' kcal · 剩余 '+amount(difference.kcal)+' kcal · 蛋白下限差 '+amount(difference.protein)+
  ' g · 脂肪下限差 '+amount(difference.fat)+' g · 钠参考差 '+amount(difference.sodium)+' mg');
 if(quality.missingMeals.length)lines.push('未找到已记录的'+quality.missingMeals.join('、')+'，可能尚未报告。');
 if(quality.unknown.length)lines.push('待补 '+quality.unknown.map(key=>labels[NUTRIENTS.indexOf(key)]).join('、'));
 lines.push('消耗 '+energy.tdee+' kcal · 账面缺口 '+amount(energy.deficit)+' kcal'+(energy.possibleOverestimate?'（可能高估）':''),
  cycle.days+'天周期 '+displayDay(cycle.start)+'—'+displayDay(cycle.end),
  '周期账面缺口 '+amount(cycle.deficit)+' / '+cycle.goal+' kcal · 有摄入 '+cycle.reportedDays+' 天 · 缺报 '+cycle.unreported+' 天'+
   (cycle.possibleOverestimate?' · 可能高估':''),
  '理论脂肪当量 '+amount(cycle.fatEquivalent)+' kg · 距目标 '+amount(cycle.remaining)+' kcal · 剩 '+cycle.daysRemaining+' 天');
 if(weight.latest)lines.push('晨重 '+weight.latest.kg+' kg · 较上次 '+amount(weight.change)+' kg · 7次均重 '+amount(weight.last7)+
  ' kg（有效 '+weight.count+' 次） · 前窗 '+amount(weight.previous7)+' kg · 窗口变化 '+amount(weight.delta)+' kg');
 return lines.join('\n');
}
export function cycleReport(state,date,today){
 if(!validDate(date)||date>today)throw Error('请指定已到的周期日期');
 const cycle=cycleForDate(state,date,today),goals=planningGoals(state),asOf=cycle.end<today?cycle.end:today;
 const foods=events(state,'foods').filter(actualFood),catalog=new Map(inventoryWithMoves(state).map(row=>[row.id,row]));
 const activity=events(state,'activities').filter(row=>!['plan','cancelled'].includes(row.status)&&!/计划|取消|作废/.test(row.status??'')),moves=state.local.stockMoves;
 let cumulative=null;
 const days=cycle.entries.map(entry=>{
  if(entry.date>today)return {date:entry.date,status:'future',deficit:null,nutrition:null,vegetables:null,cumulative};
  const dayFoods=foods.filter(row=>row.date===entry.date),intake=mealDay(state,entry.date,{today}).actual;
  const values=intake.totals;
  if(entry.deficit!==null)cumulative=round((cumulative??0)+entry.deficit,2);
  const meals=[...new Set(dayFoods.map(timelineGroup))];
  const vegetables=dayFoods.length?vegetableIntake(dayFoods,catalog):{grams:null,unmeasured:[],knownItems:0};
  return {date:entry.date,status:entry.completeness.status,nutrition:values,partialNutrients:intake.incomplete,vegetables,
   tdee:entry.tdee,tdeeSource:entry.source,deficit:entry.deficit,cumulative,possibleOverestimate:entry.possibleOverestimate,
   meals,mealsWithoutEntry:dietKeys.slice(0,3).filter(meal=>!meals.includes(meal)),
   activity:activity.filter(row=>row.date===entry.date).map(({name,kcal,minutes,km,energyKind,includedInBase,status})=>
    ({name,kcal,minutes,km,energyKind,includedInBase,status})),
   stockEvidence:moves.filter(row=>row.date===entry.date&&!row.stockArchived).length,
   pendingStockFood:dayFoods.filter(row=>row.stockAssociation==='pending').map(row=>row.name),
   belowProtein:values.protein==null?null:values.protein<goals.proteinMin,
   belowFat:values.fat==null?null:values.fat<goals.fatMin,
   aboveSodium:values.sodium==null?null:values.sodium>goals.sodiumTarget};
 });
 const weight=weightTrend(state,asOf),last=weight.points.slice(-7).map(({date,kg})=>({date,kg}));
 return {start:cycle.start,end:cycle.end,asOf,days,goals,deficit:cycle.deficit,goal:cycle.goal,reportedDays:cycle.reportedDays,
  possibleOverestimate:cycle.possibleOverestimate,weight:{observations:last,average:last.length===7?weight.last7:null,
   rollingChange:weight.delta,changeAcrossSelected:last.length>1?round(last.at(-1).kg-last[0].kg,3):null},
  interpretation:'无饮食、运动或库存条目只能说明账本缺少条目。缺报日缺口为 null，日目标参考当前设置。'};
}

export function previousCycleHint(state,today,seen){
 if(!validDate(today))return null;
 const current=cycleForDate(state,today,today),previousEnd=addDays(current.start,-1);
 if(previousEnd===seen)return null;
 const previous=cycleForDate(state,previousEnd,today);
 return previous.reportedDays?{end:previousEnd,reportedDays:previous.reportedDays}:null;
}

export function inventoryDiff(before,after){
 const old=new Map(inventoryWithMoves(before).map(row=>[row.id,row]));
 return inventoryWithMoves(after).flatMap(sku=>{
  const previous=old.get(sku.id);
  const signature=state=>packagesFor(state,sku.id).map(({id,status,gross,eaten,net})=>({id,status,gross,eaten,net}));
  const beforePackages=signature(before),afterPackages=signature(after);
  if(previous?.qty===sku.qty&&same(beforePackages,afterPackages))return [];
  const changed=afterPackages.filter(row=>!same(row,beforePackages.find(item=>item.id===row.id)));
  return [{sku:sku.id,name:sku.name,unit:sku.unit,previous:previous?.qty??null,next:sku.qty,packages:changed}];
 });
}
export function renderInventoryDiff(changes){
 if(!changes.length)return '';
 return '库存变更\n'+changes.map(row=>row.name+' · '+(row.previous==null?'数量未知':row.previous)+' → '+
  (row.next==null?'数量未知':row.next)+' '+row.unit+(row.packages.length?' · '+row.packages.map(pack=>
   ({sealed:'未开封',open:'已开封',empty:'已用完',discarded:'已丢弃'}[pack.status]??pack.status)+
   (pack.gross==null?'':' · 毛重 '+pack.gross+' g')).join('、'):'')).join('\n');
}
