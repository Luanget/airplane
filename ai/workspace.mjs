import {readState,saveState} from '../health/storage.mjs';
import {readFinance} from '../finance-storage.mjs';
import {dayIntake,inventoryWithMoves,validDate} from '../health/core.mjs';
import {summarizeFoodHistory} from '../health/food-history.mjs';
import {foodHistoryReadSchema,ledgerReadSchema,matches} from '../health/contract.mjs';

export const SKILL_LIMIT=320;
const SKILL_KEY='airplane-ai-skill-v1';

export function cleanSkill(value) {
 const text=value.trim();
 if(text.length>SKILL_LIMIT)throw Error('Skill 最多 '+SKILL_LIMIT+' 字');
 return text;
}
export function localWorkspace(){
 return {
  readHealth:()=>readState(),
  saveHealth:(next,expected)=>saveState(next,expected),
  finance:localStorage,
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
export const readLabels={stock:'匹配的库存',meal:'可用食材和今日营养',expenses:'今日收支合计',foods:'指定日期的饮食记录'};

export async function readLedger(workspace,args,today){
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
 const inventory=inventoryWithMoves(state).filter(s=>s.active&&(query?s.name?.toLowerCase().includes(query):args.scope==='stock'||s.qty>0))
  .sort((a,b)=>Number(b.name?.toLowerCase()===query)-Number(a.name?.toLowerCase()===query));
 const result={stock:inventory.slice(0,4).map(s=>({name:s.name.slice(0,48),qty:s.qty??null,unit:s.unit.slice(0,12)})),
  more:inventory.length>4};
 if(args.scope==='stock')return result;
 const intake=dayIntake(state,today);
 return {...result,today:{kcal:intake.totals.kcal,protein:intake.totals.protein,
  kcalTarget:state.settings.calorieTarget,proteinMin:state.settings.proteinMin,
  incomplete:intake.incomplete.filter(key=>key==='kcal'||key==='protein')}};
}
