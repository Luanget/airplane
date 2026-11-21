import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,mkdtempSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {extname,resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {estimatedCost} from '../ai/usage.mjs';
import {assistantFixture,action,examples,proposal} from './health-action-fixture.mjs';
import {combinedTask,conversation,orderFinance,orderReceipt,orderState,receiptStep} from './order-agent-fixture.mjs';
import {reportCandidate,syntheticPdf} from './medical-fixture.mjs';

const {chromium}=createRequire(import.meta.url)('playwright-core');
const current=process.cwd();
const baseline=process.env.AIRPLANE_EVAL_BASELINE??mkdtempSync(join(tmpdir(),'airplane-0915-baseline-'));
if(!process.env.AIRPLANE_EVAL_BASELINE){
 const source=execFileSync('git',['archive','--format=tar','14cfdecde640b068cf24adbb0f910c837fd5469b'],{maxBuffer:12*1024*1024});
 execFileSync('tar',['-x','-C',baseline],{input:source});
}
const roots={baseline:resolve(baseline),current};
const shellAssets=Object.fromEntries(Object.entries(roots).map(([mode,root])=>[mode,new Set(['sw.js',
 ...Array.from(readFileSync(join(root,'sw.js'),'utf8').split('const assets')[0].matchAll(/'\.\/([^']+)'/g),m=>m[1])])]));
const server=createServer((req,res)=>{
 const [,mode,...rest]=new URL(req.url,'http://localhost').pathname.split('/');
 let name=rest.join('/');
 if(!name||name.endsWith('/'))name+='index.html';
 if(!shellAssets[mode]?.has(name)){res.writeHead(404).end();return;}
 const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
 res.setHeader('Content-Type',mime[extname(name)]??'text/plain');res.end(readFileSync(join(roots[mode],name)));
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const cases=[
 {id:'health',text:'记晨重72.4kg',reply:/已保存。.*72\.4 kg/,writes:'weight'},
 {id:'intake',text:'吃了20g牛肉酱',reply:/已保存。.*20 g/,writes:'intake'},
 {id:'weigh',text:'牛肉酱现在310g',reply:/已保存。.*12\.2 g/,writes:'weigh'},
 {id:'finance',text:'记一笔支出 家庭食材 23元',reply:/已记支出 ¥23\.00/,writes:'finance'},
 {id:'balance',text:'我的余额是多少',reply:/当前总余额/,writes:null},
 {id:'receipt',text:'',attachment:'photo',reply:/已记支出 ¥34\.00/,writes:'paid'},
 {id:'mixed-order',text:'识别已付订单截图，食品入库',attachment:'photo',reply:/已记支出 ¥34\.00/,writes:'mixed'},
 {id:'cross-domain',text:conversation,attachment:'photo',reply:/已记支出 ¥34\.00.*72\.4 kg.*下一餐建议/s,writes:'cross'},
 {id:'correction',text:'昨天牛奶少算200mL',reply:/已保存。更正.*1200 mL/,writes:'correction'},
 {id:'medical',text:'',attachment:'medical',reply:/新录入 1 项指标/,writes:'medical'},
 {id:'interruption',text:'恢复实付订单截图',attachment:'photo',reply:/已记支出 ¥34\.00/,writes:'mixed',interrupt:true},
 {id:'ambiguous',text:'核对未确认付款截图',attachment:'photo',reply:/付款或退款状态无法核对/,writes:null}
];
const response=value=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
const financePlan=date=>({steps:[{id:'finance',kind:'finance',dependsOn:[],evidence:'记一笔支出 家庭食材 23元',
 entry:{date,type:'expense',categoryId:'家庭食材',amount:23,note:''}}]});
function fixtureResult(example,input,request){
 const {id,text}=example,date=input.date;
 if(id==='balance'){
  if(request.input.length===1)return {status:'completed',output:[{type:'function_call',name:'read_ledger',call_id:'balance-eval',
   arguments:JSON.stringify({scope:'balance',query:''})}]};
  const data=JSON.parse(request.input.at(-1).output);
  return response({reply:'当前总余额 '+data.balance+' 元。',proposal:null,
   ...(request.text.format.schema.required.includes('memoryUpdates')?{memoryUpdates:[]}:{})});
 }
 if(id==='medical')return response(reportCandidate('2024-04-19'));
 let result;
 if(id==='health'){
  result={mode:'health_action',date:null,result:proposal(action('weight',text,{kg:72.4,morning:'yes'}))};
 }else if(examples[text]){
  result={mode:'health_action',date:null,result:examples[text]};
 }else{
  let receipt=orderReceipt(date,{orderNo:'EVAL-'+id+'-01'});
  if(id==='receipt')receipt={...receipt,lines:[],shipping:null,discount:null};
  if(id==='ambiguous')receipt={...receipt,state:'unknown'};
  result={mode:'agent_task',date:null,result:id==='finance'?financePlan(date):
   id==='cross-domain'&&input.text===conversation?combinedTask(receipt):{steps:[receiptStep(receipt)]}};
 }
 return response({reply:'正在根据证据处理。',proposal:result,
  ...(request.text.format.schema.required.includes('memoryUpdates')?{memoryUpdates:[]}:{})});
}
// This approximation is deliberately independent of model and excludes media bytes.
const estimate=text=>(text.match(/[\p{Script=Han}]|[\p{L}\p{N}_]+|[^\s]/gu)??[])
 .reduce((count,unit)=>count+(/^\p{Script=Han}$/u.test(unit)?1.45:Math.max(1,[...unit].length/4)),0);
function inputProxy(request){
 const {input,...meta}=request;
 const text=input.map(item=>item.content?.filter(content=>content.type==='input_text').map(content=>content.text).join('\n')??
  JSON.stringify(item)).join('\n');
 return Math.ceil(estimate(JSON.stringify(meta)+'\n'+text));
}
const root='sk-synthetic-agent-eval-key';
async function verify(page,mode,example){
 const state=await page.evaluate(async(mode)=>{
  const health=await (await import('/'+mode+'/health/storage.mjs')).readState();
  const ledger=JSON.parse(localStorage.getItem('airplane-pwa-v1'));
  return {health,ledger};
 },mode);
 const {health,ledger}=state,writes=example.writes;
 const receipts=ledger.transactions.filter(row=>row.receiptKey);
 const purchases=health.local.purchases??[];
 if(writes==='weight'||writes==='cross')assert.equal(health.local.weights.at(-1)?.kg,72.4);
 if(writes==='intake')assert.equal(health.local.foods.at(-1)?.amount,20);
 if(writes==='weigh')assert.equal(health.local.foods.at(-1)?.amount,12.2);
 if(writes==='correction')assert.equal(health.local.foods.find(row=>row.id==='food:fixture-yesterday-milk')?.amount,1200);
 if(writes==='finance')assert.equal(ledger.transactions.filter(row=>row.id.startsWith('agent-finance')).length,1);
 if(writes==='medical'){
  assert.equal(health.local.medical.measurements.length,1);
  assert.equal(health.local.medical.attachments.length,1);
 }
 if(writes==='paid')assert.equal(receipts.length,1);
 if(['mixed','cross'].includes(writes)){
  assert.equal(receipts.length,3);
  assert.equal(receipts.reduce((sum,row)=>sum+row.amount,0),34);
  assert.equal(purchases.length,1);
  assert.equal(purchases[0].items.length,1);
  assert.equal(health.local.foods.length,0);
 }
 if(!writes)assert.equal(receipts.length,0);
}
async function run(browser,mode,example){
 const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await ctx.newPage();
 page.setDefaultTimeout(10000);
 const metrics={case:example.id,requests:0,proxyInput:0,proxyOutput:0,proxyPicoUsd:0,confirmations:0,models:[]};
 try{
  await ctx.route('https://api.openai.com/v1/responses',async route=>{
   const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
   if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
   const request=route.request().postDataJSON(),input=JSON.parse(request.input[0].content[0].text);
   metrics.requests++;metrics.models.push(request.model);
   const value=fixtureResult(example,input,request);
   const counts={input_tokens:inputProxy(request),output_tokens:Math.ceil(estimate(JSON.stringify(value.output)))};
   metrics.proxyInput+=counts.input_tokens;metrics.proxyOutput+=counts.output_tokens;
   metrics.proxyPicoUsd+=estimatedCost(request.model,counts)??0;
   value.id='resp_eval_'+metrics.requests;
   value.usage={...counts,input_tokens_details:{cached_tokens:0}};
   await new Promise(done=>setTimeout(done,60));
   await route.fulfill({headers,json:value});
  });
  await page.goto(origin+'/'+mode+'/assistant/');
  await page.waitForFunction(()=>typeof document.getElementById('assistant-settings')?.onclick==='function');
  const date=await page.evaluate(async mode=>(await import('/'+mode+'/calendar.mjs')).localDate(),mode);
  const seed=['intake','weigh','correction'].includes(example.writes)?assistantFixture(date):orderState(date);
  await page.evaluate(async({mode,seed,finance,root})=>{
   const prefix='/'+mode+'/';
   await (await import(prefix+'ai/keys.mjs')).importKey(root);
   await (await import(prefix+'health/storage.mjs')).saveState(seed,0);
   localStorage.setItem('airplane-pwa-v1',JSON.stringify(finance));
   (await import(prefix+'ai/health-actions.mjs')).setHealthAuto(localStorage,true);
   (await import(prefix+'ai/finance.mjs')).setFinanceAutomation(localStorage,true,100000);
  },{mode,seed,finance:orderFinance(date),root});
  const composer=page.locator('.chat-composer'),review=page.locator('.chat-review');
  if(example.attachment==='photo'){
   const png=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=40;
    canvas.getContext('2d').fillText('fixture paid',2,18);
    return canvas.toDataURL('image/png').split(',')[1];
   });
   await composer.locator('[name=image]').setInputFiles({
    name:'synthetic-order.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  }
  if(example.attachment==='medical')await composer.locator('[name=medicalFiles]').setInputFiles({
   name:'synthetic-report.pdf',mimeType:'application/pdf',buffer:Buffer.from(syntheticPdf())});
  if(example.interrupt)await page.evaluate(()=>{
   const put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(value,key){
    if(key==='main')throw Error('合成中断');
    return put.call(this,value,key);
   };
  });
  await composer.getByRole('textbox',{name:'消息'}).fill(example.text);
  const start=performance.now();
  await composer.getByRole('button',{name:example.attachment==='medical'?'发送所选报告识别':'发送',exact:true}).click();
  if(example.attachment==='medical'){
   await review.getByRole('button',{name:'保存到本机'}).click();
   metrics.confirmations++;
  }
  if(example.interrupt){
   await review.locator(':scope > p').filter({hasText:/财务已保存，健康账本待同步/}).waitFor();
   await page.reload();
   await composer.locator('[data-retry-request]').click();
  }
  await page.locator('.chat-bubble.assistant').filter({hasText:example.reply}).last().waitFor();
  metrics.ms=Math.round(performance.now()-start);
  await verify(page,mode,example);
  if(mode==='current'){
   const trace=await page.waitForFunction(async()=>{
    const {taskJournal}=await import('/current/ai/task-log.mjs');
    return (await taskJournal().list()).find(task=>['done','blocked','partial'].includes(task.status));
   }).then(handle=>handle.jsonValue());
   assert.equal(trace.requests.length,metrics.requests);
   assert.equal(trace.confirmations,metrics.confirmations);
   assert.equal(trace.status,example.id==='ambiguous'?'blocked':'done');
   if(example.interrupt){assert.equal(trace.attempts,2);assert.equal(trace.steps[0].receipt.transactionIds.length,3);}
   if(example.id==='cross-domain')assert.deepEqual(trace.steps.find(step=>step.id==='local-plan-1').dependsOn,['receipt-1','local-weight-1']);
  }
  metrics.success=true;
 }catch(error){
  metrics.success=false;metrics.failure=error.message.split('\n')[0];
  metrics.lastStatus=await page.locator('[data-status]').textContent().catch(()=>null);
  metrics.lastMessages=await page.locator('.chat-bubble').allTextContents().then(rows=>rows.slice(-2)).catch(()=>[]);
 }finally{await ctx.close();}
 return metrics;
}

const summarize=rows=>{
 const total=name=>rows.reduce((sum,row)=>sum+(row[name]??0),0);
 const times=rows.map(row=>row.ms).filter(Number.isFinite).sort((a,b)=>a-b);
 return {tasks:rows.length,successful:rows.filter(row=>row.success).length,unexpectedErrors:rows.filter(row=>!row.success).length,
  requests:total('requests'),proxyInput:total('proxyInput'),proxyOutput:total('proxyOutput'),
  proxyUsd:total('proxyPicoUsd')/1e12,medianMs:times.length?Math.round((times[Math.floor((times.length-1)/2)]+times[Math.floor(times.length/2)])/2):null,
  totalMs:total('ms'),confirmations:total('confirmations')};
};
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||
  ['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 const runs={baseline:[],current:[]};
 for(const example of cases)for(const mode of Object.keys(runs))runs[mode].push(await run(browser,mode,example));
 const results={method:'same scripted model results, 60ms mock delay per API response, text-only token and cost proxies, no real API/cache',
  baseline:summarize(runs.baseline),current:summarize(runs.current),cases:runs};
 console.log(JSON.stringify(results,null,2));
 if(Object.values(runs).flat().some(row=>!row.success))process.exitCode=1;
}finally{await browser?.close();server.close();}
