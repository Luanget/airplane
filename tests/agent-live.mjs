import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {extname} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {estimatedCost,usageTokens} from '../ai/usage.mjs';
import {assistantFixture} from './health-action-fixture.mjs';
import {orderFinance} from './order-agent-fixture.mjs';
import {cases,date} from './agent-live-cases.mjs';

const {chromium}=createRequire(import.meta.url)('playwright-core');
const models=['gpt-6-luna','gpt-6.1-terra'];
const endpoint='https://api.openai.com/v1/responses';
const browserKey='sk-synthetic-live-browser-placeholder';
const allowed=new Set(['sw.js',...Array.from(readFileSync('sw.js','utf8').split('const assets')[0].matchAll(/'\.\/([^']+)'/g),m=>m[1])]);
let key=process.env.AIRPLANE_EVAL_OPENAI_KEY;
if(!key){
 const prompt=createInterface({input:process.stdin,terminal:false});
 key=(await prompt.question('')).trim();
 prompt.close();
}
if(!key?.startsWith('sk-'))throw new Error('Missing API credential on standard input.');
const budget={calls:0};
const maxRequests=Number(process.env.AIRPLANE_EVAL_MAX_CALLS??250);
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname.slice(1);
 const file=path.endsWith('/')||!path?path+'index.html':path;
 if(!allowed.has(file)){res.writeHead(404).end();return;}
 const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.png':'image/png',
  '.webmanifest':'application/manifest+json'};
 res.setHeader('Content-Type',mime[extname(file)]??'text/plain');
 let source=readFileSync(file);
 if(name==='ai/chat.mjs')source=Buffer.from(source.toString().replace('const nativeAgentEnabled=!demo;','const nativeAgentEnabled=false;'));
 res.end(source);
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;

function receiptLines({amount,food,household,number,status,extra}){
 const mixed=food&&household;
 const product=[...(food?['合成脱脂牛奶 500 mL/盒 × 2    原价 ¥15.00    商品实付 ¥'+(mixed?'13.00':'15.00')]:[]),
  ...(household?['合成纸巾 × 1    原价 ¥20.00    商品实付 ¥'+(mixed?'18.00':'20.00')]:[])];
 return ['合成商店', '订单日期 '+date, ...(number?['订单号 '+number]:[]), status, ...product,
  '优惠 ¥'+(mixed?'4.00':'0.00')+'    运费 ¥'+(mixed?'3.00':'0.00'), '实付 ¥'+amount.toFixed(2),...(extra?[extra]:[])];
}
async function image(page,data,index){
 const content=Array.isArray(data)?data:receiptLines(data);
 const png=await page.evaluate(lines=>{
  const canvas=document.createElement('canvas');canvas.width=1120;canvas.height=85+lines.length*56;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#101518';ctx.font='30px "Noto Sans CJK SC", "DejaVu Sans", sans-serif';
  lines.forEach((line,i)=>ctx.fillText(line,42,68+i*56));
  return canvas.toDataURL('image/png').split(',')[1];
 },content);
 return {name:'synthetic-evidence-'+index+'.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
}
function compactError(error){return String(error?.message??error??'').split('\n')[0].slice(0,220);}
async function run(browser,model,example){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 page.setDefaultTimeout(90000);
 const metric={case:example.id,model,api:[],success:false};
 const started=performance.now();
 try{
  await context.route(endpoint,async route=>{
   const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(budget.calls>=maxRequests)return route.fulfill({status:429,headers,json:{error:{code:'benchmark_call_limit'}}});
   budget.calls++;
   const req=route.request().postDataJSON();
   const start=performance.now();
   try{
    const res=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
     body:JSON.stringify({...req,stream:false}),signal:AbortSignal.timeout(75000)});
    const body=await res.json();
    metric.api.push({status:res.status,asked:req.model,served:body.model??null,code:body.error?.code??null,
     param:body.error?.param??null,tokens:usageTokens(body.usage),cost:estimatedCost(model,body.usage),ms:Math.round(performance.now()-start)});
    return route.fulfill({status:res.status,headers,json:res.ok?body:{error:{code:body.error?.code??'api_error'}}});
   }catch(error){
    metric.api.push({network:error.name,cause:error.cause?.code??null});
    return route.fulfill({status:502,headers,json:{error:{code:'api_network_failure'}}});
   }
  });
  await page.clock.setFixedTime(new Date('2026-11-21T12:00:00Z'));
  await page.goto(origin+'/assistant/');
  await page.waitForFunction(()=>typeof document.getElementById('assistant-settings')?.onclick==='function');
  const seed=assistantFixture(date);
  await page.evaluate(async({seed,finance,browserKey,model})=>{
   await (await import('/ai/keys.mjs')).importKey(browserKey);
   await (await import('/health/storage.mjs')).saveState(seed,0);
   localStorage.setItem('airplane-pwa-v1',JSON.stringify(finance));
   (await import('/ai/health-actions.mjs')).setHealthAuto(localStorage,true);
   (await import('/ai/finance.mjs')).setFinanceAutomation(localStorage,true,100000);
   (await import('/ai/models.mjs')).saveChatModel(localStorage,model);
  },{seed:example.prepare?.(seed)??seed,finance:orderFinance(date),browserKey,model});
  const composer=page.locator('.chat-composer');
  if(example.interrupt)await page.evaluate(()=>{
   const put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(value,key){
    if(key==='main')throw Error('合成中断');
    return put.call(this,value,key);
   };
  });
  for(const [turnIndex,data] of [...(example.before??[]),...example.turns].entries()){
   const turn=typeof data==='string'?{text:data}:data;
   if(turn.pictures)await composer.locator('[name=image]').setInputFiles(await Promise.all(turn.pictures.map((picture,i)=>image(page,picture,i))));
   if(turn.medical)await composer.locator('[name=medicalFiles]').setInputFiles(await image(page,turn.medical,0));
   await composer.getByRole('textbox',{name:'消息'}).fill(turn.text);
   await composer.getByRole('button',{name:turn.medical?'发送所选报告识别':'发送',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('.chat-composer textarea')?.disabled);
   if(example.interrupt&&turnIndex===0&&await page.locator('.chat-review').isVisible()){
    await page.reload();
    await composer.locator('[data-retry-request]').click({timeout:10000});
    await page.waitForFunction(()=>!document.querySelector('.chat-composer textarea')?.disabled);
   }
   if(turn.medical){
    const save=page.locator('.chat-review').getByRole('button',{name:'保存到本机'});
    if(await save.isVisible()){await save.click();await page.waitForFunction(()=>!document.querySelector('.chat-composer textarea')?.disabled);}
   }
  }
  // The trace writes in an IndexedDB transaction after the chat response settles.
  await page.waitForFunction(async()=>{
   const rows=await (await import('/ai/task-log.mjs')).taskJournal().list();
   return rows[0]&&!['running'].includes(rows[0].status);
  },null,{timeout:5000}).catch(()=>{});
  const final=await page.evaluate(async()=>{
   const state=await (await import('/health/storage.mjs')).readState();
   const trace=await (await import('/ai/task-log.mjs')).taskJournal().list();
   const messages=[...document.querySelectorAll('.chat-bubble.assistant')].map(node=>node.textContent);
   return {state,trace,ledger:JSON.parse(localStorage.getItem('airplane-pwa-v1')),messages,
    status:document.querySelector('[data-status]')?.textContent,review:document.querySelector('.chat-review')?.hidden===false};
  });
  const check=example.verify(final);
  const canWriteFinance=example.turns.some(turn=>typeof turn!=='string'&&turn.pictures?.some(p=>!Array.isArray(p)&&Object.hasOwn(p,'amount')))||
   ['refund','expense-and-weight'].includes(example.id);
  const seedFinance=orderFinance(date);
  if(!canWriteFinance)check.finance&&=JSON.stringify(final.ledger.transactions)===JSON.stringify(seedFinance.transactions);
  check.finance&&=JSON.stringify(final.ledger.budgets)===JSON.stringify(seedFinance.budgets);
  const newFoods=final.state.local.foods.filter(row=>row.date===date&&row.status==='actual').length;
  metric.postState={newFoods,financeTransactions:final.ledger.transactions.length-seedFinance.transactions.length,
   purchases:final.state.local.purchases?.length??0};
  metric.verification=check;
  metric.confirmations=final.trace.reduce((sum,row)=>sum+row.confirmations,0);
  metric.review=final.review;
  metric.resume=example.interrupt?final.trace.some(row=>row.attempts===2):null;
  metric.success=check.health&&check.finance&&(!example.reply||final.messages.some(row=>example.reply.test(row)))&&
   metric.api.every(row=>row.status===200&&row.asked===model);
  if(!metric.success){
   metric.lastMessages=final.messages.slice(-2).map(row=>row.slice(0,250));
   metric.uiStatus=final.status;
  }
 }catch(error){metric.failure=compactError(error);}
 finally{metric.ms=Math.round(performance.now()-started);await context.close();}
 return metric;
}
function totals(rows){
 const requests=rows.flatMap(row=>row.api);
 const tokens=field=>requests.reduce((sum,row)=>sum+(row.tokens?.[field]??0),0);
 const times=rows.map(row=>row.ms).sort((a,b)=>a-b);
 return {tasks:rows.length,successes:rows.filter(row=>row.success).length,taskErrors:rows.filter(row=>!row.success).length,
  calls:requests.length,input:tokens('input'),output:tokens('output'),cached:tokens('cached'),
  cacheHits:requests.filter(row=>row.tokens?.cached>0).length,cacheReports:requests.filter(row=>row.tokens?.cached!=null).length,
  estimatedUsd:requests.reduce((sum,row)=>sum+(row.cost??0),0)/1e12,pricedCalls:requests.filter(row=>row.cost!=null).length,
  confirmations:rows.reduce((sum,row)=>sum+(row.confirmations??0),0),pendingReviews:rows.filter(row=>row.review).length,
  medianMs:times[Math.floor(times.length/2)]??null,resume:rows.find(row=>row.resume!=null)?.resume??false};
}
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||
  ['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 const selected=process.argv.length>2?cases.filter(row=>process.argv.slice(2).includes(row.id)):cases;
 if(!selected.length)throw new Error('No benchmark cases selected.');
 const jobs=selected.flatMap(example=>models.map(model=>({example,model})));
 const rows=[];
 let position=0;
 async function worker(){
  while(position<jobs.length){
   const {example,model}=jobs[position++];
   const result=await run(browser,model,example);
   rows.push(result);
   console.error(JSON.stringify({case:result.case,model,success:result.success,calls:result.api.length}));
  }
 }
 await Promise.all(Array.from({length:4},worker));
 const summaries=Object.fromEntries(models.map(model=>[model,totals(rows.filter(row=>row.model===model))]));
 console.log(JSON.stringify({method:'real Responses API, same synthetic PWA fixtures, upstream JSON transport',summaries,rows},null,2));
 if(rows.some(row=>!row.success))process.exitCode=1;
}finally{await browser?.close();server.close();}
