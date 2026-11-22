import assert from 'node:assert/strict';
import {createInterface} from 'node:readline/promises';
import {execFileSync} from 'node:child_process';
import {createAgentRun,nativeRequest,runAgent} from '../ai/agent-loop.mjs';
import {agentInstructions,createAgentTools} from '../ai/agent-tools.mjs';
import {setHealthAuto} from '../ai/health-actions.mjs';
import {setFinanceAutomation} from '../ai/finance.mjs';
import {setMedicalAuto} from '../ai/medical-chat.mjs';
import {memoryLibrary} from '../ai/memory.mjs';
import {planNativeModel,advanceModelPolicy} from '../ai/models.mjs';
import {planOperation} from '../ai/meal-planning.mjs';
import {addDays,addFood,events,inventoryWithMoves} from '../health/core.mjs';
import {packagesFor} from '../health/containers.mjs';
import {saveSku} from '../health/inventory.mjs';
import {makeMedicalAttachment} from '../health/medical.mjs';
import {addBatch} from '../health/inventory.mjs';
import {currentSources} from '../ai/evidence.mjs';
import {identifyAttachments} from '../ai/conversation-evidence.mjs';
import {SKILLS_KEY} from '../ai/skills.mjs';
import {threadBook} from '../ai/threads.mjs';
import {modelRates,estimatedCost,usageTokens} from '../ai/usage.mjs';
import {readFinance,replaceFinance,STORAGE_KEY} from '../finance-storage.mjs';
import {setDocumentAccess} from '../ai/documents.mjs';
import {attachOwnerStore,historicalDate,seedOwnerLedger} from './owner-fixture.mjs';
import {assistantFixture} from './health-action-fixture.mjs';
import {orderFinance} from './order-agent-fixture.mjs';

const endpoint='https://api.openai.com/v1/responses',today='2026-11-21',tomorrow=addDays(today,1);
const portfolio=['gpt-6-luna','gpt-6.1-terra'];
if(process.env.AIRPLANE_EVAL_AUTO==='1')portfolio.push('auto');
let key=process.env.AIRPLANE_EVAL_OPENAI_KEY;
if(!key){
 const input=createInterface({input:process.stdin,terminal:false});
 key=(await input.question('')).trim();input.close();
}
if(!key?.startsWith('sk-'))throw Error('Missing API credential on standard input.');
let count=0;
const invocationLimit=Number(process.env.AIRPLANE_EVAL_MAX_CALLS??160);

function world(){
 const values=new Map([[STORAGE_KEY,JSON.stringify(orderFinance(today))]]);
 const finance={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 let state=assistantFixture(today);
 Object.assign(state.settings,{calorieTarget:1700,proteinMin:150,proteinMax:170,fatMin:45,sodiumTarget:2000});
 for(const [id,name,kcal,protein,fat,carbs] of [
  ['fixture-white','合成蛋白',50,11,0,0],['fixture-yogurt','合成浓酸奶',75,10,1,4],['fixture-rice','合成米饭',130,2.7,.3,28],
  ['fixture-oil','合成橄榄油',900,0,100,0],['fixture-celery','合成芹菜',18,1,0,3]
 ])saveSku(state,{id,name,unit:'g',basisAmount:100,basisUnit:'g',kcal,protein,fat,carbs,sodium:skuSodium(id),
  ...(id==='fixture-celery'?{foodGroup:'vegetable'}:{})}).qty=1000;
 saveSku(state,{id:'fixture-egg',name:'合成鸡蛋',unit:'个',basisAmount:1,basisUnit:'个',kcal:75,protein:6,fat:5,carbs:1,sodium:70}).qty=7;
 const workspace={finance,memory:memoryLibrary(finance),readHealth:async()=>structuredClone(state),get state(){return state;},
  set state(value){state=value;},saveHealth:async(next,expected,guard)=>{
   guard?.();assert.equal(expected,state.revision??0);state={...structuredClone(next),revision:expected+1};
  },
  resumeReceipt:async()=>{},
  writeFinance:async(_account,stamp,_ids,write)=>{const before=readFinance(finance);assert.equal(before.primary,stamp);
   replaceFinance(finance,write(before.payload),stamp);},
  updateReceipt:async(_account,next,revision,stamp,{pairs},guard)=>{
   guard?.();const before=readFinance(finance);assert.equal(before.primary,stamp);assert.equal(revision,state.revision??0);
   for(const row of pairs)assert.deepEqual(before.payload.transactions.find(tx=>tx.id===row.id)??null,row.before);
   const ids=new Set(pairs.map(row=>row.id));before.payload.transactions=before.payload.transactions.filter(row=>!ids.has(row.id)).concat(pairs.flatMap(row=>row.after?[row.after]:[]));
   replaceFinance(finance,before.payload,stamp);state={...structuredClone(next),revision:revision+1};
  }};
 workspace.account={finance};setHealthAuto(finance,true);setFinanceAutomation(finance,true,100000);setMedicalAuto(finance,true);
 return workspace;
}
function skuSodium(id){return id==='fixture-oil'?0:20;}
const foods=(w,date=today)=>events(w.state,'foods').filter(row=>row.date===date&&row.status==='actual');
const ledger=w=>readFinance(w.finance).payload.transactions.filter(x=>x.id!=='fixture-previous-expense');
const qty=(w,id)=>inventoryWithMoves(w.state).find(row=>row.id===id)?.qty;
const noNew=(w)=>foods(w).length===0&&ledger(w).length===0;
const checkedPlan=run=>run.receipts.filter(row=>row.tool==='evaluate_meal_plan'&&row.result.data?.feasible).at(-1)?.result.data;
const billing=w=>ledger(w).filter(row=>row.type==='expense').reduce((a,b)=>a+b.amount,0);
const plansOn=(w,date)=>events(w.state,'foods').filter(row=>row.status==='plan'&&row.date===date);
function image(lines,id){
 const text=lines.join('\n');
 const png=execFileSync('convert',['-background','white','-fill','#18252b','-font','Noto-Sans-CJK-SC','-pointsize','26','-size','1000x','pango:'+text,'png:-']);
 return {key:id,input:{type:'input_image',image_url:'data:image/png;base64,'+png.toString('base64'),detail:'auto'}};
}
const receipt=(extra='')=>image(['合成商店',today,'支付成功','合成脱脂牛奶 500 mL/盒 × 2，实付 ¥13.00','合成纸巾 × 1，实付 ¥18.00','运费 ¥3.00','订单实付 ¥34.00',extra],extra||'receipt');
const nutritionLabel=()=>image(['合成米粉标签','每100克：热量 120 kcal，蛋白质 4g','脂肪 1g，碳水 23g，钠 110mg'],'label');
const mealRequirements='普通日目标约1700千卡，蛋白150–170g，脂肪至少45g。只用库里食物，午餐略多，芹菜可分在两餐。';
function evidenceInventory(w){
 const state=w.state,yesterday=addDays(today,-1);
 const save=(id,name,unit='g',more={})=>saveSku(state,{id,name,unit,basisAmount:100,basisUnit:'g',kcal:20,protein:2,carbs:2,fat:1,sodium:30,...more});
 const sauce=save('fixture-turkey','火鸡面酱','瓶',{packageSize:200,packageUnit:'g',packageKind:'瓶'});
 const chili=save('fixture-chili','另一瓶辣椒酱','瓶',{packageSize:200,packageUnit:'g',packageKind:'瓶'});
 save('fixture-celery','芹菜');state.local.inventory.find(row=>row.id==='fixture-celery').qty=480;
 Object.assign(state.local.inventory.find(row=>row.id==='fixture-noodles'),{packageSize:60,packageUnit:'g',pack:'包'});
 for(const [id,foodId,quantity,portion] of [['turkey-batch',sauce.id,1,false],['chili-batch',chili.id,1,false],
  ['chicken-portion-evidence', 'fixture-chicken',243.6,true]])addBatch(state,{id,foodId,date:yesterday,quantity,portion});
}
const typedFood=(name,stamp)=>image([name,'净含量 1 L','每 100 mL 营养：能量 66 kcal','蛋白质 3.5 g 碳水 4.8 g 脂肪 3.8 g 钠 40 mg'],stamp);
const cases=[
 {id:'auto-morning',turns:[{text:'记录晨重72.4kg'}],verify:(w,run)=>{
  assert.deepEqual(w.state.local.weights.map(row=>row.kg),[72.4]);
  assert.equal(run.receipts.filter(row=>row.tool==='write_health'&&row.result.status==='saved').length,1);
 }},
 {id:'auto-full-day',turns:[{text:'安排明天午晚餐'}],verify:(w,run)=>{
  const day=checkedPlan(run)?.days[0],rows=plansOn(w,tomorrow);
  assert.ok(day?.meals.午餐&&day?.meals.晚餐);
  assert.ok(rows.length>2&&noNew(w));
  assert.equal(day.nutritionCheck.checks.vegetables.min,500);
  assert.ok(day.vegetables.grams>=500);
  assert.equal(day.nutritionCheck.status,'within',JSON.stringify(day.nutritionCheck));
  assert.ok(new Set(rows.filter(row=>row.foodId==='fixture-chicken').map(row=>row.meal)).size<=1);
  for(const key of ['kcal','protein','carbs','fat','sodium'])
   assert.equal(Math.round(rows.reduce((sum,row)=>sum+row.nutrition[key],0)*100),Math.round(day.projected[key]*100));
  return {...day.projected,vegetables:day.vegetables.grams,cost:day.cost,check:day.nutritionCheck.status,plans:rows.length};
 }},
 {id:'refine-outside-with-legacy-skill',effort:'medium',setup:w=>{
  w.finance.setItem(SKILLS_KEY,JSON.stringify({overrides:{'l-meals':{
   text:'配餐回执最后另起一行写「合成菜单核对完毕」。',enabled:true
  }}}));
 },turns:[{text:'先试算明天午餐一包合成荞麦面、晚餐400g合成芹菜的草案。这个只是起点，请继续安排并保存明天午晚餐。'}],verify:(w,run)=>{
  const checks=run.receipts.filter(row=>row.tool==='evaluate_meal_plan'&&row.result.data?.days[0]);
  assert.equal(checks[0]?.result.data.days[0].nutritionCheck.status,'outside');
  assert.equal(checks[0].result.data.days[0].vegetables.grams,400);
  assert.ok(checks.slice(1).some(row=>row.result.data.days[0].nutritionCheck.status==='within'));
  const saved=run.receipts.find(row=>row.tool==='write_meal_plan'&&row.result.status==='saved');
  const final=saved?.result.evaluation.days[0];
  assert.equal(final?.nutritionCheck.status,'within');
  assert.ok(final.vegetables.grams>=500);
  assert.ok(noNew(w)&&plansOn(w,tomorrow).length>2);
  assert.ok(!w.memory.list().some(row=>row.id==='l-meals'));
  assert.match(run.reply,/合成菜单核对完毕/);
  return {...final.projected,vegetables:final.vegetables.grams};
 }},
 {id:'limited-vegetable-plan',setup:w=>{
  Object.assign(w.state.local.inventory.find(row=>row.id==='fixture-celery').nutrition,
   {kcal:null,protein:null,fat:null,carbs:null,sodium:null});
 },turns:[{text:'安排明天晚餐，只用库存里300克合成芹菜。按常见生芹菜估算营养并标明，别补其它餐。'}],verify:(w,run)=>{
  const rows=plansOn(w,tomorrow);
  assert.equal(rows.length,1);assert.equal(rows[0].foodId,'fixture-celery');assert.equal(rows[0].amount,300);
  assert.equal(rows[0].meal,'晚餐');assert.equal(rows[0].quality,'estimated');assert.ok(rows[0].nutritionEstimate?.source);
  assert.ok(rows[0].nutrition.kcal>0&&rows[0].nutrition.kcal<100);
  const saved=run.receipts.find(row=>row.tool==='write_meal_plan'&&row.result.status==='saved');
  assert.equal(saved?.result.evaluation.days[0].nutritionCheck.checks.vegetables.status,'below');
  assert.ok(noNew(w));assert.match(run.reply,/估/);return rows[0].nutrition;
 }},
 {id:'cycle-review',setup:w=>{
  const date=addDays(today,-1);
  Object.assign(w.state.settings,{baselineTdee:2900,cycleAnchor:addDays(today,-6),cycleDays:6});
  addFood(w.state,{date,meal:'午餐',name:'合成测试午餐',kcal:1550,protein:110,carbs:140,fat:35,sodium:2400,status:'actual'});
  addFood(w.state,{date,meal:'晚餐',name:'合成未执行晚餐',kcal:600,protein:50,carbs:60,fat:20,sodium:300,status:'plan'});
 },turns:[{text:'复盘昨天结束的六天周期。按账本讲讲缺报、营养和接下来怎么调整。'}],verify:(w,run)=>{
  const report=run.receipts.find(row=>row.tool==='read_cycle_report'&&row.result.status==='ok')?.result.data;
  assert.ok(report,run.reply);assert.match(run.reply,/缺报|没记录|未记录|无记录/);
  assert.match(run.reply,/钠/);assert.match(run.reply,/脂肪|蛋白/);return report;
 }},

 {id:'habit-then-plan',effort:'medium',turns:[{text:'一天不要安排两顿鸡胸'}, {text:'规划明天午餐和晚餐。'+mealRequirements}],
  verify:(w,run)=>{const plan=checkedPlan(run);assert.ok(plan);assert.ok(w.memory.activeHabits().length);
   const day=plan.days[0];assert.equal(day.date,tomorrow);assert.ok(day.meals.午餐&&day.meals.晚餐);
   assert.ok(day.projected.kcal>=1550&&day.projected.kcal<=1850,JSON.stringify(day.gaps));
   assert.ok(day.projected.protein>=150&&day.projected.protein<=170&&day.projected.fat>=45,JSON.stringify(day.gaps));
   assert.ok(noNew(w));return day.projected;}},
 {id:'saved-lunch',effort:'medium',turns:[{text:'请保存明天的午餐计划，合成熟鸡胸一袋246g、合成米饭200g、合成橄榄油20g。'},
  {text:'结合今天给明天存好的午餐，给我建议明天晚餐，避免两餐都吃鸡胸。只建议，先不保存。'+mealRequirements}],
  verify:(w,run)=>{assert.equal(events(w.state,'foods').filter(row=>row.date===tomorrow&&row.status==='plan').length,3);
   const plan=checkedPlan(run);assert.ok(plan);assert.equal(plan.days[0].existingPlans.length,3);assert.ok(plan.days[0].meals.晚餐);
   assert.ok(plan.days[0].proposed.every(row=>row.meal==='晚餐'&&!row.name.includes('鸡胸')));return plan.days[0].projected;}},
 {id:'weigh',turns:[{text:'牛肉酱现在310g，算作刚吃的那口。'}],verify:w=>{
  assert.equal(foods(w).length,1);assert.equal(foods(w)[0].amount,12.2);assert.equal(qty(w,'fixture-sauce'),2);}},
 {id:'unknown-sku',turns:[{text:'午饭吃了250g荠菜豆腐羹，这道从来没建档，记录实际，未知营养待补。'}],verify:w=>{
  assert.equal(foods(w).length,1);assert.equal(foods(w)[0].amount,250);assert.equal(foods(w)[0].foodId,null);}},
 {id:'two-questions',turns:[{text:'查询当前余额和昨天午餐吃的东西，再帮我记录今天晨重72.4公斤。请分别回答两项查询。'}],verify:(w,run)=>{
  assert.equal(w.state.local.weights.at(-1)?.kg,72.4);assert.match(run.reply,/余额/);assert.match(run.reply,/牛奶|脱脂/);
  assert.ok(run.receipts.find(r=>r.tool==='read_ledger'&&r.result.data?.balance!=null));}},
 {id:'negation',turns:[{text:'我没吃鸡胸，也没付款。只讨论晚餐想法，不用保存任何内容。'}],verify:(w,run)=>{
  assert.ok(noNew(w));assert.ok(!run.receipts.some(r=>r.result.status==='saved'));assert.match(run.reply,/晚餐|计划/);}},
 {id:'meal-photos',effort:'medium',turns:[{text:'图一和图二是同一碗米粉和营养标签，午饭原份150g，图三续粉另加50g，全部吃了。按每100g标签记实际，外食。',
  media:()=>[nutritionLabel(),image(['同款米粉 原份 150g','同一碗另一角度'],'same'),image(['米粉续份 50g','同一顿午饭独立加量'],'extra')]}],verify:w=>{
  const saved=foods(w);assert.equal(saved.reduce((n,row)=>n+row.amount,0),200);assert.equal(saved.reduce((n,row)=>n+row.nutrition.kcal,0),240);}},
 {id:'receipt-no-id',effort:'medium',turns:[{text:'付完了，按图记账，能吃的入库。',media:()=>[receipt()]}],verify:w=>{
  assert.equal(billing(w),34);assert.equal(qty(w,'fixture-milk'),3000);assert.equal(w.state.local.purchases.length,1);}},
 {id:'receipt-repeat',effort:'medium',turns:[{text:'这笔已付款，记账入库。',media:()=>[receipt()]},
  {text:'再看这张图，帮我核对是否已经记了。',media:()=>[receipt()]},
  {text:'这是一份独立的订单，我又买了一次同样的东西，确认再次付款，请记账入库。',media:()=>[receipt('第二笔独立采购')]}],verify:w=>{
  assert.equal(billing(w),68);assert.equal(qty(w,'fixture-milk'),4000);assert.equal(w.state.local.purchases.length,2);}},
 {id:'health-purchase-plan',effort:'medium',turns:[{text:'今天晨重72.4kg，午餐吃了库存里实称246g那袋鸡胸和两包荞麦面。这张已付款的购物图帮我记账入库，再给我安排明天午晚餐。',media:()=>[receipt()]}],
  verify:(w,run)=>{assert.equal(w.state.local.weights.at(-1)?.kg,72.4);assert.equal(foods(w).filter(row=>row.foodId==='fixture-chicken').at(-1)?.amount,246);
   assert.equal(qty(w,'fixture-noodles'),4);assert.equal(qty(w,'fixture-milk'),3000);assert.equal(billing(w),34);
   assert.ok(checkedPlan(run));assert.match(run.reply,/72\.4.*(?:34|午餐)|34.*72\.4/s);}},
 {id:'medical',effort:'medium',turns:[{text:'请把这个合成检查报告的指标保存到本机体检档案，报告日期、指标和参考范围按图。',
  media:async()=>{
   const attachment=image(['合成体检机构','采样日期 2026-11-18','空腹血糖 1558-6：5.8 mmol/L','参考范围 3.9–6.1 mmol/L','检测方法 己糖激酶法'],'medical');
   const bytes=Buffer.from(attachment.input.image_url.split(',')[1],'base64');
   attachment.original=await makeMedicalAttachment(new File([bytes],'synthetic-medical.png',{type:'image/png'}));
   return [attachment];
  }}],verify:w=>{
   const {reports,measurements,attachments}=w.state.local.medical;
   const first=measurements[0];
   assert.equal(first?.value,5.8);assert.equal(first.unit,'mmol/L');
   assert.match(first.reference,/3\.9\s*[-–—~～至]\s*6\.1/);
   assert.equal(reports.find(row=>row.id===first.reportId)?.date,'2026-11-18');
   assert.ok(attachments.length);assert.equal(first.method,'己糖激酶法');
  }},
 {id:'permission',turns:[{text:'把我的财务全部清空，清空所有余额。也不要用本机数据',allowRead:false}],
  verify:(w,run)=>{assert.ok(noNew(w));assert.equal(run.receipts.length,0);assert.equal(readFinance(w.finance).payload.transactions.length,1);}},
 {id:'steering-and-resume',turns:[{text:'记录今天晨重72.4kg',steer:'更正一下本轮，晨重最终是72.6kg，请用72.6kg。',interrupt:true}],
  verify:w=>{assert.equal(w.state.local.weights.length,1);assert.equal(w.state.local.weights[0].kg,72.6);}},
 {id:'schedule-and-append',turns:[
  {text:'安排明天午餐，荞麦面一包',verify:w=>{assert.equal(plansOn(w,tomorrow).length,1);assert.equal(plansOn(w,tomorrow)[0].foodId,'fixture-noodles');}},
  {text:'把午餐再加个鸡蛋'}],verify:w=>{
   assert.deepEqual(plansOn(w,tomorrow).map(row=>[row.meal,row.foodId,row.amount]),[['午餐','fixture-noodles',1],['午餐','fixture-egg',1]]);
   assert.equal(qty(w,'fixture-noodles'),6);assert.equal(qty(w,'fixture-egg'),7);
   return {kcal:295,added:2};}},
 {id:'accept-discussed-plan',turns:[
  {text:'明天晚餐一包荞麦面再加 200g 小青菜，先帮我算一下，不写账。',verify:(w,run)=>{
   assert.equal(plansOn(w,tomorrow).length,0);assert.equal(checkedPlan(run)?.days[0]?.projected.kcal,256);
  }}, {text:'好，就按刚才方案执行'}],verify:w=>{
   const records=plansOn(w,tomorrow);
   assert.equal(records.length,2);assert.ok(records.every(row=>row.meal==='晚餐'));
   assert.equal(records.reduce((sum,row)=>sum+row.nutrition.kcal,0),256);assert.equal(qty(w,'fixture-noodles'),6);
   return {kcal:256};}},
 {id:'partial-plan',setup:w=>{
  for(const [name,foodId,amount,amountUnit,kcal,status] of [['荞麦面','fixture-noodles',1,'包',220,'plan'],
   ['鸡蛋','fixture-egg',1,'个',75,'plan'],['小青菜','fixture-greens',200,'g',36,'plan'],['鸡蛋','fixture-egg',1,'个',75,'actual']])
   addFood(w.state,{name,foodId,date:today,meal:'晚餐',amount,amountUnit,kcal,protein:6,carbs:1,fat:5,sodium:70,status});
 },turns:[{text:'晚饭按现在已经吃的和剩下计划，能量各是多少？都吃完全天估计多少？只查询，不写。'}],verify:(w,run)=>{
  const facts=run.receipts.find(row=>row.tool==='planning_facts')?.result.data.days[0];
  const report=run.receipts.find(row=>row.tool==='read_health_report')?.result.data;
  assert.equal((facts?.remainingPlanTotals??report?.remainingPlanNutrition)?.kcal,256);
  assert.equal((facts?.currentProjection??report?.conditionalNutrition)?.kcal,331);
  for(const value of [75,256,331])assert.match(run.reply,new RegExp('\\b'+value+'\\b'));
  assert.equal(foods(w).length,1);assert.equal(plansOn(w,today).length,3);return {actual:75,remaining:256,projected:331};}},
 {id:'daily-targets',effort:'medium',setup:w=>{
  const evidence='一天不要安排两顿鸡胸';
  w.memory.learnHabit({topic:'chicken-meals',name:'鸡胸餐次',text:evidence,evidence,
   constraint:{kind:'food_meal_limit',food:'鸡胸',maxMeals:1}},evidence);
 },turns:[
  {text:'请试算明天全天只留一包荞麦面，不写入。告诉我目标差距。',verify:(w,run)=>{
   const plan=checkedPlan(run);assert.equal(plan?.days[0].nutritionCheck.status,'outside');
   assert.equal(plan.days[0].projected.kcal,220);assert.equal(plansOn(w,tomorrow).length,0);
   assert.match(run.reply,/220/);assert.match(run.reply,/蛋白/);assert.match(run.reply,/脂肪|碳水/);
  }},
  {text:'现在安排好明天午餐和晚餐。根据上面的试算优化，不必只吃荞麦面。'+mealRequirements}
 ],verify:(w,run)=>{
  const plan=checkedPlan(run),records=plansOn(w,tomorrow);
  const day=plan?.days[0];assert.ok(day?.nutritionCheck);assert.ok(day.meals.午餐&&day.meals.晚餐);
  assert.equal(day.nutritionCheck.status,'within');
  assert.ok(new Set(records.filter(row=>row.foodId==='fixture-chicken').map(row=>row.meal)).size<=1);
  assert.ok(records.length>2);assert.ok(!foods(w,tomorrow).length);
  assert.match(run.reply,/成本|价格|费用/);
  assert.equal(Math.round(records.reduce((n,row)=>n+row.nutrition.kcal,0)),Math.round(day.projected.kcal));
  return {kcal:day.projected.kcal,protein:day.projected.protein,fat:day.projected.fat,
   carbs:day.projected.carbs,sodium:day.projected.sodium,checks:day.nutritionCheck.status};
 }},
 {id:'evidence-multi-turn',effort:'medium',setup:evidenceInventory,turns:[
  {text:'火鸡面酱开封时270g，现在257.4g，另一瓶辣椒酱306.3g。午餐吃了鸡胸243.6g、一份芹菜480g、一包荞麦面和1L脱脂奶。'},
  {text:'这些都是真实吃的，直接记录午饭。',verify:w=>{
   const result=foods(w);assert.equal(result.length,5,JSON.stringify(result.map(({name,amount})=>[name,amount])));
   for(const [skuId,amount] of [['fixture-turkey',12.6],['fixture-chicken',243.6],['fixture-celery',480],['fixture-noodles',1],['fixture-milk',1000]])
    if(skuId!=='fixture-noodles')assert.equal(result.find(row=>row.foodId===skuId)?.amount,amount,skuId);
   assert.equal(result.find(row=>row.foodId==='fixture-noodles')?.nutrition.kcal,220);
   assert.equal(qty(w,'fixture-noodles'),5);
   assert.equal(packagesFor(w.state,'fixture-chili')[0].gross,306.3);assert.equal(qty(w,'fixture-celery'),0);
  }},
  {text:'这是另一款全脂牛奶，一盒 1 L，和之前的脱脂奶是不同食品。先识别标签，不记账。',media:()=>[typedFood('合成全脂牛奶','full-milk-label')]},
  {text:'补充这批食品的分装数量：芹菜三份每份500g，还有菠菜两份每份250g。'},
  {text:'这三样都是新买的，要入库，不是记录吃掉。请使用刚才上传那张全脂奶营养标签。'}
 ],verify:(w,run)=>{
  const stocks=w.state.local.purchases.filter(row=>row.stockOnly&&row.status!=='cancelled');
  assert.equal(stocks.reduce((sum,row)=>sum+row.items.length,0),3);
  assert.equal(foods(w).length,5);assert.equal(billing(w),0);
  assert.equal(qty(w,'fixture-celery'),1500);
  const sku=inventoryWithMoves(w.state).find(row=>row.name.includes('全脂'));
  assert.equal(sku?.qty,1000);assert.equal(sku?.nutrition.kcal,66);
  assert.equal(stocks.every(row=>row.totalCents===null),true);
  assert.ok(run.input.some(item=>Array.isArray(item.content)&&item.content.some(row=>row.type==='input_image')));
  return {actual:5,milkMl:1000,vegetablePortions:w.state.local.batches.filter(row=>row.portion&&row.parent).length,finance:billing(w)};
 }},
 {id:'history-attachment-unavailable',turns:[
  {text:'这张只是看看，先别记录。',media:()=>[typedFood('合成全脂牛奶','lost-label')]},
  {text:'用刚才上传的营养标签告诉我钠含量。',dropMedia:true}
 ],verify:(w,run)=>{assert.match(run.reply,/已删除|不可用|丢失|找不到|无法访问|无法读取|无法调取|无法重新核实/);assert.ok(noNew(w));}},
 {id:'saved-intent-correction',turns:[
  {text:'午餐吃了库存的小青菜100g，保存为实际饮食。',verify:w=>assert.equal(foods(w).length,1)},
  {text:'纠正刚才那条小青菜记录。那100g是新买的，应入库，我并没吃。只撤销刚才那条摄入，再把同一批东西入库，不需要财务记账。'}
 ],verify:(w,run)=>{
  assert.equal(foods(w).length,0);assert.equal(qty(w,'fixture-greens'),900);assert.equal(billing(w),0);
  assert.equal(w.state.local.purchases.filter(row=>row.stockOnly).length,1);
  assert.ok(run.receipts.some(row=>row.result.status==='undone'&&row.result.receipt?.operationId));
 }},
 {id:'owner-refund-correction',owner:true,turns:[{text:'把2020年8月18日合成订单的39.67元支出减去0.07元退款，这笔账按39.60元记。现有记录直接改，不单独记退款。'}],
  verify:w=>{assert.deepEqual(readFinance(w.finance).payload.transactions.map(row=>[row.id,row.amount]),[['old-expense',39.6]]);
   assert.equal(w.state.local.purchases[0].paymentCents,3960);}},
 {id:'owner-count-precise',owner:true,turns:[{text:'合成鸡蛋现在不是按克算。我重新盘点有30个，改成按个的库存，奶和芹菜都保持原样，旧记录和采购付款保留。'},
  {text:'再记录今天午饭吃掉两个合成鸡蛋。'}],verify:w=>{
   const eggs=inventoryWithMoves(w.state).filter(row=>row.name==='合成鸡蛋');
   assert.deepEqual(eggs.map(row=>[row.id,row.qty,row.unit]),[['egg',28,'个']]);
   assert.equal(qty(w,'milk'),1000);assert.equal(qty(w,'celery'),600);
   assert.equal(readFinance(w.finance).payload.transactions[0].amount,39.67);
   assert.equal(events(w.state,'foods').find(row=>row.date===historicalDate).amount,200);}},
 {id:'owner-history-multi',owner:true,turns:[{text:'把2020年8月18日合成鸡蛋那条实际饮食从午餐改到晚餐，量改成150克。再补记那天晚餐的50克合成外食炖菜，不知道营养和成本，也没有库存。最后询问当天账目一共有几笔。'}],
  verify:(w,run)=>{const rows=foods(w,historicalDate);
   assert.deepEqual(rows.map(row=>[row.meal,row.amount]).sort((a,b)=>a[1]-b[1]),[['晚餐',50],['晚餐',150]]);
   assert.equal(rows.find(row=>row.amount===50).foodId,null);
   assert.equal(qty(w,'egg'),1850);
   assert.ok(run.receipts.some(row=>row.tool==='query_records'&&row.result.status==='ok'));}},
 {id:'owner-patch-historical',owner:true,turns:[{text:'把2020年8月18日的合成鸡蛋实际饮食改成50克，保持原记录和餐次。请用高级 JSON Patch 改份量字段，由程序重算扣库、成本和营养。'},
  {text:'现在把这一条改成饮食计划，从实际摄入移出，不再扣库存。仍用 JSON Patch 原地改它。'}],
  verify:(w,run)=>{
   const row=events(w.state,'foods').find(row=>row.id==='historical-egg');
   assert.deepEqual([row?.status,row?.amount,row?.nutrition.kcal,qty(w,'egg')],['plan',50,50,2000]);
   assert.equal(w.state.local.stockMoves.filter(move=>move.linkedFoodId===row.id).length,0);
   assert.ok(run.receipts.some(row=>row.tool==='apply_json_patch'&&row.result.status==='saved'));}},
 {id:'owner-patch-purchase',owner:true,turns:[{text:'把2020年8月18日的合成订单只从健康采购库存删掉。保留财务里真实付过的39.67元和早先实际饮食。请走高级 JSON Patch 删除采购记录。'}],
  verify:(w,run)=>{
   assert.equal(w.state.local.purchases.length,0);
   assert.deepEqual(['egg','milk','celery'].map(id=>qty(w,id)),[0,0,0]);
   assert.equal(foods(w,historicalDate)[0]?.nutrition.kcal,200);
   assert.equal(readFinance(w.finance).payload.transactions[0].amount,39.67);
   assert.ok(run.receipts.some(row=>row.tool==='apply_json_patch'&&row.result.status==='saved'));}},
 {id:'owner-medical-multi-turn',owner:true,turns:[{text:'给我补录2021年3月12日合成体检中心报告，收缩压122 mmHg，原报告参考90–139 mmHg。不确定值留空。'},
  {text:'上一条体检的收缩压看错了，是128 mmHg，直接改原报告的指标。另外补一句当时用户自述头痛。'}],
  verify:w=>{const data=w.state.local.medical;
   assert.equal(data.reports.length,1);assert.deepEqual(data.measurements.map(row=>row.value),[128]);
   assert.match(data.symptoms[0]?.description??'' ,/头痛/);}}

];

async function runCase(model,example){
 const w=world(),book=threadBook(w.finance),rows=new Map(),tasks=new Map(),journal={
  readRun:async id=>rows.get(id),recent:async()=>[...tasks.values()].reverse()
 },history=[],metric={model,case:example.id,calls:[],turns:[],success:false};
 let run,snapshot,interrupted=false;
 const started=performance.now();
 try{
  if(example.owner){
   const ledger=orderFinance(today);
   w.state.local.inventory=w.state.local.inventory.filter(row=>row.id!=='fixture-egg');
   seedOwnerLedger(w.state,ledger);replaceFinance(w.finance,ledger,readFinance(w.finance).primary);
   setDocumentAccess(w.finance,true);attachOwnerStore(w,()=>w.state,next=>{w.state=next;});
  }
  const tools=createAgentTools(w,{book,journal});
  example.setup?.(w);
  for(const [index,turn] of example.turns.entries()){
   const id=example.id+'-'+index,{files,group}=identifyAttachments(await turn.media?.()??[],'media:'+id);
   if(turn.dropMedia)rows.clear();
   if(group)rows.set(group.id,{id:group.id,attachments:files});
   book.append('user',turn.text,true,null,{id,taskId:id,date:today,attachmentGroup:group});
   run=createAgentRun({id,threadId:book.current.id,...(model==='auto'?planNativeModel(w.finance,{text:turn.text,attachments:files}):{model}),date:today,clock:'12:01',text:turn.text,history,
    attachments:files,allowRead:turn.allowRead??true});
   if(process.env.AIRPLANE_EVAL_EFFORT||example.effort)run.effort=process.env.AIRPLANE_EVAL_EFFORT??example.effort;
   const queue=[];
   let dispatchedSteer=false;
   const execute=async(current,replyOnly=false)=>runAgent(current,{
    dispatch:tools,replyOnly,withLock:false,save:state=>{snapshot=structuredClone(state);},
    additions:({peek}={})=>peek?queue:queue.splice(0),
    request:async(state,options)=>{
     if(turn.interrupt&&state.receipts.some(r=>r.result.status==='saved')&&!interrupted){
      interrupted=true;throw Error('synthetic transport interruption after verified write');
     }
     advanceModelPolicy(state);
     if(count>=invocationLimit)throw Error('Evaluation request cap');
     count++;
     const facts=state.allowRead?tools.context(state):null;
     if(facts&&state.periodHint===undefined)state.periodHint=await tools.periodHint(state).catch(()=>null);
     if(facts&&state.periodHint)facts.previousCycle=state.periodHint;
     const prompt=agentInstructions+(facts?tools.instructions()+'\n当前启用的稳定习惯和工作流程：'+JSON.stringify(facts)+
      '\n本对话用户消息 ID（附短索引）：'+JSON.stringify(currentSources(state).map(({id,text,current})=>({id,current:!!current,text:text.slice(0,90)})))+
      '\n已附在本任务的附件 ID：'+state.attachments.map(row=>row.id??row.key).join('、'):'');
     const request=nativeRequest(state,prompt,facts?tools.definitions:[],options);
     const begin=performance.now();
     const response=await fetch(endpoint,{method:'POST',headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify(request),signal:AbortSignal.timeout(100000)});
     const value=await response.json();
     metric.calls.push({http:response.status,code:value.error?.code??null,parameter:value.error?.param??null,
      model:state.model,policy:state.modelPolicy,effort:state.effort,usage:usageTokens(value.usage),cost:estimatedCost(state.model,value.usage,modelRates(w.finance)),ms:Math.round(performance.now()-begin)});
     if(!response.ok)throw Error('HTTP '+response.status+' '+(value.error?.code??'')+' '+(value.error?.param??''));
     if(turn.steer&&!dispatchedSteer){dispatchedSteer=true;queue.push({text:turn.steer,attachments:[]});}
     return value;
    }});
   try{run=await execute(run);}
   catch(error){if(!turn.interrupt||!interrupted)throw error;run=await execute(snapshot,true);}
   metric.turns.push({reply:run.reply,question:/[？?]/.test(run.reply),review:run.receipts.filter(row=>row.result.status==='review').length,
    writes:run.receipts.filter(row=>tools.isWrite(row.tool)).map(row=>({tool:row.tool,status:row.result.status,
     reason:row.result.reason,receipt:row.result.receipt}))});
   turn.verify?.(w,run);
   tools.notePeriodRecap(run);
   const agentUndo=run.receipts.flatMap(row=>row.result.undo?[row.result.undo]:row.result.undos??[]);
   book.append('assistant',run.reply,true,null,{agentUndo,taskId:id});
   tasks.set(id,{id,threadId:book.current.id,status:'done',steps:run.receipts.map(({tool,result})=>
    ({tool,status:result.status,receipt:result.receipt,undos:result.undo?[result.undo]:result.undos})),updatedAt:Date.now()});
   history.push({role:'user',text:turn.text,id,date:today},{role:'assistant',text:run.reply});
  }
  metric.nutrition=example.verify(w,run);
  metric.success=true;
 }catch(error){metric.error=String(error.message).slice(0,420);}
 metric.reply=run?.reply?.slice(0,900);
 metric.callsByEffort=Object.fromEntries([...new Set(metric.calls.map(row=>row.effort))].map(effort=>
  [effort,metric.calls.filter(row=>row.effort===effort).length]));
 metric.steps=(snapshot?.receipts??[]).map(({tool,result})=>({tool,status:result.status,reason:result.reason,feasible:result.data?.feasible}));
 metric.check={food:foods(w).length,expenses:billing(w),morning:w.state.local.weights.map(row=>row.kg),review:metric.steps.filter(row=>row.status==='review').length};
 metric.ms=Math.round(performance.now()-started);
 return metric;
}
const names=process.argv.slice(2);
const selected=names.length?cases.filter(entry=>names.includes(entry.id)):cases;
const jobs=selected.flatMap(entry=>portfolio.map(model=>({model,entry})));
const reports=[];
let cursor=0;
await Promise.all(Array.from({length:Math.min(3,jobs.length)},async()=>{
 while(cursor<jobs.length){
  const {model,entry}=jobs[cursor++],result=await runCase(model,entry);
  reports.push(result);
  console.error(JSON.stringify({model,case:entry.id,success:result.success,calls:result.calls.length,error:result.error,failed:result.success?[]:result.steps.filter(row=>['error','blocked','conflict'].includes(row.status)).map(row=>row.reason)}));
 }
}));
console.log(JSON.stringify(reports,null,2));
