import {createHash, timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir, readFile, rename, writeFile, chmod} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const authFile=path.resolve(root,process.env.ROOMGAP_COOKIES_FILE||'.roomgap-auth.json');
const stateDir=process.env.ROOMGAP_AUTH_STATE_DIR||path.join(os.homedir(),'.local','state','roomgap-auth');
const stateFile=path.join(stateDir,'state.json');
const listenHost=process.env.ROOMGAP_AUTH_LISTEN||'127.0.0.1';
const listenPort=Number(process.env.ROOMGAP_AUTH_PORT||9010);
const apiToken=process.env.ROOMGAP_AUTH_TOKEN||'';
const barkUrl=process.env.ROOMGAP_BARK_URL||'';
const timeoutMs=Number(process.env.ROOMGAP_QR_TIMEOUT_MS||180000);
const pollMs=Number(process.env.ROOMGAP_QR_POLL_MS||1500);
const service='http://jwxtxs.tust.edu.cn:46110/j_spring_cas_security_check';
const authBase='https://id.tust.edu.cn/authserver';
const loginUrl=`${authBase}/login?service=${encodeURIComponent(service)}`;
const classroomUrl='http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/index';
const userAgent='Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

if(!apiToken)throw Error('ROOMGAP_AUTH_TOKEN is required');
if(!Number.isInteger(listenPort)||listenPort<1||listenPort>65535)throw Error('Invalid ROOMGAP_AUTH_PORT');

const runtime={active:false,status:'idle',source:null,startedAt:null,finishedAt:null,lastError:null};

function chinaDate(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=type=>parts.find(part=>part.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function loadState(){
  try{return JSON.parse(await readFile(stateFile,'utf8'));}catch{return {};}
}

async function saveState(patch){
  await mkdir(stateDir,{recursive:true,mode:0o700});
  const state={...await loadState(),...patch,updatedAt:new Date().toISOString()};
  const temporary=`${stateFile}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(state,null,2),{mode:0o600});
  await rename(temporary,stateFile);
  return state;
}

function safeEqual(left,right){
  const a=Buffer.from(left),b=Buffer.from(right);
  return a.length===b.length&&timingSafeEqual(a,b);
}

function authorized(req){
  const value=req.headers.authorization||'';
  return value.startsWith('Bearer ')&&safeEqual(value.slice(7),apiToken);
}

function sendJson(res,status,payload){
  const body=JSON.stringify(payload);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'});
  res.end(body);
}

function decodeHtml(value){
  return value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
}

function parseQrForm(html){
  const form=html.match(/<form\b[^>]*id=["']qrLoginForm["'][^>]*>[\s\S]*?<\/form>/i)?.[0];
  if(!form)throw Error('QR login form was not found');
  const fields={};
  for(const match of form.matchAll(/<input\b[^>]*>/gi)){
    const attributes={};
    for(const attribute of match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g))attributes[attribute[1].toLowerCase()]=decodeHtml(attribute[3]);
    if(attributes.name)fields[attributes.name]=attributes.value||'';
  }
  for(const required of ['cllt','dllt','execution','_eventId','rmShown'])if(!(required in fields))throw Error(`QR login form is missing ${required}`);
  return fields;
}

class CookieJar{
  constructor(){this.cookies=[];}

  setFromResponse(url,headers){
    const parsed=new URL(url);
    const values=typeof headers.getSetCookie==='function'?headers.getSetCookie():[];
    for(const raw of values){
      const parts=raw.split(';').map(part=>part.trim());
      const separator=parts[0].indexOf('=');
      if(separator<1)continue;
      const cookie={
        name:parts[0].slice(0,separator),value:parts[0].slice(separator+1),
        domain:parsed.hostname.toLowerCase(),hostOnly:true,path:'/',secure:false,httpOnly:false,
        sameSite:'Lax',expires:-1,
      };
      for(const attribute of parts.slice(1)){
        const [rawName,...rawValue]=attribute.split('=');
        const name=rawName.toLowerCase(),value=rawValue.join('=');
        if(name==='domain'&&value){cookie.domain=value.replace(/^\./,'').toLowerCase();cookie.hostOnly=false;}
        else if(name==='path'&&value)cookie.path=value;
        else if(name==='secure')cookie.secure=true;
        else if(name==='httponly')cookie.httpOnly=true;
        else if(name==='samesite'&&value)cookie.sameSite=value[0].toUpperCase()+value.slice(1).toLowerCase();
        else if(name==='expires'&&value){const time=Date.parse(value);if(Number.isFinite(time))cookie.expires=Math.floor(time/1000);}
        else if(name==='max-age'&&value){const age=Number(value);if(Number.isFinite(age))cookie.expires=Math.floor(Date.now()/1000)+age;}
      }
      const index=this.cookies.findIndex(item=>item.name===cookie.name&&item.domain===cookie.domain&&item.path===cookie.path);
      if(cookie.expires!==-1&&cookie.expires<=Math.floor(Date.now()/1000)){
        if(index>=0)this.cookies.splice(index,1);
      }else if(index>=0)this.cookies[index]=cookie;
      else this.cookies.push(cookie);
    }
  }

  header(url){
    const parsed=new URL(url),host=parsed.hostname.toLowerCase(),now=Math.floor(Date.now()/1000);
    return this.cookies.filter(cookie=>
      (cookie.expires===-1||cookie.expires>now)&&
      (cookie.hostOnly?host===cookie.domain:host===cookie.domain||host.endsWith(`.${cookie.domain}`))&&
      parsed.pathname.startsWith(cookie.path)&&(!cookie.secure||parsed.protocol==='https:')
    ).map(cookie=>`${cookie.name}=${cookie.value}`).join('; ');
  }

  exportFor(domain){
    const host=domain.toLowerCase(),now=Math.floor(Date.now()/1000);
    return this.cookies.filter(cookie=>(cookie.expires===-1||cookie.expires>now)&&(host===cookie.domain||host.endsWith(`.${cookie.domain}`)))
      .map(({name,value,domain,path,expires,httpOnly,secure,sameSite})=>({name,value,domain,path,expires,httpOnly,secure,sameSite}));
  }
}

async function request(url,options={},jar=new CookieJar(),redirects=10){
  const headers=new Headers(options.headers||{});
  headers.set('user-agent',userAgent);
  headers.delete('cookie');
  const cookie=jar.header(url);
  if(cookie)headers.set('cookie',cookie);
  const response=await fetch(url,{...options,headers,redirect:'manual',signal:AbortSignal.timeout(15000)});
  jar.setFromResponse(url,response.headers);
  if(redirects>0&&[301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');
    if(location){
      const next=new URL(location,url).href;
      const switchToGet=response.status===303||((response.status===301||response.status===302)&&options.method==='POST');
      const forwardedHeaders=Object.fromEntries(headers);
      delete forwardedHeaders.cookie;
      const nextOptions=switchToGet?{method:'GET',headers:{referer:url}}:{...options,headers:{...forwardedHeaders,referer:url}};
      if(switchToGet)delete nextOptions.body;
      await response.body?.cancel();
      return request(next,nextOptions,jar,redirects-1);
    }
  }
  return {response,jar,url};
}

async function validateSession(){
  try{
    const cookies=JSON.parse(await readFile(authFile,'utf8'));
    if(!Array.isArray(cookies)||!cookies.length)return false;
    const cookie=cookies.map(item=>`${item.name}=${item.value}`).join('; ');
    const response=await fetch(classroomUrl,{headers:{cookie,'user-agent':userAgent},redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(response.status!==200)return false;
    return (await response.text()).includes('jxlBody');
  }catch{return false;}
}

async function notifyQr(qrUrl){
  if(!barkUrl){console.warn('ROOMGAP_BARK_URL is empty; QR notification was not sent');return;}
  const url=new URL(barkUrl);
  url.searchParams.set('title','RoomGap 登录已失效');
  url.searchParams.set('body','点击通知打开二维码，保存图片后在个人微信“扫一扫 → 相册”中识别（需已关注学校企业微信）。二维码约 3 分钟有效；过期后今天不会再次提醒。');
  url.searchParams.set('group','RoomGap');
  url.searchParams.set('url',qrUrl);
  url.searchParams.set('copy',qrUrl);
  const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error(`Bark returned HTTP ${response.status}`);
}

async function createQrSession(){
  const jar=new CookieJar();
  const login=await request(loginUrl,{method:'GET'},jar,0);
  if(login.response.status!==200)throw Error(`CAS login returned HTTP ${login.response.status}`);
  const form=parseQrForm(await login.response.text());
  const tokenUrl=`${authBase}/qrCode/getToken?ts=${Date.now()}`;
  const tokenResponse=await request(tokenUrl,{headers:{'x-requested-with':'XMLHttpRequest'}},jar,0);
  if(!tokenResponse.response.ok)throw Error(`QR token returned HTTP ${tokenResponse.response.status}`);
  const uuid=(await tokenResponse.response.text()).trim();
  if(!/^QR-[A-Za-z0-9_-]{10,}$/.test(uuid))throw Error('QR token response was invalid');
  return {jar,uuid,form,qrUrl:`${authBase}/qrCode/getCode?uuid=${encodeURIComponent(uuid)}`};
}

async function waitForQr({jar,uuid}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const statusUrl=`${authBase}/qrCode/getStatus.htl?ts=${Date.now()}&uuid=${encodeURIComponent(uuid)}`;
    const result=await request(statusUrl,{headers:{'x-requested-with':'XMLHttpRequest'}},jar,0);
    const status=(await result.response.text()).trim();
    if(status==='1')return true;
    if(status==='3')return false;
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  return false;
}

async function finishQrLogin({jar,uuid,form}){
  const body=new URLSearchParams({...form,uuid});
  const submitUrl=`${authBase}/login?display=qrLogin&service=${encodeURIComponent(service)}`;
  const result=await request(submitUrl,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','origin':'https://id.tust.edu.cn','referer':loginUrl},body},jar,10);
  const text=await result.response.text();
  if(result.response.status!==200){
    const title=decodeHtml(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g,' ').trim()||'unknown');
    const final=new URL(result.url);
    throw Error(`QR login ended at ${final.host}${final.pathname} (HTTP ${result.response.status}, title: ${title})`);
  }
  const cookies=jar.exportFor('jwxtxs.tust.edu.cn');
  if(!cookies.some(cookie=>cookie.name==='JSESSIONID'))throw Error('QR login did not produce JSESSIONID');
  const temporary=`${authFile}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(cookies),{mode:0o600});
  await rename(temporary,authFile);
  await chmod(authFile,0o600);
  if(!await validateSession())throw Error('Saved classroom session failed validation');
}

async function runCollection(){
  return new Promise((resolve,reject)=>{
    const child=spawn('bash',['./run-collect.sh'],{
      cwd:root,stdio:'inherit',env:{...process.env,HOME:process.env.HOME||os.homedir(),ROOMGAP_COOKIES_FILE:authFile,ROOMGAP_REFRESH:'1'},
    });
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolve():reject(Error(`collection exited with ${code??signal}`)));
  });
}

async function workflow(source,forceQr){
  runtime.active=true;runtime.status='checking';runtime.source=source;runtime.startedAt=new Date().toISOString();runtime.finishedAt=null;runtime.lastError=null;
  console.log(`[auth] ${source} workflow started`);
  try{
    if(!forceQr&&await validateSession()){
      console.log('[auth] existing classroom session is valid');
      runtime.status='collecting';
      await runCollection();
      runtime.status='complete';
      await saveState({lastSuccessAt:new Date().toISOString(),lastResult:'complete'});
      return;
    }
    runtime.status='waiting_for_scan';
    const qr=await createQrSession();
    console.log('[auth] QR transaction created; waiting for scan');
    await saveState({lastPromptAt:new Date().toISOString(),lastResult:'waiting_for_scan'});
    try{await notifyQr(qr.qrUrl);}catch(error){console.error(`Bark QR notification failed: ${error.message}`);}
    if(!await waitForQr(qr)){
      runtime.status='expired';
      await saveState({lastResult:'expired',lastExpiredAt:new Date().toISOString()});
      console.log('[auth] QR transaction expired; no further notification will be sent');
      return;
    }
    console.log('[auth] QR scan confirmed; establishing classroom session');
    runtime.status='establishing_session';
    await finishQrLogin(qr);
    runtime.status='collecting';
    await runCollection();
    runtime.status='complete';
    await saveState({lastSuccessAt:new Date().toISOString(),lastResult:'complete'});
    console.log('[auth] authentication and collection completed');
  }catch(error){
    runtime.status='error';runtime.lastError=error.message;
    await saveState({lastResult:'error',lastError:error.message});
    console.error(error);
  }finally{
    runtime.active=false;runtime.finishedAt=new Date().toISOString();
  }
}

async function trigger(source,forceQr){
  if(runtime.active)return {accepted:false,reason:'busy',status:runtime.status};
  if(source==='scheduled'){
    const today=chinaDate(),state=await loadState();
    if(state.lastScheduledDate===today)return {accepted:false,reason:'already_checked_today'};
    await saveState({lastScheduledDate:today});
  }
  void workflow(source,forceQr);
  return {accepted:true,status:'started'};
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/health')return sendJson(res,200,{ok:true,active:runtime.active});
    if(!authorized(req))return sendJson(res,401,{error:'unauthorized'});
    if(req.method==='GET'&&url.pathname==='/status')return sendJson(res,200,{...runtime,persisted:await loadState()});
    if(req.method==='POST'&&url.pathname==='/trigger'){
      const result=await trigger('manual',true);
      return sendJson(res,result.accepted?202:409,result);
    }
    if(req.method==='POST'&&url.pathname==='/scheduled'){
      const result=await trigger('scheduled',false);
      return sendJson(res,result.accepted?202:200,result);
    }
    return sendJson(res,404,{error:'not_found'});
  }catch(error){
    console.error(error);
    return sendJson(res,500,{error:'internal_error'});
  }
});

server.listen(listenPort,listenHost,()=>console.log(`RoomGap auth daemon listening on http://${listenHost}:${listenPort}`));
