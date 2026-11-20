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
  assert.equal(await page.locator('#finance-date').count(),0);
  await page.locator('.update-banner-action').click();
  await page.locator('#finance-date').waitFor();
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
  assert.equal(await page.getByText('去导入',{exact:true}).count(),0);
  await page.locator('#health-settings').click();
  const synthetic={tables:{food_events:[],weight_events:[],food_inventory:[{'食品ID':'fixture','名称':'合成库存','库存值':5,'库存单位':'包','标准份量':'每包','kcal':100}]}};
  const importFile={name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synthetic))};
  await page.locator('#import-file').setInputFiles(importFile);
  await page.getByRole('button',{name:'取消导入'}).click();
  await page.locator('#import-preview').waitFor({state:'hidden'});
  await page.locator('#import-file').setInputFiles(importFile);
  await page.getByRole('button',{name:'确认导入'}).click();
  await page.locator('#health-settings-sheet').waitFor({state:'hidden'});
  await page.locator('#health-settings').click();
  const revision=()=>page.evaluate(async()=> (await (await import('./storage.mjs')).readState()).revision);
  const importedRevision=await revision();
  await page.locator('#import-file').setInputFiles({name:'same.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synthetic))});
  await page.locator('#toast').getByText('这份主账已导入').waitFor();
  assert.equal(await revision(),importedRevision);
  await page.locator('#health-settings-sheet [data-sheet-close]').click();
  assert.equal(await page.locator('.tabbar button').count(),3);
  await page.getByRole('link',{name:'体重趋势',exact:true}).click();
  await page.getByRole('heading',{name:'体重趋势',exact:true}).waitFor();
  await page.getByRole('link',{name:'返回首页',exact:true}).click();
  await page.locator('#local-events').waitFor();
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
  await page.locator('#local-events').getByRole('button',{name:/合成库存/}).click();
  await page.getByRole('button',{name:'删除这条记录'}).click();
  await page.locator('#confirm-delete-health').getByRole('button',{name:'取消',exact:true}).click();
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
  await page.getByRole('button',{name:'确认导入'}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('恢复成功'));
  assert.equal(await ledger(),before);
  const cacheNames=await page.evaluate(()=>caches.keys());
  assert.ok(cacheNames.includes('another-app'));
  assert.ok(!cacheNames.some(k=>/^airplane-shell-v\d+$/.test(k)));
  await page.goto(base);
  await page.getByText('synthetic legacy entry',{exact:true}).waitFor();
  console.log('PASS separate offline routes, local import, health persisted across reload');
  const today=await page.locator('#finance-date').inputValue();
  const shortDay=value=>Number(value.slice(5,7))+'月'+Number(value.slice(8))+'日';
  const headerStyle=()=>page.locator('.topbar').evaluate(top=>{
    const date=getComputedStyle(top.querySelector('.calendar-field'));
    return [getComputedStyle(top.querySelector('h1')).fontSize,date.minHeight,date.borderWidth,date.color];
  });
  const financeStyle=await headerStyle();
  assert.equal(await page.locator('.day-picker .calendar-value').textContent(),shortDay(today));
  await page.getByRole('button',{name:'前一天'}).click();
  assert.notEqual(await page.locator('#finance-date').inputValue(),today);
  await page.getByRole('button',{name:'查看整月'}).click();
  await page.getByText('synthetic legacy entry',{exact:true}).waitFor();
  await page.getByRole('button',{name:'选择月份'}).click();
  await page.locator('#monthGrid').waitFor();
  await page.locator('#modalSave').click();

  // A legacy encrypted ledger is recoverable without switching the device ledger.
  const code=randomBytes(32).toString('hex');
  await page.evaluate(async({code,backup})=>{
    const {accountKeys,privateAccount}=await import('./account.mjs');
    await import('./vendor/nacl-fast.min.js');
    const account=privateAccount(await accountKeys(code),globalThis.nacl,localStorage);
    const ledger=structuredClone(backup.data);ledger.transactions[0].note='private synthetic';
    account.finance.setItem('airplane-pwa-v1',JSON.stringify(ledger));
  },{code,backup});
  await ctx.setOffline(false);
  await page.goto(base+'?private=1');
  const legacy=page.locator('#legacy-export');
  await legacy.locator('[name=code]').fill(code);
  const migrated=page.waitForEvent('download');
  await legacy.getByRole('button',{name:'下载统一备份'}).click();
  const legacyCopy=JSON.parse(readFileSync(await (await migrated).path(),'utf8'));
  assert.equal(legacyCopy.finance.data.transactions[0].note,'private synthetic');
  assert.equal(await ledger(),before);
  await legacy.getByRole('button',{name:'关闭'}).click();
  await page.getByRole('link',{name:'健康',exact:true}).click();
  await page.locator('.day-picker .calendar-value').waitFor();
  assert.equal(await page.locator('.day-picker .calendar-value').textContent(),shortDay(today));
  assert.deepEqual(await headerStyle(),financeStyle);
  assert.equal(await page.locator('[data-account]').count(),0);
  const caloriesBefore=Number(await page.locator('#hero-calories').textContent());

  const calls=[],testKey='sk-fixture-browser-only';
  const aiIcon=await page.locator('.topbar-actions [data-open-ai] svg').innerHTML();
  assert.equal(await page.locator('.tabbar [data-open-ai]').count(),0);
  await ctx.route('https://api.openai.com/v1/responses',async route=>{
    const headers={'Access-Control-Allow-Origin':new URL(base).origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    assert.equal(route.request().headers().authorization,'Bearer '+testKey);
    const body=route.request().postDataJSON(),content=body.input[0].content;
    assert.equal(body.store,false);assert.equal(body.text.format.strict,true);
    const input=JSON.parse(content[0].text);
    assert.deepEqual(Object.keys(input).sort(),['date','history','text']);
    assert.ok(!content[0].text.includes('synthetic legacy entry'));
    assert.ok(!content[0].text.includes('private synthetic'));
    calls.push({...input,photo:content[1]?.image_url});
    if(input.text==='查一下合成库存'){
      assert.equal(body.tools[0].name,'read_ledger');
      const result=body.input.at(-1);
      if(result.type!=='function_call_output'){
        return route.fulfill({headers,json:{status:'completed',output:[{type:'function_call',name:'read_ledger',call_id:'read-1',
          arguments:'{"scope":"stock","query":"合成库存"}'}]}});
      }
      assert.equal(body.tool_choice,'none');
      assert.deepEqual(JSON.parse(result.output),{stock:[{name:'合成库存',qty:4,unit:'包'}],more:false});
      return route.fulfill({headers,json:{status:'completed',output:[{type:'message',content:[{type:'output_text',
        text:'{"reply":"合成库存还有 4 包。","proposal":null}'}]}]}});
    }
    const isPlan=input.text.includes('规划'),stock=input.text.includes('入库'),finance=input.text.includes('28 元');
    const item={sku:'fixture',name:stock?'合成新食品':'合成餐点',action:stock?'add':'eat',amount:120,unit:'g',packageSize:null,packageUnit:null,
      basisAmount:100,basisUnit:'g',nutrients:{kcal:100,protein:10,carbs:10,fat:3,sodium:10},uncertainty:'合成测试估值',weighing:null};
    let proposal={mode:isPlan?'plan':'entry',date:null,result:{note:'供测试',items:[item]}};
    if(finance)proposal={mode:'finance',date:null,result:{note:'',entry:{type:'expense',amount:28,date:input.date,note:'午餐',categoryId:'餐饮'}}};
    if(input.text==='帮我记账')proposal=null;
    const parsed={reply:proposal?'可以核对这张候选卡。':'金额是多少？',proposal};
    await route.fulfill({json:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(parsed)}]}]},headers});
  });
  const access=page.locator('#assistant-key'),chat=page.locator('#airplane-chat');
  const form=chat.locator('.chat-composer'),review=chat.locator('.chat-review');
  async function say(text){
    await form.getByRole('textbox',{name:'消息'}).fill(text);
    await form.getByRole('button',{name:'发送',exact:true}).click();
  }
  await page.locator('[data-open-ai]').click();
  assert.equal(await access.isVisible(),false);
  await chat.getByText('API Key',{exact:true}).click();
  await access.getByText('请导入 OpenAI API Key').waitFor();
  assert.equal(await chat.isVisible(),true);assert.equal(calls.length,0);
  await access.locator('[type=file]').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from(testKey)});
  await access.locator('[type=submit]').click();
  await access.getByText('已保存 Key',{exact:true}).waitFor();
  await say('合成餐点');
  await chat.getByRole('button',{name:'返回编辑'}).click();
  assert.equal(calls.length,0);
  await say('合成餐点');
  await chat.getByRole('button',{name:'确认发送'}).click();
  await review.waitFor();
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].history,[]);
  assert.equal(await review.getByLabel('匹配食品').inputValue(),'');
  const foodCount=()=>page.evaluate(async()=>(await (await import('../health/storage.mjs')).readState()).local.foods.length);
  assert.equal(await foodCount(),1);
  await review.getByLabel('数量',{exact:true}).fill('90');
  await review.getByRole('button',{name:'确认保存'}).click();
  await chat.getByText('记录已保存。',{exact:true}).waitFor();
  const food=await page.evaluate(async()=>(await (await import('../health/storage.mjs')).readState()).local.foods.at(-1));
  assert.match(food.time,/^\d{2}:\d{2}$/);
  await say('用我描述的合成蔬菜规划一餐');await review.waitFor();
  assert.equal(calls[1].history[0].text,'合成餐点');
  assert.equal(await review.getByRole('combobox',{name:/^动作/}).inputValue(),'plan');
  await review.getByRole('button',{name:'保存为饮食计划'}).click();
  await chat.getByText('已保存饮食计划。',{exact:true}).waitFor();
  await page.getByRole('link',{name:'健康',exact:true}).click();
  await page.waitForFunction(value=>Number(document.querySelector('#hero-calories').textContent)===value,caloriesBefore+90);
  await page.getByRole('link',{name:'AI 助手'}).click();
  await chat.getByText('已保存饮食计划。',{exact:true}).waitFor();

  const pixels=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=40;return c.toDataURL('image/png').split(',')[1];});
  await form.locator('[type=file]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(pixels,'base64')});
  await form.getByRole('button',{name:'发送',exact:true}).click();await review.waitFor();
  assert.ok(calls[2].photo.startsWith('data:image/jpeg;base64,/9j/'));
  await review.getByRole('button',{name:'放弃'}).click();
  await say('合成新食品入库 120g');await review.waitFor();
  await review.getByRole('button',{name:'确认保存'}).click();
  await review.waitFor({state:'hidden'});
  await say('帮我记账');await chat.getByText('金额是多少？').waitFor();
  await say('午餐 28 元');await review.waitFor();
  assert.equal(await ledger(),before);
  await review.getByRole('button',{name:'确认记账'}).click();
  await chat.getByText('财务记录已保存。',{exact:true}).waitFor();
  const recordedExpense=JSON.parse(await ledger()).transactions.at(-1);
  assert.equal(recordedExpense.amount,28);
  assert.match(recordedExpense.time,/^\d{2}:\d{2}$/);
  assert.ok(calls.at(-1).history.some(turn=>turn.text==='金额是多少？'));
  assert.equal(calls.at(-1).photo,undefined);
  await page.getByRole('link',{name:'健康',exact:true}).click();
  await page.getByText('目标 2,000 kcal',{exact:true}).waitFor();
  await page.locator('[data-tab="inventory"]').click();
  await page.getByRole('button',{name:'合成新食品'}).waitFor();

  // Both modules use the same assistant and the same previously imported key.
  await page.getByRole('link',{name:'财务',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.day-picker .calendar-value'));
  assert.equal(await page.locator('[data-open-ai] svg').innerHTML(),aiIcon);
  await page.locator('[data-open-ai]').click();await chat.waitFor();
  assert.equal(await access.isVisible(),false);
  await chat.getByText('财务记录已保存。',{exact:true}).waitFor();
  await form.locator('[name=allowRead]').check();
  await say('查一下合成库存');
  await chat.getByRole('region',{name:'账本摘要'}).waitFor();
  assert.equal(calls.length,7);
  await chat.getByRole('button',{name:'发送摘要'}).click();
  await chat.getByText('合成库存还有 4 包。',{exact:true}).waitFor();
  await chat.getByRole('button',{name:'新对话',exact:true}).click();
  await chat.getByRole('button',{name:'对话记录',exact:true}).click();
  const history=chat.getByRole('region',{name:'对话记录',exact:true});
  await history.getByRole('button',{name:/^合成餐点/}).click();
  await history.waitFor({state:'hidden'});
  await chat.getByText('财务记录已保存。',{exact:true}).waitFor();
  await chat.getByText('API Key',{exact:true}).click();
  await access.locator('[data-remove]').click();await access.getByText('已移除本机 Key').waitFor();
  await say('未授权的请求');
  await chat.getByText('请先导入 API Key',{exact:true}).waitFor();
  assert.equal(calls.length,8);
  await page.getByRole('link',{name:'财务',exact:true}).click();
  console.log('PASS shared day picker, legacy export, shared key, chat follow-ups and confirmed finance, health and inventory writes');

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
  console.log('PASS both purchase directions, duplicate protection and selective backup restore');
  await page.goto(base);
  await page.evaluate(()=>{localStorage.setItem('airplane-pwa-v1','{');localStorage.setItem('airplane-pwa-recovery-v1','invalid');});
  await page.reload();await page.getByRole('button',{name:'导出原始副本'}).waitFor();
  assert.equal(await ledger(),'{');
  await page.locator('#importInput').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.getByText('synthetic legacy entry',{exact:true}).waitFor();
  assert.deepEqual(JSON.parse(await ledger()),backup.data);
  assert.deepEqual(errors,[]);
  console.log('PASS damaged finance recovery and synthetic-only fixtures');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
