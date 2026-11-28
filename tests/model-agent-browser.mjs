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
const parameterError='合成测试：查询今天的支出';
const needsReview='帮我记录下午体重73.0kg';
const stockMessage='用刚才的照片，采购入库合成小青菜三份，每份500g，价格未知。';
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 const ctx=await browser.newContext({viewport:{width:390,height:650},isMobile:true,hasTouch:true});
 const page=await ctx.newPage();
 page.setDefaultTimeout(10000);
 let requested=0,failed=false,replayRejected=false,release,firstStarted,stockLabel,expectedModel='gpt-6.1-terra';
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
  assert.equal(body.model,expectedModel);
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
   assert.equal(replayRejected,false);
   replayRejected=true;
   await route.fulfill({status:400,headers:{...headers,'Access-Control-Expose-Headers':'x-request-id','x-request-id':'req_replay_regression'},
    json:{error:{type:'invalid_request_error',param:'input[4].encrypted_content',code:'invalid_encrypted_content',message:'Encrypted content could not be verified.'}}});
   return;
  }else if(last.content?.[0]?.text?.startsWith('应用执行回执')&&body.tool_choice==='none'){
   assert.equal(replayRejected,true);
   assert.equal(body.input.some(row=>row.type==='reasoning'||row.call_id),false);
   assert.ok(body.input.some(row=>row.content?.[0]?.text===correction));
   const receipt=JSON.parse(last.content[0].text.slice(last.content[0].text.indexOf('：')+1));
   assert.equal(receipt.callId,'corrected');
   assert.equal(receipt.result.status,'saved');
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
  }else if(last.content?.[0]?.text===parameterError){
   reply=output(call('read_ledger','parameter-check',{scope:'balance',query:''}));
  }else if(last.call_id==='parameter-check'){
   await route.fulfill({status:400,headers,json:{error:{code:'invalid_json_schema',param:'tools[0].parameters',
    message:'Synthetic provider diagnostic must not be displayed.'}}});return;
  }else if(last.content?.[0]?.text===needsReview){
   reply=output(call('write_health','review',proposal(action('weight',needsReview,{kg:73,morning:'no'}))));
  }else if(last.call_id==='review'){
   assert.equal(JSON.parse(last.output).status,'review');
   reply=output(answer('下午体重73.0公斤待确认。'));
  }else if(String(last.content).includes('客户端跳过了待确认操作')){
   assert.equal(body.tool_choice,'none');
   reply=output(answer('已跳过73.0公斤这项，未新增记录。'));
  }else if(last.content?.[0]?.text===stockMessage){
   assert.ok(!body.input.some(row=>Array.isArray(row.content)&&row.content.some(part=>part.type==='input_image')));
   reply=output(call('read_conversation_evidence','catalog',{attachmentIds:[],limit:8}));
  }else if(last.call_id==='catalog'){
   const info=JSON.parse(last.output).data;
   stockLabel=info.attachments.find(row=>row.state==='local').id;
   reply=output(call('read_conversation_evidence','label',{attachmentIds:[stockLabel],limit:8}));
  }else if(Array.isArray(last.content)&&last.content[0]?.text.includes('应用按请求提供')){
   assert.ok(last.content[0].text.includes(stockLabel));
   assert.ok(last.content.some(row=>row.type==='input_image'));
   const roster=JSON.parse(body.instructions.split('本对话用户消息 ID（附短索引）：')[1].split('\n')[0]);
   reply=output(call('receive_inventory','stock',{date:null,sources:[{kind:'message',id:roster.at(-1).id,note:null},
    {kind:'attachment',id:stockLabel,note:null}],note:'合成蔬菜',lines:[{name:'合成小青菜',skuId:'fixture-greens',amount:3,unit:'份',
     packAmount:null,packUnit:null,cost:null,label:null,portions:Array.from({length:3},()=>({amount:500,unit:'g',status:'sealed',gross:null}))}]}));
  }else if(last.call_id==='stock'){
   assert.equal(JSON.parse(last.output).status,'saved');
   reply=output(answer('合成小青菜已入库三份，每份500g，金额未知。'));
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
 const queued=page.locator('[data-queued-job]').filter({hasText:independent});
 await queued.waitFor();await queued.getByText('待处理',{exact:true}).waitFor();
 release();
 await page.getByRole('button',{name:'仅重试回复'}).waitFor();
 const weights=()=>page.evaluate(async()=> (await (await import('/health/storage.mjs')).readState()).local.weights.map(row=>row.kg));
 assert.deepEqual(await weights(),[72.6]);
 await page.reload();
 await queued.getByText('待处理',{exact:true}).waitFor();
 await page.getByRole('button',{name:'仅重试回复'}).click();
 await page.getByText('晨重已按你的补充记录为72.6公斤。',{exact:true}).waitFor();
 await page.getByText('查询的本机余额是0元。',{exact:true}).waitFor();
 assert.deepEqual(await weights(),[72.6]);
 assert.equal(requested,7);
 const recovered=page.locator('.execution-details').filter({hasText:'执行详情'}).first();
 await recovered.locator(':scope > summary').click();
 await recovered.getByText('已尝试从保存的执行回执恢复请求。',{exact:true}).waitFor();
 const rejection=recovered.getByText('API 请求错误',{exact:true});
 await rejection.click();
 await recovered.getByText(/req_replay_regression/).waitFor();
 assert.equal(await page.locator('[data-queued-job]').count(),0);
 assert.equal(await page.locator('.chat-bubble.user').filter({hasText:independent}).count(),1);
 await page.evaluate(async()=>{
  (await import('/ai/health-actions.mjs')).setHealthAuto(localStorage,false);
  (await import('/ai/models.mjs')).saveChatModel(localStorage,'gpt-6-luna');
 });
 expectedModel='gpt-6-luna';
 await say(needsReview);
 await page.getByRole('button',{name:'跳过此项'}).click();
 await page.getByText('已跳过73.0公斤这项，未新增记录。',{exact:true}).waitFor();
 assert.deepEqual(await weights(),[72.6]);
 await page.reload();
 await page.getByText('本轮附件 · 1 个',{exact:true}).click();
 await page.getByRole('img',{name:'附件 1',exact:true}).waitFor();
 console.log('PASS visible queue before execution, persisted attachments, steering, default Terra and manual Luna, resumed HTTP 400 without duplicate writes');

 await page.evaluate(async()=>{
  (await import('/ai/health-actions.mjs')).setHealthAuto(localStorage,true);
  (await import('/ai/models.mjs')).saveChatModel(localStorage,'auto');
 });
 expectedModel='gpt-6.1-terra';
 await say(stockMessage);
 await page.getByText('合成小青菜已入库三份，每份500g，金额未知。',{exact:true}).waitFor();
 const execution=page.locator('.execution-details').last();
 await execution.locator(':scope > summary').click();
 await execution.getByText('receive_inventory · 已保存',{exact:true}).waitFor();
 await execution.getByText(/已发给模型.*本机可用/).waitFor();
 await execution.getByText(/gpt-6.1-terra/).waitFor();
 if(process.env.AIRPLANE_AUDIT_SCREENSHOT){
  await page.setViewportSize({width:390,height:880});
  await page.locator('.chat-thread').evaluate(element=>element.scrollTop=element.scrollHeight);
  await page.screenshot({path:process.env.AIRPLANE_AUDIT_SCREENSHOT});
 }
 await page.getByRole('button',{name:'打开设置',exact:true}).click();
 const tasks=page.locator('[data-task-settings]');
 await tasks.locator(':scope > summary').click();
 const download=page.waitForEvent('download');
 await tasks.getByRole('button',{name:'导出当前对话和附件'}).click();
 const auditArchive=await (await download).path();
 const restored=await browser.newContext({viewport:{width:390,height:650}});
 try{
  const copy=await restored.newPage();
  await copy.goto(origin+'/assistant/');
  await copy.getByRole('button',{name:'打开设置',exact:true}).click();
  const importBackup=()=>copy.locator('[data-conversation-file]').setInputFiles(auditArchive);
  await importBackup();await copy.getByText('合成小青菜已入库三份，每份500g，金额未知。',{exact:true}).waitFor();
  await copy.getByText('本轮附件 · 1 个',{exact:true}).click();await copy.getByRole('img',{name:'附件 1'}).waitFor();
  await copy.getByRole('button',{name:'打开设置',exact:true}).click();await importBackup();
  await copy.getByText('已恢复 0 个对话。',{exact:true}).waitFor();
  assert.equal(await copy.evaluate(async()=> (await (await import('/health/storage.mjs')).readState()).local.purchases?.length??0),0);
  assert.equal(await copy.getByText('合成小青菜已入库三份，每份500g，金额未知。',{exact:true}).count(),1);
 }finally{await restored.close();}
 console.log('PASS historical attachment use, visible tool audit, conversation and attachment restore without write replay');

 const skillArchive=await page.evaluate(async()=>{
  const {SKILLS_KEY}=await import('/ai/skills.mjs');
  const {combinedBackup}=await import('/health/backup.mjs'),{exportAiArchive}=await import('/ai/archive.mjs');
  const account=globalThis.airplaneAccount;
  account.finance.setItem(SKILLS_KEY,JSON.stringify({
   runtime:{weighing:false,meals:false},
   overrides:{meals:{steps:'优先用带标签的待验食品',output:'逐项列出'}},
   personal:[{id:'custom-plan',name:'合成个人配餐流程',text:'先检查冰箱',enabled:true}]
  }));
  return combinedBackup(null,null,await exportAiArchive(account,{attachments:false}));
 });
 const skillCopy=await browser.newContext();
 try{
  const copy=await skillCopy.newPage();
  await copy.goto(origin+'/assistant/');
  const result=await copy.evaluate(async archive=>{
   const {restoreBackup,unpackBackup}=await import('/health/backup.mjs');
   const {SKILLS_KEY,skillCatalog}=await import('/ai/skills.mjs'),account=globalThis.airplaneAccount;
   account.finance.setItem(SKILLS_KEY,JSON.stringify({overrides:{meals:{output:'新设备上已改'}}}));
   await restoreBackup(null,unpackBackup(archive),account);
   const {createAgentTools}=await import('/ai/agent-tools.mjs');
   const tools=createAgentTools({finance:account.finance});
   const custom=await tools('load_skill',{id:'custom-plan'},{run:{allowRead:true}});
   const meals=skillCatalog(account.finance).find(row=>row.id==='meals');
   return {custom:custom.data.steps,steps:meals.steps,output:meals.output,active:meals.enabled,version:meals.version};
  },skillArchive);
  assert.deepEqual(result,{custom:'先检查冰箱',steps:'优先用带标签的待验食品',output:'新设备上已改',active:false,version:2});
 }finally{await skillCopy.close();}
 console.log('PASS combined backup restores custom Skill, enabled state and partial overrides');

 await page.reload();
 await page.waitForFunction(()=>typeof document.querySelector('.chat-composer')?.onsubmit==='function');
 const beforeError=requested;
 await say(parameterError);
 const apiStatus=page.locator('[data-status]');
 await apiStatus.filter({hasText:'参数 tools[0].parameters'}).waitFor();
 assert.match(await apiStatus.textContent(),/invalid_json_schema/);
 assert.doesNotMatch(await apiStatus.textContent(),/Synthetic provider diagnostic/);
 assert.equal(requested,beforeError+2);
 assert.deepEqual(await weights(),[72.6]);
 console.log('PASS unrelated HTTP 400 reports a safe parameter and error code without replaying the request');


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
 await page.locator('[data-plan-day="'+tomorrow+'"]').locator('summary').click();
 await page.getByText(/热量 356\.0 kcal.*蛋白 40\.0 g/).first().waitFor();
 await page.getByRole('button',{name:'后一天',exact:true}).click();
 assert.equal(await page.locator('#hero-calorie-label').textContent(),'计划热量');
 for(const [id,value] of Object.entries({'hero-calories':'356.0','protein-stat':'40.0 g','fat-stat':'30.0 g','carbs-stat':'60.0 g','sodium-stat':'120.0 mg'}))
  assert.equal(await page.locator('#'+id).textContent(),value);
 assert.deepEqual(errors,[]);
 console.log('PASS future top-level nutrition with all five fields and batch plan deletion with undo');
 await page.evaluate(async today=>{
  const {readState,saveState}=await import('/health/storage.mjs'),{addFood}=await import('/health/core.mjs');
  const state=await readState();
  for(const [name,kcal,status] of [['荞麦面',220,'plan'],['鸡蛋',75,'plan'],['青菜',36,'plan'],['鸡蛋',75,'actual']])
   addFood(state,{date:today,name,meal:'晚餐',status,amount:1,amountUnit:'份',kcal,protein:10,carbs:20,fat:3,sodium:60});
  await saveState(state,state.revision);
 },today);
 await page.reload();
 await page.locator('#hero-calories').filter({hasText:'75.0'}).waitFor();
 await page.getByText('剩余计划 256.0 kcal · 预计全天 331.0 kcal',{exact:true}).click();
 await page.locator('#overview-plan-values').getByText(/热量 331\.0 kcal.*蛋白 30\.0 g/).waitFor();
 await page.getByRole('button',{name:/鸡蛋 已执行/}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS today shows actual 75, remaining 256 and projected 331 kcal after one item is eaten');
}finally{await browser?.close();server.close();}
