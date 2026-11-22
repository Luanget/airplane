import assert from 'node:assert/strict';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname,join} from 'node:path';
import {chromium} from 'playwright-core';
import {freshData,STORAGE_KEY} from '../finance-storage.mjs';
import {THREADS_KEY} from '../ai/threads.mjs';

const baseline=process.env.AIRPLANE_BASELINE;
const screenshots=process.env.AIRPLANE_SCREENSHOTS;
const shellCache=root=>'airplane-shell:/:'+readFileSync(join(root,'sw.js'),'utf8').match(/SW_VERSION = '([^']+)'/)[1];
if(screenshots)mkdirSync(screenshots,{recursive:true});
let serving=baseline??'.';
const allowed=root=>new Set(['sw.js',...Array.from(readFileSync(join(root,'sw.js'),'utf8')
 .split('const assets')[0].matchAll(/'\.\/([^']+)'/g),match=>match[1])]);
const mime={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.js':'text/javascript','.png':'image/png',
 '.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
 let file=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!file||file.endsWith('/'))file+='index.html';
 if(!allowed(serving).has(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',mime[extname(file)]??'text/plain');
 res.setHeader('Cache-Control','no-store');
 res.end(readFileSync(join(serving,file)));
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const markdown=[
 '## 今日营养与账目','',
 '已核对 **午餐摄入**，晚餐计划保留。','',
 '| 食物 | 热量 kcal | 蛋白质 g | 碳水 g | 脂肪 g | 钠 mg |',
 '| --- | ---: | ---: | ---: | ---: | ---: |',
 '| 鸡胸肉 | 168 | 31 | 0 | 4.2 | 74 |',
 '| 牛奶 | 102 | 6.8 | 9.2 | 4.0 | 95 |',
 '| 午餐合计 | 270 | 37.8 | 9.2 | 8.2 | 169 |','',
 '1. 饮食',
 '   - 午餐已记录',
 '   - 晚餐保留原计划',
 '2. 财务',
 '   - 食品采购已核对',
 '   - 本次支出 **¥39.60**','',
 '```json','{"stock": 2, "meal": "午餐"}','```','',
 '[查看资料](https://example.org/guide)'
].join('\n');
const notes=['二'.repeat(20),'周末采购：牛奶、鸡蛋、芹菜、豆腐、荞麦面。'.repeat(14).slice(0,200),
 ('\n<说明>👩‍🍳长英文'+ 'A'.repeat(1000)).slice(0,1000)];
const finance=freshData();
finance.transactions=notes.map((note,i)=>({id:'summary-'+i,type:'expense',amount:[12,39.6,105.82][i],
 categoryId:finance.categories.find(row=>row.type==='expense').id,categoryName:['餐饮','食品采购','日常支出'][i],
 note,time:'12:0'+i,date:new Date().toLocaleDateString('en-CA'),...(i===1?{receiptKey:'test-receipt',receiptMerchant:'演示商店'}:{})}));
const fixture={active:'ui-format',threads:[{id:'ui-format',title:'排版验收',messages:[
 {role:'user',text:'核对午餐营养和采购账目。',carry:true},
 {role:'assistant',text:markdown,carry:true}
]}]};
const mobile=(width,colorScheme='light')=>({viewport:{width,height:760},deviceScaleFactor:2,
 isMobile:true,hasTouch:true,colorScheme});
let browser;
async function createContext(width,theme){
 const context=await browser.newContext(mobile(width,theme));
 await context.addInitScript(({book,ledger,THREADS_KEY,STORAGE_KEY})=>{
  if(!localStorage.getItem(THREADS_KEY))localStorage.setItem(THREADS_KEY,JSON.stringify(book));
  if(!localStorage.getItem(STORAGE_KEY))localStorage.setItem(STORAGE_KEY,JSON.stringify(ledger));
 },{book:fixture,ledger:finance,THREADS_KEY,STORAGE_KEY});
 return context;
}
async function screenshot(page,name){
 if(!screenshots)return;
 await page.screenshot({path:join(screenshots,name+'.png'),animations:'disabled'});
}
async function waitChat(page){
 await page.waitForFunction(()=>typeof document.querySelector('.chat-composer')?.onsubmit==='function');
}
const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 if(baseline){
  const old=await createContext(390,'light'),page=await old.newPage();
  await page.goto(origin+'/assistant/');await waitChat(page);
  await page.locator('.chat-message.assistant').first().waitFor();
  assert.match(await page.locator('.chat-bubble.assistant').first().textContent(),/\*\*午餐摄入\*\*/);
  await page.locator(".chat-thread").evaluate(el=>{el.scrollTop=0;});
  await screenshot(page,'01-chat-before');
  await page.goto(origin+'/');
  await page.locator('[data-open-tx="summary-1"]').first().waitFor();
  await page.locator('[data-open-tx=summary-1]').first().evaluate(el=>el.scrollIntoView({block:'center'}));
  await screenshot(page,'03-finance-before');
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  const initial=await page.evaluate(async(name)=>{
   return await caches.has(name)?(await (await caches.open(name)).keys()).length:0;
  },shellCache(baseline));
  assert.ok(initial>0,'initial 0.9.23 cache was not populated');
  serving='.';
  await page.evaluate(async()=>{
   const registration=await navigator.serviceWorker.ready;
   await registration.update();
   const until=Date.now()+10000;
   while(!registration.waiting&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,25));
   if(!registration.waiting)throw Error('Updated shell did not reach waiting state');
   const claimed=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
   registration.waiting.postMessage({type:'SKIP_WAITING'});
   await claimed;
  });
  const cache=shellCache('.');
  const updatedAssets=await page.evaluate(async(name)=>{
   const keys=await caches.keys();
   const fresh=await caches.open(name);
   const read=async path=>(await fresh.match(new URL(path,location.origin).href))?.text()??'';
   return [keys,...await Promise.all([read('/ai/chat.mjs'),read('/assistant/workspace.css'),read('/vendor/markdown-it.min.mjs')])];
  },cache);
  assert.ok(updatedAssets[0].includes(cache),JSON.stringify(updatedAssets[0]));
  assert.match(updatedAssets[1],/import \{markdownStream,renderMarkdown\}/);
  assert.match(updatedAssets[2],/\.markdown-table/);
  assert.match(updatedAssets[3],/markdown-it/);
  await old.setOffline(true);
  await page.goto(origin+'/assistant/');await waitChat(page);
  await page.locator('.markdown-table th').first().waitFor({timeout:6000}).catch(async error=>{
   const debug=await page.evaluate(()=>({version:document.querySelector('[data-version]')?.textContent,
    last:document.querySelector('.chat-transcript')?.textContent.slice(0,80),
    pathname:location.pathname,controller:navigator.serviceWorker.controller?.state}));
   throw Error(JSON.stringify(debug),{cause:error});
  });
  assert.equal(await page.locator('.markdown-table th').count(),6);
  await page.goto(origin+'/');
  assert.equal((await page.locator('[data-open-tx="summary-1"] .tx-sub').first().textContent()).endsWith('…'),true);
  await old.close();
  console.log('PASS pre-Markdown upgrade replaces cache including Markdown engine, CSS and finance rendering; offline history intact');
 }
 for(const width of [375,390,430])for(const theme of ['light','dark']){
  const context=await createContext(width,theme),page=await context.newPage();
  await page.goto(origin+'/assistant/');await waitChat(page);
  const heading=page.getByRole('heading',{name:'今日营养与账目'});
  await heading.waitFor();
  assert.equal(await page.locator('.markdown-table th').count(),6);
  assert.equal(await page.locator('.markdown-reply strong').first().textContent(),'午餐摄入');
  assert.equal(await page.locator('.markdown-reply ol ul li').count(),4);
  assert.match(await page.locator('.markdown-reply pre code').textContent(),/stock/);
  assert.equal(await page.getByRole('link',{name:'查看资料'}).getAttribute('rel'),'noopener noreferrer');
  assert.ok(await noOverflow(page));
  const table=page.locator('.markdown-table');
  const horizontal=await table.evaluate(el=>{el.scrollLeft=1000;return [el.scrollLeft,el.scrollWidth,el.clientWidth];});
  assert.ok(horizontal[0]>0&&horizontal[1]>horizontal[2],JSON.stringify(horizontal));
  if(width===390&&theme==='light'){
   await table.evaluate(el=>{el.closest('.chat-thread').scrollTop=0;});
   await screenshot(page,'06-chat-table-scrolled');
  }
  await table.evaluate(el=>{el.scrollLeft=0;el.closest('.chat-thread').scrollTop=0;});
  if(width===390)await screenshot(page,theme==='light'?'02-chat-after':'05-chat-dark');
  const textbox=page.getByRole('textbox',{name:'消息'});
  await textbox.focus();
  await page.setViewportSize({width,height:470});
  assert.equal(await textbox.evaluate(el=>document.activeElement===el&&
   el.getBoundingClientRect().bottom<=window.innerHeight+1),true);
  assert.ok(await noOverflow(page));
  await page.setViewportSize({width,height:760});
  await page.goto(origin+'/');
  if(width===390&&theme==='light'){
   await page.locator('[data-open-tx=summary-1]').first().evaluate(el=>el.scrollIntoView({block:'center'}));
   await screenshot(page,'04-finance-after');
  }
  for(const [i,note] of notes.entries()){
   const row=page.locator('[data-open-tx="summary-'+i+'"]').first();
   const sub=await row.locator('.tx-sub').textContent();
   assert.equal(sub.endsWith('…'),i>0);
   assert.ok(Array.from(sub).length<25);
   assert.ok(await row.evaluate(el=>el.querySelector('.tx-money').getBoundingClientRect().right<=el.getBoundingClientRect().right));
   assert.ok(await noOverflow(page));
   await row.click();
   assert.equal(await page.locator('#txNote').inputValue(),note);
   await page.getByRole('button',{name:'取消',exact:true}).click();
  }
  await context.close();
 }
 console.log('PASS six-column mobile Markdown, nested lists, code, focus during viewport resize, and 20/200/1000-character notes at 375/390/430px in both themes');

 const context=await createContext(390,'light'),page=await context.newPage();
 const badRequests=[];
 await context.route('**/external-markdown.png',route=>{badRequests.push(route.request().url());return route.abort();});
 const unsafe='[JS](JaVaScRiPt:alert%281%29) [编码](jav&#97;script:evil) [data](data:text/html,evil)\n\n'+
  '<svg onload="window.markdownPwned=true"></svg><script>window.markdownPwned=true</script>\n\n'+
  '![外部图片](https://example.org/external-markdown.png)';
 await context.addInitScript(()=>{
  const fetchRequest=window.fetch.bind(window);
  window.fetch=(url,options)=>{
   if(url!=='https://api.openai.com/v1/responses')return fetchRequest(url,options);
   const encoder=new TextEncoder();
   return Promise.resolve(new Response(new ReadableStream({start(controller){
    const emit=event=>controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));
    window.replyFixture={
     delta:delta=>emit({type:'response.output_text.delta',output_index:0,content_index:0,delta}),
     end:text=>{
      emit({type:'response.completed',response:{status:'completed',output:[{type:'message',role:'assistant',
       content:[{type:'output_text',text}]}]}});controller.close();
     }
    };
   }}),{headers:{'Content-Type':'text/event-stream'}}));
  };
 });
 await page.goto(origin+'/assistant/');await waitChat(page);
 await page.evaluate(async()=>{await (await import('/ai/keys.mjs')).importKey('sk-synthetic-format-browser-only');});
 const send=async text=>{
  await page.getByRole('textbox',{name:'消息'}).fill(text);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.waitForFunction(()=>window.replyFixture);
 };
 const first=markdown.split('1. 饮食')[0].replace('今日营养与账目','实时营养表');
 await send('测试流式排版和中断恢复');
 await page.evaluate(text=>window.replyFixture.delta(text),first);
 const live=page.locator('.agent-live');
 await live.getByRole('heading',{name:'实时营养表'}).waitFor();
 await page.evaluate(()=>{
  const row=document.querySelector('.agent-live');
  window.streamingHeading=row.querySelector('h2');window.streamingTable=row.querySelector('.markdown-table');
  window.streamingTable.scrollLeft=60;
  document.querySelector('.chat-thread').scrollTop=5;
 });
 const second='1. 饮食\n   - **补记完成**\n\n';
 await page.evaluate(text=>window.replyFixture.delta(text),second);
 await live.getByText('补记完成',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>{
  const row=document.querySelector('.agent-live');
  return [window.streamingHeading===row.querySelector('h2'),window.streamingTable===row.querySelector('.markdown-table'),
   window.streamingTable.scrollLeft,document.querySelector('.chat-thread').scrollTop];
 }),[true,true,60,5]);
 await page.reload();await waitChat(page);
 await page.locator('[data-pending-reply]').getByRole('heading',{name:'实时营养表'}).waitFor();
 await page.getByRole('button',{name:/继续未完成任务|重试这条消息/}).click();
 await page.waitForFunction(()=>window.replyFixture);
 const final=first+second+unsafe;
 await page.evaluate(text=>window.replyFixture.delta(text),final);
 await live.getByText('外部图片',{exact:false}).waitFor();
 await page.evaluate(()=>{window.reusedReply=document.querySelector('.agent-live');});
 await page.evaluate(text=>window.replyFixture.end(text),final);
 await live.waitFor({state:'detached'});
 const completed=page.locator('.chat-bubble.assistant').last();
 assert.equal(await completed.locator('script,svg,img,a').count(),0);
 assert.equal(await page.evaluate(()=>window.markdownPwned),undefined);
 assert.equal(await page.evaluate(()=>window.reusedReply.isConnected),true);
 assert.deepEqual(badRequests,[]);
 await page.evaluate(async({THREADS_KEY,final})=>{
  const {exportAiArchive,restoreAiArchive}=await import('/ai/archive.mjs');
  const archive=await exportAiArchive({finance:localStorage});
  if(archive.threads[0].messages.at(-1).text!==final)throw Error('raw Markdown changed');
  localStorage.removeItem(THREADS_KEY);
  await restoreAiArchive({finance:localStorage},JSON.parse(JSON.stringify(archive)));
 },{THREADS_KEY,final});
 await page.reload();await waitChat(page);
 await page.getByRole('heading',{name:'实时营养表'}).waitFor();
 assert.equal(await page.locator('.chat-bubble.assistant').last().locator('.markdown-table th').count(),6);
 await page.goto(origin+'/');
 await page.evaluate(async()=>{
  const {readState,saveState}=await import('/health/storage.mjs'),health=await readState();
  health.local.agentReceipts=[{id:'test-receipt',date:'2026-11-21',merchant:'演示商店',total:3960,financeIds:['summary-1'],
   lines:[{name:'合成牛奶',quantity:2,unit:'盒',packAmount:250,packUnit:'mL',net:15.8}]}];
  await saveState(health,health.revision??0);
 });
 await page.locator('[data-open-tx="summary-1"]').first().click();
 await page.getByText('采购明细',{exact:true}).click();
 await page.getByText('2 盒 · 250 mL/件 · 实付 ¥15.80',{exact:true}).waitFor();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.locator('[data-open-tx="summary-2"]').first().click();
 const handwritten='\n'+notes[2]+'\n';
 await page.locator('#txNote').fill(handwritten);
 await page.getByRole('button',{name:'保存修改'}).click();
 await page.locator('#txNote').waitFor({state:'detached'});
 assert.equal(await page.evaluate(({STORAGE_KEY})=>JSON.parse(localStorage.getItem(STORAGE_KEY)).transactions.find(row=>row.id==='summary-2').note,{STORAGE_KEY}),handwritten);
 await context.close();
 console.log('PASS streamed Markdown keeps DOM and scroll, resumes after reload, renders restored archive, blocks injection, and saves full notes with visible purchase details');
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
