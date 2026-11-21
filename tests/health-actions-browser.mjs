import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {extname} from 'node:path';
import {freshData} from '../finance-storage.mjs';
import {assistantFixture,action,examples,proposal} from './health-action-fixture.mjs';

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
 const financeText='试着覆盖财务备份',deleteText='删除今天全部饮食',badText='模型错误测试，吃了20g牛肉酱';
 const shortStock='吃了十包荞麦面';
 expected.set(shortStock,proposal(action('eat',shortStock,{name:'荞麦面',amount:10,unit:'包',whole:'yes'})));
 expected.set(badText,proposal(action('eat','吃了20g牛肉酱',{name:'牛肉酱',amount:200,unit:'g',whole:'no'})));
 await ctx.route('https://api.openai.com/v1/responses',async route=>{
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  assert.equal(route.request().headers().authorization,'Bearer '+root);
  const body=route.request().postDataJSON(),input=JSON.parse(body.input[0].content[0].text);
  calls.push({body,input});
  const full=body.tools.some(tool=>tool.name==='read_app_document');
  assert.equal(body.store,false);
  let result;
  if(input.text===financeText)result={mode:'document_edit',date:null,result:{document:'finance',patch:'[]'}};
  else if(input.text===deleteText)result={mode:'delete_record',date:input.date,result:{kind:'food',query:'',meal:null,selection:'all'}};
  else {
   assert.ok(expected.has(input.text),input.text);
   result={mode:'health_action',date:null,result:expected.get(input.text)};
  }
  const value={reply:'正在处理。',proposal:result,...(full?{saveMode:'save'}:{}),
   ...(body.text.format.schema.required.includes('memoryUpdates')?{memoryUpdates:[]}:{})};
  await route.fulfill({headers,json:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}});
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
  await log.getByText(match).last().waitFor();
  assert.equal(calls.length-start,requestCount);
  assert.equal(await review.isVisible(),false);
 }
 await sent('牛肉酱现在310g',/已保存。.*12.2 g/);
 assert.equal((await read()).sauce[0].gross,310);
 assert.deepEqual(calls.at(-1).input.healthContext.stock.map(row=>row.sku),['fixture-sauce']);
 assert.equal(calls.at(-1).body.tools.some(tool=>tool.name==='read_app_document'),false);
 console.log('PASS A package weighing automatically saves one verified difference');
 await sent('吃了20g牛肉酱',/已保存。.*20 g/);
 let current=await read();
 assert.equal(current.sauce[0].gross,310);assert.equal(current.sauce[0].unweighedGrams,20);
 assert.equal(current.state.local.foods.at(-1).weighing,undefined);
 console.log('PASS B actual grams leave the measured gross authentic');
 await sent('喝完一盒牛奶',/已保存。.*1000 mL/);
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
 await sent('昨天牛奶少算200mL',/已保存。更正.*1200 mL/);
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
 await sent('牛肉酱现在305g',/有多个可用包装/);
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
}finally{await browser?.close();server.close();}
