import assert from 'node:assert/strict';
import test from 'node:test';
import {createAgentRun,nativeRequest} from '../ai/agent-loop.mjs';
import {createAgentTools} from '../ai/agent-tools.mjs';
import {cycleReport,previousCycleHint} from '../ai/health-report.mjs';
import {evaluateMealPlan,planOperation} from '../ai/meal-planning.mjs';
import {memoryLibrary,MEMORY_KEY} from '../ai/memory.mjs';
import {advanceModelPolicy,planNativeModel,saveChatModel} from '../ai/models.mjs';
import {SKILLS_KEY,skillCatalog} from '../ai/skills.mjs';
import {addDays,addFood,events,inventoryWithMoves,newState,recordEvent} from '../health/core.mjs';
import {saveSku} from '../health/inventory.mjs';

const today='2032-11-22',tomorrow=addDays(today,1);
const local=()=>{
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};
const portion=(foodId,meal,amount,extras={})=>({foodId,date:tomorrow,meal,amount,unit:'g',containerId:null,...extras});
const writeHabit=(memory,text,extra={})=>memory.learnHabit({name:'鸡胸餐次',text,evidence:text,kind:'habit',
 source:{kind:'user_message',id:'meal-user'},constraint:{kind:'food_meal_limit',food:'鸡胸',maxMeals:1},...extra},text);

test('mode selection respects manual settings and escalates with the previous tool result intact',()=>{
 const finance=local(),seed=planNativeModel(finance,{text:'帮我记录晨重72.4kg'});
 assert.equal(seed.model,'gpt-6-luna');
 assert.equal(planNativeModel(finance,{text:'安排明天午晚餐'}).model,'gpt-6.1-terra');
 assert.equal(planNativeModel(finance,{text:'记录晨重72.4kg',attachments:[{}]}).model,'gpt-6.1-terra');
 const run=createAgentRun({...seed,date:today,id:'route-1',text:'记录晨重72.4kg'});
 run.input.push({type:'reasoning',encrypted_content:'luna-reasoning'},
  {type:'function_call_output',call_id:'earlier',output:'保存晨重72.4kg'});
 run.receipts.push({tool:'read_cycle_report',result:{status:'ok'}});
 assert.equal(advanceModelPolicy(run),true);
 assert.equal(run.model,'gpt-6.1-terra');
 run.input.push({type:'reasoning',encrypted_content:'terra-reasoning'});
 const input=nativeRequest(run,'',[]).input;
 assert.equal(input.some(row=>row.encrypted_content==='luna-reasoning'),false);
 assert.ok(input.some(row=>row.encrypted_content==='terra-reasoning'));
 assert.ok(input.some(row=>row.output==='保存晨重72.4kg'));
 saveChatModel(finance,'gpt-6-luna');
 Object.assign(run,planNativeModel(finance,{text:'分析体检报告'}));
 assert.equal(advanceModelPolicy(run),false);
 assert.equal(run.model,'gpt-6-luna');
});

test('long-term preference replaces its topic, keeps history and respects manual edits',()=>{
 const finance=local(),memory=memoryLibrary(finance),first=writeHabit(memory,'鸡胸一天不要安排两顿');
 assert.throws(()=>writeHabit(memory,'今天吃了鸡胸'),/长期习惯/);
 assert.throws(()=>writeHabit(memory,'这次可以两顿鸡胸'),/当轮|本轮/);
 const next=writeHabit(memory,'鸡胸每天最多两餐',{constraint:{kind:'food_meal_limit',food:'鸡胸',maxMeals:2}});
 assert.equal(next.id,first.id);
 assert.deepEqual(next.history.map(row=>row.text),[first.text]);
 assert.equal(memory.planningHabits()[0].constraint.maxMeals,2);
 assert.equal(next.source.id,'meal-user');
 const legacy={...first,id:'archived-legacy-chicken',updatedAt:'2020-01-01T00:00:00Z'};
 finance.setItem(MEMORY_KEY,JSON.stringify([legacy,...memory.list()]));
 memory.prepare(next.id,{enabled:false},'update').commit();
 assert.throws(()=>writeHabit(memory,'鸡胸一天只吃一餐'),/由用户管理/);
 assert.deepEqual(memory.planningHabits(),[]);
 assert.deepEqual(memory.relevant('鸡胸'),[]);
});

test('meal planning keeps one-turn exceptions scoped and labels vegetables with estimated missing nutrients',async()=>{
 const state=newState(),finance=local(),memory=memoryLibrary(finance);
 const chicken=saveSku(state,{id:'chicken',name:'合成鸡胸',unit:'g',basisUnit:'g',basisAmount:100,kcal:158,protein:31,fat:4,carbs:0,sodium:60});
 const veg=saveSku(state,{id:'celery',name:'合成芹菜',unit:'g',basisUnit:'g',basisAmount:100,kcal:18});
 chicken.qty=500;veg.qty=500;
 const estimate={amount:100,unit:'g',source:'通用芹菜参考',uncertainty:'按生鲜可食部分估计',
  nutrition:{kcal:999,protein:1,fat:.2,carbs:3,sodium:70}};
 const args={items:[portion(chicken.id,'午餐',200),portion(chicken.id,'晚餐',100),portion(veg.id,'晚餐',320,{estimate})],
  appendTo:[],replaceIds:[],exceptions:[]};
 const run=createAgentRun({date:today,id:'planned-test',text:'这次可以两顿鸡胸'});
 const tools=createAgentTools({finance,memory,readHealth:async()=>state});
 const context={run,operationId:'meal-test'};
 const block=await tools('evaluate_meal_plan',args,context);
 assert.equal(block.data.feasible,false);
 assert.equal(block.data.days[0].nutritionCheck.status,'outside');
 assert.equal(block.data.days[0].nutritionCheck.checks.vegetables.value,320);
 const habitId='default:chicken-meals';
 await assert.rejects(tools('evaluate_meal_plan',{...args,exceptions:[{habitId,date:tomorrow,evidence:'另一次未授权的对话'}]},context),/本轮/);
 const exception={...args,exceptions:[{habitId,date:tomorrow,evidence:'这次可以两顿鸡胸'}]};
 const result=(await tools('evaluate_meal_plan',exception,context)).data;
 assert.equal(result.feasible,true);
 const {next}=planOperation(state,exception,{id:'test',today,habits:memory.planningHabits()});
 const stored=events(next,'foods').find(row=>row.foodId==='celery');
 assert.equal(stored.status,'plan');assert.equal(stored.nutrition.kcal,57.6);
 assert.equal(stored.nutrition.protein,3.2);assert.equal(stored.quality,'estimated');
 assert.equal(stored.nutritionEstimate.source,estimate.source);
 assert.equal(inventoryWithMoves(next).find(row=>row.id==='celery').qty,500);
 assert.equal(JSON.parse(finance.getItem(MEMORY_KEY)).length,0);
 assert.equal(evaluateMealPlan(state,args,today,memory.planningHabits()).feasible,false);
});

test('cycle review keeps gaps unknown, excludes plans and preserves the original energy model',()=>{
 const state=newState(),start=addDays(today,-6),last=addDays(today,-1);
 Object.assign(state.settings,{cycleAnchor:start,cycleDays:6,baselineTdee:2900,proteinMin:150,fatMin:45,sodiumTarget:2000});
 state.legacy.energy[last]={tdee:2750};
 for(let i=0;i<8;i++)recordEvent(state,'weights',{date:addDays(last,i-7),kg:76-i,isMorning:true});
 addFood(state,{date:last,name:'合成午餐',meal:'午餐',kcal:1550,protein:110,carbs:140,fat:35,sodium:2400,status:'actual'});
 addFood(state,{date:last,name:'合成芹菜',meal:'午餐',amount:320,amountUnit:'g',kcal:30,protein:3.2,carbs:9.6,fat:0,sodium:60});
 addFood(state,{date:last,name:'合成晚餐',meal:'晚餐',kcal:800,status:'plan'});
 const report=cycleReport(state,last,today);
 assert.equal(report.deficit,1170);assert.equal(report.reportedDays,1);
 assert.deepEqual(report.days.slice(0,5).map(row=>row.deficit),[null,null,null,null,null]);
 assert.equal(report.days[5].tdee,2750);
 assert.equal(report.days[5].vegetables.grams,320);
 assert.ok(report.days[5].aboveSodium&&report.days[5].belowFat&&report.days[5].belowProtein);
 assert.ok(report.days[5].mealsWithoutEntry.includes('晚餐'));
 assert.equal(report.weight.average,72);
 assert.equal(report.weight.rollingChange,-1);
 assert.deepEqual(previousCycleHint(state,today,null),{end:last,reportedDays:1});
 assert.equal(previousCycleHint(state,today,last),null);
});

test('skill overrides are read without rewriting the existing storage key',async()=>{
 const finance=local();
 finance.setItem(SKILLS_KEY,JSON.stringify({runtime:{weighing:false},overrides:{meals:{text:'我的配餐步骤',version:1}},
  personal:[{id:'custom',name:'合成自定义',text:'我的独立技能'}]}));
 const original=finance.getItem(SKILLS_KEY),tools=createAgentTools({finance,memory:memoryLibrary(finance)});
 const {data}=await tools('load_skill',{id:'meals'},{run:{allowRead:true}});
 assert.equal(data.version,2);assert.equal(data.steps,'我的配餐步骤');assert.equal(data.customized,true);
 assert.equal((await tools('load_skill',{id:'custom'},{run:{allowRead:true}})).data.steps,'我的独立技能');
 assert.equal(skillCatalog(finance).find(row=>row.id==='weighing').enabled,false);
 assert.equal(finance.getItem(SKILLS_KEY),original);
});
