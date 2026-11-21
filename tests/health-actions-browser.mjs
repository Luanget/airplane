import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {extname} from 'node:path';
import {addDays} from '../health/core.mjs';
import {CORE_RULES} from '../ai/health-profile.mjs';
import {freshData} from '../finance-storage.mjs';
import {assistantFixture,action,examples,proposal} from './health-action-fixture.mjs';
import {combinedTask,conversation,orderFinance,orderReceipt,orderState,receiptStep} from './order-agent-fixture.mjs';

const {chromium}=createRequire(import.meta.url)('playwright-core');
const assets=new Set(['sw.js',...Array.from(readFileSync('sw.js','utf8').split('const assets')[0].matchAll(/'\.\/([^']+)'/g),match=>match[1])]);
const server=createServer((req,res)=>{
 let name=new URL(req.url,'http://localhost').pathname.slice(1);
 if(name.endsWith('/'))name+='index.html';
 if(!assets.has(name)){res.writeHead(404).end();return;}
 const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
 res.setHeader('Content-Type',types[extname(name)]??'text/plain');res.end(readFileSync(name));
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await ctx.newPage();
 page.setDefaultTimeout(8000);
 const calls=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const finance={...freshData(),categories:freshData().categories};
 const root='sk-synthetic-health-fixture-only';
 const healthText='再喝完一盒牛奶';
 const expected=new Map(Object.entries(examples));
 expected.set(healthText,proposal(action('eat','喝完一盒牛奶',{name:'牛奶',amount:1,unit:'盒',whole:'yes'})));
 for(const [text,gross] of [['牛肉酱现在305g',305],['牛肉酱A瓶现在500g',500]])
  expected.set(text,proposal(action('weigh',text,{name:'牛肉酱',gross})));
 const tomorrowText='安排明天的午餐和晚餐';
 const saveTomorrowText='把明天的饮食保存为计划';
 const planItem={sku:null,name:'合成熟鸡胸',action:'plan',amount:100,unit:'g',packageSize:null,packageUnit:null,
  basisAmount:100,basisUnit:'g',nutrients:{kcal:160,protein:32,carbs:0,fat:3,sodium:40},uncertainty:'合成营养标签',weighing:null};
 expected.set(tomorrowText,proposal(action('next_meal','午餐和晚餐',{meal:null,preferences:[]})));
 const financeText='试着覆盖财务备份',deleteText='删除今天全部饮食',badText='模型错误测试，吃了20g牛肉酱';
 const shortStock='吃了十包荞麦面';
 expected.set(shortStock,proposal(action('eat',shortStock,{name:'荞麦面',amount:10,unit:'包',whole:'yes'})));
 expected.set(badText,proposal(action('eat','吃了20g牛肉酱',{name:'牛肉酱',amount:200,unit:'g',whole:'no'})));
 const photoText='午餐吃了这餐，请记账，另外续粉一份，记录晨重72.4kg';
 const photoBase={dishKey:'synthetic-noodle',name:'合成米粉',role:'served',images:[1],amount:170,unit:'g',
  confidence:'estimated',basisAmount:100,basisUnit:'g',nutrition:{kcal:100,protein:2,carbs:21,fat:3,sodium:90},uncertainty:'合成影像估量'};
 const photoPlan={intent:'execute',date:null,meal:'午餐',observations:[
  photoBase,{...photoBase,images:[2]},
  {...photoBase,role:'label',images:[3],amount:null,confidence:'label'},
  {...photoBase,role:'extra',images:[3],amount:80}
 ],steps:[action('weight','记录晨重72.4kg',{kg:72.4,morning:'yes'})]};
 await ctx.route('https://api.openai.com/v1/responses',async route=>{
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  assert.equal(route.request().headers().authorization,'Bearer '+root);
  const body=route.request().postDataJSON(),input=JSON.parse(body.input[0].content[0].text);
  calls.push({body,input});
  const full=(body.tools??[]).some(tool=>tool.name==='read_app_document');
  assert.equal(body.store,false);
  let result;
  if(input.text===photoText){
   assert.equal(body.input[0].content.filter(row=>row.type==='input_image').length,3);
   assert.match(body.instructions,/同一菜不同角度/);
   assert.match(input.activeSkills??body.instructions,/photos v1/);
   result={mode:'photo_meal',date:null,result:photoPlan};
  }else if(['','识别购物截图，食品入库',conversation,'补充购买付款截图','测试购物车','登记退款','确认顺序'].includes(input.text)){
   const order=orderReceipt(input.date);
   const images=body.input[0].content.filter(row=>row.type==='input_image');
   assert.ok(images.length>=1);
   assert.match(body.instructions,/独立流水号/);
   let plan;
   if(input.text==='识别购物截图，食品入库'){
    assert.equal(images.length,2);
    assert.equal(body.tools,undefined);
    assert.equal(body.model,'gpt-6.1-terra');
    plan={steps:[receiptStep({...order,images:[1,2],orderNo:'SYNTH-BROWSER-MIX'})]};
   }else if(input.text===conversation){
    assert.equal(images.length,2);
    plan=combinedTask({...order,images:[1,2],orderNo:'SYNTH-BROWSER-MIX'});
   }else{
    const patch={
     '':{lines:[],discount:null,shipping:null},
     '补充购买付款截图':{orderNo:'SYNTH-BROWSER-REBUY',images:[1]},
     '测试购物车':{state:'unpaid',paymentEvidence:'购物车待付款'},
     '登记退款':{orderNo:'SYNTH-START-001',state:'partial_refund',paymentEvidence:'退款成功',totalEvidence:'实退 ¥6',
      refund:6,refundNo:'SYNTH-REFUND-001',lines:[],discount:null,shipping:null},
     '确认顺序':{orderNo:'SYNTH-BROWSER-REVIEW'}
    }[input.text];
    plan={steps:[receiptStep({...order,...patch})]};
   }
   result={mode:'agent_task',date:null,result:plan};
  }else if(input.text===saveTomorrowText)result={mode:'plan',date:null,result:{items:[planItem],note:''}};
  else if(input.text===financeText)result={mode:'document_edit',date:null,result:{document:'finance',patch:'[]'}};
  else if(input.text===deleteText)result={mode:'delete_record',date:input.date,result:{kind:'food',query:'',meal:null,selection:'all'}};
  else {
   assert.ok(expected.has(input.text),input.text);
   result={mode:'health_action',date:null,result:expected.get(input.text)};
  }
  const value={reply:result?.mode==='agent_task'?'模型声称已全部保存。':'正在处理。',proposal:result,...(full?{saveMode:'save'}:{}),
   ...(body.text.format.schema.required.includes('memoryUpdates')?{memoryUpdates:[]}:{})};
  const usage=input.text===''?{id:'resp_health_task_'+calls.length,
   usage:{input_tokens:2000,output_tokens:200,input_tokens_details:{cached_tokens:1500}}}:{};
  await route.fulfill({headers,json:{status:'completed',...usage,output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}});
 });
 await page.goto(origin+'/assistant/');
 await page.waitForFunction(()=>typeof document.getElementById('assistant-settings')?.onclick==='function');
 const today=await page.evaluate(async()=> (await import('../calendar.mjs')).localDate());
 await page.evaluate(async({seed,finance,root})=>{
  await (await import('../ai/keys.mjs')).importKey(root);
  const storage=await import('../health/storage.mjs');
  await storage.saveState(seed,0);
  localStorage.setItem('airplane-pwa-v1',JSON.stringify(finance));
 },{seed:assistantFixture(today),finance,root});
 const settings=page.locator('#assistant-settings-sheet'),composer=page.locator('.chat-composer');
 const log=page.getByRole('log',{name:'对话'}),review=page.locator('.chat-review');
 const open=()=>page.locator('#assistant-settings').click();
 const close=()=>settings.getByRole('button',{name:'关闭',exact:true}).click();
 await open();
 await settings.getByText('数据权限',{exact:true}).click();
 const grant=settings.getByRole('checkbox',{name:'自动执行健康记录'});
 const full=settings.getByRole('checkbox',{name:'完整数据权限'});
 assert.equal(await grant.isChecked(),false);
 await grant.check();assert.equal(await full.isChecked(),false);await close();
 const say=async text=>{
  const send=composer.getByRole('button',{name:'发送',exact:true});
  await composer.getByRole('textbox',{name:'消息'}).fill(text);await send.click();
 };
 const read=()=>page.evaluate(async()=>{
  const state=await (await import('../health/storage.mjs')).readState();
  const {packagesFor}=await import('../health/containers.mjs');
  return {state,sauce:packagesFor(state,'fixture-sauce'),milk:packagesFor(state,'fixture-milk'),finance:localStorage.getItem('airplane-pwa-v1')};
 });
 async function sent(text,match,requestCount=1){
  const start=calls.length;
  await say(text);
  await log.locator('.chat-bubble').filter({hasText:match}).last().waitFor();
  assert.equal(calls.length-start,requestCount);
  assert.equal(await review.isVisible(),false);
 }
 await sent('牛肉酱现在310g',/已保存。.*12.2 g/,0);
 assert.equal((await read()).sauce[0].gross,310);
 console.log('PASS A package weighing automatically saves one verified difference');
 await sent('吃了20g牛肉酱',/已保存。.*20 g/,0);
 let current=await read();
 assert.equal(current.sauce[0].gross,310);assert.equal(current.sauce[0].unweighedGrams,20);
 assert.equal(current.state.local.foods.at(-1).weighing,undefined);
 console.log('PASS B actual grams leave the measured gross authentic');
 await sent('喝完一盒牛奶',/已保存。.*1000 mL/);
 assert.deepEqual(calls.at(-1).input.healthContext.stock.map(row=>row.sku),['fixture-milk']);
 assert.equal((calls.at(-1).body.tools??[]).some(tool=>tool.name==='read_app_document'),false);
 current=await read();
 assert.deepEqual(current.milk.map(row=>row.status),['empty','empty','sealed']);
 console.log('PASS C whole carton recording automatically closes only one carton');
 const revision=current.state.revision;
 await sent('吃了一袋鸡胸、两包面，安排晚餐',/下一餐建议/);
 current=await read();
 assert.equal(current.state.revision,revision+1);
 assert.equal(current.state.local.foods.filter(row=>row.status==='plan').length,0);
 assert.equal(current.state.local.stockMoves.filter(row=>row.foodId==='fixture-noodles').at(-1).delta,-2);
 console.log('PASS D composite meal writes in one revision; next-meal plan runs locally');
 const oldMilk=current.state.local.foods.find(row=>row.id==='food:fixture-yesterday-milk');
 await sent('昨天牛奶少算200mL',/已保存。更正.*1200 mL/,0);
 current=await read();
 assert.equal(current.state.local.foods.find(row=>row.id===oldMilk.id).amount,1200);
 assert.deepEqual(current.milk.map(row=>row.status),['empty','empty','sealed']);
 const revisionE=current.state.revision;
 await sent('昨天牛奶少算200mL',/刚已保存，未重复入账/,0);
 assert.equal((await read()).state.revision,revisionE);
 console.log('PASS E historical correction keeps the same meal ID and deduction');
 await sent('牛肉酱A瓶现在500g',/毛重增加/);
 await sent(badText,/数值和本轮原话对不上/);
 await sent(shortStock,/库存不足/);
 await page.evaluate(async()=>{
  const {readState,saveState}=await import('../health/storage.mjs');
  const {packagesFor,confirmPackageAction}=await import('../health/containers.mjs');
  const state=await readState(),another=packagesFor(state,'fixture-sauce')[1];
  const next=confirmPackageAction(state,{id:'demo-open-second',action:'baseline',containerId:another.id,
   gross:490,date:(await import('../calendar.mjs')).localDate()}).next;
  await saveState(next,state.revision);
 });
 await page.locator('[data-new]').click();
 await sent('牛肉酱现在305g',/有多个可用包装/,0);
 const before=await read();
 await page.evaluate(()=>{
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){
   if(key==='main')throw Error('合成保存中断');
   return put.call(this,value,key);
  };
 });
 await say(healthText);
 await composer.getByText('合成保存中断',{exact:true}).waitFor();
 assert.deepEqual(await read(),before);
 const requests=calls.length;
 await page.reload();
 await composer.getByRole('button',{name:'重试这条消息'}).click();
 await log.getByText(/已保存。.*1000 mL/).waitFor();
 assert.equal(calls.length,requests);
 assert.equal((await read()).state.revision,before.state.revision+1);
 await page.getByRole('button',{name:'撤销这次记录'}).last().click();
 await page.getByRole('button',{name:'已撤销这次健康记录。'}).waitFor();
 assert.deepEqual((await read()).milk,before.milk);
 assert.equal((await read()).finance,JSON.stringify(finance));
 await say(financeText);
 await composer.getByText(/无法读取回复或候选格式/).waitFor();
 assert.equal((await read()).finance,JSON.stringify(finance));
 await open();await settings.getByText('数据权限',{exact:true}).click();await full.check();await close();
 await say(deleteText);
 await review.getByRole('button',{name:'确认删除'}).waitFor();
 assert.deepEqual((await read()).state.local.foods,before.state.local.foods);
 await review.getByRole('button',{name:'放弃'}).click();
 await page.emulateMedia({colorScheme:'dark'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
 assert.deepEqual(errors,[]);
 console.log('PASS F ambiguity, anomalous weight, model error, atomic failure, reload retry, undo and high-risk permission checks');
 await open();
 const agent=settings.locator('#assistant-agent');
 await agent.getByText('健康 Skills 与规则',{exact:true}).click();
 assert.equal(await agent.locator('[data-skill-list] input:checked').count(),12);
 const content=['# 合成工作规范',...Object.keys(CORE_RULES),
  '普通日参考约 1700 kcal。TDEE基线2900kcal，已包含日常通勤。',
  '六天缺口7700 kcal。一天通常1袋鸡胸。芹菜在午餐与晚餐分两餐。'].join(String.fromCharCode(10));
 await agent.locator('[data-profile-file]').setInputFiles({name:'HEALTH_WORKFLOW_AND_STORAGE_310101.1.md',
  mimeType:'text/markdown',buffer:Buffer.from(content)});
 await agent.locator('[data-profile-preview]').waitFor();
 await agent.locator('[data-profile-calculations]').check();
 await agent.getByRole('button',{name:'保存个人配置'}).click();
 await agent.getByText('已保存个人配置 310101.1，计算参数已采用。').waitFor();
 assert.equal((await read()).state.settings.baselineTdee,2900);
 assert.equal((await read()).state.settings.cycleDays,6);
 const weigh=agent.getByRole('checkbox',{name:'包装称重 · v1'});
 await weigh.uncheck();
 await close();
 await page.locator('[data-new]').click();
 await sent('牛肉酱现在305g',/包装称重.*已停用/,0);
 await open();await weigh.check();await close();
 console.log('PASS profile preview and explicit calculation adoption; Skill toggle gates writes');
 await page.locator('[data-new]').click();
 const assets=await page.evaluate(()=>['#aa2222','#228822','#2222aa'].map(color=>{
  const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;
  const drawing=canvas.getContext('2d');drawing.fillStyle=color;drawing.fillRect(0,0,24,24);
  return canvas.toDataURL('image/png').split(',')[1];
 }));
 const attachments=assets.map((base64,index)=>({name:'meal-'+(index+1)+'.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')}));
 const beforePhoto=await read();
 await composer.locator('[name=image]').setInputFiles(attachments);
 await sent(photoText,/已保存。.*170 g.*80 g.*72.4 kg/s);
 const afterPhoto=await read();
 assert.equal(afterPhoto.state.revision,beforePhoto.state.revision+1);
 assert.equal(afterPhoto.state.local.foods.length,beforePhoto.state.local.foods.length+2);
 assert.equal(afterPhoto.state.local.weights.length,beforePhoto.state.local.weights.length+1);
 assert.equal(afterPhoto.state.local.foods.at(-1).agentEvidence.part,'extra');
 assert.equal(afterPhoto.state.local.foods.at(-2).agentEvidence.part,'served');
 await log.getByText('营养、库存与进度明细',{exact:true}).last().click();
 await log.getByText(/续份独立计入.*周期账面缺口/s).waitFor();
 await composer.locator('[name=image]').setInputFiles(attachments);
 await sent(photoText,/刚已保存，未重复入账/,0);
 assert.equal((await read()).state.revision,afterPhoto.state.revision);
 await page.setViewportSize({width:375,height:500});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),375);
 assert.deepEqual(errors,[]);
 console.log('PASS same-meal three-photo grouping, additional serving, reporting, deduplicated retry and mixed execution');
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(async({seed,ledger})=>{
  const storage=await import('../health/storage.mjs');
  const current=await storage.readState();
  await storage.saveState(seed,current.revision);
  localStorage.setItem('airplane-pwa-v1',JSON.stringify(ledger));
 },{seed:orderState(today),ledger:orderFinance(today)});
 await page.locator('[data-new]').click();
 const accessSection=settings.locator('details').filter({has:page.locator('[data-finance-auto]')});
 const openAccess=async()=>{
  await open();
  if(!await accessSection.evaluate(node=>node.open))await accessSection.locator('summary').click();
 };
 await openAccess();
 await full.uncheck();
 const financeGrant=settings.getByRole('checkbox',{name:'日常财务自动记账'});
 const financeLimit=settings.locator('[data-finance-limit]');
 assert.equal(await financeGrant.isChecked(),false);
 await financeGrant.check();await financeLimit.fill('10');await financeLimit.press('Tab');await close();
 const choose=files=>composer.locator('[name=image]').setInputFiles(files);
 const newEvidence=(await page.evaluate(()=>['#2846be','#882b40'].map(color=>{
  const canvas=document.createElement('canvas');canvas.width=24;canvas.height=24;
  const drawing=canvas.getContext('2d');drawing.fillStyle=color;drawing.fillRect(0,0,24,24);
  return canvas.toDataURL('image/png').split(',')[1];
 }))).map((base64,index)=>({name:'order-'+index+'.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')}));
 const receipts=async()=>JSON.parse((await read()).finance).transactions.filter(row=>row.receiptKey);
 await choose([attachments[0]]);await say('');
 await review.getByRole('button',{name:'确认待保存项'}).waitFor();
 assert.match(await review.innerText(),/单笔上限/);
 assert.equal((await receipts()).length,0);
 await review.getByRole('button',{name:'确认待保存项'}).click();
 await log.getByText(/已记支出 ¥34.00/).last().waitFor();
 assert.equal((await receipts()).length,1);
 assert.equal((await receipts())[0].receiptUnallocated,true);
 assert.equal(await log.getByText('模型声称已全部保存。',{exact:true}).count(),0);
 await choose([attachments[0]]);await sent('',/未重复写入/);
 assert.equal((await receipts()).length,1);
 await choose([attachments[2]]);await sent('测试购物车',/未付款订单或购物车/);
 await openAccess();
 await financeLimit.fill('300');await financeLimit.press('Tab');await close();
 await choose([attachments[2]]);await sent('登记退款',/已登记退款 ¥6.00/);
 assert.equal((await receipts()).at(-1).budgetSync,false);
 await choose([attachments[1],attachments[2]]);await sent(conversation,/已记支出 ¥34.00.*72.4 kg.*下一餐建议/s);
 assert.equal((await read()).state.local.foods.length,0);
 assert.equal((await read()).state.local.weights.length,1);
 assert.deepEqual((await read()).milk.map(row=>row.nominal.value),[500,500]);
 assert.ok((await receipts()).some(row=>row.categoryName==='家庭食材'&&row.amount===13&&row.budgetExcluded));
 assert.ok((await receipts()).some(row=>row.categoryName==='日用'&&row.amount===18));
 console.log('PASS payment-only screenshot, opt-in cap, no model success claim, duplicate, unpaid cart, refund, mixed category and weight / order / dinner DAG');

 await page.evaluate(()=>{
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){
   if(key==='main')throw Error('合成中断，财务落账后健康尚未写入');
   return put.call(this,value,key);
  };
 });
 await choose([newEvidence[0]]);await say('补充购买付款截图');
 await review.locator(":scope > p").filter({hasText:/财务已保存，健康账本待同步/}).waitFor();
 assert.equal((await read()).state.local.purchases.length,1);
 assert.equal((await receipts()).length,8);
 const during=calls.length;
 await page.reload();
 await composer.locator('[data-retry-request]').click();
 await log.getByText(/已记支出 ¥34.00.*未重复写入/).last().waitFor();
 assert.equal(calls.length,during);
 assert.equal((await receipts()).length,8);
 assert.equal((await read()).state.local.purchases.length,2);
 const details=log.locator('details.chat-source').last();
 await details.locator('summary').click();
 await details.getByRole('button',{name:'撤销截图订单'}).click();
 await details.getByRole('button',{name:/已撤销整张截图订单/}).waitFor();
 assert.equal((await receipts()).length,5);
 assert.equal((await read()).state.local.batches.length,1);
 assert.equal(await page.evaluate(async()=>!!await (await import('../health/purchase-sync.mjs')).readPendingPurchase({finance:localStorage})),false);
 console.log('PASS staged IndexedDB interruption, reload without API, one inventory commit and linked undo');

 await page.evaluate(()=>{
  const set=Storage.prototype.setItem;
  Storage.prototype.setItem=function(key,value){
   if(key==='airplane-pwa-v1'&&!window.financeFailure){
    window.financeFailure=true;throw Error('合成财务写入中断');
   }
   return set.call(this,key,value);
  };
 });
 await choose([newEvidence[1]]);await say('确认顺序');
 await review.locator(":scope > p").filter({hasText:/财务写入未完成/}).waitFor();
 assert.equal((await receipts()).length,5);
 const retryCount=calls.length;
 await composer.getByRole('button',{name:'重试未完成步骤'}).click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('airplane-pwa-v1')).transactions.filter(row=>row.receiptKey).length===8);
 await review.waitFor({state:'hidden'});
 assert.equal(calls.length,retryCount);
 assert.equal((await receipts()).length,8);
 assert.equal((await read()).state.local.batches.length,2);
 for(const width of [375,390,430]){
  await page.setViewportSize({width,height:600});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
 }
 assert.deepEqual(errors,[]);
 console.log('PASS failed primary finance write safely retries and compact order UI fits three mobile widths');
 await open();
 const taskSettings=settings.locator('[data-task-settings]');
 await taskSettings.getByText('任务用量与费率',{exact:true}).click();
 await taskSettings.getByText(/缓存命中 2\/2/).waitFor();
 await taskSettings.locator('[name=model]').selectOption('gpt-6.1-terra');
 await taskSettings.locator('[name=input]').fill('1.01');
 await taskSettings.getByRole('button',{name:'保存本机费率'}).click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('airplane-ai-prices-v1'))['gpt-6.1-terra'][0]),1.01);
 const taskDownload=page.waitForEvent('download');
 await taskSettings.getByRole('button',{name:'导出本机任务日志'}).click();
 assert.equal((await taskDownload).suggestedFilename(),'airplane-agent-task-log.json');
 await close();
 console.log('PASS editable rates, returned cached-token accounting and local task export');
 const tomorrow=addDays(today,1),beforeFuturePlan=(await read()).state;
 await say(tomorrowText);
 await log.locator('.chat-bubble.assistant').filter({hasText:/午餐建议.*晚餐建议/s}).last().waitFor();
 await log.locator('details.chat-source').last().locator('summary').click();
 await log.locator('details.chat-source').last().getByText(/饮食计划.*计划合计/s).waitFor();
 assert.equal((await read()).state.revision,beforeFuturePlan.revision);

 await say(saveTomorrowText);
 await review.getByRole('button',{name:'保存为饮食计划'}).click();
 await log.getByText('已保存饮食计划。',{exact:true}).last().waitFor();
 let future=(await read()).state;
 assert.ok(future.local.foods.some(row=>row.date===tomorrow&&row.status==='plan'&&row.name==='合成熟鸡胸'));
 assert.deepEqual(future.local.stockMoves,beforeFuturePlan.local.stockMoves);

 await page.goto(origin+'/health/');
 await page.getByRole('button',{name:'后一天',exact:true}).click();
 assert.equal(await page.locator('#report-date').inputValue(),tomorrow);
 for(const name of ['合成计划一','合成计划二']){
  await page.getByRole('button',{name:'记一笔健康'}).click();
  const form=page.locator('#food-form');
  assert.equal(await form.locator('[name=status]').inputValue(),'plan');
  await form.locator('[name=name]').fill(name);
  await form.getByRole('button',{name:'确认保存这条饮食'}).click();
  await page.locator('#health-entry').waitFor({state:'hidden'});
 }
 future=(await read()).state;
 assert.equal(future.local.foods.filter(row=>row.date===tomorrow&&row.status==='plan').length,3);
 assert.deepEqual(future.local.stockMoves,beforeFuturePlan.local.stockMoves);
 assert.deepEqual(errors,[]);
 console.log('PASS tomorrow recommendations, AI plan save, and repeated manual plan entry keep actual intake and stock intact');

}finally{await browser?.close();server.close();}
