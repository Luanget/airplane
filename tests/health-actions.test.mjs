import assert from 'node:assert/strict';
import {test} from 'node:test';
import {executeHealthAction,healthContext,readPackages,undoHealthAction} from '../ai/health-actions.mjs';
import {modelRequest,parseResult,pendingLedgerRead} from '../ai/responses.mjs';
import {dayIntake,events,inventoryWithMoves,validateAppState} from '../health/core.mjs';
import {confirmPackageAction,packagesFor} from '../health/containers.mjs';
import {assistantFixture,action,examples,proposal} from './health-action-fixture.mjs';

const today='2030-04-03';
function fake(initial=assistantFixture(today)){
 let state=structuredClone(initial);
 return {
  async readHealth(){return structuredClone(state);},
  async saveHealth(next,expected,guard){
   assert.equal(expected,state.revision??0);
   guard?.();
   if(this.fail==='before')throw Error('模拟事务中断');
   assert.equal(validateAppState(next),true);
   this.writes=(this.writes??0)+1;
   state={...structuredClone(next),revision:expected+1};
   if(this.fail==='after')throw Error('模拟回执中断');
   return state;
  }
 };
}
const model=(workspace,text,plan=examples[text],options={})=>workspace.readHealth().then(base=>
 executeHealthAction(workspace,base,plan,{id:'turn-'+text,text,today,clock:'12:30',auto:true,now:1000,...options}));
const bag=(state,id)=>packagesFor(state,id);
const qty=(state,id)=>inventoryWithMoves(state).find(row=>row.id===id).qty;
const sauce='fixture-sauce',milk='fixture-milk',chicken='fixture-chicken',noodles='fixture-noodles';

test('A and B use the open package, preserve genuine measurements and subtract intervening consumption once',async()=>{
 const w=fake();
 const first=await model(w,'牛肉酱现在310g');
 assert.match(first.text,/12\.2 g/);
 let s=await w.readHealth(),row=bag(s,sauce)[0];
 assert.equal(row.eaten,50);
 assert.equal(row.gross,310);
 assert.equal(qty(s,sauce),2);
 const second=await model(w,'吃了20g牛肉酱');
 assert.match(second.text,/20 g/);
 s=await w.readHealth();row=bag(s,sauce)[0];
 assert.equal(row.eaten,70);
 assert.equal(row.gross,310);
 assert.equal(row.unweighedGrams,20);
 assert.equal(s.local.foods.at(-1).weighing,undefined);
 const text='牛肉酱现在280g';
 const third=await model(w,text,proposal(action('weigh',text,{name:'牛肉酱',gross:280})));
 assert.match(third.text,/10 g/);
 assert.equal(bag(await w.readHealth(),sauce)[0].eaten,80);
 await model(w,text,proposal(action('weigh',text,{name:'牛肉酱',gross:280})),{id:'next-message'});
 assert.equal(w.writes,3);
});

test('C consumes one unopened carton, closes only that carton, and does not invent grams',async()=>{
 const w=fake();
 const result=await model(w,'喝完一盒牛奶');
 assert.match(result.text,/1000 mL/);
 const s=await w.readHealth();
 assert.deepEqual(bag(s,milk).map(row=>[row.status,row.gross]),[['empty',null],['empty',null],['sealed',null]]);
 assert.equal(qty(s,milk),1000);
 assert.equal(s.local.foods.at(-1).amountUnit,'mL');
 assert.equal(s.local.foods.at(-1).nutrition.kcal,350);
});

test('D records the whole weighed serving and two packs in one save before planning from the saved state',async()=>{
 const w=fake();
 const result=await model(w,'吃了一袋鸡胸、两包面，安排晚餐');
 assert.match(result.text,/246 g.*2 包/s);
 assert.match(result.text,/下一餐建议/);
 const s=await w.readHealth();
 assert.equal(w.writes,1);
 assert.equal(s.local.foods.filter(row=>row.date===today).length,2);
 assert.equal(qty(s,chicken),497);
 assert.equal(qty(s,noodles),4);
 assert.equal(s.local.foods.filter(row=>row.status==='plan').length,0);
});

test('E corrects the original full-carton volume, keeps its sole stock deduction, and deduplicates fresh repeated text',async()=>{
 const w=fake();
 const before=await w.readHealth(),original=events(before,'foods').find(row=>row.foodId===milk);
 const result=await model(w,'昨天牛奶少算200mL');
 assert.match(result.text,/更正.*1200 mL/);
 const after=await w.readHealth();
 assert.equal(events(after,'foods').length,events(before,'foods').length);
 const revised=events(after,'foods').find(row=>row.id===original.id);
 assert.equal(revised.amount,1200);
 assert.equal(revised.nutrition.kcal,420);
 assert.deepEqual(after.local.stockMoves,before.local.stockMoves);
 assert.equal(bag(after,milk)[0].volumeMl,1200);
 const again=await model(w,'昨天牛奶少算200mL',undefined,{id:'reissued'});
 assert.equal(again.duplicate,true);
 assert.equal(w.writes,1);
});

test('F rejects ambiguous or rising readings, insufficient stock, fabricated values, and negated requests',async()=>{
 let initial=assistantFixture(today);
 const second=bag(initial,sauce)[1];
 initial=confirmPackageAction(initial,{id:'other',action:'baseline',containerId:second.id,gross:410,date:today}).next;
 const w=fake(initial),base=await w.readHealth();
 await assert.rejects(model(w,'牛肉酱现在310g'),/多个可用包装/);
 for(const [text,schema,pattern] of [
  ['牛肉酱A瓶现在500g',proposal(action('weigh','牛肉酱A瓶现在500g',{name:'牛肉酱',gross:500})),/毛重增加/],
  ['吃了十包荞麦面',proposal(action('eat','吃了十包荞麦面',{name:'荞麦面',whole:'yes',amount:10,unit:'包'})),/库存不足/],
  ['吃了20g牛肉酱',proposal(action('eat','吃了20g牛肉酱',{name:'牛肉酱',whole:'no',amount:200,unit:'g'})),/原话对不上/],
  ['牛肉酱还在吗',proposal(action('discard','牛肉酱还在吗',{name:'牛肉酱'})),/明确|记录指令/]
 ])await assert.rejects(model(w,text,schema),pattern);
 assert.deepEqual(await w.readHealth(),base);
 const readonly=await model(fake(),'假如喝完一盒牛奶',proposal(action('eat','喝完一盒牛奶',{name:'牛奶',amount:1,whole:'yes',unit:'盒'})));
 assert.equal(readonly.preview,'readonly');
 const chosen=await model(w,'牛肉酱B瓶现在398g',proposal(action('weigh','牛肉酱B瓶现在398g',{name:'牛肉酱',gross:398})));
 assert.match(chosen.text,/12 g/);
});

test('F transaction failure, abort, permission revocation, recovery after commit, and undo are verified locally',async()=>{
 const w=fake(),before=await w.readHealth();
 w.fail='before';
 await assert.rejects(model(w,'喝完一盒牛奶'),/事务中断/);
 assert.deepEqual(await w.readHealth(),before);
 w.fail=null;
 const signal=AbortSignal.abort(Error('测试取消'));
 await assert.rejects(model(w,'喝完一盒牛奶',undefined,{signal}),/测试取消/);
 await assert.rejects(model(w,'喝完一盒牛奶',undefined,{guard:()=>{throw Error('已关闭权限');}}),/已关闭权限/);
 assert.deepEqual(await w.readHealth(),before);
 const noGrant=await model(w,'喝完一盒牛奶',undefined,{auto:false});
 assert.equal(noGrant.preview,'confirm');
 assert.deepEqual(await w.readHealth(),before);
 w.fail='after';
 await assert.rejects(model(w,'喝完一盒牛奶'),/回执中断/);
 w.fail=null;
 const resume=await model(w,'喝完一盒牛奶');
 assert.equal(resume.duplicate,true);
 assert.equal(w.writes,1);
 assert.match(await undoHealthAction(w,resume.record.id),/已撤销/);
 const undone=await w.readHealth();
 assert.deepEqual(undone.local.foods,before.local.foods);
 assert.deepEqual(undone.local.stockMoves,before.local.stockMoves);
 assert.deepEqual(undone.local.containerEvents,before.local.containerEvents);
});

test('package context only includes relevant stock and ordinary permissions cannot select document writes',()=>{
 const text='牛肉酱现在310g',state=assistantFixture(today),input={mode:'chat',text,date:today,photo:null,history:[]};
 const context=healthContext(state,input);
 assert.deepEqual(context.stock.map(row=>row.sku),[sauce]);
 const snapshot=readPackages(state,{query:'牛肉酱'});
 assert.equal(snapshot.stock[0].packages[0].latestGrossGrams,322.2);
 assert.equal(snapshot.stock[0].packages[0].batchCostCents,600);
 const request=modelRequest(input,{allowRead:true,healthActions:true,healthContext:context});
 assert.ok(request.tools.some(tool=>tool.name==='read_packages'));
 assert.ok(!request.tools.some(tool=>tool.name==='read_app_document'));
 assert.doesNotMatch(request.input[0].content[0].text,/未提及|fixture-milk|assistantActions/);
 const args={query:'牛肉酱',skuId:null,containerId:null,includeClosed:'no'};
 assert.equal(pendingLedgerRead({status:'completed',output:[{type:'function_call',name:'read_packages',call_id:'1',arguments:JSON.stringify(args)}]},
  {allowRead:true}).args.scope,'packages');
 const wire=result=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});
 assert.throws(()=>parseResult(wire({reply:'不应该写入',proposal:{mode:'document_edit',date:null,result:{document:'finance',patch:'[]'}}}),
  input,{allowRead:true,healthActions:true}));
 assert.equal(parseResult(wire({reply:'准备记账',proposal:{mode:'health_action',date:null,result:examples[text]}}),
  input,{allowRead:true,healthActions:true}).proposal.mode,'health_action');
});

test('split, morning weight, exercise and cycle computations share the same transaction',async()=>{
 const w=fake(),text='把小青菜分装两份300g和200g，晨重72.3kg，跑步30分钟消耗200kcal，查周期';
 const plan=proposal(action('split','小青菜分装两份300g和200g',{name:'小青菜',weights:[300,200]}),
  action('weight','晨重72.3kg',{kg:72.3,morning:'yes'}),
  action('activity','跑步30分钟消耗200kcal',{name:'跑步',minutes:30,kcal:200,uncertainty:''}),
  action('cycle','查周期',{}));
 const response=await model(w,text,plan);
 assert.match(response.text,/已结算/);
 const state=await w.readHealth();
 assert.equal(w.writes,1);
 assert.equal(state.local.weights.at(-1).kg,72.3);
 assert.equal(state.local.activities.at(-1).includedInBase,false);
 assert.equal(qty(state,'fixture-greens'),800);
 assert.equal(bag(state,'fixture-greens').length,2);
 assert.equal(dayIntake(state,today).totals.kcal,null);
});

test('historical morning weight and activity corrections update the original IDs and are reversible',async()=>{
 const fixture=assistantFixture(today),yesterday='2030-04-02';
 fixture.legacy.weights.push({id:'old-morning',date:yesterday,time:'06:35',kg:80,source:'legacy',trendStatus:'是'});
 fixture.legacy.activities.push({id:'old-run',date:yesterday,time:'17:00',name:'跑步',minutes:45,kcal:320,source:'legacy',includedInBase:false});
 const w=fake(fixture);
 const text='昨天晨重更正为79.8kg，昨天跑步改为40分钟';
 const plan=proposal(action('correct_weight','昨天晨重更正为79.8kg',{kg:79.8,recordId:'old-morning'}),
  action('correct_activity','昨天跑步改为40分钟',{name:'跑步',minutes:40,recordId:'old-run'}));
 const result=await model(w,text,plan);
 const next=await w.readHealth();
 assert.equal(events(next,'weights')[0].kg,79.8);
 assert.equal(events(next,'weights')[0].id,'old-morning');
 assert.equal(events(next,'activities')[0].minutes,40);
 assert.equal(events(next,'activities')[0].kcal,320);
 await undoHealthAction(w,result.record.id);
 assert.deepEqual(events(await w.readHealth(),'weights'),fixture.legacy.weights);
 assert.deepEqual(events(await w.readHealth(),'activities'),fixture.legacy.activities);
});
