import {displayDay} from '../calendar.mjs';
import {NUTRIENTS,actualFood,cycleForDate,dayIntake,energyForDay,events,inventoryWithMoves,round,
 sampleNutrientSum,validDate,weightTrend} from '../health/core.mjs';
import {packagesFor} from '../health/containers.mjs';
import {same} from '../health/sync-source.mjs';

const labels=['热量','蛋白','碳水','脂肪','钠'],units=['kcal','g','g','g','mg'];
const amount=value=>value==null?'未知':String(round(value,1));
const money=value=>value==null?'未知':'¥'+round(value,2);
const dietKeys=['早餐','午餐','晚餐','加餐'];
const fieldTotals=totals=>NUTRIENTS.map((key,index)=>labels[index]+' '+amount(totals[key])+' '+units[index]).join(' · ');
function cost(rows){
 const known=rows.filter(row=>row.cost!=null);
 return {known:known.length?round(known.reduce((sum,row)=>sum+row.cost,0),2):null,partial:known.length<rows.length};
}
function foodLine(row){
 return [row.name,row.portion??'',fieldTotals(row.nutrition??{}),'成本 '+money(row.cost),
  ...(row.uncertainty?[row.uncertainty]:[])].filter(Boolean).join(' · ');
}
function mealRows(rows){
 return [...new Set([...dietKeys,...rows.map(row=>row.meal||'未注明餐次')])].flatMap(meal=>{
  const items=rows.filter(row=>(row.meal||'未注明餐次')===meal);
  return items.length?[{meal,rows:items.map(row=>({id:row.id,name:row.name,portion:row.portion,foodId:row.foodId,
   nutrition:row.nutrition,cost:row.cost,quality:row.quality??null,uncertainty:row.uncertainty??null,evidence:row.agentEvidence??null})),
   totals:sampleNutrientSum(items),cost:cost(items)}]:[];
 });
}
function conditional(actual,plans){
 return Object.fromEntries(NUTRIENTS.map(key=>[key,actual[key]==null||plans.some(row=>row.nutrition[key]==null)?null:
  round(actual[key]+plans.reduce((n,row)=>n+row.nutrition[key],0),2)]));
}
export function healthReport(state,date,today,{includeMeals=true,proposed=[]}={}){
 if(!validDate(date)||!validDate(today)||date>today)throw Error('请选择今天或更早的报告日期');
 const all=events(state,'foods').filter(row=>row.date===date),actual=all.filter(actualFood);
 const savedPlans=all.filter(row=>!actualFood(row)&&/^(plan|计划)/i.test(row.status??''));
 const candidates=[...savedPlans,...proposed];
 const actualMeals=new Set(actual.map(row=>row.meal));
 const newestMeals=new Set(proposed.map(row=>row.meal));
 // Plans already represented by an actual meal cannot contribute to a projected daily total.
 const pending=candidates.filter(row=>!actualMeals.has(row.meal)&&(proposed.includes(row)||!newestMeals.has(row.meal)));
 const intake=dayIntake(state,date),day=energyForDay(state,date,today);
 const cycle=cycleForDate(state,date,today),trend=weightTrend(state,date);
 const latest=trend.points.at(-1),previous=trend.points.at(-2),conditionalToday=!day.closed?day.deficit:null;
 const {calorieTarget,proteinMin,proteinMax,fatMin,sodiumTarget}=state.settings;
 const targets={kcal:calorieTarget,proteinMin,proteinMax,fatMin,sodium:sodiumTarget};
 const difference={kcal:intake.totals.kcal==null?null:round(calorieTarget-intake.totals.kcal,1),
  protein:intake.totals.protein==null?null:round(proteinMin-intake.totals.protein,1),
  fat:intake.totals.fat==null?null:round(fatMin-intake.totals.fat,1),
  sodium:intake.totals.sodium==null?null:round(sodiumTarget-intake.totals.sodium,1)};
 return {date,...(includeMeals?{meals:mealRows(actual),plans:mealRows(pending)}:{}),actual:intake.totals,
  cost:{known:intake.cost,partial:intake.costPartial},targets,difference,quality:{status:!intake.reported?'缺报':intake.incomplete.length?'部分营养数据待补':day.completeness.status==='complete'?'全天记录已确认':'全天记录待确认',
   missingMeals:['午餐','晚餐'].filter(meal=>!actualMeals.has(meal)),
   unknown:intake.incomplete},conditionalNutrition:pending.length?conditional(intake.totals,pending):null,
  energy:{tdee:day.tdee,source:day.source,closed:day.closed,completeness:day.completeness,deficit:day.deficit},
  cycle:{start:cycle.start,end:cycle.end,days:cycle.days,closedDays:cycle.closedDays,unreported:cycle.unreported,
   closedThrough:cycle.entries.filter(row=>row.closed).at(-1)?.date??null,formal:cycle.deficit,goal:cycle.goal,
   conditionalToday,conditionalTotal:conditionalToday==null?null:round(cycle.deficit+conditionalToday,2),
   progress:cycle.progress,fatEquivalent:cycle.fatEquivalent,remaining:cycle.remaining,daysRemaining:cycle.entries.filter(row=>row.date>=today).length},
  weight:{latest:latest?{date:latest.date,kg:latest.kg}:null,change:latest&&previous?round(latest.kg-previous.kg,2):null,
   count:Math.min(trend.points.length,7),last7:trend.points.length>=7?trend.last7:null,previous7:trend.previous7,delta:trend.delta}};
}
const costText=value=>money(value.known)+(value.partial?'（部分价格未知）':'');
export function renderHealthReport(report){
 const {meals,plans,actual,cost,targets,difference,quality,energy,cycle,weight,conditionalNutrition}=report;
 const groups=(rows,plan)=>rows.flatMap(group=>[
  (plan?'计划 · ':'实际 · ')+group.meal,...group.rows.map(foodLine),
  '餐次合计 '+fieldTotals(group.totals)+' · 成本 '+costText(group.cost)
 ]);
 const lines=[displayDay(report.date,true)+' · '+quality.status,...groups(meals??[],false),
  '全天实际 '+fieldTotals(actual)+' · 成本 '+costText(cost),...groups(plans??[],true)];
 if(conditionalNutrition)lines.push('执行尚未实际记录的餐单后 '+fieldTotals(conditionalNutrition));
 lines.push('日参考 '+targets.kcal+' kcal · 剩余 '+amount(difference.kcal)+' kcal · 蛋白下限差 '+amount(difference.protein)+
  ' g · 脂肪下限差 '+amount(difference.fat)+' g · 钠参考差 '+amount(difference.sodium)+' mg');
 if(quality.missingMeals.length)lines.push('未找到已记录的'+quality.missingMeals.join('、')+'，可能尚未报告。');
 if(quality.unknown.length)lines.push('待补 '+quality.unknown.map(key=>labels[NUTRIENTS.indexOf(key)]).join('、'));
 lines.push('消耗 '+energy.tdee+' kcal · '+(energy.closed?'已结算缺口':'当前条件缺口')+' '+amount(energy.deficit)+' kcal',
  cycle.days+'天周期 '+displayDay(cycle.start)+'—'+displayDay(cycle.end)+' · 最近结算 '+(cycle.closedThrough?displayDay(cycle.closedThrough):'暂无'),
  '正式累计缺口 '+cycle.formal+' / '+cycle.goal+' kcal · 已结 '+cycle.closedDays+' 天 · 缺报 '+cycle.unreported+' 天 · 进度 '+cycle.progress+'%',
  '理论脂肪当量 '+cycle.fatEquivalent+' kg · 距目标 '+cycle.remaining+' kcal · 剩 '+cycle.daysRemaining+' 天');
 if(cycle.conditionalTotal!=null)lines.push('当日条件缺口 '+cycle.conditionalToday+' kcal · 条件累计 '+cycle.conditionalTotal+' kcal');
 if(weight.latest)lines.push('晨重 '+weight.latest.kg+' kg · 较上次 '+amount(weight.change)+' kg · 7次均重 '+amount(weight.last7)+
  ' kg（有效 '+weight.count+' 次） · 前窗 '+amount(weight.previous7)+' kg · 窗口变化 '+amount(weight.delta)+' kg');
 return lines.join('\n');
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
