import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateMealPlan,planOperation,undoMealPlan,planningFacts} from '../ai/meal-planning.mjs';
import {assistantFixture,action,proposal} from './health-action-fixture.mjs';
import {packagesFor} from '../health/containers.mjs';
import {dayIntake,events} from '../health/core.mjs';
import {saveSku} from '../health/inventory.mjs';
import {memoryLibrary} from '../ai/memory.mjs';
import {createAgentTools} from '../ai/agent-tools.mjs';
import {setHealthAuto} from '../ai/health-actions.mjs';

const today='2035-04-22',tomorrow='2035-04-23';
const memoryStore=()=>{
 const rows=new Map();
 return {getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};
};
const row=(foodId,amount,meal,containerId=null)=>({date:tomorrow,foodId,containerId,amount,unit:'g',meal});
const limit={id:'habit-1',constraint:{kind:'food_meal_limit',food:'鸡胸',maxMeals:1}};

test('future combined meal evaluation uses saved lunch, portions, goals and exact nutrients without a debit',()=>{
 const state=assistantFixture(today);
 Object.assign(state.settings,{calorieTarget:1700,proteinMin:150,proteinMax:170,fatMin:45});
 for(const [id,kcal,protein,fat,carbs] of [['蛋白',50,11,0,0],['酸奶',75,10,1,4],['米饭',130,2.7,0.3,28],['油',900,0,100,0]])
  saveSku(state,{id,name:id,unit:'g',basisAmount:100,basisUnit:'g',kcal,protein,fat,carbs,sodium:20}).qty=1000;
 const [first,second]=packagesFor(state,'fixture-chicken');
 const lunch=[row('fixture-chicken',246,'午餐',first.id),row('米饭',200,'午餐'),row('油',20,'午餐')];
 const saved=planOperation(state,{items:lunch,replaceIds:[]},{id:'first',today,habits:[limit]});
 const stillAvailable=planningFacts(saved.next,[tomorrow],today,[limit]);
 assert.equal(stillAvailable.days[0].existingPlans.length,3);
 const dinner=[row('酸奶',300,'晚餐'),row('蛋白',300,'晚餐'),row('米饭',200,'晚餐'),row('油',25,'晚餐')];
 const evaluation=evaluateMealPlan(saved.next,{items:dinner,replaceIds:[]},today,[limit]);
 assert.equal(evaluation.feasible,true);
 assert.equal(evaluation.days[0].projected.kcal,1693.6);
 assert.equal(evaluation.days[0].projected.protein,152.52);
 assert.ok(evaluation.days[0].projected.fat>=45);
 assert.equal(dayIntake(saved.next,tomorrow).totals.kcal,null);
 assert.deepEqual(saved.next.local.stockMoves,state.local.stockMoves);
 const bad=evaluateMealPlan(saved.next,{items:[row('fixture-chicken',248,'晚餐',second.id)],replaceIds:[]},today,[limit]);
 assert.equal(bad.feasible,false);
 assert.equal(bad.violations[0].habitId,'habit-1');
 const remove=planOperation(saved.next,{items:[],replaceIds:saved.changes.created.map(row=>row.id)},{id:'new',today,habits:[limit]});
 assert.ok(!events(remove.next,'foods').some(row=>row.date===tomorrow));
 assert.deepEqual(events(undoMealPlan(remove.next,remove.changes),'foods'),events(saved.next,'foods'));
});

test('model-selected habit saved without cue words and same-topic preferences keep history',()=>{
 const memory=memoryLibrary(memoryStore());
 const evidence='一天不要安排两顿鸡胸';
 const first=memory.learnHabit({name:'鸡胸安排',topic:'chicken',text:evidence,evidence,constraint:limit.constraint},evidence);
 assert.equal(memory.activeHabits()[0].constraint.maxMeals,1);
 const update='鸡胸限制为零餐';
 const second=memory.learnHabit({name:'鸡胸安排',topic:first.topic,text:update,evidence:update,
  constraint:{...limit.constraint,maxMeals:0}},update);
 assert.equal(first.id,second.id);
 assert.equal(second.history[0].text,evidence);
 assert.equal(memory.activeHabits()[0].constraint.maxMeals,0);
});

test('native tool access is independent of workflows, an unknown SKU can retain actual food, and access off blocks writes',async()=>{
 const finance=memoryStore(),memory=memoryLibrary(finance);
 let health=assistantFixture(today);
 const workspace={finance,memory,readHealth:async()=>structuredClone(health),saveHealth:async(next,revision,guard)=>{
  assert.equal(health.revision??0,revision);guard?.();health={...structuredClone(next),revision:revision+1};
 }};
 setHealthAuto(finance,true);
 finance.setItem('airplane-ai-skills-v2',JSON.stringify({runtime:{intake:false}}));
 const tools=createAgentTools(workspace);
 const text='午饭吃了120g合成杂粮粥';
 const run={id:'x',date:today,clock:'12:20',allowRead:true,messages:[text],attachments:[]};
 const context={run,operationId:'different-one'};
 const args=proposal(action('eat',text,{name:'合成杂粮粥',amount:120,unit:'g',source:'auto',whole:'no'}));
 const before=structuredClone(health.local.stockMoves);
 const saved=await tools('write_health',args,context);
 assert.equal(saved.status,'saved',JSON.stringify(saved));
 assert.equal(health.local.foods.at(-1).stockAssociation,'pending');
 assert.deepEqual(health.local.stockMoves,before);
 await assert.rejects(tools('write_health',args,{...context,run:{...run,allowRead:false}}),/权限/);
});
