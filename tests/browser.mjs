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
async function ready(page){await page.waitForFunction(()=>document.querySelector('#results-section').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.room-card').length>0);}
async function count(page,n){await page.waitForFunction(n=>document.querySelector('#result-count').textContent===`${n} 间`,n);}
async function date(page,value){await page.locator('#date').fill(value);}
try{
 const desktop=await context(),page=await desktop.newPage();
 await page.goto(base);await ready(page);
 await check('desktop initial screen and content',async()=>{
   assert.equal(await page.locator('#candidate-count').textContent(),'384');
   assert.equal(await page.locator('#campus-count').textContent(),'3');
   assert.equal(await page.locator('#start-period').inputValue(),'1');assert.equal(await page.locator('#end-period').inputValue(),'2');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:'artifacts/desktop.png'});
 });
 await check('known 19-room query and combined filters',async()=>{
   await date(page,'2026-09-08');await page.locator('#campus').selectOption('04');await page.locator('#end-period').selectOption('4');await count(page,19);
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
   await page.reload();await ready(page);assert.equal(await page.locator('#campus').inputValue(),'04');
   await page.locator('#campus').selectOption('');await ready(page);
   assert.equal(await page.locator('.room-card').count(),24);
   await page.locator('#load-more').click();assert.equal(await page.locator('.room-card').count(),48);
   assert.equal(await page.locator('.room-card').nth(24).locator('button').evaluate(el=>el===document.activeElement),true);
 });
 await check('term limits, cross-month navigation and period normalization',async()=>{
   await date(page,'2026-08-31');await ready(page);assert.equal(await page.locator('#previous-day').isDisabled(),true);
   await page.locator('#next-day').click();await ready(page);assert.equal(await page.locator('#date').inputValue(),'2026-09-01');
   await date(page,'2027-01-17');await ready(page);assert.equal(await page.locator('#next-day').isDisabled(),true);
   await page.locator('#start-period').selectOption('9');assert.equal(await page.locator('#end-period').inputValue(),'9');
   await page.locator('#end-period').selectOption('4');assert.equal(await page.locator('#start-period').inputValue(),'4');
   await date(page,'2026-08-30');assert.equal(await page.locator('.room-card').count(),0);
   await date(page,'2026-09-08');await ready(page);
 });
 await check('failed catalog and retry',async()=>{
   const c=await context(),p=await c.newPage();let fail=true;
   await p.route('**/schema.json',route=>fail?(fail=false,route.fulfill({status:503,body:'unavailable'})):route.continue());
   await p.goto(base);await p.locator('#state-action').waitFor();assert.equal(await p.locator('.room-card').count(),0);
   await p.locator('#state-action').click();await ready(p);await c.close();
 });
 await check('daily load failure and version mismatch recover without false availability',async()=>{
   await page.locator('#start-period').selectOption('1');await page.locator('#end-period').selectOption('2');
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
   const c=await context({viewport:{width:390,height:1000},isMobile:true,hasTouch:true,deviceScaleFactor:1}),p=await c.newPage();
   await p.goto(base);await ready(p);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await p.screenshot({path:'artifacts/mobile.png'});
   await p.locator('.room-card button').first().click();assert.equal(await p.locator('#room-dialog').isVisible(),true);
   assert.equal(await p.locator('.detail-period').count(),13);await p.screenshot({path:'artifacts/mobile-detail.png'});
   await p.locator('#close-dialog').click();await p.setViewportSize({width:320,height:900});
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await p.screenshot({path:'artifacts/mobile-320.png'});await c.close();
 });
 await check('out-of-term default is explicit',async()=>{
   const c=await context(),p=await c.newPage();await p.clock.setFixedTime(new Date('2027-02-01T04:00:00Z'));
   await p.goto(base);await ready(p);assert.equal(await p.locator('#date').inputValue(),'2026-08-31');
   assert.equal(await p.locator('#range-notice').isVisible(),true);assert.equal(await p.locator('#today').isDisabled(),true);await c.close();
 });
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/browser-results.json',JSON.stringify({passed:true,checks:results,uncaughtErrors:errors},null,2));
 console.log(`BROWSER VERIFIED ${results.length} checks, no uncaught errors`);
}finally{await browser.close();}
