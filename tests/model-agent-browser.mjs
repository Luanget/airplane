import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {extname} from 'node:path';
import {addDays} from '../health/core.mjs';
import {action,assistantFixture,proposal} from './health-action-fixture.mjs';

const {chromium}=createRequire(import.meta.url)('playwright-core');
const allowed=new Set(['sw.js',...Array.from(readFileSync('sw.js','utf8').split('const assets')[0].matchAll(/'\.\/([^']+)'/g),m=>m[1])]);
const server=createServer((req,res)=>{
 let file=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!file||file.endsWith('/'))file+='index.html';
 if(!allowed.has(file)){res.writeHead(404).end();return;}
 const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.png':'image/png',
  '.webmanifest':'application/manifest+json'};
 res.setHeader('Content-Type',mime[extname(file)]??'text/plain');res.end(readFileSync(file));
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const output=(...items)=>({status:'completed',output:items});
const answer=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const call=(name,id,args)=>({type:'function_call',name,id:'fc_'+id,call_id:id,arguments:JSON.stringify(args)});
const message='帮我记录真实的晨重72.4kg',correction='本轮改成晨重72.6kg',independent='独立的问题：余额是多少？';
const needsReview='帮我记录下午体重73.0kg';
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 const ctx=await browser.newContext({viewport:{width:390,height:650},isMobile:true,hasTouch:true});
 const page=await ctx.newPage();
 page.setDefaultTimeout(10000);
 let requested=0,failed=false,release,firstStarted;
 const waitFirst=new Promise(resolve=>{firstStarted=resolve;});
 const releaseFirst=new Promise(resolve=>{release=resolve;});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await ctx.route('https://api.openai.com/v1/responses',async route=>{
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const body=route.request().postDataJSON();
  assert.equal(body.store,false);assert.deepEqual(body.include,['reasoning.encrypted_content']);
  assert.equal(body.text,undefined);
  requested++;
  let reply;
  const last=body.input.at(-1);
  if(requested===1){
   firstStarted();await releaseFirst;
   reply=output({type:'reasoning',id:'rs_first',summary:[],encrypted_content:'opaque-begin'},
    call('write_health','stale',proposal(action('weight',message,{kg:72.4,morning:'yes'}))));
  }else if(last.content?.[0]?.text===correction){
   assert.ok(body.input.find(row=>row.encrypted_content==='opaque-begin'));
   assert.equal(JSON.parse(body.input.find(row=>row.call_id==='stale'&&row.type==='function_call_output').output).status,'superseded');
   reply=output(call('write_health','corrected',proposal(action('weight',correction,{kg:72.6,morning:'yes'}))));
  }else if(last.call_id==='corrected'&&!failed){
   const saved=JSON.parse(last.output);
   assert.equal(saved.status,'saved');
   failed=true;await route.fulfill({headers,status:500,json:{error:{code:'synthetic'}}});return;
  }else if(last.call_id==='corrected'){
   assert.equal(body.tool_choice,'none');
   reply=output(answer('晨重已按你的补充记录为72.6公斤。'));
  }else if(last.content?.[0]?.text===independent){
   assert.ok(last.content.some(part=>part.type==='input_image'));
   reply=output(call('read_ledger','balance',{scope:'balance',query:''}));
  }else if(last.call_id==='balance'){
   assert.equal(JSON.parse(last.output).status,'ok');
   const text='查询的本机余额是0元。';
   const stream=[{type:'response.output_text.delta',output_index:0,content_index:0,delta:text},
    {type:'response.completed',response:output(answer(text))}].map(event=>'data: '+JSON.stringify(event)+'\n\n').join('');
   await route.fulfill({headers:{...headers,'Content-Type':'text/event-stream'},body:stream});return;
  }else if(last.content?.[0]?.text===needsReview){
   reply=output(call('write_health','review',proposal(action('weight',needsReview,{kg:73,morning:'no'}))));
  }else if(last.call_id==='review'){
   assert.equal(JSON.parse(last.output).status,'review');
   reply=output(answer('下午体重73.0公斤待确认。'));
  }else if(String(last.content).includes('客户端跳过了待确认操作')){
   assert.equal(body.tool_choice,'none');
   reply=output(answer('已跳过73.0公斤这项，未新增记录。'));
  }else throw Error('Unexpected test request '+requested);
  await route.fulfill({headers,json:reply});
 });
 await page.goto(origin+'/assistant/');
 await page.waitForFunction(()=>typeof document.querySelector('.chat-composer')?.onsubmit==='function');
 const today=await page.evaluate(async()=>(await import('/calendar.mjs')).localDate());
 await page.evaluate(async seed=>{
  await (await import('/ai/keys.mjs')).importKey('sk-synthetic-native-browser-only');
  await (await import('/health/storage.mjs')).saveState(seed,0);
  (await import('/ai/health-actions.mjs')).setHealthAuto(localStorage,true);
 },assistantFixture(today));
 const textbox=page.getByRole('textbox',{name:'消息'}),send=()=>page.locator('.chat-composer').getByRole('button',{name:'发送',exact:true}).click();
 const say=async text=>{await textbox.fill(text);await send();await textbox.waitFor({state:'visible'});};
 await say(message);await waitFirst;
 await page.getByRole('checkbox',{name:'补充当前任务'}).check();
 await say(correction);await page.getByText('已收到本轮补充',{exact:true}).waitFor();
 await page.getByRole('checkbox',{name:'补充当前任务'}).uncheck();
 const png=await page.evaluate(()=>document.createElement('canvas').toDataURL('image/png').split(',')[1]);
 await page.locator('[name=image]').setInputFiles({name:'合成附件.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await say(independent);await page.getByText('等待处理 1 条消息',{exact:true}).waitFor();
 release();
 await page.getByRole('button',{name:'仅重试回复'}).waitFor();
 const weights=()=>page.evaluate(async()=> (await (await import('/health/storage.mjs')).readState()).local.weights.map(row=>row.kg));
 assert.deepEqual(await weights(),[72.6]);
 await page.reload();
 await page.getByRole('button',{name:'仅重试回复'}).click();
 await page.getByText('晨重已按你的补充记录为72.6公斤。',{exact:true}).waitFor();
 await page.getByText('查询的本机余额是0元。',{exact:true}).waitFor();
 assert.deepEqual(await weights(),[72.6]);
 assert.equal(requested,6);
 await page.evaluate(async()=>(await import('/ai/health-actions.mjs')).setHealthAuto(localStorage,false));
 await say(needsReview);
 await page.getByRole('button',{name:'跳过此项'}).click();
 await page.getByText('已跳过73.0公斤这项，未新增记录。',{exact:true}).waitFor();
 assert.deepEqual(await weights(),[72.6]);
 await page.reload();
 await page.getByText('本轮附件 · 1 个',{exact:true}).click();
 await page.getByRole('img',{name:'附件 1',exact:true}).waitFor();
 console.log('PASS native tool response, steering queue, durable answer-only retry and no duplicate weight');

 const tomorrow=addDays(today,1);
 await page.evaluate(async({tomorrow})=>{
  const storage=await import('/health/storage.mjs'),core=await import('/health/core.mjs');
  const state=await storage.readState(),amounts=[246,110];
  for(const [index,amount] of amounts.entries())core.addFood(state,{date:tomorrow,name:'合成计划'+index,meal:'晚餐',
   status:'plan',amount,amountUnit:'g',kcal:amount,protein:20,carbs:30,fat:15,sodium:60});
  await storage.saveState(state,state.revision);
 },{tomorrow});
 await page.goto(origin+'/health/');
 const select=page.getByRole('button',{name:'选择计划',exact:true});
 await select.click();
 await page.getByRole('button',{name:'全选本月计划',exact:true}).click();
 await page.getByRole('button',{name:'删除 2 项计划',exact:true}).click();
 await page.getByText('已删除 2 项计划',{exact:true}).waitFor();
 await page.getByRole('button',{name:'撤销计划删除',exact:true}).click();
 await page.getByText('已撤销计划删除',{exact:true}).waitFor();
 await page.getByText('实际、计划与预计全天',{exact:true}).click();
 await page.getByText(/热量 356\.0 kcal.*蛋白 40\.0 g/).first().waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS full plan nutrition, per-day projection and batch plan deletion with undo');
}finally{await browser?.close();server.close();}
