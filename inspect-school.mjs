import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.ROOMGAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ROOMGAP_PLAYWRIGHT_MODULE).href : 'playwright');
import {writeFile} from 'node:fs/promises';
const context=await chromium.launchPersistentContext('.roomgap-browser',{channel:'chrome',headless:false,args:['--window-position=80,80','--window-size=1200,850']});
const page=context.pages()[0] || await context.newPage();
const responses=[];
page.on('response',async r=>{if(r.url().includes('/student/teachingResources/')){let body='';try{body=await r.text();}catch{}responses.push({url:r.url(),status:r.status(),contentType:r.headers()['content-type'],body:body.slice(0,200000)});}});
await page.goto('http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/index');
await page.locator('#jxlBody tr').first().getByRole('button').click();
await page.waitForLoadState('networkidle');
console.log(await page.locator('#classInfoTableHead').evaluate(el=>el.outerHTML));
console.log(await page.locator('#searchDate').evaluate(el=>el.outerHTML));
const form=await page.locator('#searchCondition').evaluate(el=>Object.fromEntries(new FormData(el)));
console.log('FORM',JSON.stringify(form));
const allResponse=await context.request.post('http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/jasInfo',{form:{...form,xqh:'',jxlh:'',searchDate:'2026-08-31'}});
const allText=await allResponse.text();
try {const all=JSON.parse(allText); console.log('ALL_QUERY',JSON.stringify({status:allResponse.status(),keys:Object.keys(all),date:all.date,rooms:all.classrooms?.length,occupied:all.classroomTime?.length,campuses:[...new Set(all.classrooms?.map(r=>r.id.campusNumber))]})); await writeFile('data/all-query-sample.json',JSON.stringify(all));}catch{console.log('ALL_QUERY_FAILED',allResponse.status(),allResponse.headers()['content-type']);}
for(const [label,fields] of [['exact',{}],['all-today',{xqh:'',jxlh:''}],['campus-today',{jxlh:''}]]) {
 const r=await context.request.post('http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/jasInfo',{form:{...form,...fields}}); const d=await r.json(); console.log(label,JSON.stringify({rooms:d.classrooms?.length,occupied:d.classroomTime?.length,date:d.date}));
}
await writeFile('data/inspection-responses.json',JSON.stringify(responses));
await context.close();
