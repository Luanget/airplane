import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateMealPlan,planOperation,undoMealPlan,planningFacts,vegetableIntake,mushroomIntake} from '../ai/meal-planning.mjs';
import {assistantFixture,action,proposal} from './health-action-fixture.mjs';
import {packagesFor} from '../health/containers.mjs';
import {addFood,dayIntake,deleteEvent,events,newState,validateAppState} from '../health/core.mjs';
import {mealDay} from '../health/meal-status.mjs';
import {saveSku} from '../health/inventory.mjs';
import {memoryLibrary} from '../ai/memory.mjs';
import {createAgentTools} from '../ai/agent-tools.mjs';
import {setHealthAuto} from '../ai/health-actions.mjs';
import {readChatModel,saveChatModel} from '../ai/models.mjs';

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
 const priorMealChange=evaluateMealPlan(saved.next,{items:[row('酸奶',100,'午餐')],replaceIds:[]},today,[limit]);
 assert.equal(priorMealChange.feasible,false);
 assert.match(priorMealChange.violations[0].reason,/已有保存计划/);
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

test('natural schedule and follow-up can save and append to the selected meal, with unchanged stock',async()=>{
 const finance=memoryStore(),memory=memoryLibrary(finance);
 let state=assistantFixture(today);
 saveSku(state,{id:'egg',name:'合成鸡蛋',unit:'个',basisAmount:1,basisUnit:'个',kcal:75,protein:6,carbs:1,fat:5,sodium:70}).qty=6;
 const before=structuredClone(state.local.stockMoves);
 const workspace={finance,memory,readHealth:async()=>structuredClone(state),saveHealth:async(next,revision,guard)=>{
  assert.equal(state.revision??0,revision);guard?.();state={...structuredClone(next),revision:revision+1};
 }};
 const tool=createAgentTools(workspace),noodles={...row('fixture-noodles',1,'午餐'),unit:'包'};
 const write=(id,evidence,fields,messages=[evidence])=>tool('write_meal_plan',{evidence,replaceIds:[],appendTo:[],...fields},
  {run:{date:today,allowRead:true,messages,attachments:[]},operationId:id});
 const request='安排明天午餐，荞麦面一包';
 assert.equal((await write('preview',request,{items:[noodles]})).status,'review');
 assert.equal(events(state,'foods').filter(row=>row.date===tomorrow).length,0);
 setHealthAuto(finance,true);
 const saved=await write('lunch',request,{items:[noodles]});
 assert.equal(saved.status,'saved');
 assert.equal((await write('lunch',request,{items:[noodles]})).receipt.revision,saved.receipt.revision);
 const lunch=saved.receipt.createdIds[0];
 const dinner=await write('dinner','就按刚才方案执行',{items:[{...row('fixture-greens',200,'晚餐')}]});
 assert.equal(dinner.status,'saved');
 const amendment='把午餐再加个鸡蛋';
 const egg={...row('egg',1,'午餐'),unit:'个'};
 assert.equal((await write('old-context',request,{items:[egg],appendTo:[lunch]},[request,amendment])).status,'conflict');
 assert.equal((await write('add-egg',amendment,{items:[egg],appendTo:[lunch]})).status,'saved');
 const active=events(state,'foods').filter(row=>row.date===tomorrow);
 assert.equal(active.length,3);assert.equal(active.find(row=>row.id===lunch).nutrition.kcal,220);
 assert.equal(active.find(row=>row.id===dinner.receipt.createdIds[0]).meal,'晚餐');
 assert.equal(dayIntake(state,tomorrow).totals.kcal,null);
 assert.deepEqual(state.local.stockMoves,before);
});

test('a saved meal keeps other food and unused portions in projection even after actual food and cancellation',()=>{
 const state=assistantFixture(today);
 const log=(foodId,name,amount,amountUnit,kcal,status)=>addFood(state,{date:today,meal:'晚餐',foodId,name,
  amount,amountUnit,kcal,protein:10,carbs:12,fat:3,sodium:40,status});
 const noodles=log('fixture-noodles','荞麦面',2,'包',440,'plan');
 const egg=log('egg','鸡蛋',1,'个',75,'plan');
 const greens=log('fixture-greens','蔬菜',200,'g',40,'plan');
 const eaten=log('egg','鸡蛋',1,'个',75,'actual');
 log('distinct-egg','鸡蛋',1,'个',60,'cancelled');
 let day=mealDay(state,today);
 assert.equal(day.actual.totals.kcal,75);assert.equal(day.planned.kcal,480);assert.equal(day.projected.kcal,555);
 assert.deepEqual(day.plans.find(item=>item.row.id===egg.id).actualIds,[eaten.id]);
 const facts=planningFacts(state,[today],today,[]).days[0];
 assert.equal(facts.existingPlans.find(item=>item.id===egg.id).status,'executed');
 assert.equal(evaluateMealPlan(state,{items:[],dates:[today]},today).days[0].projected.kcal,555);
 const firstServing=log('fixture-noodles','荞麦面',1,'包',220,'actual');
 day=mealDay(state,today);
 assert.equal(day.plans.find(item=>item.row.id===noodles.id).remaining.amount,1);
 assert.equal(day.planned.kcal,260);assert.equal(day.projected.kcal,555);
 deleteEvent(state,'foods',firstServing.id);deleteEvent(state,'foods',greens.id);
 day=mealDay(state,today);
 assert.equal(day.planned.kcal,440);assert.equal(day.projected.kcal,515);
 const corrected=log('distinct-egg','鸡蛋',1,'个',60,'actual');
 deleteEvent(state,'foods',eaten.id);
 day=mealDay(state,today);
 assert.equal(day.plans.find(item=>item.row.id===egg.id).status,'pending');
 assert.ok(day.actualRows.some(item=>item.id===corrected.id));
 log('fixture-noodles','荞麦面',null,null,100,'actual');
 assert.equal(mealDay(state,today).plans.find(item=>item.row.id===noodles.id).remaining.amount,2);
});

test('stock feasibility is separate from nutrition targets and evidence-based cost',()=>{
 const state=assistantFixture(today);
 Object.assign(state.settings,{calorieTarget:1700,proteinMin:150,proteinMax:170,fatMin:45});
 const {feasible,days:[day]}=evaluateMealPlan(state,{items:[{...row('fixture-noodles',1,'晚餐'),unit:'包'}]},today);
 assert.equal(feasible,true);assert.equal(day.projected.kcal,220);
 assert.equal(day.nutritionCheck.status,'outside');
 assert.deepEqual(day.nutritionCheck.outside,['kcal','protein','fat','carbs','vegetables']);
 assert.deepEqual(day.nutritionCheck.checks.vegetables,{status:'below',value:0,min:500,max:null,difference:500});
 assert.deepEqual(day.nutritionCheck.checks.kcal,{status:'below',value:220,min:1615,max:1785,difference:1395});
 assert.equal(day.nutritionCheck.checks.sodium.status,'within');
 assert.deepEqual(day.cost,{knownPlannedCost:null,knownDayCost:null,complete:false});
});

test('default is explicitly Terra and the selected model always takes precedence',()=>{
 const store=memoryStore();
 assert.equal(readChatModel(store).name,'Terra');
 for(const [id,name] of [['gpt-6-luna','Luna'],['gpt-6.2-sol','Sol'],['gpt-6.1-terra','Terra']]){
  saveChatModel(store,id);assert.equal(readChatModel(store).name,name);
 }
 saveChatModel(store,'auto');assert.equal(readChatModel(store).name,'Terra');
});

test('plans count recorded pure vegetables and account for mushrooms separately',()=>{
 const state=newState();
 const add=(id,name,qty,foodGroup)=>{saveSku(state,{id,name,unit:'g',basisUnit:'g',basisAmount:100,foodGroup,
  vegetableBasis:foodGroup==='vegetable'?'whole':null,kcal:18,protein:1,fat:.2,carbs:3,sodium:20}).qty=qty;};
 add('cabbage','娃娃菜',500,'vegetable');
 add('celery','新鲜芹菜',500,'vegetable');
 add('mushroom','水煮金针菇（熟重）',250,'mushroom');
 const summary=items=>evaluateMealPlan(state,{items,dates:[tomorrow]},today).days[0];
 const target={status:'within',min:500,max:null,value:500,difference:0};
 assert.deepEqual(summary([row('cabbage',500,'午餐')]).nutritionCheck.checks.vegetables,target);
 const day=summary([row('celery',500,'午餐'),row('mushroom',250,'晚餐')]);
 assert.deepEqual(day.nutritionCheck.checks.vegetables,target);
 assert.equal(day.mushrooms.grams,250);
 assert.deepEqual(summary([]).nutritionCheck.checks.vegetables,{status:'below',min:500,max:null,value:0,difference:500});
});

test('SKU classification survives saving, unrelated edits and a JSON round trip',()=>{
 const state=newState(),fields={unit:'g',basisUnit:'g',basisAmount:100};
 const sku=saveSku(state,{...fields,id:'market-a',name:'市场鲜品A',foodGroup:' vegetable ',category:'时令菜'});
 sku.qty=500;
 const edited=saveSku(state,{...fields,id:sku.id,name:'市场鲜品B',category:undefined});
 assert.equal(edited.foodGroup,'vegetable');
 assert.equal(edited.category,'时令菜');
 assert.equal(edited.qty,500);
 const categoryOnly=saveSku(state,{...fields,id:'market-b',name:'市场鲜品C',category:'菌菇类'});
 categoryOnly.qty=500;
 const restored=JSON.parse(JSON.stringify(state));
 assert.ok(validateAppState(restored));
 assert.deepEqual(planningFacts(restored,[tomorrow],today,[]).inventory.map(({foodGroup,category})=>[foodGroup,category]),
  [['vegetable','时令菜'],[undefined,'菌菇类']]);
 const tracked=evaluateMealPlan(restored,{items:[row(sku.id,500,'午餐')]},today).days[0];
 assert.equal(tracked.vegetables.grams,500);
 assert.equal(tracked.nutritionCheck.checks.vegetables.status,'within');
 const pending=evaluateMealPlan(restored,{items:[row(categoryOnly.id,500,'午餐')]},today).days[0];
 assert.deepEqual(pending.vegetables.pending,['市场鲜品C']);
 assert.equal(pending.nutritionCheck.checks.vegetables.status,'unknown');
 const staple=saveSku(state,{...fields,id:'corn',name:'玉米',foodGroup:'staple'});
 staple.qty=500;
 assert.equal(evaluateMealPlan(state,{items:[row(staple.id,500,'午餐')]},today).days[0].vegetables.grams,0);
});

test('only supported weight of pure vegetables counts while mixed food keeps its full nutrients',()=>{
 const state=newState(),fields={unit:'g',basisUnit:'g',basisAmount:100,kcal:160,protein:8,carbs:18,fat:6,sodium:320};
 for(const [index,name] of ['菠菜鸡蛋饼','牛肉芹菜水饺','牛肉芹菜大馄饨','娃娃菜鸡蛋汤'].entries()){
  const dish=saveSku(state,{...fields,id:'mixed-'+index,name,foodGroup:'mixed',price:.04});
  dish.qty=500;
  const [day]=evaluateMealPlan(state,{items:[{...row(dish.id,500,'午餐'),vegetableGrams:120}]},today).days;
  assert.deepEqual(day.vegetables,{grams:0,unmeasured:[],knownItems:0});
  assert.deepEqual(day.projected,{kcal:800,protein:40,carbs:90,fat:30,sodium:1600});
  assert.equal(day.cost.knownPlannedCost,20);
  assert.equal(day.nutritionCheck.checks.vegetables.status,'below');
 }
 const withOil=saveSku(state,{...fields,id:'cooked-veg',name:'清炒芹菜',foodGroup:'vegetable',vegetableBasis:'component'});
 withOil.qty=500;
 const [planned]=evaluateMealPlan(state,{items:[{...row(withOil.id,300,'午餐'),vegetableGrams:250}]},today).days;
 assert.equal(planned.vegetables.grams,250);
 assert.equal(planned.projected.kcal,480);
 const [uncertain]=evaluateMealPlan(state,{items:[row(withOil.id,300,'午餐')]},today).days;
 assert.deepEqual(uncertain.vegetables.unmeasured,['清炒芹菜']);
 assert.equal(uncertain.nutritionCheck.checks.vegetables.status,'unknown');
 const noSku=new Map();
 assert.deepEqual(vegetableIntake([{name:'芹菜味饼干',foodGroup:'snack',portion:'500 g'}],noSku),
  {grams:0,unmeasured:[],knownItems:0});
 assert.deepEqual(vegetableIntake([{name:'娃娃菜',foodGroup:'vegetable',vegetableBasis:'whole',portion:'一份'}],noSku),
  {grams:null,unmeasured:['娃娃菜'],knownItems:0});
 const mushrooms=[{name:'金针菇',foodGroup:'mushroom',portion:'120 g'}];
 assert.equal(vegetableIntake(mushrooms,noSku).grams,0);
 assert.equal(mushroomIntake(mushrooms,noSku).grams,120);
 assert.deepEqual(vegetableIntake([{name:'芹菜',portion:'500 g'}],noSku).pending,['芹菜']);
});
