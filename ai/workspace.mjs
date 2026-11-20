import {readState,saveState} from '../health/storage.mjs';
import {readFinance} from '../finance-storage.mjs';
import {batchBalances,carbReference,dayIntake,inventoryWithMoves,isStockReference,validDate} from '../health/core.mjs';
import {summarizeFoodHistory} from '../health/food-history.mjs';
import {expenseSummaryReadSchema,foodHistoryReadSchema,ledgerReadSchema,matches} from '../health/contract.mjs';
import {displayStockQuantity,stockMeasure} from '../health/inventory.mjs';

export const SKILL_LIMIT=320;
const SKILL_KEY='airplane-ai-skill-v1';

export function cleanSkill(value) {
 const text=value.trim();
 if(text.length>SKILL_LIMIT)throw Error('Skill 最多 '+SKILL_LIMIT+' 字');
 return text;
}
export function localWorkspace(){
 const account={finance:localStorage};
 return {
  account,finance:account.finance,readHealth:()=>readState(account),
  saveHealth:(next,expected)=>saveState(next,expected,account),
  readSkill:()=>localStorage.getItem(SKILL_KEY)??'',
  saveSkill:text=>localStorage.setItem(SKILL_KEY,cleanSkill(text))
 };
}
export function shortHistory(turns){
 let remaining=900;
 return turns.slice(-4).reverse().flatMap(({role,text})=>{
  const short=text.slice(0,Math.min(320,remaining));
  remaining-=short.length;
  return short?[{role,text:short}]:[];
 }).reverse();
}
export const readLabels={stock:'匹配的食品库存',meal:'可用食材和今日营养',expenses:'今日收支合计',foods:'指定日期的饮食记录',expense_summary:'指定时段的支出汇总'};
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
 if(args.scope==='expenses'){
  const tx=readFinance(workspace.finance).payload?.transactions.filter(t=>t.date===today)??[];
  const total=type=>tx.filter(t=>t.type===type).reduce((sum,t)=>sum+Math.round(Number(t.amount)*100),0)/100;
  return {date:today,income:total('income'),expense:total('expense'),count:tx.length};
 }
 const state=await workspace.readHealth(),query=args.query.trim().toLowerCase();
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
 const intake=dayIntake(state,today);
 const {calorieTarget,proteinMin,proteinMax,fatMin,sodiumTarget}=state.settings;
 return {...result,today:{...intake.totals,kcalTarget:calorieTarget,proteinMin,proteinMax,
  fatMin,carbRange:carbReference(state.settings),sodiumTarget,incomplete:intake.incomplete}};
}
