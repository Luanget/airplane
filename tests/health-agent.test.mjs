import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assistantFixture,action,proposal} from './health-action-fixture.mjs';
import {addBatch,saveSku} from '../health/inventory.mjs';
import {addFood,addDays,dayIntake,energyForDay,events,inventoryWithMoves,recordEvent,setDayCompleteness,validateAppState} from '../health/core.mjs';
import {ensureContainers,packagesFor} from '../health/containers.mjs';
import {recordPurchase} from '../health/purchases.mjs';
import {HEALTH_SKILLS,SKILLS_KEY,assertSkillAction,selectSkills,setSkillEnabled,skillCatalog} from '../ai/skills.mjs';
import {CORE_RULES,applyProfileSettings,habitPolicy,prepareHealthProfile} from '../ai/health-profile.mjs';
import {MEMORY_KEY,memoryLibrary} from '../ai/memory.mjs';
import {healthReport,renderHealthReport} from '../ai/health-report.mjs';
import {buildMealPlan,executeHealthAction,healthActionPreview} from '../ai/health-actions.mjs';
import {groupMealPhotos} from '../ai/meal-photos.mjs';
import {modelRequest,pendingLedgerRead} from '../ai/responses.mjs';
import {readHealthFileStatus,HEALTH_FILE_STATUS_KEY,createSyncPackage} from '../health/sync-io.mjs';
import {importSource} from '../health/sync-source.mjs';
import {planHealthMerge} from '../health/sync.mjs';

const date='2030-04-03',yesterday='2030-04-02';
const keys=Object.keys(CORE_RULES);
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
const make=()=>assistantFixture(date);
const workflow=(version,text)=>({name:'HEALTH_WORKFLOW_AND_STORAGE_'+version+'.md',text:'# 工作规范\n'+keys.map(key=>'- '+key).join('\n')+'\n'+text});
const ruleText='普通日参考约 1700 kcal，蛋白质150–170g，脂肪45g，钠2000mg。\n'+
 'TDEE基线 2900 kcal，已包含日常通勤。Watch总热量仍在校准。六天缺口 7700 kcal。\n'+
 '一天通常1袋熟鸡胸。芹菜在午餐与晚餐分两餐。每餐蔬菜优先整份。正常午餐稍多、晚餐稍少。普通日不安排火鸡面。';
const plan=prepareHealthProfile([workflow('300403.2',ruleText)],make(),{now:'2030-04-03T10:00:00.000Z'});
function workspace(seed=make()){
 let live=structuredClone(seed);
 return {count:0,async readHealth(){return structuredClone(live);},
  async saveHealth(next,expected,guard){assert.equal(live.revision??0,expected);guard?.();assert.ok(validateAppState(next));this.count++;live={...structuredClone(next),revision:expected+1};return live;}};
}
const apply=(db,text,steps,extra={})=>db.readHealth().then(before=>executeHealthAction(db,before,
 Array.isArray(steps)?proposal(...steps):steps,{text,id:extra.id??'agent:'+text,today:date,clock:'12:30',auto:true,now:1000,...extra}));

test('skills are versioned, scoped, toggleable, and preserve legacy storage',()=>{
 const store=storage();store.setItem(SKILLS_KEY,JSON.stringify({personal:[{id:'old'}],overrides:{x:{text:'old'}}}));
 const first=selectSkills(skillCatalog(store),{text:'牛肉酱现在310g'});
 assert.deepEqual(first.map(row=>row.id),['weighing']);
 assert.ok(HEALTH_SKILLS.every(row=>row.version>0&&row.tools.length&&row.checks&&row.output));
 setSkillEnabled(store,'weighing',false);
 assert.throws(()=>assertSkillAction(skillCatalog(store),'weigh'),/已停用/);
 assert.equal(selectSkills(skillCatalog(store),{text:'牛肉酱现在310g'}).length,0);
 assert.deepEqual(JSON.parse(store.getItem(SKILLS_KEY)).personal,[{id:'old'}]);
 const text='牛肉酱现在310g',input={mode:'chat',text,date,photo:null,history:[]};
 const req=modelRequest(input,{allowRead:true,healthActions:true,skills:first});
 assert.match(req.instructions,/weighing v1/);
 assert.doesNotMatch(req.instructions,/correction v1|exercise v1/);
 assert.equal(pendingLedgerRead({status:'completed',output:[{type:'function_call',name:'read_health_report',call_id:'x',
  arguments:JSON.stringify({date,view:'summary'})}]},{allowRead:true}).args.scope,'health_report');
});

test('latest rule import excludes archived and lower versions while retaining revisable habits',()=>{
 const store=storage(),lib=memoryLibrary(store);
 store.setItem(SKILLS_KEY,JSON.stringify({personal:[],overrides:{'l-progress':{text:'旧 TDEE 规则',enabled:true}}}));
 const current=workflow('300403.2',ruleText);
 const outdated=workflow('300403.1','普通日参考 2400 kcal。');
 const core={name:'CORE_RULES_300403.2.md',text:'# 核心规则\n'+keys.join('\n')+'\n## 历史归档\nTDEE基线3000kcal'};
 const raw={name:'health_tracker_300403.2.json',text:JSON.stringify({handoff_version:'300403.2',tables:{
  rules:keys.map(id=>({Key:id,状态:id==='08_recovery_and_safety'?'inactive':'active',说明:id}))}})};
 const profile=prepareHealthProfile([outdated,current,core,raw],make());
 assert.equal(profile.ruleIds.length,7);
 assert.equal(profile.settings.baselineTdee,2900);
 assert.equal(profile.ignored,1);
 lib.importProfile(profile)();
 assert.equal(lib.profile().version,'300403.2');
 assert.equal(lib.list().find(row=>row.id==='l-progress').enabled,false);
 assert.equal(habitPolicy(lib.list()).avoidTurkey,true);
 const old=lib.list().find(row=>row.topic==='chicken-one');
 lib.prepare(old.id,{name:old.name,text:'熟鸡胸每天两袋',priority:80},'update').commit();
 lib.importProfile(profile)();
 assert.equal(habitPolicy(lib.list()).chickenLimit,2);
 assert.throws(()=>prepareHealthProfile([outdated],make(),{previousVersion:profile.version}),/早于/);
 const said='以后工作日也可以吃火鸡面。';
 assert.deepEqual(lib.rememberFromTurn([{name:'火鸡面新偏好',text:said,evidence:said}],said),['常规日避开高热量火鸡面']);
 assert.equal(habitPolicy(lib.list()).avoidTurkey,false);
 assert.ok(JSON.parse(store.getItem(MEMORY_KEY)).some(row=>row.updatedAt));
});

test('automatic memory ignores one-time food and hypothetical preferences',()=>{
 const lib=memoryLibrary(storage());
 for(const message of ['今天吃了鸡胸。','假如以后每天吃两袋鸡胸。','你觉得以后要不要吃火鸡面？'])
  assert.deepEqual(lib.rememberFromTurn([{name:'鸡胸',text:message,evidence:message}],message),[]);
 assert.deepEqual(lib.rememberFromTurn([{name:'鸡胸习惯',text:'平时每天一袋熟鸡胸。',evidence:'平时每天一袋熟鸡胸。'}],
  '平时每天一袋熟鸡胸。'),['鸡胸习惯']);
 assert.equal(habitPolicy(lib.list()).chickenLimit,1);
});

function addStock(state,id,name,quantity,{unit='g',kcal=100,portion=false}={}){
 const sku=saveSku(state,{id,name,unit,basisUnit:unit,basisAmount:unit==='g'?100:1,kcal,protein:15,fat:6,carbs:20,sodium:160});
 if(portion)addBatch(state,{id:'batch-'+id,foodId:id,date:yesterday,quantity,portion:true,costCents:500});
 else sku.qty=quantity;
 return sku;
}

test('the local planner follows imported habits, includes exact portions and offers normal recovery',()=>{
 const state=make(),lib=memoryLibrary(storage());
 lib.importProfile(plan)();
 const habits=habitPolicy(lib.list());
 addStock(state,'celery','合成芹菜',500,{portion:true});
 addStock(state,'turkey','合成高热量火鸡面',2,{unit:'包',kcal:620});
 addStock(state,'nuts','合成坚果',90);
 ensureContainers(state);
 const request=action('next_meal','安排晚餐',{meal:'晚餐',preferences:['芹菜','火鸡味']});
 const first=buildMealPlan(state,request,date,habits);
 assert.ok(first.items.some(row=>row.foodId==='fixture-chicken'&&row.amount===246));
 assert.ok(first.items.some(row=>row.foodId==='celery'&&row.amount===250&&row.containerId));
 assert.ok(!first.items.some(row=>['turkey','nuts'].includes(row.foodId)));
 const before=structuredClone(state);
 const draft=healthActionPreview(state,proposal(request),{id:'plan',text:'安排晚餐',today:date,clock:'12:30',habits});
 assert.ok(draft.source.text.includes('计划 · 晚餐'));
 assert.deepEqual(state,before);
 addFood(state,{name:'合成高热量外食',date,meal:'午餐',kcal:2300,protein:20});
 const after=buildMealPlan(state,request,date,habits);
 assert.ok(after.items.length);
 assert.match(after.reply,/下一餐正常吃/);
});

test('commute and wearable totals do not inflate TDEE, repeated exercise is deduped, and earlier days are preserved',async()=>{
 const original=make(),prior=energyForDay(original,yesterday,date).tdee;
 const state=applyProfileSettings(original,plan.settings,date);
 const db=workspace(state);
 const commute='通勤骑行8公里消耗300kcal',ride='专项夜骑20公里消耗400kcal',watch='手表全天总消耗3600kcal';
 const activity=(text,name,km,kcal,energyKind='activity')=>action('activity',text,{name,km,kcal,energyKind,quality:'device',includedInBase:'no',uncertainty:''});
 await apply(db,commute,[activity(commute,'通勤骑行',8,300)]);
 await apply(db,ride,[activity(ride,'专项夜骑',20,400)]);
 await apply(db,watch,[activity(watch,'手表全天总消耗',null,3600,'total')]);
 const repeated='补记手表户外骑行20公里消耗400kcal';
 await apply(db,repeated,[activity(repeated,'手表户外骑行',20,400)]);
 const saved=await db.readHealth();
 assert.equal(saved.local.activities.length,3);
 assert.equal(saved.local.activities[0].includedInBase,true);
 assert.equal(saved.local.activities[2].excludedFromEnergy,true);
 assert.equal(energyForDay(saved,date,date).tdee,3300);
 assert.equal(energyForDay(saved,yesterday,date).tdee,prior);
});

test('daily reports distinguish pending meals, missing nutrients, measured weights and a live cycle deficit',()=>{
 const state=applyProfileSettings(make(),plan.settings,date);
 const mix=(name,day,meal,status,energy)=>addFood(state,{name,date:day,meal,status,kcal:energy,protein:20,carbs:30,fat:10,sodium:111});
 const missing=addDays(date,-2);
 state.settings.cycleAnchor=addDays(date,-5);
 for(let i=1;i<=4;i++)if(i!==2)mix('餐次 '+i,addDays(date,-i),'晚餐','actual',1600);
 mix('实际午餐',date,'午餐','actual',550);
 mix('已被实际覆盖',date,'午餐','plan',450);
 mix('晚餐方案',date,'晚餐','plan',600);
 for(let i=0;i<8;i++)recordEvent(state,'weights',{date:addDays(date,-i),kg:78+i/10,isMorning:true});
 const full=healthReport(state,date,date);
 const old=healthReport(state,missing,date);
 assert.equal(old.quality.status,'缺报');
 assert.ok(full.cycle.unreported>0);
 assert.equal(full.weight.count,7);
 assert.equal(full.actual.kcal,550);
 assert.equal(full.conditionalNutrition.kcal,1150);
 assert.equal(full.plans.length,1);
 assert.equal(full.cycle.deficit,3762.2);
 assert.equal(full.cycle.possibleOverestimate,true);
 assert.match(renderHealthReport(full),/周期账面缺口.*\n理论脂肪当量/s);
 mix('历史补报',missing,'晚餐','actual',1500);
 assert.equal(healthReport(state,date,date).cycle.reportedDays,full.cycle.reportedDays+1);
 const result=healthReport(state,date,date).cycle.deficit;
 setDayCompleteness(state,missing,'complete');
 assert.equal(healthReport(state,date,date).cycle.deficit,result);
});

const basePhoto={dishKey:'noodle',name:'合成米粉',role:'served',images:[1],amount:170,unit:'g',
 confidence:'estimated',basisAmount:100,basisUnit:'g',nutrition:{kcal:100,protein:5,carbs:20,fat:1,sodium:80},uncertainty:'图像估重'};
const photos=[
 basePhoto,{...basePhoto,dishKey:'different-angle',images:[2]},
 {...basePhoto,role:'label',images:[3],amount:null,confidence:'label'},
 {...basePhoto,role:'leftover',images:[4],amount:20},
 {...basePhoto,role:'extra',images:[4],amount:80}
];
const pictured={intent:'execute',date:null,meal:'午餐',observations:photos,steps:[]};

test('a same-meal image group combines angles, label and remaining amount; only explicit continuation becomes extra',async()=>{
 const text='午餐已经吃了，记这餐，另有一份续粉。';
 const grouped=groupMealPhotos(pictured,text,4);
 assert.equal(grouped.plan.steps.length,2);
 assert.deepEqual(grouped.plan.steps.map(row=>row.amount),[150,80]);
 assert.equal(grouped.photoSteps[1].part,'extra');
 assert.deepEqual(grouped.photoSteps[0].images,[1,2,3,4]);
 const db=workspace();
 await apply(db,text,grouped.plan,{photoSteps:grouped.photoSteps,mediaKey:'one'});
 const first=await db.readHealth();
 assert.equal(dayIntake(first,date).totals.kcal,230);
 assert.equal(events(first,'foods').filter(row=>row.date===date).length,2);
 assert.equal(first.local.foods.at(-1).agentEvidence.part,'extra');
 const retry=await apply(db,text,grouped.plan,{id:'repeated',photoSteps:grouped.photoSteps,mediaKey:'one'});
 assert.equal(retry.duplicate,true);
 assert.equal(db.count,1);
 await apply(db,text,grouped.plan,{id:'unrelated-fingerprints',photoSteps:grouped.photoSteps,mediaKey:'two'});
 assert.equal(db.count,2);
 assert.equal(groupMealPhotos(pictured,'只识别照片',4).plan.intent,'preview');
 assert.equal(groupMealPhotos(pictured,'午餐已吃，请记账',4).review,true);
 const sample='data:image/jpeg;base64,/9j/AAAA';
 const payload=modelRequest({mode:'chat',text,date,history:[],photo:sample},{allowRead:true,photos:[sample,sample]});
 assert.equal(payload.input[0].content.filter(row=>row.type==='input_image').length,2);
 assert.match(payload.instructions,/同一菜不同角度/);
});

test('zero-stock repurchase retains SKU, and sync reporting never upgrades a file receipt to external verification',()=>{
 const state=make(),store=storage();
 const sku=addStock(state,'repurchase','合成复购食材',0);
 recordPurchase(state,{id:'repurchase-1',date,items:[{foodId:sku.id,quantity:320,costCents:400}],totalCents:400});
 assert.equal(inventoryWithMoves(state).filter(row=>row.id===sku.id).length,1);
 assert.equal(inventoryWithMoves(state).find(row=>row.id===sku.id).qty,320);
 const pkg=createSyncPackage(state,{id:'phone',version:'0.9.13'});
 assert.equal(readHealthFileStatus(store,state).syncPackage,null);
 store.setItem(HEALTH_FILE_STATUS_KEY,JSON.stringify({issuedAt:pkg.anchor.exportedAt,revision:pkg.anchor.revision}));
 assert.equal(readHealthFileStatus(store,state).external.verified,false);
 assert.equal(readHealthFileStatus(store,state).syncPackage.issuedAt,pkg.anchor.exportedAt);
 const mismatch=structuredClone(state);
 mismatch.local.foods[0].nutrition.kcal+=20;
 const merge=planHealthMerge(mismatch,importSource(pkg));
 assert.ok(merge.unresolved.some(row=>row.kind==='foods'));
});

test('two-meal plans reserve the same celery portion across lunch and dinner without allocating another chicken bag',()=>{
 const state=applyProfileSettings(make(),plan.settings,date),lib=memoryLibrary(storage());
 lib.importProfile(plan)();
 addStock(state,'celery','合成芹菜',500,{portion:true});
 ensureContainers(state);
 const text='安排今天午餐和晚餐，含芹菜';
 const preview=healthActionPreview(state,proposal(action('next_meal',text,{meal:null,preferences:['芹菜']})),
  {id:'two-meals',text,today:date,clock:'09:00',habits:habitPolicy(lib.list())});
 assert.match(preview.preview,/午餐建议[\s\S]*晚餐建议/);
 assert.equal((preview.source.text.match(/合成芹菜 · 250 g/g)??[]).length,2);
 assert.equal((preview.source.text.match(/合成熟鸡胸 ·/g)??[]).length,1);
 assert.equal(inventoryWithMoves(state).find(row=>row.id==='celery').qty,500);
});

test('a readable label and one stated eaten weight are enough to save the same named food',()=>{
 const label={...basePhoto,name:'合成米粉',role:'label',confidence:'label',amount:null,unit:null};
 const proposal={intent:'preview',date:null,meal:null,observations:[label],steps:[]};
 const grouped=groupMealPhotos(proposal,'中午吃完合成米粉150g，请按标签记录',1);
 assert.equal(grouped.plan.intent,'execute');
 assert.equal(grouped.plan.steps[0].amount,150);
 assert.equal(grouped.plan.steps[0].nutrition.kcal,150);
 assert.equal(grouped.plan.steps[0].meal,'午餐');
 assert.equal(groupMealPhotos(proposal,'中午吃完合成鸡蛋150g，请按标签记录',1).plan.steps.length,0);
});

test('future meal recommendations use the requested local date without writing consumption',()=>{
 const today='2030-12-31',tomorrow='2031-01-01',later='2031-01-03',state=assistantFixture(today);
 const before=structuredClone(state);
 const options={id:'future-plan',today,clock:'20:15'};
 const first=healthActionPreview(state,proposal(action('next_meal','早餐',{meal:null,preferences:[]})),
  {...options,text:'安排明天的早餐'});
 assert.equal(first.execute,false);
 assert.match(first.preview,/2031年1月1日/);
 assert.match(first.source.text,/2031年1月1日 · 饮食计划.*计划 · 早餐.*计划合计/s);
 assert.doesNotMatch(first.source.text,/缺报|全天实际/);
 const laterPreview=healthActionPreview(state,proposal(action('next_meal','晚餐',{date:later,meal:'晚餐',preferences:[]})),
  {...options,text:'安排2031-01-03晚餐'});
 assert.match(laterPreview.preview,/2031年1月3日/);
 assert.throws(()=>healthActionPreview(state,proposal(action('eat','明天吃了20g牛肉酱',
  {name:'牛肉酱',amount:20,unit:'g',whole:'no'})),{...options,text:'明天吃了20g牛肉酱'}),/今天或更早/);
 assert.deepEqual(state,before);
 addFood(state,{date:tomorrow,name:'合成明日午餐',meal:'午餐',status:'plan',kcal:350});
 const report=healthReport(state,tomorrow,today);
 assert.equal(report.conditionalNutrition.kcal,350);
 assert.equal(dayIntake(state,tomorrow).totals.kcal,null);
 assert.deepEqual(state.local.stockMoves,before.local.stockMoves);
});
