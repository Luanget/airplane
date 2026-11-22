import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {extname} from 'node:path';
import {ownerFixture,changes,edit} from './owner-fixture.mjs';
import {readFinance} from '../finance-storage.mjs';

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
const fake=(...out)=>({status:'completed',output:out});
const call=(name,id,args)=>({type:'function_call',name,id:'fc_'+id,call_id:id,arguments:JSON.stringify(args)});
const answer=text=>({type:'message',role:'assistant',content:[{type:'output_text',text}]});
const seed=ownerFixture(),finance=readFinance(seed.finance).payload;
const request=changes(edit('transactions','old-expense','update',{amountAdjustment:{gross:39.67,refund:.07}}),
 edit('inventory','egg','update',{quantity:30,unit:'个'}));
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 const ctx=await browser.newContext({viewport:{width:390,height:660},isMobile:true,hasTouch:true,colorScheme:'dark'});
 const page=await ctx.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await ctx.route('https://api.openai.com/v1/responses',async route=>{
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  const body=route.request().postDataJSON(),last=body.input.at(-1);
  assert.ok(body.tools.some(row=>row.name==='mutate_records'));
  const reply=last.call_id?(assert.equal(JSON.parse(last.output).status,'saved'),fake(answer('已将原支出改成39.60元，鸡蛋盘点为30个。'))):
   fake(call('mutate_records','update',request));
  await route.fulfill({headers,json:reply});
 });
 await page.goto(origin+'/assistant/');
 await page.waitForFunction(()=>typeof document.querySelector('.chat-composer')?.onsubmit==='function');
 await page.evaluate(async({health,finance})=>{
  await (await import('/ai/keys.mjs')).importKey('sk-synthetic-owner-browser-only');
  const {replaceFinance}=await import('/finance-storage.mjs');
  replaceFinance(localStorage,finance,null);
  await (await import('/health/storage.mjs')).saveState(health,0);
  (await import('/ai/documents.mjs')).setDocumentAccess(localStorage,true);
 },{health:seed.state,finance});
 await page.reload();
 await page.getByText('所有者完全控制已开启',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'消息'}).fill('按净额更正原账，顺便把鸡蛋换成按个盘点。');
 await page.locator('.chat-composer').getByRole('button',{name:'发送',exact:true}).click();
 await page.getByText('已将原支出改成39.60元，鸡蛋盘点为30个。',{exact:true}).waitFor();
 const details=page.locator('.execution-details').last();
 await details.locator('summary').first().click();
 await details.getByText('mutate_records · 已保存',{exact:true}).waitFor();
 const state=()=>page.evaluate(async()=>{
  const {readState,readPurchaseUpdate}=await import('/health/storage.mjs'),{readFinance}=await import('/finance-storage.mjs');
  const {inventoryWithMoves}=await import('/health/core.mjs'),health=await readState();
  return {pending:!!(await readPurchaseUpdate()),revision:health.revision,
   qty:inventoryWithMoves(health).find(row=>row.id==='egg').qty,amount:readFinance(localStorage).payload.transactions[0].amount};
 });
 assert.deepEqual(await state(),{pending:false,revision:2,qty:30,amount:39.6});
 const undo=page.getByRole('button',{name:/撤销/}).last();
 await undo.click();
 await page.getByText('已撤销这次修改。',{exact:true}).waitFor();
 assert.deepEqual(await state(),{pending:false,revision:3,qty:1800,amount:39.67});
 console.log('PASS native owner tools, 390px dark PWA, execution details, verified multi-ledger undo');

 const interrupt=async(mode)=>page.evaluate(async({request,mode})=>{
  const {createOwnerData}=await import('/ai/owner.mjs'),{localWorkspace}=await import('/ai/workspace.mjs');
  const {setDocumentAccess}=await import('/ai/documents.mjs');
  const owner=createOwnerData(localWorkspace()),id='browser-'+mode;
  setDocumentAccess(localStorage,true);
  const context={operationId:id,run:{allowRead:true,id,date:'2026-11-21',userSources:[]}};
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){
   if(this.name==='kv'&&key==='main')throw Error('synthetic health commit interruption');
   return put.call(this,value,key);
  };
  try{await owner.mutate(request,context);throw Error('expected interruption');}
  catch(error){if(!error.message.includes('待恢复'))throw error;}
  finally{IDBObjectStore.prototype.put=put;}
 },{mode,request});
 await interrupt('resume');
 assert.deepEqual(await state(),{pending:true,revision:3,qty:1800,amount:39.6});
 await page.reload();
 await page.waitForFunction(async()=>!(await (await import('/health/storage.mjs')).readPurchaseUpdate()));
 assert.deepEqual(await state(),{pending:false,revision:4,qty:30,amount:39.6});
 const retry=await page.evaluate(async request=>{
  const {createOwnerData}=await import('/ai/owner.mjs'),{localWorkspace}=await import('/ai/workspace.mjs');
  return createOwnerData(localWorkspace()).mutate(request,{operationId:'browser-resume',run:{allowRead:true,id:'browser-resume',date:'2026-11-21'}});
 },request);
 assert.ok(retry.replayed);
 assert.deepEqual(await state(),{pending:false,revision:4,qty:30,amount:39.6});

 const other=changes(edit('transactions','old-expense','update',{amount:38}),
  edit('inventory','egg','update',{quantity:28,unit:'个'}));
 await page.evaluate(async request=>{
  const {createOwnerData}=await import('/ai/owner.mjs'),{localWorkspace}=await import('/ai/workspace.mjs');
  const put=IDBObjectStore.prototype.put,id='browser-cancel';
  IDBObjectStore.prototype.put=function(value,key){if(key==='main')throw Error('synthetic fault');return put.call(this,value,key);};
  try{await createOwnerData(localWorkspace()).mutate(request,{operationId:id,run:{allowRead:true,id,date:'2026-11-21'}});}
  catch(error){if(!error.message.includes('待恢复'))throw error;}
  finally{IDBObjectStore.prototype.put=put;}
 },other);
 assert.deepEqual(await state(),{pending:true,revision:4,qty:30,amount:38});
 await page.evaluate(async()=>(await import('/health/purchase-sync.mjs')).abandonPurchaseUpdate({finance:localStorage}));
 assert.deepEqual(await state(),{pending:false,revision:4,qty:30,amount:39.6});
 assert.deepEqual(errors,[]);
 console.log('PASS real IndexedDB interruption, automatic reload recovery, retry without duplicate, and compensating rollback');
}finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
}
