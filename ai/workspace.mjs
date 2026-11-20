import {readState,saveState} from '../health/storage.mjs';
import {readFinance} from '../finance-storage.mjs';
import {currentBalanceFor,monthlyMetrics} from '../finance-metrics.mjs';
import {batchBalances,currentCarbReference,cycleForDate,dayIntake,energyForDay,inventoryWithMoves,isStockReference,round,validDate,weightTrend} from '../health/core.mjs';
import {summarizeFoodHistory} from '../health/food-history.mjs';
import {expenseSummaryReadSchema,foodHistoryReadSchema,ledgerReadSchema,matches} from '../health/contract.mjs';
import {displayStockQuantity,stockAlerts,stockMeasure} from '../health/inventory.mjs';
import {skillLibrary} from './skills.mjs';
export function localWorkspace(){
 const account={finance:localStorage};
 return {
  account,finance:account.finance,readHealth:()=>readState(account),
  saveHealth:(next,expected)=>saveState(next,expected,account),
  skills:skillLibrary(account.finance)
 };
}
export const readLabels={balance:'当前总余额',budget:'月预算与支出进度',nutrition:'指定日期的营养和热量缺口',
 stock_alerts:'库存提醒',app_data:'指定的本机数据',stock:'匹配的食品库存',meal:'可用食材和今日营养',expenses:'今日收支合计',foods:'指定日期的饮食记录',expense_summary:'指定时段的支出汇总',weight:'本机晨重趋势',cycle:'当前减脂周期'};
export const expenseGroupLabels={category:'分类',day:'日期',month:'月份'};

export async function readLedger(workspace,args,today){
 if(args.scope==='expense_summary'){
  const {start,end,groupBy}=args;
  if(!matches(expenseSummaryReadSchema,{start,end,groupBy})||!validDate(start)||!validDate(end)||end<start||end>today)
   throw Error('请选择截至今天的有效日期范围');
  const ledger=readFinance(workspace.finance).payload;
  const categories=new Map(ledger?.categories.map(row=>[row.id,row.name]));
  const groups=new Map();
  let cents=0,count=0;
  for(const row of ledger?.transactions??[]){
   if(row.type!=='expense'||row.date<start||row.date>end)continue;
   const label=groupBy==='category'?(categories.get(row.categoryId)||row.categoryName||'未分类'):
    groupBy==='month'?row.date.slice(0,7):row.date;
   const item=groups.get(label)??{cents:0,count:0};
   const amount=Math.round(Number(row.amount)*100);
   item.cents+=amount;item.count++;cents+=amount;count++;
   groups.set(label,item);
  }
  const rows=[...groups].map(([label,item])=>({label,expense:item.cents/100,count:item.count}));
  rows.sort((a,b)=>groupBy==='category'?b.expense-a.expense:a.label.localeCompare(b.label));
  return {start,end,groupBy,expense:cents/100,count,rows};
 }
 if(args.scope==='foods'){
  const {date,query}=args;
  if(!matches(foodHistoryReadSchema,{date,query})||!validDate(date)||date>today)
   throw Error('请选择今天或更早的有效日期');
  return summarizeFoodHistory(await workspace.readHealth(),date,query);
 }
 if(!matches(ledgerReadSchema,args))throw Error('助手请求了无效的账本范围');
 if(args.scope==='balance'){
  const value=currentBalanceFor(readFinance(workspace.finance).payload,today);
  return {balance:Number(value.toLocaleString('zh-CN',{maximumFractionDigits:2,useGrouping:false})),currency:'CNY'};
 }
 if(args.scope==='budget'){
  const month=args.query.trim()||today.slice(0,7);
  if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))throw Error('请选择有效的预算月份');
  const summary=monthlyMetrics(readFinance(workspace.finance).payload,month,today);
  const {current,future}=summary;
  const fields=['budget','baseBudget','syncBudget','remainingBudget','income','expense','budgetExpense','excludedExpense',
   'plannedToDate','delta','averageDaily',...(current?['dailyLimit','todayExpense','todayExcludedExpense','todayDelta','projection']:[])];
  return {month,current,future,...Object.fromEntries(fields.map(key=>[key,round(summary[key],2)]))};
 }
 if(args.scope==='expenses'){
  const date=args.query.trim()||today;
  if(!validDate(date))throw Error('请选择有效的收支日期');
  const tx=readFinance(workspace.finance).payload?.transactions.filter(t=>t.date===date)??[];
  const total=type=>tx.filter(t=>t.type===type).reduce((sum,t)=>sum+Math.round(Number(t.amount)*100),0)/100;
  return {date,income:total('income'),expense:total('expense'),count:tx.length};
 }
 const state=await workspace.readHealth(),query=args.query.trim().toLowerCase();
 if(args.scope==='stock_alerts'){
  const alerts=stockAlerts(state,today),names=new Map(inventoryWithMoves(state).map(row=>[row.id,row]));
  const matchesQuery=row=>row?.name?.toLowerCase().includes(query);
  return {asOf:today,low:alerts.low.filter(matchesQuery).map(row=>({
   name:row.name,qty:displayStockQuantity(row,row.qty),minimum:displayStockQuantity(row,row.minimum),unit:stockMeasure(row).unit
  })),expiry:alerts.expiry.flatMap(batch=>{
   const row=names.get(batch.foodId);
   return matchesQuery(row)?[{name:row.name,expires:batch.expires,qty:displayStockQuantity(row,batch.remaining),unit:stockMeasure(row).unit}]:[];
  })};
 }
 if(['nutrition','weight','cycle'].includes(args.scope)&&query&&!validDate(query))throw Error('请选择有效的记录日期');
 const date=query||today;
 if(args.scope==='weight'){
  const {points,last,last7,previous7,delta}=weightTrend(state,date),previous=points.at(-2);
  return {asOf:date,latest:last?{date:last.date,kg:last.kg,tentative:/暂定/.test(last.trendStatus??'')}:null,
   change:previous?round(last.kg-previous.kg,3):null,count:Math.min(points.length,7),last7:points.length>=7?last7:null,
   previous7,delta};
 }
 if(args.scope==='cycle'){
  const {start,end,days,closedDays,unreported,entries,deficit,goal,progress,fatEquivalent,remaining}=cycleForDate(state,date,today);
  const day=entries.find(row=>row.date===date);
  return {start,end,days,closedDays,unreported,closedThrough:entries.filter(row=>row.closed).at(-1)?.date??null,
   deficit,goal,progress,fatEquivalent,remaining,today:{date,intake:day?.intake??null,tdee:day?.tdee??null,
    conditionalDeficit:day?.deficit??null,closed:day?.closed??false,source:day?.source??null}};
 }
 if(args.scope==='nutrition'){
  const intake=dayIntake(state,date),energy=energyForDay(state,date,today);
  return {date,...dietSummary(state,intake),cost:intake.cost,costPartial:intake.costPartial,
   tdee:energy.tdee,deficit:energy.deficit,closed:energy.closed,energySource:energy.source};
 }
 const inventory=inventoryWithMoves(state).filter(s=>s.active&&!isStockReference(s)&&(args.scope==='stock'||s.qty>0)&&(!query||s.name?.toLowerCase().includes(query)))
  .sort((a,b)=>Number(b.name?.toLowerCase()===query)-Number(a.name?.toLowerCase()===query));
 const portions=new Map();
 for(const batch of batchBalances(state)){
  if(batch.remaining<=0||batch.date>today||!batch.portion&&!batch.parent)continue;
  const weights=portions.get(batch.foodId)??[];
  weights.push(batch.remaining);portions.set(batch.foodId,weights);
 }
 const result={stock:inventory.map(s=>({name:s.name,qty:displayStockQuantity(s,s.qty),unit:stockMeasure(s).unit,
  ...(portions.has(s.id)?{portions:portions.get(s.id).map(qty=>displayStockQuantity(s,qty))}:{})}))};
 if(args.scope==='stock')return result;
 return {...result,today:dietSummary(state,dayIntake(state,today))};
}

function dietSummary(state,intake){
 const {calorieTarget,proteinMin,proteinMax,fatMin,sodiumTarget}=state.settings;
 return {...intake.totals,kcalTarget:calorieTarget,proteinMin,proteinMax,
  fatMin,carbRange:currentCarbReference(state).range,sodiumTarget,incomplete:intake.incomplete};
}
