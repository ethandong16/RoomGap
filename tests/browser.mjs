import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.ROOMGAP_PLAYWRIGHT_MODULE?pathToFileURL(process.env.ROOMGAP_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.ROOMGAP_TEST_URL||'http://127.0.0.1:4173';
const results=[],errors=[];
await mkdir('artifacts',{recursive:true});
const check=async(name,fn)=>{await fn();results.push(name);console.log(`PASS ${name}`);};
async function context(options={}){
  const c=await browser.newContext({viewport:{width:1440,height:1080},locale:'zh-CN',timezoneId:'Asia/Shanghai',...options});
  c.on('page',p=>{p.on('pageerror',error=>errors.push(error.message));});
  return c;
}
async function settled(page){await page.waitForFunction(()=>document.querySelector('#results-section').getAttribute('aria-busy')==='false');}
async function ready(page){await page.waitForFunction(()=>document.querySelector('#results-section').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.room-card').length>0);}
async function count(page,n){await page.waitForFunction(n=>document.querySelector('#result-count').textContent===`${n} 间`,n);}
async function date(page,value){await page.locator('#date').evaluate((element,next)=>{element.value=next;element.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function setPeriods(page,periods){
  for(const period of periods){
    const button=page.locator(`.period-option[data-period="${period}"]`);
    if(await button.getAttribute('aria-pressed')!=='true')await button.click();
  }
  const selected=await page.locator('.period-option[aria-pressed="true"]').evaluateAll(buttons=>buttons.map(button=>Number(button.dataset.period)));
  for(const period of selected.filter(period=>!periods.includes(period)))await page.locator(`.period-option[data-period="${period}"]`).click();
}
try{
 const desktop=await context(),page=await desktop.newPage();
 await page.clock.setFixedTime(new Date('2026-09-08T04:00:00Z'));
 await page.goto(base);await settled(page);
 await check('desktop initial screen and content',async()=>{
   assert.equal(await page.locator('#candidate-count').textContent(),'384');
   assert.equal(await page.locator('#campus-count').textContent(),'3');
   assert.equal(await page.locator('.period-option').count(),13);
   assert.deepEqual(await page.locator('.period-option[aria-pressed="true"]').evaluateAll(buttons=>buttons.map(button=>Number(button.dataset.period))),[]);
   assert.equal(await page.locator('#period-selection-count').textContent(),'未选节次');
   assert.match(await page.locator('#state-panel').textContent(),/请选择节次/);
   await page.locator('.period-preset').first().click();
   assert.deepEqual(await page.locator('.period-option[aria-pressed="true"]').evaluateAll(buttons=>buttons.map(button=>Number(button.dataset.period))),[1,2,3,4]);
   assert.equal(await page.locator('.period-preset').first().getAttribute('aria-pressed'),'true');
   await page.locator('.period-clear').click();
   assert.equal(await page.locator('.period-option[aria-pressed="true"]').count(),0);
   assert.equal(await page.locator('#date-picker').isVisible(),true);
   const dateHitTarget=await page.locator('.date-picker-shell').evaluate(shell=>{
     const rect=shell.getBoundingClientRect();
     return document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.id;
   });
   assert.equal(dateHitTarget,'date');
   await page.evaluate(()=>{
     window.__roomgapPickerCalls=0;
     HTMLInputElement.prototype.showPicker=function(){window.__roomgapPickerCalls++;};
   });
   await page.locator('.date-picker-shell').click();
   assert.equal(await page.evaluate(()=>window.__roomgapPickerCalls),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await page.locator('#back-to-top').getAttribute('data-visible'),'false');
   await page.locator('.period-preset').first().click();await ready(page);
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
   await page.locator('#back-to-top[data-visible="true"]').waitFor();
   await page.locator('#back-to-top').click();
   await page.waitForFunction(()=>scrollY===0);
   await page.waitForFunction(()=>document.querySelector('#back-to-top').dataset.visible==='false');
   await page.locator('.period-clear').click();
 await page.screenshot({path:'artifacts/desktop.png'});
 });
 await check('theme follows the device and remembers manual choices',async()=>{
   const c=await context({colorScheme:'dark'}),p=await c.newPage();await p.goto(base);await settled(p);
   assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
   assert.equal(await p.locator('html').getAttribute('data-theme-preference'),'system');
   assert.equal(await p.locator('.theme-option[data-theme="system"]').getAttribute('aria-checked'),'true');
   await p.screenshot({path:'artifacts/desktop-dark.png',fullPage:true});
   await p.locator('.theme-option[data-theme="light"]').click();
   assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
   assert.equal(await p.evaluate(()=>localStorage.getItem('roomgap-theme')),'light');
   await p.reload();await settled(p);assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
   await p.locator('.theme-option[data-theme="system"]').click();
   assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
   await p.emulateMedia({colorScheme:'light'});
   await p.waitForFunction(()=>document.documentElement.dataset.theme==='light');
   await p.locator('.theme-option[data-theme="system"]').focus();await p.keyboard.press('ArrowRight');
   assert.equal(await p.locator('html').getAttribute('data-theme-preference'),'light');
   await c.close();
 });
 await check('author contacts use an icon-only modal and restore focus',async()=>{
   await desktop.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(base).origin});
   const trigger=page.locator('#author-trigger');await trigger.click();
   const dialog=page.locator('#author-dialog');
   assert.equal(await dialog.isVisible(),true);
   assert.equal(await dialog.locator('.author-link').count(),4);
   assert.deepEqual(await dialog.locator('.author-link').evaluateAll(links=>links.map(link=>link.getAttribute('aria-label'))),['GitHub','X','Email','复制 QQ 号']);
   assert.doesNotMatch(await dialog.innerText(),/GitHub|Email|QQ|\bX\b/);
   await dialog.locator('#copy-qq').click();
   await page.waitForFunction(()=>document.querySelector('#author-copy-status').textContent==='已复制到剪贴板');
   assert.equal(await dialog.locator('#author-copy-status').textContent(),'已复制到剪贴板');
   assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'2675943788');
   await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);
   assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
 });
 await check('bottom helper copy uses consistent typography and spacing',async()=>{
   const typography=await page.locator('#data-note p, #author-trigger, .footer-disclaimer').evaluateAll(elements=>elements.map(element=>{
     const style=getComputedStyle(element);return {fontSize:style.fontSize,lineHeight:style.lineHeight};
   }));
   assert.equal(new Set(typography.map(style=>style.fontSize)).size,1);
   assert.equal(new Set(typography.map(style=>style.lineHeight)).size,1);
   assert.deepEqual(await page.locator('#data-note p + p').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).marginTop)),['4px','4px','4px']);
 });
 await check('known 19-room query and combined filters',async()=>{
   await setPeriods(page,[1,2,3,4]);await ready(page);await date(page,'2026-09-08');await page.locator('#campus').selectOption('04');await count(page,19);
   await page.locator('#building').selectOption('04/11');await page.locator('#search').fill('111');await page.locator('#capacity').selectOption('100');await count(page,1);
   assert.match(await page.locator('.room-card h3').textContent(),/111/);
 });
 await check('keyboard details, 13 states, Escape and focus restoration',async()=>{
   const trigger=page.locator('.room-card button');await trigger.focus();await page.keyboard.press('Enter');
   assert.equal(await page.locator('#room-dialog').isVisible(),true);
   assert.equal(await page.locator('.detail-period').count(),13);assert.equal(await page.locator('.detail-period.chosen').count(),4);
   await page.screenshot({path:'artifacts/desktop-detail.png'});
   await page.keyboard.press('Escape');assert.equal(await page.locator('#room-dialog').isVisible(),false);
   assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
 });
 await check('empty results and clear additional filters',async()=>{
   await page.locator('#search').fill('no-room-with-this-name');await count(page,0);
   assert.equal(await page.locator('.room-card').count(),0);
   await page.locator('#state-action').click();await count(page,19);
 });
 await check('campus preference and accessible progressive results',async()=>{
   await page.reload();await settled(page);assert.equal(await page.locator('#campus').inputValue(),'04');await setPeriods(page,[1,2]);await ready(page);
   await page.locator('#campus').selectOption('');await ready(page);
   assert.equal(await page.locator('.room-card').count(),24);
   await page.locator('.room-card').first().locator('button').focus();
   await page.locator('#load-more').scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelectorAll('.room-card').length===48);
   assert.equal(await page.locator('.room-card').first().locator('button').evaluate(el=>el===document.activeElement),true);
   const total=parseInt(await page.locator('#result-count').textContent());
   while(await page.locator('.room-card').count()<total){
     const before=await page.locator('.room-card').count();
     await page.locator('#load-more').scrollIntoViewIfNeeded();
     await page.waitForFunction(before=>document.querySelectorAll('.room-card').length>before,before);
   }
   assert.equal(await page.locator('.room-card').count(),total);
   assert.equal(await page.locator('#load-more').textContent(),`已显示全部 ${total} 间教室`);
   assert.equal(await page.locator('[data-room]').evaluateAll(buttons=>new Set(buttons.map(b=>b.dataset.room)).size),total);
 });
 await check('reset restores every query filter',async()=>{
   await date(page,'2026-09-10');await page.locator('#campus').selectOption('04');await setPeriods(page,[3,6]);
   await page.locator('#building').selectOption('04/11');await page.locator('#search').fill('111');await page.locator('#capacity').selectOption('60');
   await page.locator('#reset-filters').click();await settled(page);
   assert.equal(await page.locator('#date').inputValue(),'2026-09-08');assert.equal(await page.locator('#campus').inputValue(),'');
   assert.equal(await page.locator('#building').inputValue(),'');assert.equal(await page.locator('#search').inputValue(),'');assert.equal(await page.locator('#capacity').inputValue(),'0');
   assert.equal(await page.locator('.period-option[aria-pressed="true"]').count(),0);assert.match(await page.locator('#state-panel').textContent(),/请选择节次/);
   assert.equal(await page.evaluate(()=>localStorage.getItem('roomgap-campus')),'');
 });
 await check('term limits, cross-month navigation and non-contiguous periods',async()=>{
   await setPeriods(page,[1,2]);await ready(page);
   await date(page,'2026-08-31');await ready(page);assert.equal(await page.locator('#previous-day').isDisabled(),true);
   await page.locator('#next-day').click();await ready(page);assert.equal(await page.locator('#date').inputValue(),'2026-09-01');
   await date(page,'2027-01-17');await ready(page);assert.equal(await page.locator('#next-day').isDisabled(),true);
   await setPeriods(page,[4,9]);
   assert.deepEqual(await page.locator('.period-option[aria-pressed="true"]').evaluateAll(buttons=>buttons.map(button=>Number(button.dataset.period))),[4,9]);
   assert.match(await page.locator('#selection-summary').textContent(),/第 4、9 节/);
   await date(page,'2026-08-30');assert.equal(await page.locator('.room-card').count(),0);
   await date(page,'2026-09-08');await ready(page);
 });
 await check('failed catalog and retry',async()=>{
   const c=await context(),p=await c.newPage();let fail=true;
   await p.route('**/schema.json',route=>fail?(fail=false,route.fulfill({status:503,body:'unavailable'})):route.continue());
   await p.goto(base);await p.locator('#state-action').waitFor();assert.equal(await p.locator('.room-card').count(),0);
   await p.locator('#state-action').click();await settled(p);await setPeriods(p,[1,2]);await ready(p);await c.close();
 });
 await check('daily load failure and version mismatch recover without false availability',async()=>{
   await setPeriods(page,[1,2]);
   let fail=true;
   await page.route('**/days/2026-09-11.json',route=>fail?(fail=false,route.fulfill({status:503,body:'unavailable'})):route.continue());
   await date(page,'2026-09-11');await page.locator('#state-action').waitFor();assert.equal(await page.locator('.room-card').count(),0);
   await page.locator('#state-action').click();await ready(page);
   let mismatch=true;
   await page.route('**/days/2026-09-12.json',async route=>{
     if(!mismatch)return route.continue();mismatch=false;
     const response=await route.fetch(),json=await response.json();json.catalogDigest='wrong-version';
     await route.fulfill({response,json});
   });
   await date(page,'2026-09-12');await page.locator('#state-action').waitFor();assert.equal(await page.locator('.room-card').count(),0);
   assert.match(await page.locator('#state-panel').textContent(),/版本不一致/);
   await page.locator('#state-action').click();await ready(page);
 });
 await check('slow prior request cannot overwrite latest date',async()=>{
   let release,entered=false,finished=false;const gate=new Promise(resolve=>release=resolve);
   await page.route('**/days/2026-09-13.json',async route=>{entered=true;const response=await route.fetch();await gate;await route.fulfill({response});finished=true;});
   await date(page,'2026-09-13');
   while(!entered)await new Promise(resolve=>setTimeout(resolve,10));
   await date(page,'2026-09-14');await ready(page);release();
   while(!finished)await new Promise(resolve=>setTimeout(resolve,10));
   await page.waitForLoadState('networkidle');
   assert.equal(await page.locator('#date').inputValue(),'2026-09-14');assert.match(await page.locator('#selection-summary').textContent(),/9月14日/);
 });
 await check('mobile layout, touch details and narrow viewport',async()=>{
   const c=await context({viewport:{width:390,height:1000},isMobile:true,hasTouch:true,deviceScaleFactor:1,colorScheme:'dark'}),p=await c.newPage();
   await p.goto(base);await settled(p);await setPeriods(p,[1,3,6]);await ready(p);
   assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.equal(await p.locator('.date-picker-shell').evaluate(shell=>{
     const rect=shell.getBoundingClientRect();
     return document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.id;
   }),'date');
   assert.equal(await p.locator('.period-option').count(),13);
   assert.equal(await p.locator('.period-option').first().evaluate(element=>element.getBoundingClientRect().height>=44),true);
   await p.screenshot({path:'artifacts/mobile.png'});
   await p.locator('#load-more').scrollIntoViewIfNeeded();
   await p.waitForFunction(()=>document.querySelectorAll('.room-card').length===48);
   await p.locator('#capacity').scrollIntoViewIfNeeded();
   await p.locator('#capacity').selectOption('30');await ready(p);
   assert.equal(await p.locator('.room-card').count(),24);
   await p.locator('.room-card button').first().click();assert.equal(await p.locator('#room-dialog').isVisible(),true);
   assert.equal(await p.locator('.detail-period').count(),13);assert.equal(await p.locator('.detail-period.chosen').count(),3);await p.screenshot({path:'artifacts/mobile-detail.png'});
   await p.locator('#close-dialog').click();await p.setViewportSize({width:320,height:900});await p.evaluate(()=>scrollTo(0,0));
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await p.screenshot({path:'artifacts/mobile-320.png'});await c.close();
 });
 await check('out-of-term default is explicit',async()=>{
   const c=await context(),p=await c.newPage();await p.clock.setFixedTime(new Date('2027-02-01T04:00:00Z'));
   await p.goto(base);await settled(p);assert.equal(await p.locator('#date').inputValue(),'2026-08-31');
   assert.equal(await p.locator('#range-notice').isVisible(),true);assert.equal(await p.locator('#today').isDisabled(),true);await c.close();
 });
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/browser-results.json',JSON.stringify({passed:true,checks:results,uncaughtErrors:errors},null,2));
 console.log(`BROWSER VERIFIED ${results.length} checks, no uncaught errors`);
}finally{await browser.close();}
