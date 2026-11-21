import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {extname} from 'node:path';
import {medicalFixture,reportCandidate,syntheticPdf} from './medical-fixture.mjs';

const {chromium,devices}=createRequire(import.meta.url)('playwright-core');
const assets=new Set(['sw.js',...Array.from(readFileSync('sw.js','utf8').split('const assets')[0].matchAll(/'\.\/([^']+)'/g),match=>match[1])]);
const server=createServer((req,res)=>{
 let name=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!name||name.endsWith('/'))name+='index.html';
 if(!assets.has(name)){res.writeHead(404).end();return;}
 const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
 res.setHeader('Content-Type',types[extname(name)]??'text/plain');res.end(readFileSync(name));
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||
  ['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 const {defaultBrowserType,...device}=devices['iPhone SE'];
 const ctx=await browser.newContext({...device,viewport:{width:375,height:667},acceptDownloads:true});
 const page=await ctx.newPage();
 page.setDefaultTimeout(10000);
 const calls=[],errors=[];
 const root='sk-synthetic-medical-fixture-only';
 page.on('pageerror',err=>errors.push(err.message));
 await ctx.route('https://api.openai.com/v1/responses',async route=>{
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
  assert.equal(route.request().headers().authorization,'Bearer '+root);
  const request=route.request().postDataJSON();
  const name=request.text.format.name,serialized=JSON.stringify(request),content=request.input[0].content;
  calls.push(request);
  for(const text of ['载体专用私密指标','合成就诊前头晕','不出设备验证资料','隐私附件名字'])
   assert.ok(!serialized.includes(text),text);
  let value;
  if(name==='airplane_medical_extract'){
   assert.equal(request.store,false);assert.equal(request.tools,undefined);
   assert.equal(content.length,3);
   const upload=content[2];
   if(upload.type==='input_file'){
    assert.equal(upload.filename,'report-1.pdf');assert.match(upload.file_data,/^data:application\/pdf;base64,/);
    value=reportCandidate('2023-05-02');
   }else{
    assert.equal(upload.type,'input_image');assert.match(upload.image_url,/^data:image\/png;base64,/);
    value=reportCandidate('2024-04-19');
   }
  }else if(name==='airplane_medical_explain'){
   assert.equal(content.length,1);
   assert.deepEqual(JSON.parse(content[0].text).selectedIndicators.map(row=>row.name),['空腹血糖']);
   value={explanation:'合成医学解释',uncertainty:'结论仅基于选中指标'};
  }else {
   assert.doesNotMatch(serialized,/体检日期|症状自述[^用]|己糖激酶法|空腹血糖/);
   value={reply:'普通请求成功。',proposal:null,...(request.text.format.schema.required.includes('memoryUpdates')?{memoryUpdates:[]}:{})};
  }
  await route.fulfill({headers,json:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}});
 });
 const goHealth=()=>page.goto(origin+'/health/');
 await goHealth();
 await page.evaluate(async({seed,root})=>{
  await (await import('/ai/keys.mjs')).importKey(root);
  await (await import('/health/storage.mjs')).saveState(seed,0);
 },{seed:medicalFixture(),root});
 await page.reload();
 const read=()=>page.evaluate(async()=> (await import('/health/storage.mjs')).readState());
 const entry=page.locator('#medical-entry'),sheet=page.locator('#medical-sheet');
 await entry.getByText('健康档案',{exact:true}).click();
 assert.equal(await entry.evaluate(el=>el.previousElementSibling.querySelector('#cycle-title')!==null),true);
 const open=label=>entry.getByRole('button',{name:label,exact:true}).click();
 const close=()=>sheet.getByRole('button',{name:'关闭',exact:true}).click();
 await open('指标趋势');
 await sheet.getByText('高于本次参考范围',{exact:true}).waitFor();
 await sheet.getByText('5.2 mmol/L → 6 mmol/L · 变化 +0.8 mmol/L',{exact:true}).waitFor();
 assert.equal(await sheet.locator('polyline').count(),1);
 await close();
 assert.equal(await entry.getByRole('button',{name:'指标趋势',exact:true}).evaluate(el=>document.activeElement===el),true);
 await open('症状');
 await sheet.getByText('合成就诊前头晕',{exact:true}).waitFor();
 assert.equal(await sheet.getByText('医生诊断',{exact:true}).count(),1);
 await close();

 const pdf={name:'隐私附件名字.pdf',mimeType:'application/pdf',buffer:Buffer.from(syntheticPdf())};
 await open('体检');
 const beforeScroll=await page.evaluate(()=>window.scrollY);
 await sheet.getByRole('button',{name:'添加报告'}).click();
 const editor=sheet.locator('[data-medical-editor]');
 await editor.locator('[name=date]').evaluate(input=>{
  input.value='2023-04-09';
  input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await editor.getByLabel('机构（可选）').fill('合成本机体检');
 await editor.locator('[name=attachments]').setInputFiles(pdf);
 await editor.getByRole('button',{name:'保存',exact:true}).click();
 await sheet.getByText(/4月9日.*合成本机体检/).waitFor();
 assert.equal(calls.length,0);
 assert.equal(await sheet.evaluate(el=>el.open),true);
 assert.equal(await page.evaluate(()=>window.scrollY),beforeScroll);
 const download=page.waitForEvent('download');
 await sheet.getByRole('button',{name:pdf.name}).click();
 assert.equal((await download).suggestedFilename(),pdf.name);
 const backup=await read();
 assert.equal(backup.local.medical.attachments.length,1);
 await page.emulateMedia({colorScheme:'dark'});
 for(const width of [375,390,430]){
  await page.setViewportSize({width,height:667});
  const size=await sheet.evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth}));
  assert.ok(size.width<=width&&size.scroll<=size.client+1,JSON.stringify(size));
 }
 await close();
 console.log('PASS iPhone-size archive at 375, 390 and 430px, trend, distinct symptom view, local attachment and scroll/focus');

 await page.goto(origin+'/assistant/');
 const composer=page.locator('.chat-composer'),review=page.locator('.chat-review'),log=page.getByRole('log',{name:'对话'});
 const say=async(text,sendName='发送')=>{
  await composer.getByRole('textbox',{name:'消息'}).fill(text);
  await composer.getByRole('button',{name:sendName,exact:true}).click();
 };
 await composer.locator('[name=medicalFiles]').setInputFiles({...pdf,buffer:Buffer.from(syntheticPdf('Another synthetic report'))});
 assert.equal(calls.length,0);
 await say('','发送所选报告识别');
 await review.getByText('核对体检报告与指标').waitFor();
 await review.getByText(/证据 空腹血糖/).waitFor();
 assert.equal((await read()).local.medical.attachments.length,1);
 await review.getByRole('button',{name:'保存到本机'}).click();
 await log.locator('.chat-bubble').filter({hasText:/新录入 1 项指标/}).waitFor();
 const count=()=>page.evaluate(async()=> (await import('/health/medical.mjs')).medicalCounts(await (await import('/health/storage.mjs')).readState()));
 assert.equal((await count()).attachments,2);
 assert.equal((await count()).reports,4);

 const permission=page.locator('#assistant-settings-sheet');
 await page.locator('#assistant-settings').click();
 await permission.getByText('数据权限',{exact:true}).click();
 const grant=permission.getByRole('checkbox',{name:'自动保存明确的健康档案记录'});
 assert.equal(await grant.isChecked(),false);
 await grant.check();
 await permission.getByRole('button',{name:'关闭',exact:true}).click();

 const image=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
  const context=canvas.getContext('2d');context.fillText('5.8',4,12);
  return canvas.toDataURL('image/png').split(',')[1];
 });
 const original={name:'synthetic-report.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')};
 await composer.locator('[name=medicalFiles]').setInputFiles(original);
 await say('','发送所选报告识别');
 await log.locator('.chat-bubble').filter({hasText:/新录入 1 项指标/}).last().waitFor();
 await page.waitForFunction(()=>document.querySelector('.chat-composer [type=submit]').textContent==='发送');
 assert.equal((await count()).attachments,3);
 const after=await count();
 await composer.locator('[name=medicalFiles]').setInputFiles(original);
 await say('','发送所选报告识别');
 await log.locator('.chat-bubble').filter({hasText:/未重复录入/}).waitFor();
 assert.deepEqual(await count(),after);
 const beforeRead=calls.length;
 await say('查空腹血糖趋势');
 await log.locator('.chat-bubble').filter({hasText:'本机档案 · 空腹血糖'}).waitFor();
 assert.equal(calls.length,beforeRead);
 await say('解读空腹血糖');
 await log.getByText('合成医学解释',{exact:true}).waitFor();
 assert.equal(calls.length,beforeRead+1);
 assert.deepEqual(await count(),after);
 await say('你好');
 await log.getByText('普通请求成功。',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS PDF and photo consent, evidence preview, separately authorized save, retry deduplication, offline-style reads and scoped explanations');

 await goHealth();
 await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 await ctx.setOffline(true);
 await page.reload();
 await entry.getByText('健康档案',{exact:true}).click();
 await open('体检');
 await sheet.getByText(/合成本机体检/).waitFor();
 assert.equal(await sheet.evaluate(el=>el.open),true);
 assert.deepEqual(await count(),after);
 console.log('PASS personal archive and files remain available after offline reload');
}finally{await browser?.close();server.close();}
