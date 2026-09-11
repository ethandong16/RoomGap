import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
import readline from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';

const {chromium}=await import(process.env.ROOMGAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ROOMGAP_PLAYWRIGHT_MODULE).href : 'playwright');
const browserOptions={channel:'chrome',headless:false,args:['--window-size=1200,850']};
if(process.env.ROOMGAP_BROWSER_PROXY)browserOptions.args.push(`--proxy-server=${process.env.ROOMGAP_BROWSER_PROXY}`);
if(process.env.ROOMGAP_BROWSER_CHANNEL)browserOptions.channel=process.env.ROOMGAP_BROWSER_CHANNEL;
if(process.env.ROOMGAP_BROWSER_EXECUTABLE)browserOptions.executablePath=process.env.ROOMGAP_BROWSER_EXECUTABLE;
const browser=process.env.ROOMGAP_CDP_URL ? await chromium.connectOverCDP(process.env.ROOMGAP_CDP_URL) : null;
const context=browser?.contexts()[0]||await chromium.launchPersistentContext('.roomgap-login-browser',browserOptions);
const page=context.pages()[0]||await context.newPage();
await page.goto('http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/index',{waitUntil:'domcontentloaded'});
console.log('请在打开的浏览器窗口中完成学校登录，并进入教室使用状况查询页面。');
const rl=readline.createInterface({input,output});
try {
  await rl.question('登录完成后回到此处按 Enter：');
  if(!await page.locator('#jxlBody').isVisible())throw Error('尚未进入教室使用状况查询，请完成登录后重试');
  const cookies=(await context.cookies()).filter(c=>c.domain==='tust.edu.cn'||c.domain.endsWith('.tust.edu.cn'));
  if(!cookies.length)throw Error('未找到 tust.edu.cn Cookie');
  await writeFile('.roomgap-auth.json',JSON.stringify(cookies),{encoding:'utf8',mode:0o600});
  console.log(`已导出 ${cookies.length} 个教务系统 Cookie 到 .roomgap-auth.json。请通过 SSH 传到远程机后再运行采集器。`);
} finally {
  rl.close();
  if(browser)await browser.close();
  else await context.close();
}
