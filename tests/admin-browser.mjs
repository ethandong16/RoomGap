import {mkdir,readFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const browser=await chromium.launch({channel:'chrome',headless:true});
const dist=path.resolve('dist');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const target=path.resolve(dist,`.${pathname}`);
    if(!target.startsWith(`${dist}${path.sep}`))throw Error('invalid path');
    const content=await readFile(target);
    response.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream'}).end(content);
  }catch{response.writeHead(404).end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const adminUrl=`http://127.0.0.1:${server.address().port}/admin.html`;
await mkdir('artifacts',{recursive:true});

const summary={
  generatedAt:'2026-09-21T14:10:00.000Z',
  metrics:{visits:128,sessions:54,queries:96,details:31},
  daily:['15','16','17','18','19','20','21'].map((day,index)=>({date:`2026-09-${day}`,visits:12+index,queries:8+index})),
  popular:{campuses:[{label:'河西',count:48}],buildings:[{label:'主楼',count:32}],periods:[{label:'第 1 节',count:40}],rooms:[{label:'A101',count:12}]},
  recent:[{
    id:'query-1',timestamp:'2026-09-21T13:40:00.000Z',type:'query',sessionId:'session-query',path:'/',
    data:{date:'2026-09-18',campus:'河西',building:'主楼',periods:[1,2],resultCount:12}
  }]
};

async function verify(viewport,name){
  const context=await browser.newContext({viewport,locale:'zh-CN',colorScheme:'light'});
  const page=await context.newPage();
  await page.route('**/api/admin/session',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:true,method:'trusted_device',expiresAt:'2026-10-06T00:00:00.000Z'})}));
  await page.route('**/api/admin/collection/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({active:false,status:'idle',persisted:{lastResult:'complete',lastSuccessAt:'2026-09-21T14:07:04.864Z'}})}));
  await page.route('**/api/analytics/summary?**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(summary)}));
  await page.goto(adminUrl,{waitUntil:'networkidle'});
  await page.locator('#dashboard:not([hidden])').waitFor();
  assert.equal(await page.locator('#collection-status').textContent(),'已完成');
  assert.equal(await page.locator('#collection-trigger').isVisible(),true);
  assert.match(await page.locator('#recent-events .event-detail').textContent(),/查询日期 2026-09-18/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`artifacts/${name}`,fullPage:true});
  await context.close();
}

try{
  await verify({width:1440,height:1000},'admin-desktop.png');
  await verify({width:390,height:1000},'admin-mobile.png');
  console.log('ADMIN BROWSER VERIFIED desktop and mobile');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
