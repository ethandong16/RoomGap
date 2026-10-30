import {createCipheriv, createHash, randomBytes} from 'node:crypto';
import {fetchRecentSms, waitForSmsCode, maxSmsId} from './sms-code.mjs';

export const authBase = 'https://id.tust.edu.cn/authserver';
export const classroomBase = 'https://jwxtxs.tust.edu.cn';
export const service = 'https://jwxtxs.tust.edu.cn/';
export const classroomUrl = 'https://jwxtxs.tust.edu.cn/student/teachingResources/classroomUseStatus/index';

const RANDOM_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';

function randomText(length){
 const bytes=randomBytes(length);
 let result='';
 for(let i=0;i<length;i++)result+=RANDOM_ALPHABET[bytes[i]%RANDOM_ALPHABET.length];
 return result;
}

export function encryptPassword(password, salt, {iv, prefix}={}){
 const actualIv=iv??randomText(16);
 const actualPrefix=prefix??randomText(64);
 if(String(actualIv).length!==16)throw new Error('invalid_iv');
 if(String(actualPrefix).length!==64)throw new Error('invalid_prefix');
 const cipher=createCipheriv('aes-128-cbc',Buffer.from(String(salt),'utf8'),Buffer.from(String(actualIv),'utf8'));
 return Buffer.concat([cipher.update(Buffer.from(`${actualPrefix}${password}`,'utf8')),cipher.final()]).toString('base64');
}

export function generateFingerprint(seed){
 return createHash('sha256').update(String(seed),'utf8').digest('hex').slice(0,32).toUpperCase();
}

function decodeHtml(value){
 return String(value??'').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
}

function attrs(tag){
 const result={};
 for(const match of String(tag).matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))result[match[1].toLowerCase()]=decodeHtml(match[2]??match[3]??match[4]);
 return result;
}

export function parseLoginPage(html){
 const formMatch=String(html).match(/<form\b[^>]*\bid\s*=\s*["']pwdFromId["'][^>]*>([\s\S]*?)<\/form\s*>/i);
 const form= formMatch?.[1]??String(html);
 const fields={};
 let salt='';
 for(const match of form.matchAll(/<input\b[^>]*>/gi)){
  const input=attrs(match[0]);
  if((input.id||'').toLowerCase()==='pwdencryptsalt')salt=input.value??'';
  if(input.name)fields[input.name]=input.value??'';
 }
 const saltMatch=String(html).match(/<[^>]*\bid\s*=\s*["']pwdEncryptSalt["'][^>]*\bvalue\s*=\s*["']([^"']*)["']/i);
 if(!salt&&saltMatch)salt=decodeHtml(saltMatch[1]);
 if(!('username' in fields))throw new Error('login_form_invalid');
 if(!salt)throw new Error('password_salt_missing');
 return {fields,salt};
}

function splitSetCookie(value){
 if(!value)return[];
 const result=[];let start=0;let inExpires=false;
 for(let i=0;i<value.length;i++){
  if(value.slice(i,i+8).toLowerCase()==='expires=')inExpires=true;
  if(inExpires&&value[i]===';')inExpires=false;
  if(value[i]===','&&!inExpires&&/\s*[\w!#$%&'*+.^`|~-]+=/.test(value.slice(i+1))){result.push(value.slice(start,i).trim());start=i+1;}
 }
 result.push(value.slice(start).trim());
 return result.filter(Boolean);
}

function defaultCookiePath(path){
 if(!path||path[0]!=='/')return'/';
 const index=path.lastIndexOf('/');
 return index<=0?'/':path.slice(0,index);
}

function domainMatches(host,domain){
 const normalized=String(domain||'').replace(/^\./,'').toLowerCase();
 return Boolean(normalized)&&(host===normalized||host.endsWith(`.${normalized}`));
}

function pathMatches(path,cookiePath){
 const value=cookiePath||'/';
 if(path===value)return true;
 if(!path.startsWith(value))return false;
 return value.endsWith('/')||path[value.length]==='/';
}

class CookieJar{
 constructor(now=Date.now){this.cookies=new Map();this.now=now;this.order=0;}
 setFromHeaders(headers,url){
  const values=typeof headers?.getSetCookie==='function'?headers.getSetCookie():splitSetCookie(headers?.get?.('set-cookie'));
  for(const value of values||[])this.set(value,url);
 }
 set(line,url){
  const target=new URL(url);const pieces=String(line).split(';').map(piece=>piece.trim()).filter(Boolean);
  const raw=pieces[0];if(!raw)return;
  const separator=raw.indexOf('=');if(separator<1)return;
  const name=raw.slice(0,separator).trim();const cookie={name,value:raw.slice(separator+1).trim(),domain:target.hostname.toLowerCase(),path:defaultCookiePath(target.pathname),expires:null,httpOnly:false,secure:false,sameSite:null,hostOnly:true,created:++this.order};
  for(const attr of pieces.slice(1)){
   const index=attr.indexOf('=');const key=(index<0?attr:attr.slice(0,index)).trim().toLowerCase();const val=index<0?'':attr.slice(index+1).trim();
   if(key==='domain'&&val){cookie.domain=val.replace(/^\./,'').toLowerCase();cookie.hostOnly=false;}
   else if(key==='path'&&val.startsWith('/'))cookie.path=val;
   else if(key==='secure')cookie.secure=true;
   else if(key==='httponly')cookie.httpOnly=true;
   else if(key==='samesite')cookie.sameSite=val||null;
   else if(key==='max-age'){const seconds=Number(val);if(Number.isFinite(seconds))cookie.expires=seconds<=0?0:Math.floor(this.now()/1000)+seconds;}
   else if(key==='expires'){const time=Date.parse(val);if(Number.isFinite(time))cookie.expires=Math.floor(time/1000);}
  }
  const key=`${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`;
  if(cookie.expires!==null&&cookie.expires<=Math.floor(this.now()/1000)){this.cookies.delete(key);return;}
  this.cookies.set(key,cookie);
 }
 header(url){
  const target=new URL(url);const now=Math.floor(this.now()/1000);const list=[];
  for(const cookie of this.cookies.values()){
   if(cookie.expires!==null&&cookie.expires<=now)continue;
   if(cookie.hostOnly?target.hostname.toLowerCase()!==cookie.domain:!domainMatches(target.hostname.toLowerCase(),cookie.domain))continue;
   if(!pathMatches(target.pathname,cookie.path)||cookie.secure&&target.protocol!=='https:')continue;
   list.push(cookie);
  }
  list.sort((a,b)=>b.path.length-a.path.length||a.created-b.created);
  return list.map(cookie=>`${cookie.name}=${cookie.value}`).join('; ');
 }
 export(){
  return [...this.cookies.values()].filter(cookie=>domainMatches(cookie.domain,'tust.edu.cn')).map(({name,value,domain,path,expires,httpOnly,secure,sameSite})=>({name,value,domain,path,expires,httpOnly,secure,sameSite}));
 }
}

function headerGet(headers,name){return typeof headers?.get==='function'?headers.get(name):headers?.[name]??headers?.[name.toLowerCase()];}
function responseSetCookies(response){return response.headers;}
function responseLocation(response){return headerGet(response.headers,'location')||headerGet(response.headers,'Location');}
function isRedirect(status){return status>=300&&status<400;}
function formBody(fields){return new URLSearchParams(fields).toString();}
function withCookie(headers,jar,url){
 const result={...headers};const cookie=jar.header(url);if(cookie)result.Cookie=cookie;return result;
}

async function request(fetchImpl,jar,url,init={}){
 const headers=withCookie(init.headers||{},jar,url);
 const response=await fetchImpl(url,{...init,headers,redirect:'manual'});
 jar.setFromHeaders(responseSetCookies(response),url);
 return response;
}

async function follow(fetchImpl,jar,url,init={},maxRedirects=10){
 let currentUrl=url;let options={...init};
 for(let i=0;i<=maxRedirects;i++){
  const response=await request(fetchImpl,jar,currentUrl,options);
  if(!isRedirect(response.status))return {response,url:currentUrl};
  const location=responseLocation(response);if(!location)throw new Error('redirect_location_missing');
  currentUrl=new URL(location,currentUrl).toString();
  if(response.status===301||response.status===302||response.status===303){options={method:'GET',headers:{}};}
 }
 throw new Error('too_many_redirects');
}

function parseReauthType(html){
 const match=String(html).match(/(?:name|id)\s*=\s*["']reAuthType["'][^>]*\bvalue\s*=\s*["']([^"']*)["']/i)||String(html).match(/\breAuthType\b["']?\s*[:=]\s*["']?(\d+)/i);
 return match?.[1]??'';
}

async function waitInjected(fetchRecent,{url,token,baselineId,timeoutMs,now,sleep}){
 const deadline=now()+timeoutMs;const baseline=Number(baselineId??-Infinity);
 while(true){
  const result=await fetchRecent({url,token});
  const messages=Array.isArray(result?.messages)?result.messages:[];
  messages.sort((a,b)=>Number(b?.id)-Number(a?.id));
  for(const message of messages){if(Number(message?.id)<=baseline)continue;const text=String(message?.text??'');const code=text.match(/(?<!\d)\d{4,8}(?!\d)/)?.[0];if(code)return code;}
  const remaining=deadline-now();if(remaining<=0)throw new Error('SMS code timeout');
  await sleep(Math.min(2000,remaining));
 }
}

export async function loginWithPassword({user,password,service:serviceUrl=service,authBase:authBaseUrl=authBase,classroomUrl:classroomUrlValue=classroomUrl,bfp,sms,timeoutMs=180000,skipTmpReAuth=true,fetchImpl=fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),fetchRecentSmsImpl}={}){
 const jar=new CookieJar(now);const loginUrl=`${authBaseUrl}/login?service=${encodeURIComponent(serviceUrl)}`;
 const loginPage=await follow(fetchImpl,jar,loginUrl,{method:'GET',headers:{Accept:'text/html'}});const parsed=parseLoginPage(await loginPage.response.text());
 const captchaResponse=await request(fetchImpl,jar,`${authBaseUrl}/checkNeedCaptcha.htl?username=${encodeURIComponent(user)}`,{method:'GET',headers:{Accept:'application/json',Referer:loginUrl}});
 const captcha=await captchaResponse.json();if(captcha?.isNeed===true||captcha?.isNeed==='true')throw new Error('captcha_required');
 const fingerprint=bfp||generateFingerprint(`${user}:${now()}:${Math.random()}`);
 await request(fetchImpl,jar,`${authBaseUrl}/bfp/info?bfp=${encodeURIComponent(fingerprint)}&_=${now()}`,{method:'GET',headers:{Accept:'application/json',Referer:loginUrl}});
 const fields={...parsed.fields,username:user,password:encryptPassword(password,parsed.salt)};delete fields.passwordText;delete fields.captcha;
 const passwordResponse=await follow(fetchImpl,jar,loginUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:new URL(authBaseUrl).origin,Referer:loginUrl},body:formBody(fields)});
 let smsUsed=false;const finalUrl=passwordResponse.url;const finalHost=new URL(finalUrl).hostname;const finalPath=new URL(finalUrl).pathname+new URL(finalUrl).search;
 if(finalHost!==new URL(serviceUrl).hostname&&finalPath.includes('/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true')){
  await request(fetchImpl,jar,`${authBaseUrl}/bfp/info?bfp=${encodeURIComponent(fingerprint)}&_=${now()}`,{method:'GET',headers:{Accept:'application/json',Referer:finalUrl}});
  const reauthHtml=await passwordResponse.response.text();if(parseReauthType(reauthHtml)!=='3')throw new Error('unsupported_reauth_type');
  if(!sms)throw new Error('sms_not_configured');
  const recent=fetchRecentSmsImpl||((options)=>fetchRecentSms({...options,fetchImpl}));const baseline=await recent({url:sms.url,token:sms.token,fetchImpl});const baselineId=maxSmsId(baseline?.messages);
  const send=async()=>{const response=await request(fetchImpl,jar,`${authBaseUrl}/dynamicCode/getDynamicCodeByReauth.do`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest',Origin:new URL(authBaseUrl).origin,Referer:finalUrl},body:formBody({userName:user,authCodeTypeName:'reAuthDynamicCodeType'})});return response.json();};
  let sendResult=await send();if(sendResult?.res==='code_time_fail'){const seconds=Number(sendResult.codeTime);await sleep(((Number.isFinite(seconds)?seconds:0)+2)*1000);sendResult=await send();}
  if(sendResult?.res!=='success')throw new Error('sms_send_failed');
  const picked=fetchRecentSmsImpl?{code:await waitInjected(recent,{url:sms.url,token:sms.token,baselineId,timeoutMs,now,sleep})}:await waitForSmsCode({url:sms.url,token:sms.token,baselineId,notBefore:now()-60000,timeoutMs,fetchImpl,now,sleep});
  const code=typeof picked==='string'?picked:picked.code;
  const submit=await request(fetchImpl,jar,`${authBaseUrl}/reAuthCheck/reAuthSubmit.do`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Requested-With':'XMLHttpRequest',Origin:new URL(authBaseUrl).origin,Referer:finalUrl},body:formBody({service:serviceUrl,reAuthType:'3',isMultifactor:'true',password:'',dynamicCode:code,uuid:'',answer1:'',answer2:'',otpCode:'',skipTmpReAuth:String(skipTmpReAuth)})});
  const submitResult=await submit.json();if(submitResult?.code!=='reAuth_success')throw new Error(`reauth_failed:${submitResult?.code||'unknown'}:${submitResult?.msg||''}`);
  smsUsed=true;await follow(fetchImpl,jar,loginUrl,{method:'GET',headers:{Accept:'text/html'}});
 }
 const classroom=await follow(fetchImpl,jar,classroomUrlValue,{method:'GET',headers:{Accept:'text/html'}},10);const classroomBody=await classroom.response.text();if(classroom.response.status!==200||!classroomBody.includes('jxlBody'))throw new Error('classroom_check_failed');
 return {cookies:jar.export(),bfp:fingerprint,smsUsed};
}
