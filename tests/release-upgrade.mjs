import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname} from 'node:path';
import {chromium} from 'playwright-core';
import {assistantFixture,action,proposal} from './health-action-fixture.mjs';
import {orderFinance} from './order-agent-fixture.mjs';
import {lab,syntheticPdf} from './medical-fixture.mjs';

const baseRevision='913d287',date='2034-05-06';
const assets=source=>new Set(['sw.js',...Array.from(source.split('const assets')[0].matchAll(/'\.\/([^']+)'/g),match=>match[1])]);
const oldSource=execFileSync('git',['show',baseRevision+':sw.js'],{encoding:'utf8'});
const oldAssets=assets(oldSource),newAssets=assets(readFileSync('sw.js','utf8'));
const previous=new Map();
let upgrading=false,browser;
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png',
 '.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
 let file=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!file||file.endsWith('/'))file+='index.html';
 if(!(upgrading?newAssets:oldAssets).has(file))return res.writeHead(404).end();
 try{
  if(!upgrading&&!previous.has(file))previous.set(file,execFileSync('git',['show',baseRevision+':'+file],{stdio:['ignore','pipe','ignore']}));
  res.writeHead(200,{'Content-Type':mime[extname(file)]??'text/plain','Cache-Control':'no-store'})
   .end(upgrading?readFileSync(file):previous.get(file));
 }catch{return res.writeHead(404).end();}
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const contextOptions={viewport:{width:390,height:844},isMobile:true,hasTouch:true};
const keyFixture='sk-synthetic-release-check-only';
const checkpoint='补记2034年5月6日晨重72公斤';
const fixture={state:assistantFixture(date),finance:orderFinance(date),pdf:syntheticPdf(),
 report:{date,institution:'合成体检机构',measurements:[lab()]},checkpoint,
 plan:proposal(action('weight',checkpoint,{date,kg:72,morning:'yes'})),date,keyFixture};
const snapshot=()=>({keys:Object.fromEntries([
 'airplane-pwa-v1','airplane-pwa-recovery-v1','airplane-ai-conversations-v1','airplane-ai-memory-v1','airplane-ai-skills-v2'
].map(key=>[key,localStorage.getItem(key)]))});
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 const old=await browser.newContext(contextOptions);
 // A recovery regression must never fall through to a network write.
 let apiCalls=0;
 await old.route('https://api.openai.com/**',route=>{apiCalls++;return route.abort();});
 const page=await old.newPage();
 await page.goto(origin+'/assistant/');
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
 assert.equal(await page.evaluate(async()=> (await import('/shell.mjs')).APP_VERSION),'0.9.27');
 const original=await page.evaluate(async fixture=>{
  const storage=await import('/health/storage.mjs'),finance=await import('/finance-storage.mjs');
  const medical=await import('/health/medical.mjs');
  const pdf=await medical.makeMedicalAttachment(new File([fixture.pdf],'synthetic.pdf',{type:'application/pdf'}));
  medical.saveMedicalReport(fixture.state,fixture.report,[pdf]);
  const health=await storage.saveState(fixture.state,0);
  finance.replaceFinance(localStorage,fixture.finance,finance.readFinance(localStorage).primary);
  const {memoryLibrary,MEMORY_KEY}=await import('/ai/memory.mjs');
  memoryLibrary(localStorage).prepare(null,{name:'发布验收偏好',text:'合成说明',kind:'habit'},'add').commit();
  const {SKILLS_KEY}=await import('/ai/skills.mjs');
  localStorage.setItem(SKILLS_KEY,JSON.stringify({runtime:{meals:false},personal:[{id:'upgrade-skill',name:'合成流程',text:'原文',enabled:true}]}));
  const {setHealthAuto}=await import('/ai/health-actions.mjs');setHealthAuto(localStorage,true);
  const {importKey}=await import('/ai/keys.mjs');await importKey(fixture.keyFixture);
  const {saveChatModel}=await import('/ai/models.mjs');saveChatModel(localStorage,'gpt-6-luna');
  const {threadBook,THREADS_KEY}=await import('/ai/threads.mjs'),book=threadBook(localStorage);
  const {identifyAttachments}=await import('/ai/conversation-evidence.mjs'),{taskJournal}=await import('/ai/task-log.mjs');
  const journal=taskJournal(globalThis.airplaneAccount);
  const image_url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfkAAAAASUVORK5CYII=';
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(image_url));
  const key=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  const {files,group}=identifyAttachments([{key,input:{type:'input_image',image_url}}],'media:upgrade');
  await journal.saveRun({id:group.id,attachments:files});
  book.append('user','合成历史消息',true,null,{id:'upgrade-message',attachmentGroup:group});
  book.append('assistant','合成历史回复');
  book.start();
  const pending=book.begin(fixture.checkpoint,{text:fixture.checkpoint,date:fixture.date,healthClock:'07:30',hasPhoto:false,allowRead:true});
  book.stageHealth(pending,fixture.plan);
  book.checkpoint(pending,'旧版已生成待续跑的候选');
  const {exportAiArchive}=await import('/ai/archive.mjs'),{combinedBackup}=await import('/health/backup.mjs');
  return {keys:Object.fromEntries([finance.STORAGE_KEY,finance.RECOVERY_KEY,MEMORY_KEY,SKILLS_KEY,THREADS_KEY].map(key=>[key,localStorage.getItem(key)])),
   health,media:await journal.readRun(group.id),archive:combinedBackup(health,fixture.finance,await exportAiArchive(globalThis.airplaneAccount))};
 },fixture);
 upgrading=true;
 await page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.ready;
  await registration.update();
  const end=Date.now()+12000;
  while(!registration.waiting&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,30));
  if(!registration.waiting)throw Error('新版 Service Worker 未进入待激活状态');
  const active=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  registration.waiting.postMessage({type:'SKIP_WAITING'});
  await active;
 });
 await old.setOffline(true);
 await page.goto(origin+'/assistant/');
 assert.equal(await page.evaluate(async()=> (await import('/shell.mjs')).APP_VERSION),'1.0.0-rc.1');
 assert.deepEqual((await page.evaluate(snapshot)).keys,original.keys);
 assert.equal(await page.evaluate(async()=> (await import('/ai/models.mjs')).readChatModel().id),'gpt-6-luna');
 assert.equal(await page.evaluate(async()=> (await import('/ai/keys.mjs')).readKey()),keyFixture);
 assert.equal(JSON.stringify(original.archive).includes(keyFixture),false);
 assert.deepEqual(await page.evaluate(async()=> (await import('/health/storage.mjs')).readState()),original.health);
 assert.deepEqual(await page.evaluate(async()=> (await import('/ai/task-log.mjs')).taskJournal(globalThis.airplaneAccount).readRun('media:upgrade')),original.media);
 assert.deepEqual(await page.evaluate(async()=> (await caches.keys()).filter(key=>key.startsWith('airplane-shell:'))),['airplane-shell:/:96']);
 await page.getByRole('button',{name:'重试这条消息'}).click();
 await page.getByText(/已保存。晨重 72 kg/).waitFor();
 assert.equal(apiCalls,0);
 await page.getByRole('button',{name:'撤销这次记录'}).last().click();
 await page.getByRole('button',{name:'已撤销这次健康记录。'}).waitFor();
 const offlineState=await page.evaluate(async()=> (await import('/health/storage.mjs')).readState());
 assert.deepEqual(offlineState.local.weights,original.health.local.weights);
 assert.deepEqual(offlineState.local.medical,original.health.local.medical);
 for(const path of ['/','/health/']){
  const response=await page.goto(origin+path);
  assert.equal(response.status(),200);
  assert.equal(await page.evaluate(async()=> (await import('/shell.mjs')).APP_VERSION),'1.0.0-rc.1');
 }
 assert.equal((await page.evaluate(snapshot)).keys['airplane-pwa-v1'],original.keys['airplane-pwa-v1']);
 console.log('PASS actual 0.9.27 → rc.1 offline shell upgrade preserves ledgers, attachment bytes, memories, Skills, history and staged legacy retry/undo');

 const recovered=await browser.newContext(contextOptions);
 const copy=await recovered.newPage();
 await copy.goto(origin+'/assistant/');
 const restored=await copy.evaluate(async archive=>{
  const {unpackBackup,restoreBackup}=await import('/health/backup.mjs'),{readState,readRestoreSnapshot}=await import('/health/storage.mjs');
  const {readFinance}=await import('/finance-storage.mjs'),account=globalThis.airplaneAccount;
  const before=await readState(),parsed=unpackBackup(archive);
  await restoreBackup(before,{...parsed,financeRevision:readFinance(account.finance).primary},account,()=>{});
  const health=await readState(),{exportAiArchive}=await import('/ai/archive.mjs'),ai=await exportAiArchive(account);
  return {health,finance:readFinance(account.finance).payload,ai,snapshot:await readRestoreSnapshot(account)};
 },original.archive);
 assert.deepEqual(restored.finance,JSON.parse(original.keys['airplane-pwa-v1']));
 assert.deepEqual(restored.health.local,original.health.local);
 assert.deepEqual(restored.health.settings,original.health.settings);
 assert.deepEqual(restored.ai.media,original.archive.ai.media);
 assert.deepEqual(restored.ai.habits,original.archive.ai.habits);
 assert.deepEqual(restored.ai.skills,original.archive.ai.skills);
 assert.ok(restored.ai.threads.some(thread=>thread.messages.some(row=>row.text==='合成历史回复')));
 assert.ok(restored.snapshot.health);
 console.log('PASS combined backup from 0.9.27 restores financial and health data, attachment bytes, Skills, memories and chat history on a fresh profile');
}finally{await browser?.close();server.close();}
