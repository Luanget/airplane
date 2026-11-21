import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {extname,resolve} from 'node:path';

const {chromium}=createRequire(import.meta.url)('playwright-core');
const output=process.env.AIRPLANE_SCREENSHOTS_DIR;
if(output)mkdirSync(output,{recursive:true});
const assets=new Set(['sw.js',...Array.from(readFileSync('sw.js','utf8').split('const assets')[0].matchAll(/'\.\/([^']+)'/g),match=>match[1])]);
const server=createServer((req,res)=>{
 let name=new URL(req.url,'http://localhost').pathname.slice(1);
 if(name.endsWith('/'))name+='index.html';
 if(!assets.has(name)){res.writeHead(404).end();return;}
 const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
 res.setHeader('Content-Type',types[extname(name)]??'text/plain');
 res.end(readFileSync(name));
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const url='http://127.0.0.1:'+server.address().port+'/health/';
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(existsSync),headless:true});
 for(const [width,height] of [[375,812],[390,844],[430,932],[1100,840]]){
  const mobile=width<500;
  const context=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
  try{
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(url);
   await page.waitForFunction(()=>typeof document.getElementById('health-settings').onclick==='function');
   await page.evaluate(async()=>{
    const {readState,saveState}=await import('./storage.mjs');
    const {saveSku,addBatch}=await import('./inventory.mjs');
    const {localDate}=await import('../calendar.mjs');
    const {confirmPackageAction,ensureContainers,packagesFor}=await import('./containers.mjs');
    const date=localDate(),state=await readState();
    const add=(name,unit,basisUnit,extra={})=>saveSku(state,{name,unit,basisUnit,basisAmount:100,kcal:85,protein:12,carbs:5,fat:2,sodium:110,...extra});
    const sauce=add('牛肉辣椒酱（演示）','瓶','g',{id:'demo-sauce',packageSize:200,packageUnit:'g',price:8});
    const milk=add('脱脂牛奶 1 L 盒装（演示）','mL','mL',{id:'demo-milk',packageSize:1000,packageUnit:'mL'});
    const chicken=add('熟鸡胸（演示）','g','g',{id:'demo-chicken'});
    const celery=add('大芹菜（演示）','g','g',{id:'demo-celery'});
    const ordinary=add('荞麦面（演示）','包','g',{id:'demo-noodles'});
    addBatch(state,{id:'sauce-batch',foodId:sauce.id,date,quantity:2,costCents:1600});
    addBatch(state,{id:'milk-batch',foodId:milk.id,date,quantity:2000,costCents:1200});
    for(const [i,quantity] of [228,234.7,250.5,219.3].entries())
     addBatch(state,{id:'chicken-'+i,foodId:chicken.id,date,quantity,portion:true,costCents:310});
    celery.qty=1000;celery.unitDescription='g（剩2份×500g）';
    ordinary.qty=5;
    const [bottle]=packagesFor(ensureContainers(state),sauce.id);
    const started=confirmPackageAction(state,{id:'demo-first',containerId:bottle.id,date,action:'baseline',gross:360}).next;
    const partial=confirmPackageAction(started,{id:'demo-lunch',containerId:bottle.id,date,meal:'午餐',gross:322.2}).next;
    await saveState(partial,state.revision??0);
   });
   await page.reload();
   await page.locator('[data-tab=inventory]').click();
   const row=page.locator('[data-stock-id=demo-sauce]'),sku=row.locator('[data-stock-expand]');
   await sku.waitFor();
   await row.getByText('未开1瓶 · 已开1瓶',{exact:true}).waitFor();
   await page.getByText('4袋 · 932.5 g',{exact:true}).waitFor();
   await page.getByText('2份 · 约1,000 g',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(width===390&&output)await page.screenshot({path:resolve(output,'01-inventory-390.png'),animations:'disabled'});
   await sku.click();
   await row.locator('[data-open-package]').getByText(/最新毛重 322.2 g · 净余未知/).waitFor();
   assert.equal(await sku.getAttribute('aria-expanded'),'true');
   if(width===390&&output)await page.screenshot({path:resolve(output,'02-expanded-390.png'),animations:'disabled'});
   const button=row.locator('[data-package-sku]');
   await button.scrollIntoViewIfNeeded();
   const scroll=await page.evaluate(()=>window.scrollY);
   await button.click();
   const sheet=page.locator('#package-sheet');
   await sheet.waitFor();
   const gross=sheet.getByRole('spinbutton',{name:'最新毛重（g）'});
   await gross.fill('310');
   await sheet.getByText(/本次食用 12.2 g/).waitFor();
   const confirm=sheet.getByRole('button',{name:'确认记录饮食'});
   assert.equal(await confirm.isEnabled(),true);
   if(width===390&&output)await page.screenshot({path:resolve(output,'03-weighing-390.png'),animations:'disabled'});
   if(mobile){
    await page.setViewportSize({width,height:490});
    await gross.focus();
    await confirm.scrollIntoViewIfNeeded();
    const box=await confirm.boundingBox();
    assert.ok(box&&box.y>=0&&box.y+box.height<=490);
    await page.setViewportSize({width,height});
   }
   await confirm.click();
   await sheet.waitFor({state:'hidden'});
   await row.locator('[data-open-package]').getByText(/最新毛重 310 g · 净余未知 · 已吃 50 g/).waitFor();
   assert.equal(await sku.getAttribute('aria-expanded'),'true');
   assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-scroll)<=4);
   await page.waitForFunction(()=>document.activeElement?.getAttribute('data-package-sku')==='demo-sauce');
   await page.emulateMedia({colorScheme:'dark'});
   await row.locator('[data-package-sku]').click();
   await sheet.waitFor();
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-color-scheme:dark)').matches),true);
   assert.equal(await sheet.evaluate(el=>el.scrollWidth),await sheet.evaluate(el=>el.clientWidth));
   if(width===390&&output){
    await gross.fill('302');
    await sheet.getByText(/本次食用 8 g/).waitFor();
    await page.screenshot({path:resolve(output,'04-weighing-dark-390.png'),animations:'disabled'});
   }
   await sheet.locator('[data-sheet-close]').click();
   await page.reload();
   await page.locator('[data-tab=inventory]').click();
   await sku.click();
   await row.locator('[data-open-package]').getByText(/最新毛重 310 g/).waitFor();
   assert.deepEqual(errors,[]);
   console.log('PASS package inventory at '+width+'px, light/dark, save, focus and reload');
  }finally{await context.close();}
 }
}finally{await browser?.close();server.close();}
