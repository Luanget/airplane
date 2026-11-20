// Run from a full clone. This upgrades the actual 0.7.23 shell on one origin.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright-core');

const root=process.cwd(), prefix='/airplane/';
const publicAssets=new Set(['sw.js',...Array.from(readFileSync('sw.js','utf8').split('const assets')[0].matchAll(/'\.\/([^']+)'/g),m=>m[1])]);
let old=true;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  let name=path.slice(prefix.length);
  if (name.endsWith('/') || !name) name+='index.html';
  if (!path.startsWith(prefix) || !publicAssets.has(name)) {res.writeHead(404).end();return;}
  try {
    const buf=old ? execFileSync('git',['show','6fb5f50:'+name],{stdio:['ignore','pipe','ignore']}) : readFileSync(resolve(root,name));
    const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
    res.writeHead(200,{'Content-Type':mime[extname(name)] || 'text/plain','Cache-Control':'no-store'}).end(buf);
  } catch {res.writeHead(404).end();}
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const base='http://127.0.0.1:'+server.address().port+prefix;
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || ['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  page.setDefaultTimeout(10000);
  const errors=[]; page.on('pageerror',err=>errors.push(String(err)));
  page.on('dialog',dialog=>dialog.accept());
  await page.goto(base);
  await page.locator('[data-action="budget"]').first().click();
  await page.locator('#budgetInput').fill('1234');
  await page.locator('#modalSave').click();
  await page.locator('#addButton').click();
  await page.locator('#txAmount').fill('12.34');
  await page.locator('#txNote').fill('synthetic legacy entry');
  await page.locator('#txSubmit').click();
  const ledger=()=>page.evaluate(()=>localStorage.getItem('airplane-pwa-v1'));
  // Let 0.7.23 apply its own first-relaunch defaults before comparing bytes.
  await page.reload();await page.getByText('synthetic legacy entry',{exact:true}).waitFor();
  const before=await ledger();
  assert.equal(JSON.parse(before).transactions[0].amount,12.34);
  assert.ok(Object.values(JSON.parse(before).budgets).includes(1234));
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;await caches.open('another-app');});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  old=false;
  await page.evaluate(async()=>{await (await navigator.serviceWorker.ready).update();});
  await page.locator('.update-banner-action').waitFor();
  assert.equal(await page.locator('[data-account]').count(),0);
  await page.locator('.update-banner-action').click();
  await page.locator('[data-account]').waitFor();
  assert.equal(await ledger(),before);
  assert.equal(await page.evaluate(()=>localStorage.getItem('airplane-pwa-recovery-v1')),before);
  await page.locator('#settingsButton').click();
  const downloading=page.waitForEvent('download');
  await page.locator('[data-action="export-json"]').click();
  const backup=JSON.parse(readFileSync(await (await downloading).path(),'utf8'));
  assert.deepEqual(backup.data,JSON.parse(before));
  await page.locator('#importInput').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(()=>localStorage.getItem('airplane-pre-restore-v1'));
  assert.deepEqual(JSON.parse(await ledger()),backup.data);
  console.log('PASS old finance budget, transaction, backup/restore and user-approved PWA upgrade');

  await ctx.setOffline(true);
  await page.goto(base+'health/?test=offline');
  await page.locator('#health-settings').click();
  const synthetic={tables:{food_events:[],weight_events:[],food_inventory:[{'食品ID':'fixture','名称':'合成库存','库存值':5,'库存单位':'包','标准份量':'每包','kcal':100}]}};
  await page.locator('#import-file').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synthetic))});
  await page.locator('#health-settings-sheet').waitFor({state:'hidden'});
  await page.locator('#health-settings').click();
  const revision=()=>page.evaluate(async()=> (await (await import('./storage.mjs')).readState()).revision);
  const importedRevision=await revision();
  await page.locator('#import-file').setInputFiles({name:'same.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synthetic))});
  await page.locator('#toast').getByText('这份主账已导入').waitFor();
  assert.equal(await revision(),importedRevision);
  await page.locator('#health-settings-sheet [data-sheet-close]').click();
  await page.locator('[data-tab="record"]').click();
  await page.locator('#add-health').click();
  const manual=page.locator('#food-form');
  await manual.locator('[name=foodId]').selectOption('fixture');
  await manual.locator('[name=status]').selectOption('plan');
  await manual.locator('[type=submit]').click();
  await page.locator('#local-events').getByText('合成库存',{exact:true}).waitFor();
  const quantity=()=>page.evaluate(async()=>{
    const {readState}=await import('./storage.mjs'),{inventoryWithMoves}=await import('./core.mjs');
    return inventoryWithMoves(await readState())[0].qty;
  });
  assert.equal(await quantity(),5);
  await page.locator('#local-events').getByRole('button',{name:'编辑'}).click();
  await manual.locator('[name=status]').selectOption('actual');
  await manual.locator('[type=submit]').click();
  await page.locator('#toast').getByText('饮食已保存').waitFor();
  assert.equal(await quantity(),4);
  await page.locator('[data-tab="inventory"]').click();
  await page.locator('#inventory-list').getByText('合成库存',{exact:true}).waitFor();
  await page.reload();await page.locator('[data-tab="inventory"]').click();
  await page.locator('#inventory-list').getByText('合成库存',{exact:true}).waitFor();
  await page.locator('#health-settings').click();
  const healthDownload=page.waitForEvent('download');
  await page.locator('#export-button').click();
  const healthCopy=JSON.parse(readFileSync(await (await healthDownload).path(),'utf8'));
  assert.equal(healthCopy.legacy.inventory[0].id,'fixture');
  await page.locator('#restore-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"appType":"airplane-health-v1"}')});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('导入失败'));
  await page.locator('#restore-file').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(healthCopy))});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('恢复成功'));
  assert.equal(await ledger(),before);
  const cacheNames=await page.evaluate(()=>caches.keys());
  assert.ok(cacheNames.includes('another-app'));
  assert.ok(!cacheNames.some(k=>/^airplane-shell-v\d+$/.test(k)));
  await page.goto(base);
  await page.getByText('synthetic legacy entry',{exact:true}).waitFor();
  console.log('PASS separate offline routes, local import, health persisted across reload');
  const codes=[randomBytes(32).toString('hex'),randomBytes(32).toString('hex')];
  async function unlock(url,code) {
    await page.goto(url+'?private=1');await page.locator('#account-gate input').fill(code);
    await page.locator('#account-gate button').click();
    await page.locator('[data-shell]').waitFor();
  }
  await unlock(base,codes[0]); assert.equal(await page.getByText('synthetic legacy entry').count(),0);
  await page.locator('#addButton').click();await page.locator('#txAmount').fill('5');
  await page.locator('#txNote').fill('private synthetic');await page.locator('#txSubmit').click();
  await unlock(base,codes[1]);assert.equal(await page.getByText('private synthetic').count(),0);
  await unlock(base,codes[0]);await page.getByText('private synthetic',{exact:true}).waitFor();
  assert.equal(await ledger(),before);
  await unlock(base+'health/',codes[0]);
  await page.locator('[data-tab="inventory"]').click();assert.equal(await page.locator('#inventory-list').getByText('合成库存',{exact:true}).count(),0);
  await ctx.setOffline(false);
  const calls=[];
  const testKey='sk-fixture-browser-only';
  const aiIcon=await page.locator('#open-health-ai svg').innerHTML();
  await ctx.route('https://api.openai.com/v1/responses',async route=>{
    const headers={'Access-Control-Allow-Origin':new URL(base).origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    assert.equal(route.request().headers().authorization,'Bearer '+testKey);
    const body=route.request().postDataJSON(),content=body.input[0].content;
    const input=JSON.parse(content[0].text);
    assert.deepEqual(Object.keys(input).sort(),input.mode==='finance'?['date','mode','text']:['mode','text']);
    calls.push({...input,photo:content[1]?.image_url});
    const item={sku:null,name:'合成餐点',action:input.mode==='plan'?'plan':'eat',amount:120,unit:'g',packageSize:null,packageUnit:null,
      basisAmount:100,basisUnit:'g',nutrients:{kcal:100,protein:10,carbs:10,fat:3,sodium:10},uncertainty:'合成测试估值',weighing:null};
    const parsed=input.mode==='finance' ? {note:'',entry:{type:'expense',amount:28,date:input.date,note:'午餐',categoryId:'餐饮'}} : {note:'供测试',items:[item]};
    await route.fulfill({json:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(parsed)}]}]},headers});
  });
  const access=page.locator('#ai-keys');
  async function importKey(fromFile=false){
    if(fromFile)await access.locator('[type=file]').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from(testKey)});
    else await access.locator('[name=key]').fill(testKey);
    await access.locator('[type=submit]').click();
    await access.waitFor({state:'hidden'});
  }
  await page.locator('#open-health-ai').click();
  await page.locator('#health-ai-sheet [data-ai-key]').click();
  await importKey(true);
  const form=page.locator('#assistant-form');
  await form.locator('textarea').fill('合成餐点');
  await form.locator('[type=submit]').click();
  await page.locator('#send-preview').waitFor();assert.equal(calls.length,0);
  await page.locator('#send-request').click();await page.locator('#candidate-list legend').waitFor();
  assert.equal(await page.locator('#local-events .event-row').count(),0);
  await page.locator('#candidate-list').getByLabel('数量',{exact:true}).fill('90');
  await page.locator('#candidate-form [type=submit]').click();
  await page.locator('[data-tab="record"]').click();await page.locator('#local-events .event-row').waitFor(); assert.equal(calls.length,1);
  await page.locator('[data-tab="overview"]').click();
  assert.equal(await page.locator('#hero-calories').textContent(),'90');
  await page.locator('#open-health-ai').click();await form.getByRole('combobox').selectOption('plan');
  await form.locator('textarea').fill('用我描述的合成蔬菜规划一餐');
  await form.locator('[type=submit]').click();await page.locator('#send-request').click();
  await page.locator('#candidate-list legend').waitFor();assert.equal(calls[1].text,'用我描述的合成蔬菜规划一餐');
  await page.locator('#candidate-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#candidate-form').hidden);
  await page.locator('#open-health-ai').click();await form.getByRole('combobox').selectOption('photo');
  const pixels=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=40;return c.toDataURL('image/png').split(',')[1];});
  await form.locator('[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(pixels,'base64')});
  await form.locator('[type=submit]').click();await page.locator('#send-image').waitFor();
  assert.equal(calls.length,2);await page.locator('#send-request').click();await page.locator('#candidate-list legend').waitFor();
  assert.ok(calls[2].photo.startsWith('data:image/jpeg;base64,/9j/'));await page.locator('#discard').click();await page.locator('#health-ai-sheet [data-sheet-close]').click();
  await page.locator('[data-tab="overview"]').click();assert.equal(await page.locator('#hero-calories').textContent(),'90');
  await unlock(base+'health/',codes[1]); assert.equal(await page.locator('#hero-calories').textContent(),'—');
  // Refuse malformed backups and detect stale writes in the actual IndexedDB.
  await page.evaluate(async()=>{
    const {readState,saveState}=await import('./storage.mjs');
    const state=await readState(), expected=state.revision??0;
    await saveState(state,expected);
    try {await saveState(state,expected);}catch(err){if(err.message.includes('其他页面'))return;}
    throw Error('stale write accepted');
  });
  await page.goto(base+'#model');
  await access.getByText('请导入 OpenAI API Key').waitFor();await importKey();
  assert.equal(await page.locator('#open-finance-ai svg').innerHTML(),aiIcon);
  await page.locator('#open-finance-ai').click();
  const finance=page.locator('#finance-assistant');
  await finance.locator('textarea').fill('午餐 28 元');await finance.locator('[type=submit]').click();
  await page.locator('#txSubmit').waitFor();
  assert.equal(await ledger(),before);assert.equal(await page.locator('#txAmount').inputValue(),'28');
  await page.locator('#txSubmit').click();assert.equal(JSON.parse(await ledger()).transactions.at(-1).amount,28);
  assert.equal(calls.at(-1).mode,'finance');
  await page.locator('#open-finance-ai').click();await finance.locator('[data-ai-key]').click();
  await access.locator('[data-remove]').click();await access.getByText('已移除本机 Key').waitFor();await access.locator('[data-close]').click();
  await finance.locator('textarea').fill('未授权的请求');await finance.locator('[type=submit]').click();
  await finance.getByText(/导入自己的密钥/).waitFor();
  assert.equal(calls.length,4);await finance.locator('[data-close]').click();

  // Start in finance, reuse the saved expense, then start a separate purchase in inventory.
  await page.locator('#addButton').click();await page.locator('#txAmount').fill('18');
  await page.locator('#txNote').fill('试验采购');
  await page.locator('#txTime').fill('18:05');
  assert.equal(await page.locator('#txTime').locator('..').locator('.calendar-value').textContent(),'18:05');
  await page.getByRole('button',{name:'保存食品支出并同步入库'}).click();
  const buy=page.locator('#purchase-form');
  await page.waitForFunction(()=>document.querySelector('#purchase-form [name=time]')?.value==='18:05');
  await buy.locator('[name=quantity]').fill('2');await buy.locator('[name=cost]').fill('18');
  await buy.locator('[type=submit]').click();
  await page.locator('#purchases-list').getByText(/已关联支出/).waitFor();
  const count=JSON.parse(await ledger()).transactions.length;
  await page.locator('#purchase-panel').evaluate(el=>el.open=true);
  await buy.locator('[name=total]').fill('6');await buy.locator('[name=quantity]').fill('1');
  await buy.locator('[name=createExpense]').check();await buy.locator('[type=submit]').click();
  await page.locator('#txSubmit').waitFor();
  const link=page.url();
  await page.locator('#txSubmit').click();
  await page.waitForFunction(expected=>JSON.parse(localStorage.getItem('airplane-pwa-v1')).transactions.length===expected,count+1);
  await page.goto(link);
  await page.getByText('这张采购订单已记账',{exact:true}).waitFor();
  assert.equal(JSON.parse(await ledger()).transactions.length,count+1);

  // Export both ledgers and restore the selected section.
  await page.goto(base+'health/');await page.locator('#health-settings').click();
  const combined=page.locator('#combined-backup');
  const bothDownload=page.waitForEvent('download');await combined.locator('[data-export]').click();
  const both=JSON.parse(readFileSync(await (await bothDownload).path(),'utf8'));
  assert.equal(both.finance.data.transactions.length,count+1);
  assert.equal(both.health.local.purchases.length,2);
  await combined.locator('[name=finance]').uncheck();
  await combined.locator('[type=file]').setInputFiles({name:'both.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(both))});
  await page.locator('#toast').getByText(/已恢复/).waitFor();
  assert.equal(JSON.parse(await ledger()).transactions.length,count+1);
  const edited=JSON.parse(await ledger());
  edited.transactions.pop();
  await page.evaluate(edited=>localStorage.setItem('airplane-pwa-v1',JSON.stringify(edited)),edited);
  await combined.locator('[name=finance]').check();
  await combined.locator('[type=file]').setInputFiles({name:'both.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(both))});
  await page.waitForFunction(expected=>JSON.parse(localStorage.getItem('airplane-pwa-v1')).transactions.length===expected,count+1);
  await page.locator('#health-settings-sheet [data-sheet-close]').click();
  await page.locator('[data-tab="inventory"]').click();
  const purchaseRow=amount=>page.locator('#purchases-list p').filter({hasText:'¥'+amount});
  await purchaseRow('6.00').getByRole('button',{name:'编辑采购'}).click();
  await buy.locator('[name=total]').fill('9');
  await buy.locator('[name=quantity]').fill('3');
  await buy.locator('[name=cost]').fill('9');
  await buy.locator('[type=submit]').click();
  await purchaseRow('9.00').filter({hasText:'已关联支出'}).waitFor();
  const afterEdit=JSON.parse(await ledger());
  assert.equal(afterEdit.transactions.length,count+1);
  assert.equal(afterEdit.transactions.find(t=>t.id.startsWith('expense-purchase-')).amount,9);
  assert.equal(await quantity(),9);

  // Simulate a failed financial write after the recovery record was persisted.
  await page.evaluate(async()=>{
    const account=window.airplaneAccount;
    const {readState,saveState,readPurchaseUpdate}=await import('./storage.mjs');
    const {revisePurchase,purchaseTransactionId}=await import('./purchases.mjs');
    const {projectedExpense,updatePurchaseLedgers}=await import('./purchase-sync.mjs');
    const state=await readState();
    const order=state.local.purchases.find(x=>x.totalCents===900);
    const tx=JSON.parse(account.finance.getItem('airplane-pwa-v1')).transactions.find(t=>t.id===purchaseTransactionId(order));
    const updated=revisePurchase(state,order.id,{...order,totalCents:1100,items:[{...order.items[0],costCents:1100}]});
    const failing={...account,finance:{getItem:k=>account.finance.getItem(k),setItem(){throw Error('synthetic storage failure');}}};
    try{await updatePurchaseLedgers(failing,updated.next,state.revision,projectedExpense(order,updated.order,tx));}
    catch(err){if(err.message!=='synthetic storage failure')throw err;}
    if(!(await readPurchaseUpdate(account)))throw Error('recovery journal missing');
    if((await readState()).local.purchases.find(x=>x.id===order.id).totalCents!==900)throw Error('pending edit appeared as committed');
    try{await saveState(state,state.revision,account);}
    catch(err){if(err.message.includes('待完成'))return;}
    throw Error('unrelated writes are not blocked during recovery');
  });
  await page.reload();await page.locator('[data-tab="inventory"]').click();
  await purchaseRow('11.00').filter({hasText:'已关联支出'}).waitFor();
  assert.equal(JSON.parse(await ledger()).transactions.find(t=>t.id.startsWith('expense-purchase-')).amount,11);
  await purchaseRow('11.00').getByRole('button',{name:'撤销采购'}).click();
  await purchaseRow('11.00').filter({hasText:'已撤销'}).waitFor();
  assert.equal(JSON.parse(await ledger()).transactions.length,count);
  assert.equal(await quantity(),6);

  // The list can feed a purchase draft without touching inventory until confirmation.
  await page.locator('#inventory-list').getByRole('button',{name:'合成库存'}).click();
  await page.locator('#sku-form [name=minimum]').fill('7');
  await page.locator('#sku-form [type=submit]').click();
  await page.getByText('合成库存 库存偏低',{exact:true}).waitFor();
  await page.getByText('补货清单',{exact:true}).click();
  await page.getByRole('button',{name:'加入低库存食品'}).click();
  const shopping=page.locator('#shopping-list');
  await shopping.locator('label').scrollIntoViewIfNeeded();
  await shopping.getByRole('checkbox').check();
  await page.getByRole('button',{name:'用勾选项填写采购单'}).click();
  assert.equal(await buy.locator('[name=foodId]').inputValue(),'fixture');
  assert.equal(await quantity(),6);
  await buy.locator('[name=quantity]').fill('3');
  await buy.locator('[name=total]').fill('6');
  await buy.locator('[type=submit]').click();
  await page.locator('#toast').getByText('订单已入库').waitFor();
  assert.equal(await quantity(),9);
  assert.equal(await shopping.locator('[type=number]').inputValue(),'4');
  console.log('PASS mirrored purchase correction, interrupted commit recovery, cancellation and shopping conversion');
  console.log('PASS BYOK with private request payload, both purchase directions, duplicate protection and selective backup restore');
  await page.goto(base);
  await page.evaluate(()=>{localStorage.setItem('airplane-pwa-v1','{');localStorage.setItem('airplane-pwa-recovery-v1','invalid');});
  await page.reload();await page.getByRole('button',{name:'导出原始副本'}).waitFor();
  assert.equal(await ledger(),'{');
  await page.locator('#importInput').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.getByText('synthetic legacy entry',{exact:true}).waitFor();
  assert.deepEqual(JSON.parse(await ledger()),backup.data);
  assert.deepEqual(errors,[]);
  console.log('PASS two encrypted accounts, three consent previews, editable candidates and local-only confirmation');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
