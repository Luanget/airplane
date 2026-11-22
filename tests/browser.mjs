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
let old=true,nextShell=false;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  let name=path.slice(prefix.length);
  if (name.endsWith('/') || !name) name+='index.html';
  if (!path.startsWith(prefix) || !publicAssets.has(name)) {res.writeHead(404).end();return;}
  try {
    let buf=old ? execFileSync('git',['show','6fb5f50:'+name],{stdio:['ignore','pipe','ignore']}) : readFileSync(resolve(root,name));
    if(!old&&name==='ai/chat.mjs')buf=Buffer.from(buf.toString().replace('const nativeAgentEnabled=!demo;','const nativeAgentEnabled=false;'));
    if(nextShell&&name==='sw.js')buf=Buffer.from(buf.toString().replace(/const SW_VERSION = '[^']+'/,"const SW_VERSION = 'fixture-next'"));
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
  await ctx.addInitScript(()=>{delete AbortSignal.timeout;});
  const page=await ctx.newPage();
  page.setDefaultTimeout(10000);
  async function checkPickerSpacing(trigger){
    const layout=await trigger.evaluate(button=>{
      const label=button.parentElement;
      const text=document.createRange();
      text.selectNode(label.firstChild);
      const labelBox=text.getBoundingClientRect(),control=button.getBoundingClientRect();
      const value=button.firstElementChild.getBoundingClientRect();
      const arrow=button.lastElementChild.getBoundingClientRect();
      return {
        labelGap:control.top-labelBox.bottom,arrowGap:arrow.left-value.right,
        border:getComputedStyle(button).borderTopWidth,wrapperBorder:getComputedStyle(label.parentElement).borderTopWidth,
        width:control.width,height:control.height,overflow:button.scrollWidth>button.clientWidth+2
      };
    });
    assert.ok(layout.labelGap>=4,JSON.stringify(layout));
    assert.ok(layout.arrowGap>=6,JSON.stringify(layout));
    assert.equal(layout.border,'1px');
    assert.equal(layout.wrapperBorder,'0px');
    assert.ok(layout.height>=44&&layout.width>0&&!layout.overflow,JSON.stringify(layout));
  }
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
  await page.locator('.day-picker .calendar-trigger').waitFor();
  assert.equal(await ledger(),before);
  assert.equal(await page.evaluate(()=>localStorage.getItem('airplane-pwa-recovery-v1')),before);
  await page.locator('#settingsButton').click();
  await page.locator('[data-action="check-update"]').click();
  await page.locator('.update-inline').getByText('已检查，当前已是最新版本').waitFor();
  nextShell=true;
  await page.locator('[data-action="check-update"]').click();
  await page.locator('.update-inline').getByText('新版已准备好').waitFor();
  assert.equal(await page.locator('.update-banner-action').count(),0);
  await page.locator('.update-inline').getByRole('button',{name:'更新',exact:true}).click();
  await page.locator('[data-action="check-update"]').waitFor({state:'hidden'});
  assert.equal(await ledger(),before);
  await page.locator('#settingsButton').click();
  const downloading=page.waitForEvent('download');
  await page.locator('[data-action="export-json"]').click();
  const backup=JSON.parse(readFileSync(await (await downloading).path(),'utf8'));
  assert.deepEqual(backup.data,JSON.parse(before));
  await page.locator('#importInput').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.getByRole('dialog',{name:'恢复财务备份'}).getByRole('button',{name:'确认恢复'}).click();
  await page.waitForFunction(()=>localStorage.getItem('airplane-pre-restore-v1'));
  assert.deepEqual(JSON.parse(await ledger()),backup.data);
  console.log('PASS old finance budget, transaction, backup/restore and user-approved PWA upgrade');

  await ctx.setOffline(true);
  await page.goto(base+'health/?test=offline');
  assert.equal(await page.getByText('去导入',{exact:true}).count(),0);
  await page.locator('#health-settings').click();
  await page.mouse.click(8,8);
  await page.locator('#health-settings-sheet').waitFor({state:'hidden'});
  await page.locator('#add-health').click();
  await page.mouse.click(8,8);
  await page.locator('#health-entry').waitFor({state:'hidden'});
  await page.locator('#health-settings').click();
  await page.locator('#check-update').click();
  await page.locator('#health-settings-sheet .update-inline').waitFor();
  assert.ok(await page.locator('#health-settings-sheet').isVisible());
  const combined=page.locator('#combined-backup');
  async function openBackups(){
    if(!await combined.evaluate(panel=>panel.open))await combined.locator('summary').click();
  }
  await openBackups();
  const fixtureDay=await page.locator('#report-date').inputValue();
  const otherFixtureDay=fixtureDay.slice(0,8)+(fixtureDay.endsWith('-01')?'02':'01');
  const synthetic={updated_at:fixtureDay+'T10:00:00+08:00',tables:{
    food_events:['早餐','午餐（外食）','晚餐（计划）'].map((meal,i)=>({
      日期:i===2?otherFixtureDay:fixtureDay,
      餐次:meal,'食物/饮品':'合成菜单'+i,'份量/重量':'1 份',状态:'计划'
    })).concat({日期:fixtureDay,餐次:'晚餐','食物/饮品':'合成同日晚餐',状态:'已吃','份量/重量':'1234 g',时间:'19:58',kcal:15}),
    weight_events:[
      {日期:'2020-01-01',数值:80,纳入趋势:'是'},
      {日期:'2020-01-04',数值:79.7,纳入趋势:'是'}
    ],
    food_inventory:[
      {'食品ID':'fixture','名称':'合成库存','库存值':5,'库存单位':'包','标准份量':'每包',kcal:100},
      {'食品ID':'fixture-pieces','名称':'合成计数食品','库存值':2,'库存单位':'盒','标准份量':'200g/盒；10个/盒；按100g标签',kcal:100},
      {'食品ID':'empty','名称':'空库存样品','库存值':0,'库存单位':'个'},
      {'食品ID':'unknown','名称':'未知数量样品','库存值':null,'库存单位':'个'},
      {'食品ID':'mirror','名称':'合计样品（仅总量核对）','库存值':5,'库存单位':'包（仅镜像）'},
      {'食品ID':'variant-a','名称':'合成瓶','库存值':2,'库存单位':'瓶（型号 A）'},
      {'食品ID':'variant-b','名称':'合成瓶','库存值':3,'库存单位':'瓶（型号 B）'},
      {'食品ID':'portions','名称':'合成分装食品','库存值':675,'库存单位':'g熟重','标准份量':'100g熟重','库存基准':'余3袋 [180,220,275]','库存份数估算':3,kcal:100}
    ]
  }};
  const importFile={name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synthetic))};
  await page.locator('#import-file').setInputFiles(importFile);
  await page.getByRole('button',{name:'取消导入'}).click();
  await page.locator('#import-preview').waitFor({state:'hidden'});
  await page.locator('#import-file').setInputFiles(importFile);
  await page.getByRole('button',{name:'确认导入'}).click();
  await page.locator('#health-settings-sheet').waitFor({state:'hidden'});
  await page.locator('#health-settings').click();
  await openBackups();
  const revision=()=>page.evaluate(async()=> (await (await import('./storage.mjs')).readState()).revision);
  const importedRevision=await revision();
  await page.locator('#import-file').setInputFiles({name:'same.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(synthetic))});
  await page.locator('#toast').getByText('这份主账已导入').waitFor();
  assert.equal(await revision(),importedRevision);
  await page.locator('#health-settings-sheet [data-sheet-close]').click();
  assert.equal(await page.locator('.tabbar button').count(),3);
  const weightChart=page.getByRole('slider',{name:'查看近期晨重'});
  await weightChart.waitFor();
  assert.match(await weightChart.getAttribute('aria-valuetext'),/1月4日.*79\.7 kg/);
  // The floating navigation can cover a visible SVG edge. Center the pointer target.
  await weightChart.evaluate(chart=>chart.scrollIntoView({block:'center',behavior:'instant'}));
  const plot=await weightChart.boundingBox();
  assert.equal(await weightChart.evaluate((chart,{x,y})=>chart.contains(document.elementFromPoint(x,y)),
   {x:plot.x+plot.width*.92,y:plot.y+plot.height*.5}),true);
  await page.mouse.move(plot.x+plot.width*.92,plot.y+plot.height*.5);
  await page.mouse.down();
  await page.mouse.move(plot.x+plot.width*.12,plot.y+plot.height*.5,{steps:5});
  await page.mouse.up();
  assert.match(await weightChart.getAttribute('aria-valuetext'),/1月1日.*80\.0 kg/);
  assert.equal(await weightChart.evaluate(plot=>getComputedStyle(plot).outlineStyle),'none');
  await weightChart.press('End');
  assert.match(await weightChart.getAttribute('aria-valuetext'),/1月4日.*79\.7 kg/);
  assert.equal(await weightChart.evaluate(plot=>getComputedStyle(plot).outlineStyle),'none');
  assert.notEqual(await page.locator('#weight-chart-value').evaluate(readout=>getComputedStyle(readout).boxShadow),'none');
  assert.match(page.url(),/health\/\?test=offline$/);
  const deviceTouch=await ctx.newCDPSession(page);
  await deviceTouch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  async function swipe(startX,startY,endX,endY){
    const point=(x,y)=>({x,y});
    await deviceTouch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(startX,startY)]});
    for(let step=1;step<=4;step++){
      await deviceTouch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
        point(startX+(endX-startX)*step/4,startY+(endY-startY)*step/4)
      ]});
    }
    await deviceTouch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  const dateInput=page.locator('#report-date');
  const selectHealthDate=date=>dateInput.evaluate((input,value)=>{
    input.value=value;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  },date);
  await weightChart.scrollIntoViewIfNeeded();
  const chartArea=await weightChart.boundingBox();
  const chartY=chartArea.y+chartArea.height/2;
  await swipe(chartArea.x+chartArea.width*.9,chartY,chartArea.x+chartArea.width*.12,chartY);
  assert.equal(await dateInput.inputValue(),fixtureDay);
  assert.match(await weightChart.getAttribute('aria-valuetext'),/1月1日.*80\.0 kg/);
  const hero=page.locator('.health-hero');
  await hero.scrollIntoViewIfNeeded();
  const heroArea=await hero.boundingBox(),heroY=heroArea.y+heroArea.height/2;
  await selectHealthDate('2024-03-01');
  await swipe(heroArea.x+50,heroY,heroArea.x+150,heroY);
  assert.equal(await dateInput.inputValue(),'2024-02-29');
  await swipe(heroArea.x+150,heroY,heroArea.x+50,heroY);
  assert.equal(await dateInput.inputValue(),'2024-03-01');
  await swipe(heroArea.x+50,heroY,heroArea.x+85,heroY);
  assert.equal(await dateInput.inputValue(),'2024-03-01');
  await selectHealthDate(fixtureDay);
  await page.evaluate(()=>window.scrollTo(0,0));
  const topHero=await hero.boundingBox();
  await swipe(topHero.x+105,topHero.y+75,topHero.x+105,topHero.y-30);
  await page.waitForFunction(()=>scrollY>0);
  assert.equal(await dateInput.inputValue(),fixtureDay);
  await deviceTouch.send('Emulation.setTouchEmulationEnabled',{enabled:false});
  await deviceTouch.detach();
  await page.evaluate(()=>window.scrollTo(0,0));
  console.log('PASS touch day swipes cross month boundaries without intercepting chart scrubs or vertical scrolling');

  await page.getByRole('region',{name:'早餐',exact:true}).getByText('合成菜单0').waitFor();
  await page.getByRole('region',{name:'午餐',exact:true}).getByText('合成菜单1').waitFor();
  await page.getByRole('region',{name:'晚餐',exact:true}).getByText('合成菜单2').waitFor();
  await page.getByRole('heading',{name:'饮食',exact:true}).waitFor();
  assert.equal(await page.locator('#local-events .diet-status').count(),3);
  const mealOrder=await page.locator('#local-events .day-group').filter({hasText:'合成同日晚餐'}).locator('.meal-group h3').allTextContents();
  assert.deepEqual(mealOrder,['晚餐','午餐','早餐']);
  const dietRow=page.getByRole('button',{name:/合成同日晚餐/});
  assert.equal(await dietRow.locator('.health-record-symbol[data-tone=moon] svg').count(),1);
  assert.equal(await page.getByRole('region',{name:'早餐',exact:true}).locator('.health-record-symbol[data-tone=calendar] svg').count(),1);
  assert.equal(await page.locator('#local-events .health-record-symbol[data-tone=calendar] svg').count(),3);
  assert.equal(await dietRow.locator('.diet-nutrients span').count(),5);
  assert.doesNotMatch(await dietRow.innerText(),/1234|19:58/);
  await page.getByRole('link',{name:'体重趋势',exact:true}).click();
  await page.getByRole('heading',{name:'体重趋势',exact:true}).waitFor();
  const detailChart=page.getByRole('slider',{name:'查看历史晨重'});
  await detailChart.press('Home');
  assert.match(await detailChart.getAttribute('aria-valuetext'),/1月1日.*80\.0 kg/);
  await page.getByRole('link',{name:'返回首页',exact:true}).click();
  await page.locator('#local-events').waitFor();
  await page.locator('#add-health').click();
  const manual=page.locator('#food-form');
  async function choose(form,name,option,query){
    const field=form.locator('.inline-field:has(select[name="'+name+'"])');
    await field.locator('.choice-trigger').click();
    const picker=field.locator('.inline-picker-panel');
    if(query)await picker.getByRole('searchbox').fill(query);
    await picker.getByRole('button',{name:option}).click();
    await picker.waitFor({state:'hidden'});
  }
  assert.deepEqual(await manual.locator('#food-select option').evaluateAll(options=>options.map(option=>option.value).sort()),
    ['','fixture','fixture-pieces','portions','variant-a','variant-b']);
  await choose(manual,'foodId',/^合成分装食品/,'分装');
  assert.equal(await manual.locator('[name=amount]').inputValue(),'');
  await choose(manual,'batchId',/^220 g/);
  assert.equal(await manual.locator('[name=amount]').inputValue(),'220');
  assert.equal(await manual.locator('[name=kcal]').inputValue(),'220');
  await manual.locator('[type=submit]').click();
  const portionRow=page.locator('#local-events').getByRole('button',{name:/合成分装食品/});
  await portionRow.waitFor();
  const remainingPortions=()=>page.evaluate(async()=>{
    const state=await (await import('./storage.mjs')).readState();
    return (await import('./core.mjs')).availableBatches(state,'portions').map(batch=>batch.remaining);
  });
  assert.deepEqual(await remainingPortions(),[180,275]);
  await portionRow.click();
  assert.match(await manual.locator('#food-portion-picker .choice-value').textContent(),/^220 g/);
  await page.getByRole('button',{name:'删除这条记录'}).click();
  await page.getByRole('button',{name:'确认删除'}).click();
  await portionRow.waitFor({state:'hidden'});
  assert.deepEqual(await remainingPortions(),[180,220,275]);
  await page.locator('#add-health').click();
  await choose(manual,'foodId',/^合成计数食品/,'计数');
  await manual.getByLabel('份量（个）',{exact:true}).fill('6');
  assert.equal(await manual.locator('[name=portion]').inputValue(),'6 个');
  assert.equal(await manual.locator('[name=stockQty]').inputValue(),'6');
  assert.equal(await manual.locator('[name=kcal]').inputValue(),'120');
  await choose(manual,'foodId',/^合成库存/,'合成库存');
  await manual.locator('[name=amount]').fill('1');
  const dateField=manual.locator('.calendar-field:has(input[name=date])');
  await checkPickerSpacing(dateField.locator('.calendar-trigger'));
  await dateField.locator('.calendar-trigger').click();
  const dateMenu=dateField.locator('.calendar-menu');
  await dateMenu.getByRole('button',{name:'上个月'}).click();
  await dateMenu.getByRole('button',{name:'下个月'}).click();
  await dateMenu.getByRole('button',{name:'今天',exact:true}).click();
  assert.equal(await manual.locator('[name=date]').inputValue(),fixtureDay);
  assert.equal(await dateMenu.isVisible(),false);
  await manual.locator('#food-options > summary').click();
  await choose(manual,'status','计划');
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
  await manual.locator('#food-options > summary').click();
  await choose(manual,'status','已吃（计入）');
  await manual.locator('[type=submit]').click();
  await page.locator('#toast').getByText('饮食已保存').waitFor();
  assert.equal(await quantity(),4);
  await page.locator('#add-health').click();
  await page.locator('[data-entry=activity]').click();
  const activity=page.locator('#activity-form');
  assert.equal(await activity.locator('[name=includedInBase]').count(),0);
  await activity.getByLabel('运动名称').fill('合成额外骑行');
  await activity.getByLabel('额外活动热量 kcal').fill('125');
  await activity.locator('[type=submit]').click();
  await page.getByText('运动已保存',{exact:true}).waitFor();
  assert.equal(await page.evaluate(async()=>{
    const state=await (await import('./storage.mjs')).readState();
    return state.local.activities.at(-1).includedInBase;
  }),false);
  await page.locator('[data-tab="inventory"]').click();
  await page.locator('#inventory-list').getByText('合成库存',{exact:true}).waitFor();
  const inventory=page.locator('#inventory-list');
  await inventory.getByRole('button',{name:'合成计数食品'}).getByText('20 个',{exact:true}).waitFor();
  assert.equal(await inventory.getByText(/空库存样品|合计样品/).count(),0);
  const merged=inventory.locator('details').filter({hasText:'合成瓶'});
  assert.equal(await merged.count(),1);
  await merged.locator('summary').click();
  await merged.getByText('未开2瓶',{exact:true}).waitFor();
  await merged.getByText('未开3瓶',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'未知数量样品'}).isVisible(),false);
  await page.getByText('数量未记录 · 1 项',{exact:true}).click();
  await page.getByRole('button',{name:'未知数量样品'}).waitFor();
  await page.reload();await page.locator('[data-tab="inventory"]').click();
  await page.locator('#inventory-list').getByText('合成库存',{exact:true}).waitFor();
  await page.locator('#health-settings').click();
  await openBackups();await combined.locator('[name=finance]').uncheck();
  const healthDownload=page.waitForEvent('download');
  await combined.locator('[data-export]').click();
  const healthCopy=JSON.parse(readFileSync(await (await healthDownload).path(),'utf8'));
  assert.equal(healthCopy.legacy.inventory[0].id,'fixture');
  await page.locator('#import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"appType":"airplane-health-v1"}')});
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('导入失败'));
  await page.locator('#import-file').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(healthCopy))});
  await page.getByRole('button',{name:'确认导入'}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('备份已恢复'));
  assert.equal(await ledger(),before);
  const cacheNames=await page.evaluate(()=>caches.keys());
  assert.ok(cacheNames.includes('another-app'));
  assert.ok(!cacheNames.some(k=>/^airplane-shell-v\d+$/.test(k)));
  await page.goto(base);
  await page.getByText('synthetic legacy ent…',{exact:true}).waitFor();
  console.log('PASS separate offline routes, local import, health persisted across reload');
  const today=await page.locator('#finance-date').inputValue();
  const shortDay=value=>Number(value.slice(5,7))+'月'+Number(value.slice(8))+'日';
  const headerStyle=()=>page.locator('.topbar').evaluate(top=>{
    const date=getComputedStyle(top.querySelector('.calendar-field'));
    return [getComputedStyle(top.querySelector('h1')).fontSize,date.minHeight,date.borderWidth,date.color];
  });
  const buttonLayout=()=>page.locator('.topbar-actions .icon-button').evaluateAll(buttons=>{
    return buttons.map(button=>{
      const {x,y,width,height}=button.getBoundingClientRect();
      const icon=button.querySelector('svg').getBoundingClientRect();
      return {x,y,width,height,iconX:icon.x-x,iconY:icon.y-y,iconWidth:icon.width,iconHeight:icon.height};
    });
  });
  const financeStyle=await headerStyle();
  const financeButtons=await buttonLayout();
  assert.ok(financeButtons.every(button=>button.width===44&&button.height===44&&button.iconX===11&&button.iconY===11));
  const moduleBadge=page.locator('.topbar .brand-mark svg');
  assert.equal(await page.locator('.topbar h1').textContent(),'账本');
  const financeBadge=await moduleBadge.innerHTML();
  const healthBadge=await page.locator('.topbar-actions [aria-label="健康"] svg').innerHTML();
  assert.equal(await page.locator('.day-picker .calendar-value').textContent(),shortDay(today));
  await page.setViewportSize({width:320,height:568});
  const dayTrigger=page.locator('.day-picker .calendar-trigger');
  assert.equal(await dayTrigger.locator('.chevron').isVisible(),false);
  const dayCalendar=page.locator('.day-picker .calendar-date-menu');
  await dayTrigger.click();
  const weeks=()=>dayCalendar.locator('.calendar-date-grid').evaluate(grid=>Math.ceil((grid.children.length-7)/7));
  for(let i=0;i<12&&await weeks()<6;i++)await dayCalendar.getByRole('button',{name:'下个月'}).click();
  assert.equal(await weeks(),6);
  assert.equal(await dayCalendar.getByRole('button',{name:'清空'}).count(),0);
  assert.ok(await dayCalendar.evaluate(menu=>{
    const {left,right,bottom}=menu.getBoundingClientRect();
    return left>=12&&right<=innerWidth-12&&bottom<=innerHeight&&menu.scrollHeight===menu.clientHeight;
  }));
  await page.keyboard.press('Escape');
  assert.equal(await dayTrigger.getAttribute('aria-expanded'),'false');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'前一天'}).click();
  assert.notEqual(await page.locator('#finance-date').inputValue(),today);
  await page.getByRole('button',{name:'查看整月'}).click();
  await page.getByText('synthetic legacy ent…',{exact:true}).waitFor();
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
  assert.deepEqual(await buttonLayout(),financeButtons);
  assert.equal(await page.locator('.topbar h1').textContent(),'健康');
  assert.equal(await moduleBadge.innerHTML(),healthBadge);
  assert.equal(await page.locator('.topbar-actions [aria-label="账本"] svg').innerHTML(),financeBadge);
  assert.equal(await page.locator('[data-account]').count(),0);
  const caloriesBefore=Number(await page.locator('#hero-calories').textContent());

  const calls=[],testKey='sk-fixture-browser-only';
  await page.evaluate(()=>localStorage.setItem('airplane-ai-skill-v1','合成旧用户偏好'));
  const batchText='盘点合成新食品为 90g，补记 43 元午餐，再查更新后的库存';
  let resumeAttempts=0;
  let firstPhotoAttempts=0,compactions=0;
  let expectedModel='gpt-6-luna';
  let releaseDelayed,markDelayed;
  const delayedStarted=new Promise(resolve=>{markDelayed=resolve;});
  const aiIcon=await page.locator('.topbar-actions [data-open-ai] svg').innerHTML();
  assert.equal(await page.locator('.tabbar [data-open-ai]').count(),0);
  await ctx.route('https://api.openai.com/v1/responses',async route=>{
    const headers={'Access-Control-Allow-Origin':new URL(base).origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'};
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    assert.equal(route.request().headers().authorization,'Bearer '+testKey);
    const body=route.request().postDataJSON(),content=body.input[0].content;
    const visual=content.some(row=>row.type==='input_image'||row.type==='input_file');
    assert.equal(body.model,expectedModel==='gpt-6-luna'&&visual?'gpt-6.1-terra':expectedModel);
    assert.equal(body.reasoning.effort,body.model==='gpt-6.2-sol'?'low':'none');
    assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.text.format.strict,true);
    const input=JSON.parse(content[0].text);
    const mockResult=value=>route.fulfill({headers,json:{status:'completed',output:[{type:'message',
      content:[{type:'output_text',text:JSON.stringify(value)}]}]}});
    if(body.text.format.name==='airplane_context_summary'){
      compactions++;
      assert.equal(body.tools,undefined);
      assert.equal(input.summary,'');
      assert.match(input.older[0].text,/合成历史0/);
      return mockResult({summary:'测试摘要：使用合成饮食规则。'});
    }
    const fields=['date','history','text'];
    if(input.memory){
      fields.push('memory');
      assert.ok(input.memory.every(item=>Object.keys(item).sort().join(',')==='name,text'));
    }
    if(input.recentOperations){
      fields.push('recentOperations');
      assert.ok(input.recentOperations.length<=5&&input.recentOperations.every(task=>task.taskId&&task.steps.length<=8));
    }
    if(input.activeSkills)fields.push('activeSkills');
    if(input.financeCategories)fields.push('financeCategories');
    if(input.healthContext)fields.push('healthContext');
    if(input.photoPosition)fields.push('photoPosition');
    if(input.applied)fields.push('applied');
    if(input.contextSummary)fields.push('contextSummary');
    assert.deepEqual(Object.keys(input).sort(),fields.sort());
    assert.ok(!content[0].text.includes('synthetic legacy entry'));
    assert.ok(!content[0].text.includes('private synthetic'));
    calls.push({...input,photo:content[1]?.image_url});
    if(input.text==='合成餐点'){
      assert.ok(body.tools.some(tool=>tool.name==='read_ledger'));
      assert.deepEqual(input.memory.map(row=>row.name),['测试个人记忆','原有个人偏好']);
    }
    if(input.text==='验证压缩后接续'){
      assert.equal(input.contextSummary,'测试摘要：使用合成饮食规则。');
      assert.ok(input.history.some(row=>row.text.startsWith('合成历史49')));
      return mockResult({reply:'压缩后的对话已接续。',proposal:null});
    }
    if(input.text==='我的余额是多少'){
      if(body.input.length===1)return route.fulfill({headers,json:{status:'completed',output:[
        {type:'function_call',name:'read_ledger',call_id:'fixture-balance',arguments:'{"scope":"balance","query":""}'}
      ]}});
      const balance=JSON.parse(body.input.at(-1).output);
      assert.deepEqual(Object.keys(balance).sort(),['balance','currency']);
      assert.equal(balance.currency,'CNY');
      return mockResult({reply:'当前总余额 '+balance.balance+' 元。',proposal:null});
    }
    if(input.text==='我平时用牛肉酱喜欢少放一点'){
      assert.ok(body.text.format.schema.required.includes('memoryUpdates'));
      return mockResult({reply:'给你搭配食材时会少放牛肉酱。',proposal:null,memoryUpdates:[
       {name:'酱料用量偏好',text:'牛肉酱少放一点',evidence:input.text}
      ]});
    }
    if(input.text==='晚餐用库存里的合成牛肉酱，初始360g，吃到322.2g'){
      assert.ok(!body.tools.some(tool=>tool.name==='read_app_document'));
      assert.ok(input.memory.some(item=>item.name==='酱料用量偏好'));
      return mockResult({reply:'会按同一瓶的两次称重记用量。',saveMode:'save',memoryUpdates:[],proposal:{
       mode:'entry',date:input.date,result:{meal:'晚餐',note:'',items:[{
        sku:null,name:'合成牛肉酱',action:'eat',stockSource:'inventory',amount:37.8,unit:'g',packageSize:null,packageUnit:null,
        basisAmount:100,basisUnit:'g',nutrients:{kcal:200,protein:null,carbs:null,fat:null,sodium:800},
        uncertainty:'合成标签',weighing:{before:360,after:322.2,tare:null}
       }]}
      }});
    }
    if(input.text==='把合成餐点从90g改成50g并挪到晚餐'){
      return mockResult({reply:'我会更正原饮食。',saveMode:'save',proposal:{mode:'food_edit',date:input.date,
       result:{name:'合成餐点',id:null,amount:50,unit:'g',meal:'午餐',time:null,newMeal:'晚餐',weighing:null}}});
    }
    if(input.text==='直接记合成支出再告诉我金额'){
      assert.ok(body.tools.some(tool=>tool.name==='read_app_document'));
      if(input.applied){
        assert.deepEqual(input.applied,['finance']);
        return mockResult({reply:'刚才记了 11 元。',proposal:null,saveMode:'review'});
      }
      return mockResult({reply:'我会记录这笔支出。',saveMode:'save',proposal:{
       mode:'batch',date:null,result:{next:'continue',operations:[{mode:'finance',date:null,result:{
        note:'',entry:{type:'expense',amount:11,date:input.date,note:'合成直接支出',categoryId:'餐饮'}
       }}]}
      }});
    }
    if(input.text==='直接删除合成直接支出'){
      return mockResult({reply:'我会删除匹配的支出。',saveMode:'save',proposal:{mode:'delete_record',date:input.date,
       result:{kind:'finance',query:'合成直接支出',meal:null,selection:'one'}}});
    }
    if(input.text==='只看看运动候选'){
      assert.ok(body.tools.some(tool=>tool.name==='read_app_document'));
      return mockResult({reply:'这是运动预览。',saveMode:'review',proposal:{mode:'activity',date:null,result:{note:'',
       activity:{name:'合成运动',km:1,minutes:10,kcal:40,energyKind:'activity',quality:'estimated',includedInBase:'no',uncertainty:'合成样例'}
      }}});
    }
    if(input.text==='权限关掉后拒绝本次保存'){
      return mockResult({reply:'我会记录候选支出。',saveMode:'save',proposal:{mode:'finance',date:null,result:{note:'',
       entry:{type:'expense',amount:30,date:input.date,note:'合成撤销权限支出',categoryId:'餐饮'}
      }}});
    }
    if(input.text==='修改原始会话备注'){
      assert.ok(body.tools.some(tool=>tool.name==='read_app_document'));
      if(body.input.length===1)return route.fulfill({headers,json:{status:'completed',output:[
        {type:'function_call',name:'read_app_document',call_id:'fixture-document',
         arguments:JSON.stringify({document:'conversations',path:'/active',view:'value'})}
      ]}});
      const raw=JSON.parse(body.input.at(-1).output);
      assert.deepEqual(Object.keys(raw).sort(),['document','path','value']);
      assert.equal(raw.path,'/active');
      assert.match(raw.value,/^[a-f0-9-]{36}$/);
      return mockResult({reply:'已找到当前会话。',saveMode:'save',proposal:{mode:'document_edit',date:null,
       result:{document:'conversations',patch:JSON.stringify([
        {op:'test',path:'/active',value:raw.value},{op:'add',path:'/customNotes',value:{topic:'合成备注'}}
       ])}}});
    }
    if(input.text==='把周期改为六天'){
      if(body.input.length===1)return route.fulfill({headers,json:{status:'completed',output:[
        {type:'function_call',name:'read_app_data',call_id:'fixture-settings',
         arguments:JSON.stringify({dataset:'health_settings',id:null,date:null,query:'',fields:[]})}
      ]}});
      const info=JSON.parse(body.input.at(-1).output);
      assert.equal(info.fields.cycleDays,'cycleDays');
      const change={dataset:'health_settings',id:null,action:'update',changes:JSON.stringify({cycleDays:6})};
      return mockResult({reply:'请确认周期调整。',proposal:{mode:'app_data_edit',date:null,result:change}});
    }
    if(input.text==='记录照片里的合成分装'){
      assert.equal(content[1].type,'input_image');
      return route.fulfill({headers,json:{status:'completed',output:[{type:'message',content:[{type:'output_text',
        text:JSON.stringify({reply:'请核对分装数量。',proposal:{mode:'portions',date:null,
          result:{name:'合成计数食品',quantities:[3,7],unit:'个'}}})}]}]}});
    }
    if(input.text==='分别识别合成两张照片'){
      assert.equal(content.length,2);
      assert.equal(content[1].type,'input_image');
      const photoIndex=input.photoPosition?.index;
      assert.ok([1,2].includes(photoIndex));
      if(photoIndex===1&&++firstPhotoAttempts===1)
        return route.fulfill({status:503,headers,json:{error:{code:'synthetic'}}});
      const item={sku:null,name:'合成库存',amount:1,unit:'包',action:'eat',stockSource:photoIndex===1?'inventory':'one_off',
        packageSize:null,packageUnit:null,basisAmount:1,basisUnit:'包',
        nutrients:{kcal:100,protein:5,carbs:10,fat:3,sodium:30},uncertainty:'合成照片估值',weighing:null};
      return route.fulfill({headers,json:{status:'completed',output:[{type:'message',content:[{type:'output_text',
        text:JSON.stringify({reply:'已识别合成图 '+photoIndex+'。',proposal:{mode:'entry',date:null,result:{note:'',items:[item]}}})}]}]}});
    }
    if(input.text==='模拟额度不足'){
      assert.equal(body.tools,undefined);
      return route.fulfill({status:429,headers:{...headers,'Access-Control-Expose-Headers':'X-Request-ID','X-Request-ID':'req_fixture'},
        json:{error:{code:'credit_balance_exhausted'}}});
    }
    const fixtureReply={status:'completed',output:[{type:'message',content:[{type:'output_text',
      text:'{"reply":"连接正常。","proposal":null}'}]}]};
    if(input.text==='分析合成月度分类支出'){
      const last=body.input.at(-1),start=input.date.slice(0,7)+'-01';
      assert.ok(body.tools.some(tool=>tool.name==='read_expense_summary'));
      if(last.type!=='function_call_output')return route.fulfill({headers,json:{status:'completed',output:[
        {type:'function_call',name:'read_expense_summary',call_id:'fixture-expenses',
         arguments:JSON.stringify({start,end:input.date,groupBy:'category'})}
      ]}});
      const summary=JSON.parse(last.output);
      assert.equal(summary.start,start);
      assert.equal(summary.end,input.date);
      assert.equal(summary.groupBy,'category');
      assert.ok(summary.rows.some(row=>row.label==='餐饮'&&row.expense>=71));
      assert.ok(summary.rows.every(row=>Object.keys(row).sort().join(',')==='count,expense,label'));
      assert.ok(!last.output.includes('合成批量支出'));
      return route.fulfill({headers,json:{status:'completed',output:[
        {type:'message',content:[{type:'output_text',text:'{"reply":"已按分类查看本月支出。","proposal":null}'}]}
      ]}});
    }
    if(input.text===batchText){
      const reply=(reply,proposal=null)=>route.fulfill({headers,json:{status:'completed',output:[{type:'message',
        content:[{type:'output_text',text:JSON.stringify({reply,proposal})}]}]}});
      if(!input.applied)return reply('请核对盘点和支出。',{mode:'batch',date:null,result:{next:'continue',operations:[
        {mode:'inventory',date:null,result:{operation:'count',name:'合成新食品',quantity:90,unit:'g'}},
        {mode:'finance',date:null,result:{note:'',entry:{type:'expense',amount:43,date:input.date,note:'合成批量支出',categoryId:'餐饮'}}}
      ]}});
      assert.deepEqual(input.applied,['inventory','finance']);
      assert.deepEqual(input.history,[]);
      assert.equal(content.length,1);
      const last=body.input.at(-1);
      if(last.type==='function_call_output'){
        assert.deepEqual(JSON.parse(last.output),{stock:[{name:'合成新食品',qty:90,unit:'g'}]});
        return reply('保存后还剩 90 g。');
      }
      if(++resumeAttempts===1)return route.fulfill({status:503,headers,json:{error:{code:'fixture'}}});
      assert.equal(body.input.length,1);
      return route.fulfill({headers,json:{status:'completed',output:[{type:'function_call',name:'read_ledger',
        call_id:'batch-stock',arguments:'{"scope":"stock","query":"合成新食品"}'}]}});
    }
    if(input.text.startsWith('这是连接测试'))return route.fulfill({headers,json:{...fixtureReply,id:'resp_fixture_cost',
      usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:100,cache_write_tokens:200}}}});
    if(input.text==='删除合成计划'||input.text==='删除合成午餐支出'){
      assert.deepEqual(input.history,[]);
      const finance=input.text.endsWith('支出');
      return route.fulfill({headers,json:{status:'completed',output:[{type:'message',content:[{type:'output_text',
        text:JSON.stringify({reply:'勾选要删除的原记录。',proposal:{mode:'delete_record',date:input.date,
          result:{kind:finance?'finance':'plan',query:finance?'午餐':'合成餐点',meal:null}}})}]}]}});
    }
    if(input.text==='模拟等待'){
      await new Promise(resolve=>{releaseDelayed=resolve;markDelayed();});
      await route.fulfill({headers,json:fixtureReply}).catch(()=>{});
      return;
    }
    if(input.text==='查一下合成库存'){
      assert.equal(body.tools[0].name,'read_ledger');
      const result=body.input.at(-1);
      if(result.type!=='function_call_output'){
        return route.fulfill({headers,json:{status:'completed',output:[{type:'function_call',name:'read_ledger',call_id:'read-1',id:'fc_fixture',status:'completed',
          arguments:'{"scope":"stock","query":"合成库存"}'}]}});
      }
      assert.equal(body.tool_choice,'auto');
      assert.equal(body.input.at(-2).id,'fc_fixture');
      assert.deepEqual(JSON.parse(result.output),{stock:[{name:'合成库存',qty:4,unit:'包'}]});
      return route.fulfill({headers,json:{status:'completed',output:[{type:'message',content:[{type:'output_text',
        text:'{"reply":"合成库存还有 4 包。","proposal":null}'}]}]}});
    }
    const isPlan=input.text.includes('规划'),stock=input.text.includes('入库'),finance=input.text.includes('28 元');
    const item={sku:'fixture',name:stock?'合成新食品':'合成餐点',action:stock?'add':'eat',amount:120,unit:'g',packageSize:null,packageUnit:null,
      ...(isPlan?{}:{stockSource:'one_off'}),
      basisAmount:100,basisUnit:'g',nutrients:{kcal:100,protein:10,carbs:10,fat:3,sodium:10},uncertainty:'合成测试估值',weighing:null};
    let proposal={mode:isPlan?'plan':'entry',date:null,result:{note:'供测试',items:[item]}};
    if(finance)proposal={mode:'finance',date:null,result:{note:'',entry:{type:'expense',amount:28,date:input.date,note:'午餐',categoryId:'餐饮'}}};
    if(input.text==='帮我记账')proposal=null;
    const parsed={reply:proposal?'可以核对这张候选卡。':'金额是多少？',proposal};
    await route.fulfill({json:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(parsed)}]}]},headers});
  });
  const access=page.locator('#assistant-key'),chat=page.locator('#airplane-chat');
  const assistantSettings=page.getByRole('dialog',{name:'设置',exact:true});
  const openAssistantSettings=()=>page.getByRole('button',{name:'打开设置',exact:true}).click();
  const closeAssistantSettings=()=>assistantSettings.getByRole('button',{name:'关闭',exact:true}).click();
  const form=chat.locator('.chat-composer'),review=chat.locator('.chat-review');
  async function say(text){
    await form.getByRole('textbox',{name:'消息'}).fill(text);
    await form.getByRole('button',{name:'发送',exact:true}).click();
  }
  await page.locator('.topbar-actions [data-open-ai]').click();
  await moduleBadge.waitFor();
  assert.equal(await page.locator('.topbar h1').textContent(),'AI 助手');
  assert.deepEqual(await buttonLayout(),financeButtons);
  assert.equal(await moduleBadge.innerHTML(),aiIcon);
  assert.equal(await page.locator('.topbar-actions [aria-label="账本"] svg').innerHTML(),financeBadge);
  assert.equal(await access.isVisible(),false);
  assert.ok(await form.locator('[name=allowRead]').isChecked());
  await openAssistantSettings();
  await page.mouse.click(8,8);
  await assistantSettings.waitFor({state:'hidden'});
  await openAssistantSettings();
  const memorySettings=assistantSettings.locator('#assistant-memory');
  await memorySettings.getByText('记忆',{exact:true}).click();
  const autoMemory=memorySettings.getByRole('checkbox',{name:'自动记住长期偏好'});
  assert.ok(await autoMemory.isChecked());
  await autoMemory.uncheck();
  await memorySettings.getByText('合成旧用户偏好',{exact:true}).waitFor();
  await memorySettings.getByRole('button',{name:'添加记忆',exact:true}).click();
  await memorySettings.getByLabel('名称',{exact:true}).fill('测试个人记忆');
  await memorySettings.getByLabel('记忆内容',{exact:true}).fill('合成餐点优先配蔬菜。');
  await memorySettings.getByRole('button',{name:'保存记忆',exact:true}).click();
  await memorySettings.getByText('合成餐点优先配蔬菜。',{exact:true}).waitFor();
  await memorySettings.getByRole('button',{name:'编辑 测试个人记忆'}).click();
  assert.ok(await memorySettings.getByLabel('记忆内容',{exact:true}).isVisible());
  await memorySettings.getByRole('button',{name:'收起',exact:true}).click();
  await memorySettings.getByText('记忆',{exact:true}).click();
  await assistantSettings.getByText('API Key',{exact:true}).click();
  await access.getByText('请导入 OpenAI API Key').waitFor();
  assert.equal(await chat.isVisible(),true);assert.equal(calls.length,0);
  await access.locator('[type=file]').setInputFiles({name:'fixture.txt',mimeType:'text/plain',buffer:Buffer.from(testKey)});
  await access.locator('[type=submit]').click();
  await access.getByText('已保存 Key',{exact:true}).waitFor();
  await closeAssistantSettings();
  await say('合成餐点');
  await review.waitFor();
  await checkPickerSpacing(review.locator('.calendar-trigger'));
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].history,[]);
  assert.equal(await review.locator('label').filter({hasText:'匹配食品'}).locator('select').inputValue(),'');
  const foodCount=()=>page.evaluate(async()=>(await (await import('../health/storage.mjs')).readState()).local.foods.length);
  assert.equal(await foodCount(),1);
  await review.getByLabel('数量',{exact:true}).fill('90');
  await review.getByRole('button',{name:'确认保存'}).click();
  await chat.getByText('记录已保存。',{exact:true}).waitFor();
  const food=await page.evaluate(async()=>(await (await import('../health/storage.mjs')).readState()).local.foods.at(-1));
  assert.match(food.time,/^\d{2}:\d{2}$/);
  await say('用我描述的合成蔬菜规划一餐');await review.waitFor();
  assert.equal(calls[1].history[0].text,'合成餐点');
  const planCard=review.locator('.assistant-plan-item');
  await planCard.getByText(/120 g.*120 kcal.*蛋白 12 g.*碳水 12 g.*脂肪 3.6 g.*钠 12 mg/).waitFor();
  await review.getByText(/^整餐.*钠 12 mg/).waitFor();
  await review.getByText(/^若吃完/).waitFor();
  await planCard.getByText('合成测试估值',{exact:true}).waitFor();
  assert.equal(await planCard.getByLabel('数量',{exact:true}).isVisible(),false);
  await planCard.getByText('调整份量与营养',{exact:true}).click();
  await planCard.getByLabel('数量',{exact:true}).waitFor();
  await planCard.getByText('调整份量与营养',{exact:true}).click();
  await page.reload();
  await chat.getByRole('button',{name:'继续核对上次候选'}).click();
  await review.getByRole('button',{name:'保存为饮食计划'}).click();
  await chat.getByText('已保存饮食计划。',{exact:true}).waitFor();
  await page.getByRole('link',{name:'健康',exact:true}).click();
  await page.waitForFunction(value=>Number(document.querySelector('#hero-calories').textContent)===value,caloriesBefore+90);
  await page.getByRole('link',{name:'AI 助手'}).click();
  await chat.getByText('已保存饮食计划。',{exact:true}).waitFor();

  const pixels=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=40;c.height=40;return c.toDataURL('image/png').split(',')[1];});
  await form.locator('[name=image]').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from(pixels,'base64')});
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
  await page.getByRole('link',{name:'账本',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.day-picker .calendar-value'));
  assert.equal(await page.locator('.topbar-actions [data-open-ai] svg').innerHTML(),aiIcon);
  await page.getByRole('button',{name:'打开设置',exact:true}).click();
  await page.getByRole('link',{name:/^管理 API Key/}).click();
  await assistantSettings.waitFor();
  await access.waitFor();
  await closeAssistantSettings();
  await page.waitForFunction(()=>!location.hash);
  await page.getByRole('link',{name:'账本',exact:true}).click();
  await page.locator('.topbar-actions [data-open-ai]').click();await chat.waitFor();
  assert.equal(await access.isVisible(),false);
  await chat.getByText('财务记录已保存。',{exact:true}).waitFor();
  assert.ok(await form.locator('[name=allowRead]').isChecked());
  await say('查一下合成库存');
  await chat.getByText('合成库存还有 4 包。',{exact:true}).waitFor();
  assert.equal(calls.length,8);
  assert.equal(await chat.getByRole('button',{name:'发送摘要'}).count(),0);
  await chat.getByRole('button',{name:'新对话',exact:true}).click();
  await chat.getByRole('button',{name:'对话记录',exact:true}).click();
  const history=chat.getByRole('region',{name:'对话记录',exact:true});
  await history.getByRole('button',{name:/^合成餐点/}).click();
  await history.waitFor({state:'hidden'});
  await chat.getByText('财务记录已保存。',{exact:true}).waitFor();
  await openAssistantSettings();
  const modelPanel=assistantSettings.locator('#assistant-model-panel');
  await modelPanel.getByText('模型',{exact:true}).click();
  assert.equal(await modelPanel.getByRole('button',{name:'默认',exact:true}).getAttribute('aria-pressed'),'true');
  await modelPanel.getByText('默认使用 Terra',{exact:true}).waitFor();
  assert.equal(await assistantSettings.getByRole('link',{name:/API 余额|用量明细/}).count(),0);
  await modelPanel.getByRole('button',{name:'Terra',exact:true}).click();
  expectedModel='gpt-6.1-terra';
  await assistantSettings.getByText('API Key',{exact:true}).click();
  await access.getByRole('button',{name:'发送连接测试'}).click();
  await access.getByText('GPT-6.1 Terra · 连接正常。',{exact:true}).waitFor();
  await modelPanel.getByText('本机已用约 US$0.001455',{exact:true}).waitFor();
  await access.getByRole('button',{name:'发送连接测试'}).click();
  await access.getByText('GPT-6.1 Terra · 连接正常。',{exact:true}).waitFor();
  await modelPanel.getByText('本机已用约 US$0.001455',{exact:true}).waitFor();
  await modelPanel.getByRole('button',{name:'Sol',exact:true}).click();
  expectedModel='gpt-6.2-sol';
  await closeAssistantSettings();
  await page.reload();
  await openAssistantSettings();
  await modelPanel.getByText('模型',{exact:true}).click();
  assert.equal(await modelPanel.getByRole('button',{name:'Sol',exact:true}).getAttribute('aria-pressed'),'true');
  await closeAssistantSettings();
  await form.locator('[name=allowRead]').uncheck();
  await say('模拟额度不足');
  await form.getByText(/预付余额已用完.*429.*req_fixture/).waitFor();
  assert.equal(await form.getByRole('textbox',{name:'消息'}).inputValue(),'模拟额度不足');
  await say('模拟等待');
  await delayedStarted;
  await form.getByRole('button',{name:'停止等待'}).click();
  await form.getByText('已停止等待 OpenAI 回复。',{exact:true}).waitFor();
  assert.equal(await form.getByRole('textbox',{name:'消息'}).inputValue(),'模拟等待');
  releaseDelayed();
  await page.evaluate(()=>{
    const fetchRequest=window.fetch.bind(window);
    window.fetch=(url,options)=>{
      if(url!=='https://api.openai.com/v1/responses')return fetchRequest(url,options);
      const payload=JSON.parse(options.body),input=JSON.parse(payload.input[0].content[0].text);
      if(input.text!=='模拟流式回复')return fetchRequest(url,options);
      if(payload.model!=='gpt-6.2-sol'||payload.reasoning.effort!=='low')throw Error('Sol model settings not applied');
      const encoder=new TextEncoder();
      return Promise.resolve(new Response(new ReadableStream({start(controller){
        const emit=event=>controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));
        const delta=delta=>emit({type:'response.output_text.delta',output_index:0,content_index:0,delta});
        const result={reply:'先显示，再完成。',proposal:{mode:'finance',date:null,result:{
          note:'',entry:{type:'expense',amount:3,date:input.date,note:'合成流式收支',categoryId:'餐饮'}
        }}};
        delta('{"reply":"先显示');
        window.finishFixtureStream=()=>{
          delta(JSON.stringify(result).slice('{"reply":"先显示'.length));
          emit({type:'response.completed',response:{status:'completed',output:[{type:'message',
            content:[{type:'output_text',text:JSON.stringify(result)}]}]}});
          controller.close();
        };
      }}),{headers:{'Content-Type':'text/event-stream'}}));
    };
  });
  await say('模拟流式回复');
  const partial=chat.locator('.streaming-reply');
  await partial.getByText('先显示',{exact:true}).waitFor();
  assert.equal(await partial.locator('.chat-avatar svg').count(),1);
  assert.equal(await chat.locator('.chat-message.user').last().locator('.chat-avatar svg').count(),1);
  assert.equal(await review.isVisible(),false);
  await page.evaluate(()=>window.finishFixtureStream());
  await chat.getByText('先显示，再完成。',{exact:true}).waitFor();
  await review.getByRole('button',{name:'确认记账'}).waitFor();
  assert.equal(await partial.count(),0);
  assert.equal(JSON.parse(await ledger()).transactions.at(-1).amount,28);
  await review.getByRole('button',{name:'放弃'}).click();
  const financeBeforeBatch=await ledger();
  await say(batchText);
  await review.getByText('合成新食品 120 → 90 g',{exact:false}).waitFor();
  assert.equal(await ledger(),financeBeforeBatch);
  await review.getByRole('button',{name:'确认全部并继续'}).click();
  const retry=chat.getByRole('button',{name:'重试后续请求'});
  await retry.waitFor();
  const savedBatch=await ledger();
  assert.equal(JSON.parse(savedBatch).transactions.at(-1).amount,43);
  await retry.click();
  await chat.getByText('保存后还剩 90 g。',{exact:true}).waitFor();
  assert.equal(calls.at(-1).applied.length,2);
  assert.equal(await ledger(),savedBatch);
  console.log('PASS batch save before fresh read, minimal follow-up context and no duplicate writes on retry');
  await openAssistantSettings();
  const dataPermissions=assistantSettings.getByText('数据权限',{exact:true});
  await dataPermissions.click();
  const rootPermission=assistantSettings.getByRole('checkbox',{name:'所有者完全控制'});
  assert.equal(await rootPermission.isChecked(),false);
  await rootPermission.check();
  await closeAssistantSettings();
  await say('修改原始会话备注');
  const conversations=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('airplane-ai-conversations-v1')));
  await chat.getByRole('log').getByText('完整对话已保存。 新增 /customNotes。',{exact:true}).waitFor();
  assert.equal(await review.isVisible(),false);
  assert.deepEqual((await conversations()).customNotes,{topic:'合成备注'});
  await page.reload();
  assert.deepEqual((await conversations()).customNotes,{topic:'合成备注'});
  assert.equal(await form.getByRole('button',{name:'继续核对上次候选'}).isVisible(),false);
  await say('直接记合成支出再告诉我金额');
  await chat.getByText('刚才记了 11 元。',{exact:true}).waitFor();
  assert.deepEqual(calls.at(-1).applied,['finance']);
  assert.equal(JSON.parse(await ledger()).transactions.at(-1).amount,11);
  assert.equal(await review.isVisible(),false);
  await say('直接删除合成直接支出');
  await chat.getByText(/已删除 1 条收支记录。.*合成直接支出/).waitFor();
  assert.equal(await ledger(),savedBatch);
  assert.equal(await review.isVisible(),false);
  await say('把合成餐点从90g改成50g并挪到晚餐');
  await chat.getByText(/已更正.*合成餐点.*90 g → 50 g.*午餐 → 晚餐/).waitFor();
  await page.evaluate(async(id)=>{
    const {readState,saveState}=await import('../health/storage.mjs');
    const state=await readState(),row=state.local.foods.find(row=>row.id===id);
    if(row?.portion!=='50 g'||row.meal!=='晚餐'||row.nutrition.kcal!==50)throw Error('incorrect food correction');
    const {reviseFoodPortion}=await import('../health/food-history.mjs');
    await saveState(reviseFoodPortion(state,{id,date:row.date,amount:90,unit:'g',newMeal:'午餐'}).next,state.revision);
  },food.id);
  assert.equal(await review.isVisible(),false);
  await say('只看看运动候选');
  await review.getByText('运动记录',{exact:true}).waitFor();
  await review.getByRole('button',{name:'放弃'}).click();
  await page.evaluate(()=>{
    const fetchRequest=window.fetch.bind(window);
    window.fetch=async(url,options)=>{
      const response=await fetchRequest(url,options);
      if(url==='https://api.openai.com/v1/responses'&&
         JSON.parse(JSON.parse(options.body).input[0].content[0].text).text==='权限关掉后拒绝本次保存'){
        await new Promise(resolve=>{window.releaseRevokedRequest=resolve;});
      }
      return response;
    };
  });
  await say('权限关掉后拒绝本次保存');
  await page.waitForFunction(()=>window.releaseRevokedRequest);
  await openAssistantSettings();
  await dataPermissions.click();
  await rootPermission.uncheck();
  await closeAssistantSettings();
  await page.evaluate(()=>window.releaseRevokedRequest());
  await chat.getByText('无法完成本轮写入。完整数据权限已关闭。',{exact:true}).waitFor();
  assert.equal(await ledger(),savedBatch);
  console.log('PASS opt-in direct raw and typed writes, explicit deletion, read-only preview and revocation');
  await form.locator('[name=allowRead]').check();
  const beforeAnalysis=calls.length;
  await say('分析合成月度分类支出');
  await chat.getByText('已按分类查看本月支出。',{exact:true}).waitFor();
  assert.equal(calls.length,beforeAnalysis+2);
  assert.equal(await ledger(),savedBatch);
  const twoImages=await page.evaluate(()=>['red','blue'].map(color=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=40;
   const paint=canvas.getContext('2d');paint.fillStyle=color;paint.fillRect(0,0,40,40);
   return canvas.toDataURL('image/png').split(',')[1];
  }));
  const beforePhotos=await foodCount();
  await form.locator('[name=image]').setInputFiles(twoImages.map((base64,i)=>({
   name:'image-'+i+'.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')
  })));
  await say('分别识别合成两张照片');
  const photos=chat.getByRole('region',{name:'照片识别结果'});
  await photos.getByRole('button',{name:'核对照片 2'}).click();
  assert.equal(await foodCount(),beforePhotos);
  assert.equal(await review.locator('label').filter({hasText:'匹配食品'}).locator('select').inputValue(),'');
  await review.getByRole('button',{name:'确认保存'}).click();
  await photos.getByText(/记录已保存/).waitFor();
  assert.equal(await foodCount(),beforePhotos+1);
  assert.equal(await page.evaluate(async()=>{
    const state=await (await import('../health/storage.mjs')).readState();
    return (await import('../health/core.mjs')).inventoryWithMoves(state).find(row=>row.id==='fixture').qty;
  }),4);
  await photos.getByRole('button',{name:'重试照片 1'}).click();
  await photos.getByRole('button',{name:'核对照片 1'}).click();
  assert.equal(await review.locator('label').filter({hasText:'匹配食品'}).locator('select').inputValue(),'fixture');
  await review.getByRole('button',{name:'放弃'}).click();
  await photos.getByText(/已放弃候选/).waitFor();
  await chat.getByText(/^这组共 2 张照片，已识别 2 张/).waitFor();
  await page.reload();
  await photos.getByText(/已放弃候选/).waitFor();
  await chat.getByText(/^这组共 2 张照片，已识别 2 张/).waitFor();
  assert.equal(await photos.getByRole('button',{name:/核对照片/}).count(),0);
  const photoCalls=calls.filter(call=>call.text==='分别识别合成两张照片');
  assert.equal(photoCalls.length,3);
  assert.notEqual(photoCalls[0].photo,photoCalls[1].photo);
  assert.equal(photoCalls[0].photo,photoCalls[2].photo);
  const photographedPortions=()=>page.evaluate(async()=>{
    const state=await (await import('../health/storage.mjs')).readState();
    const {inventoryWithMoves,batchBalances}=await import('../health/core.mjs');
    return {qty:inventoryWithMoves(state).find(row=>row.id==='fixture-pieces').qty,
      portions:batchBalances(state,'fixture-pieces').map(batch=>batch.remaining)};
  });
  await form.locator('[name=image]').setInputFiles({name:'portions.png',mimeType:'image/png',buffer:Buffer.from(pixels,'base64')});
  await say('记录照片里的合成分装');
  await review.getByRole('button',{name:'确认分装',exact:true}).waitFor();
  assert.deepEqual(await photographedPortions(),{qty:2,portions:[]});
  await review.getByRole('button',{name:'确认分装',exact:true}).click();
  await chat.getByText('已保存分装重量。',{exact:true}).waitFor();
  assert.deepEqual(await photographedPortions(),{qty:2,portions:[0.3,0.7]});
  console.log('PASS separate photos, individual retry, candidate confirmation and same-name one-off intake');
  await openAssistantSettings();
  const contextPanel=assistantSettings.locator('.assistant-context');
  await contextPanel.getByText('本轮上下文',{exact:true}).click();
  await contextPanel.getByRole('button',{name:'仅本轮'}).click();
  await contextPanel.getByText(/历史 0 条 · 0\/0 字/).waitFor();
  await closeAssistantSettings();
  const planBeforeDeletion=await foodCount();
  await say('删除合成计划');
  await review.getByText('核对要删除的饮食计划',{exact:true}).waitFor();
  assert.equal(await review.getByRole('checkbox').count(),1);
  await review.getByRole('button',{name:'确认删除'}).click();
  await review.getByText('请先勾选要删除的记录',{exact:true}).waitFor();
  assert.equal(await foodCount(),planBeforeDeletion);
  await review.getByRole('checkbox',{name:/合成餐点/}).check();
  await review.getByRole('button',{name:'确认删除'}).click();
  await chat.getByText('已删除 1 条饮食计划。',{exact:true}).waitFor();
  assert.equal(await foodCount(),planBeforeDeletion-1);

  const beforeFinanceDeletion=JSON.parse(await ledger());
  await say('删除合成午餐支出');
  await review.getByText('核对要删除的收支记录',{exact:true}).waitFor();
  await review.getByRole('checkbox',{name:/午餐.*¥28/}).check();
  await review.getByRole('button',{name:'确认删除'}).click();
  await review.waitFor({state:'hidden'});
  await chat.getByText('已删除 1 条收支记录。',{exact:true}).waitFor();
  const afterFinanceDeletion=JSON.parse(await ledger());
  assert.equal(afterFinanceDeletion.transactions.length,beforeFinanceDeletion.transactions.length-1);
  assert.deepEqual(afterFinanceDeletion.budgets,beforeFinanceDeletion.budgets);
  console.log('PASS selectable chat history, local USD accumulation, and confirmed plan and expense deletion');
  await say('把周期改为六天');
  await review.getByText('核对健康设置变更',{exact:true}).waitFor();
  const cycleDays=()=>page.evaluate(async()=>(await (await import('../health/storage.mjs')).readState()).settings.cycleDays);
  assert.notEqual(await cycleDays(),6);
  await review.getByRole('button',{name:'确认更新'}).click();
  await chat.getByText('健康设置已更新。',{exact:true}).waitFor();
  assert.equal(await cycleDays(),6);

  await page.evaluate(()=>{
    localStorage.setItem('airplane-ai-history-v1','rolling');
    const key='airplane-ai-conversations-v1',book=JSON.parse(localStorage.getItem(key));
    const thread=book.threads.find(row=>row.id===book.active);
    thread.messages=Array.from({length:50},(_,i)=>({role:'user',carry:true,text:'合成历史'+i+'营'.repeat(400)}));
    localStorage.setItem(key,JSON.stringify(book));
  });
  await page.reload();
  await say('验证压缩后接续');
  await chat.getByText('压缩后的对话已接续。',{exact:true}).waitFor();
  assert.equal(compactions,1);
  await page.reload();
  await say('验证压缩后接续');
  await page.waitForFunction(()=>document.querySelectorAll('.chat-bubble.assistant').length===2);
  assert.equal(compactions,1);
  assert.equal(await chat.getByText(/^合成历史0营/).count(),1);
  await chat.locator('[data-toggle-threads]').click();
  await chat.getByRole('region',{name:'对话记录',exact:true}).waitFor();
  await page.locator('.topbar h1').click();
  await chat.getByRole('region',{name:'对话记录',exact:true}).waitFor({state:'hidden'});
  console.log('PASS app data candidate confirmation, automatic compaction, reload reuse and outside history dismissal');
  await say('我的余额是多少');
  const balanceReply=chat.locator('.chat-bubble.assistant').filter({hasText:/^当前总余额 -?\d+(?:\.\d+)? 元。$/});
  await balanceReply.waitFor();
  const assistantBalance=Number((await balanceReply.textContent()).match(/-?\d+(?:\.\d+)?/)[0]);
  await chat.getByText('查看本次查询数据',{exact:true}).last().click();
  assert.match(await chat.locator('.chat-source pre').last().textContent(),/^当前总余额/);
  await page.evaluate(()=>{
   const fetchRequest=window.fetch.bind(window);
   window.fetch=(url,options)=>{
    if(url!=='https://api.openai.com/v1/responses')return fetchRequest(url,options);
    const input=JSON.parse(JSON.parse(options.body).input[0].content[0].text);
    if(input.text!=='离开再回来')return fetchRequest(url,options);
    const encoder=new TextEncoder();
    return Promise.resolve(new Response(new ReadableStream({start(controller){
     const event={type:'response.output_text.delta',output_index:0,content_index:0,delta:'{"reply":"可见的半截回复'};
     controller.enqueue(encoder.encode('data: '+JSON.stringify(event)+'\n\n'));
    }}),{headers:{'Content-Type':'text/event-stream'}}));
   };
  });
  await say('离开再回来');
  await chat.locator('.streaming-reply').getByText('可见的半截回复',{exact:true}).waitFor();
  await page.getByRole('link',{name:'健康',exact:true}).click();
  await page.getByRole('link',{name:'AI 助手'}).click();
  await chat.getByText('可见的半截回复',{exact:true}).waitFor();
  await chat.getByRole('button',{name:'重试这条消息'}).click();
  await chat.getByText('可以核对这张候选卡。',{exact:true}).last().waitFor();
  await review.waitFor();
  assert.equal(await chat.getByText('离开再回来',{exact:true}).count(),1);
  await review.getByRole('button',{name:'放弃'}).click();
  console.log('PASS returning from another page keeps the interrupted reply and retries without duplicating the question');
  const callsBeforeKeyRemoval=calls.length;
  await openAssistantSettings();
  await assistantSettings.getByText('API Key',{exact:true}).click();
  await access.locator('[data-remove]').click();await access.getByText('已移除本机 Key').waitFor();
  await closeAssistantSettings();
  await say('未授权的请求');
  await chat.getByText('请先导入 API Key',{exact:true}).waitFor();
  await access.waitFor();
  assert.equal(calls.length,callsBeforeKeyRemoval);
  await closeAssistantSettings();
  console.log('PASS streamed preview before completion, validated final proposal and no unconfirmed ledger writes');
  await page.getByRole('link',{name:'账本',exact:true}).click();
  assert.equal(Number((await page.locator('.balance-value').textContent()).replace(/[^0-9.\-]/g,'')),assistantBalance);
  console.log('PASS assistant balance lookup matches the finance card and sends only the total');
  console.log('PASS shared day picker, legacy export, shared key, chat follow-ups and confirmed finance, health and inventory writes');

  // Start in finance, reuse the saved expense, then start a separate purchase in inventory.
  await page.locator('#addButton').click();await page.locator('#txAmount').fill('18');
  await page.locator('#txNote').fill('试验采购');
  const clock=page.locator('.calendar-field').filter({has:page.locator('#txTime')});
  assert.equal(await clock.locator('.calendar-trigger').evaluate(button=>getComputedStyle(button).borderTopWidth),'0px');
  await clock.locator('.calendar-trigger').click();
  const clockMenu=clock.locator('.calendar-menu');
  await clockMenu.getByRole('button',{name:'小时 18',exact:true}).click();
  await clockMenu.getByRole('button',{name:'分钟 05',exact:true}).click();
  await clockMenu.getByRole('button',{name:'确定',exact:true}).click();
  assert.equal(await page.locator('#txTime').inputValue(),'18:05');
  assert.equal(await page.locator('#txTime').locator('..').locator('.calendar-value').textContent(),'18:05');
  await page.getByRole('button',{name:'保存食品支出并同步入库'}).click();
  const buy=page.locator('#purchase-form');
  await page.waitForFunction(()=>document.querySelector('#purchase-form [name=time]')?.value==='18:05');
  const purchaseField=buy.locator('.inline-field:has(select[name=foodId])');
  const purchasePicker=purchaseField.locator('.inline-picker-panel');
  const purchaseTrigger=purchaseField.locator('.choice-trigger');
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});
    for(const name of ['date','time','expires']){
      await checkPickerSpacing(buy.locator('.calendar-field:has([name="'+name+'"]) .calendar-trigger'));
    }
    await checkPickerSpacing(purchaseTrigger);
  }
  assert.ok(await buy.locator('.calendar-field:has([name=date]) .calendar-value').evaluate(value=>{
    const [year,day]=value.querySelectorAll('span');
    return year.getBoundingClientRect().top===day.getBoundingClientRect().top;
  }));
  await purchaseTrigger.click();
  await purchasePicker.waitFor();
  assert.equal(await page.getByRole('dialog',{name:'选择食品'}).count(),0);
  const triggerBox=await purchaseTrigger.boundingBox();
  const pickerGap=(await purchasePicker.boundingBox()).y-triggerBox.y-triggerBox.height;
  assert.ok(pickerGap>=0&&pickerGap<8);
  await purchasePicker.getByRole('searchbox').fill('不存在的合成食品');
  await purchasePicker.getByText('没有匹配的选项').waitFor();
  await purchasePicker.getByRole('searchbox').fill('合成库存');
  await purchasePicker.getByRole('button',{name:/^合成库存/}).click();
  await purchasePicker.waitFor({state:'hidden'});
  await purchaseTrigger.click();
  await purchasePicker.getByRole('searchbox').press('Escape');
  await purchasePicker.waitFor({state:'hidden'});
  await buy.getByRole('button',{name:/^选择食品，合成库存/}).waitFor();
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
  await openBackups();
  const bothDownload=page.waitForEvent('download');await combined.locator('[data-export]').click();
  const both=JSON.parse(readFileSync(await (await bothDownload).path(),'utf8'));
  assert.equal(both.finance.data.transactions.length,count+1);
  assert.equal(both.health.local.purchases.length,2);
  await combined.locator('[name=finance]').uncheck();
  await combined.locator('[type=file]').setInputFiles({name:'both.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(both))});
  assert.doesNotMatch(await combined.locator('[data-import-summary]').innerText(),/财务/);
  await combined.getByRole('button',{name:'确认导入'}).click();
  await page.locator('#toast').getByText('备份已恢复').waitFor();
  assert.equal(JSON.parse(await ledger()).transactions.length,count+1);
  const edited=JSON.parse(await ledger());
  edited.transactions.pop();
  await page.evaluate(edited=>localStorage.setItem('airplane-pwa-v1',JSON.stringify(edited)),edited);
  await page.locator('#health-settings').click();await openBackups();
  await combined.locator('[name=finance]').check();
  await combined.locator('[type=file]').setInputFiles({name:'both.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(both))});
  await combined.getByRole('button',{name:'确认导入'}).click();
  await page.waitForFunction(expected=>JSON.parse(localStorage.getItem('airplane-pwa-v1')).transactions.length===expected,count+1);
  await page.locator('[data-tab="inventory"]').click();
  const purchaseRow=amount=>page.locator('#purchases-list p').filter({hasText:'¥'+amount});
  assert.equal(await page.locator('#purchases-list').isVisible(),false);
  assert.equal(await page.locator('#sku-form').isVisible(),false);
  await page.locator('#purchase-panel > summary').click();
  const orderToEdit=purchaseRow('6.00');
  await orderToEdit.getByRole('button',{name:'编辑采购'}).click();
  assert.ok(await orderToEdit.evaluate(row=>row.nextElementSibling?.id==='purchase-form'));
  await buy.locator('[name=total]').fill('9');
  await buy.locator('[name=quantity]').fill('3');
  await buy.locator('[name=cost]').fill('9');
  await buy.locator('[type=submit]').click();
  await page.getByRole('dialog',{name:'核对采购修改'}).getByRole('button',{name:'确认修改'}).click();
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
    catch(err){if(err.message.includes('待同步'))return;}
    throw Error('unrelated writes are not blocked during recovery');
  });
  await page.reload();await page.locator('[data-tab="inventory"]').click();
  await page.locator('#purchase-panel > summary').click();
  await purchaseRow('11.00').filter({hasText:'已关联支出'}).waitFor();
  assert.equal(JSON.parse(await ledger()).transactions.find(t=>t.id.startsWith('expense-purchase-')).amount,11);
  await purchaseRow('11.00').getByRole('button',{name:'撤销采购'}).click();
  const withdraw=page.getByRole('dialog',{name:'撤销采购'});
  await withdraw.waitFor();
  await page.mouse.click(8,8);
  await withdraw.waitFor({state:'hidden'});
  assert.equal(JSON.parse(await ledger()).transactions.find(t=>t.id.startsWith('expense-purchase-')).amount,11);
  await purchaseRow('11.00').getByRole('button',{name:'撤销采购'}).click();
  await withdraw.getByRole('button',{name:'确认撤销'}).click();
  await purchaseRow('11.00').filter({hasText:'已撤销'}).waitFor();
  assert.equal(JSON.parse(await ledger()).transactions.length,count);
  assert.equal(await quantity(),6);

  // The list can feed a purchase draft without touching inventory until confirmation.
  await page.locator('#inventory-list').getByRole('button',{name:'合成库存'}).click();
  await page.locator('#inventory-list').getByRole('button',{name:'编辑食品',exact:true}).click();
  await page.locator('#sku-form').waitFor();
  assert.equal(await page.locator('[data-stock-id="fixture"] #sku-form').count(),1);
  await page.locator('#sku-form [data-close-stock-editor]').click();
  await page.locator('[data-stock-id="fixture"]').getByRole('button',{name:'记录分装'}).click();
  assert.equal(await page.locator('[data-stock-id="fixture"] #split-form').count(),1);
  await page.locator('#split-form [data-close-stock-editor]').click();
  await page.locator('[data-stock-id="fixture"]').getByRole('button',{name:'编辑食品',exact:true}).click();
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
  await page.getByRole('dialog',{name:'恢复财务备份'}).getByRole('button',{name:'确认恢复'}).click();
  await page.getByText('synthetic legacy ent…',{exact:true}).waitFor();
  assert.deepEqual(JSON.parse(await ledger()),backup.data);
  // The demo uses its own stored thread and ledger through the same review UI.
  await page.goto(base+'assistant/');
  await openAssistantSettings();
  await memorySettings.getByText('记忆',{exact:true}).click();
  await autoMemory.check();
  await assistantSettings.getByText('API Key',{exact:true}).click();
  await access.locator('[name=key]').fill(testKey);
  await access.locator('[type=submit]').click();
  await access.getByText('已保存 Key',{exact:true}).waitFor();
  await closeAssistantSettings();
  const beforeAuto=calls.length;
  await say('我平时用牛肉酱喜欢少放一点');
  await chat.getByText('已记住 「酱料用量偏好」。',{exact:true}).waitFor();
  assert.equal(calls.length,beforeAuto+1);
  await chat.getByRole('button',{name:'新对话',exact:true}).click();
  await openAssistantSettings();
  await dataPermissions.click();
  await rootPermission.check();
  await closeAssistantSettings();
  const sauceId=await page.evaluate(async()=>{
    const {readState,saveState}=await import('../health/storage.mjs');
    const {saveSku}=await import('../health/inventory.mjs');
    const state=await readState();
    const sauce=saveSku(state,{name:'合成牛肉酱',unit:'瓶',basisUnit:'g',basisAmount:100,kcal:200,sodium:800});
    sauce.qty=1;
    await saveState(state,state.revision??0);
    return sauce.id;
  });
  await say('晚餐用库存里的合成牛肉酱，初始360g，吃到322.2g');
  await chat.getByText('记录已保存。 合成牛肉酱 用了 37.8 g，剩余 322.2 g（含瓶）。',{exact:true}).waitFor();
  assert.equal(await review.isVisible(),false);
  await page.getByRole('link',{name:'健康',exact:true}).click();
  await page.waitForFunction(()=>typeof document.getElementById('health-settings')?.onclick==='function');
  await page.locator('[data-tab="inventory"]').click();
  const sauceRow=page.locator('[data-stock-id="'+sauceId+'"]');
  await sauceRow.getByText('已开1瓶',{exact:true}).waitFor();
  await sauceRow.locator('[data-stock-expand]').click();
  await sauceRow.locator('[data-open-package]').getByText(/最新毛重 322.2 g · 净余未知/).waitFor();
  console.log('PASS automatic memory in one request across chats and direct sauce-bottle gross weighing');

  await page.goto(base+'assistant/?demo=1');
  for(const viewport of [{width:320,height:568},{width:1280,height:800}]){
    await page.setViewportSize(viewport);
    assert.ok(await form.evaluate(form=>form.getBoundingClientRect().bottom<=innerHeight));
    await openAssistantSettings();
    assert.ok(await assistantSettings.locator('#assistant-memory .chevron svg').evaluate(icon=>icon.getBoundingClientRect().width===16));
    await assistantSettings.getByText('本轮上下文',{exact:true}).click();
    await assistantSettings.getByText(/历史 0 条/).waitFor();
    assert.ok(await assistantSettings.evaluate(sheet=>sheet.scrollWidth===sheet.clientWidth));
    await assistantSettings.getByText('本轮上下文',{exact:true}).click();
    await closeAssistantSettings();
  }
  await page.setViewportSize({width:390,height:844});
  await chat.getByRole('button',{name:'查昨天饮食'}).click();
  await form.getByRole('button',{name:'发送',exact:true}).click();
  await chat.getByText('记录里有燕麦 60 g、牛奶 250 g。',{exact:true}).waitFor();
  await chat.getByText('查看本次饮食记录 · 2 条',{exact:true}).waitFor();
  await page.reload();
  await chat.getByText('查看本次饮食记录 · 2 条',{exact:true}).click();
  await chat.locator('.chat-source').getByText(/牛奶 · 250 g/).waitFor();
  await say('牛奶那条改成 300g');
  await review.getByText('250 g → 300 g',{exact:true}).waitFor();
  assert.equal(await review.getByText('牛奶 500 → 450 g',{exact:true}).count(),1);
  const demoMilk=()=>page.evaluate(async()=>{
    const {demoWorkspace}=await import('../ai/demo.mjs'),{localDate}=await import('../calendar.mjs');
    return (await (await demoWorkspace(localDate())).readHealth()).local.foods.filter(row=>row.name==='牛奶');
  });
  const original=(await demoMilk())[0];
  assert.equal(original.portion,'250 g');
  await review.getByRole('button',{name:'确认更正'}).click();
  await chat.getByText('已更正原饮食记录，并重新计算当日营养和关联库存。',{exact:true}).waitFor();
  const milk=await demoMilk();
  assert.deepEqual(milk.map(row=>[row.id,row.portion,row.nutrition.kcal]),[[original.id,'300 g',186]]);
  await chat.getByRole('button',{name:'新对话',exact:true}).click();
  await chat.getByRole('button',{name:'查库存和支出'}).click();
  await form.getByRole('button',{name:'发送',exact:true}).click();
  await chat.getByText('查到 3 种食品，今天已支出 12 元。',{exact:true}).waitFor();
  await chat.getByText('查看本轮 2 次查询的数据',{exact:true}).click();
  await chat.locator('.chat-source').getByText(/燕麦 · 390 g/).waitFor();
  await chat.locator('.chat-source').getByText(/支出 12 元/).waitFor();
  await chat.locator('[data-toggle-threads]').click();
  const deleteFoodChat=history.getByRole('button',{name:'删除对话 昨天吃了什么',exact:true});
  await deleteFoodChat.click();
  await history.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await deleteFoodChat.isVisible(),true);
  await deleteFoodChat.click();
  await history.getByRole('button',{name:'确认删除',exact:true}).click();
  await page.reload();
  await chat.locator('[data-toggle-threads]').click();
  await history.getByRole('button',{name:/^查库存和今日支出/}).waitFor();
  assert.equal(await deleteFoodChat.count(),0);
  assert.deepEqual(await demoMilk(),milk);
  await history.getByRole('button',{name:'删除对话 查库存和今日支出',exact:true}).click();
  await history.getByRole('button',{name:'确认删除',exact:true}).click();
  await history.getByText('还没有对话记录').waitFor();
  assert.equal(await chat.getByText('查到 3 种食品，今天已支出 12 元。',{exact:true}).count(),0);
  assert.deepEqual(await demoMilk(),milk);
  console.log('PASS automatically scoped ledger reads and local deletion of active and inactive chats');
  await page.getByRole('link',{name:'健康',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#hero-goal').textContent.includes('kcal'));
  await page.getByRole('button',{name:'前一天'}).click();
  const milkRow=page.locator('#local-events').getByRole('button',{name:/牛奶.*186\.0 kcal/});
  await milkRow.waitFor();
  assert.doesNotMatch(await milkRow.innerText(),/300\.0 g|08:15/);
  await page.getByRole('link',{name:'AI 助手'}).click();
  const demoLedger=()=>page.evaluate(async()=>{
    const {demoWorkspace}=await import('../ai/demo.mjs'),{localDate}=await import('../calendar.mjs');
    return JSON.parse((await demoWorkspace(localDate())).finance.getItem('airplane-pwa-v1'));
  });
  const originalDemoLedger=await demoLedger();
  await chat.getByRole('button',{name:'更正饮食、记账并安排晚餐'}).click();
  await form.getByRole('button',{name:'发送',exact:true}).click();
  await review.getByText('核对 2 项账本变更',{exact:true}).waitFor();
  await review.getByRole('button',{name:'确认全部并继续'}).click();
  await review.locator('output').getByText(/没有变化/).waitFor();
  assert.deepEqual(await demoLedger(),originalDemoLedger);
  await review.getByLabel('新份量（g）').fill('320');
  await page.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(key?.startsWith('member:demo-')&&value?.appType==='airplane-health-v1'){
        IDBObjectStore.prototype.put=put;
        throw Error('synthetic assistant finalization failure');
      }
      return put.call(this,value,key);
    };
  });
  await review.getByRole('button',{name:'确认全部并继续'}).click();
  await review.locator('output').getByText(/财务已保存，健康账本待同步/).waitFor();
  assert.equal((await demoMilk())[0].portion,'300 g');
  const stagedLedger=await demoLedger();
  assert.equal(stagedLedger.transactions.length,originalDemoLedger.transactions.length+1);
  await review.getByRole('button',{name:'继续同步',exact:true}).click();
  await chat.getByText(/更新后的牛奶库存是 430 g/).waitFor();
  assert.deepEqual(await demoLedger(),stagedLedger);
  assert.deepEqual((await demoMilk()).map(row=>[row.id,row.portion,row.nutrition.kcal]),[[original.id,'320 g',198.4]]);
  await review.getByRole('button',{name:'保存为饮食计划'}).click();
  await chat.getByText('已保存饮食计划。',{exact:true}).waitFor();
  assert.deepEqual(await demoLedger(),stagedLedger);
  console.log('PASS invalid batch leaves both ledgers intact, interrupted local commit settles once and dinner uses fresh inventory');
  await openAssistantSettings();
  await dataPermissions.click();
  await rootPermission.check();
  await closeAssistantSettings();
  await say('记住我晚餐优先配蔬菜');
  await chat.getByText('已记住「晚餐偏好」。',{exact:true}).waitFor();
  assert.equal(await review.isVisible(),false);
  await chat.getByRole('button',{name:'新对话',exact:true}).click();
  await page.reload();
  await openAssistantSettings();
  await memorySettings.getByText('记忆',{exact:true}).click();
  await memorySettings.getByText('我晚餐优先配蔬菜',{exact:true}).waitFor();
  await memorySettings.getByRole('button',{name:'删除 晚餐偏好',exact:true}).click();
  await memorySettings.getByText('已删除记忆。',{exact:true}).waitFor();
  assert.equal(await memorySettings.getByText('我晚餐优先配蔬菜',{exact:true}).count(),0);
  await closeAssistantSettings();
  console.log('PASS explicit memory writes persist across threads and reload, with local deletion');
  const mergeContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  try{
   const mergePage=await mergeContext.newPage();
   await mergePage.goto(base+'health/');
   const openSettings=mergePage.locator('#health-settings');
   await openSettings.waitFor();
   await mergePage.waitForFunction(()=>typeof document.getElementById('health-settings')?.onclick==='function');
   const oldDay='2020-01-01';
   const historical={日期:oldDay,餐次:'午餐','食物/饮品':'合成历史午餐 300g','份量/重量':'300g',状态:'已吃',kcal:450};
   const inherited={ledger_id:'browser-merge-fixture',handoff_version:'301120.1',updated_at:oldDay+'T12:00:00Z',tables:{
    food_events:[historical],food_inventory:[],weight_events:[],daily_summaries:[{日期:oldDay,kcal:450}]
   }};
   const tidy=structuredClone(inherited);
   tidy.handoff_version+='-整理';
   tidy.tables.food_events[0]['食物/饮品']='合成历史午餐';
   tidy.tables.food_events[0]['原食物/饮品名称']=historical['食物/饮品'];
   const fixture=await mergePage.evaluate(async tidy=>{
    const {saveState}=await import('./storage.mjs');
    const {addFood,normalizeLedger}=await import('./core.mjs');
    const {freshData,replaceFinance,STORAGE_KEY}=await import('../finance-storage.mjs');
    const {localDate}=await import('../calendar.mjs');
    const state=normalizeLedger(tidy),date=localDate();
    addFood(state,{date,meal:'午餐',name:'合成午餐',portion:'100 g',kcal:150});
    await saveState(state,0);
    const finance=freshData();
    finance.budgets[date.slice(0,7)]=321;
    finance.transactions.push({id:'merge-fixture-expense',type:'expense',amount:9,date,categoryId:'default-1'});
    replaceFinance(localStorage,finance,null);
    return {date,finance:localStorage.getItem(STORAGE_KEY)};
   },tidy);
   const dinner={日期:fixture.date,餐次:'晚餐','食物/饮品':'合成晚餐','份量/重量':'70g',状态:'实际',kcal:75};
   const external=structuredClone(inherited);
   external.handoff_version='301120.2';
   external.tables.food_events.push({日期:fixture.date,餐次:'午餐','食物/饮品':'合成午餐','份量/重量':'110g',状态:'实际',kcal:175},dinner);
   external.tables.daily_summaries.push({日期:fixture.date,kcal:250});
   const json={name:'health_tracker_301120.1.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(external))};
   await openSettings.click();
   const mergePanel=mergePage.locator('#health-merge');
   await mergePanel.locator(':scope > summary').click();
   const submit=mergePanel.locator('[data-sync-apply]');
   const importFile=()=>mergePanel.locator('[data-sync-file]').setInputFiles(json);
   const read=()=>mergePage.evaluate(async()=>{
    const {readState,readRestoreSnapshot}=await import('./storage.mjs');
    return {state:await readState(),snapshot:await readRestoreSnapshot()??null,finance:localStorage.getItem('airplane-pwa-v1')};
   });
   await importFile();
   await mergePanel.locator('[data-sync-keep]').waitFor();
   assert.equal(await submit.isEnabled(),false);
   assert.equal(await mergePanel.locator('[data-sync-group="review"] .sync-change').count()>0,true);
   assert.equal(await mergePanel.locator('.sync-change').filter({hasText:'合成历史午餐'}).count(),0);
   await mergePanel.locator('[data-sync-keep]').click();
   assert.equal(await mergePanel.locator('[data-sync-group="kept"]').evaluate(node=>node.open),false);
   await submit.waitFor();
   assert.equal((await read()).state.revision,1);
   assert.equal((await read()).snapshot,null);
   await mergePage.evaluate(()=>{
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
     if(key==='main')throw Error('合并中断合成测试');
     return put.call(this,value,key);
    };
    window.restoreFixturePut=()=>{IDBObjectStore.prototype.put=put;};
   });
   await submit.click();
   await mergePage.getByText('合并中断合成测试',{exact:true}).waitFor();
   const failed=await read();
   assert.equal(failed.state.revision,1);
   assert.equal(failed.snapshot,null);
   assert.equal(failed.finance,fixture.finance);
   await mergePage.evaluate(()=>window.restoreFixturePut());
   await submit.click();
   await mergePage.getByText('已合并到本机，已保留合并前完整快照。',{exact:true}).waitFor();
   const merged=await read();
   assert.equal(merged.state.revision,2);
   assert.equal(merged.snapshot.health.local.foods[0].name,'合成午餐');
   assert.equal(merged.snapshot.health.legacy.foods.length,1);
   assert.deepEqual(merged.snapshot.finance.data,JSON.parse(fixture.finance));
   assert.equal(merged.finance,fixture.finance);
   assert.equal(merged.state.legacy.foods.length,2);
   assert.equal(merged.state.legacy.foods[1].name,'合成晚餐');
   assert.equal(await mergePage.evaluate(async date=>{
    const [{readState},{dayIntake}]=await Promise.all([import('./storage.mjs'),import('./core.mjs')]);
    return dayIntake(await readState(),date).totals.kcal;
   },oldDay),450);
   await importFile();
   await mergePanel.locator('[data-sync-summary]').filter({hasText:'已导入'}).waitFor();
   assert.equal(await submit.isEnabled(),false);
   const downloaded=mergePage.waitForEvent('download');
   await mergePanel.locator('[data-sync-export]').click();
   const exported=JSON.parse(readFileSync(await (await downloaded).path(),'utf8'));
   assert.equal(exported.format,'airplane-health-sync-v1');
   assert.equal(exported.anchor.revision,2);
   assert.ok(exported.health.legacy.foods.some(row=>row.name==='合成晚餐'));
   const backup=mergePage.locator('#combined-backup');
   await backup.locator(':scope > summary').click();
   const snapshotDownload=mergePage.waitForEvent('download');
   await backup.getByRole('button',{name:'导出最近一次恢复或合并前快照'}).click();
   assert.deepEqual(JSON.parse(readFileSync(await (await snapshotDownload).path(),'utf8')),merged.snapshot);
   console.log('PASS shared history, read-only merge preview, atomic recovery on abort, unchanged finance, repeat import and sync export');
  }finally{await mergeContext.close();}
  assert.deepEqual(errors,[]);
  console.log('PASS dated food lookup, thread reload, confirmed in-place correction and health timeline');
  console.log('PASS damaged finance recovery and synthetic-only fixtures');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
