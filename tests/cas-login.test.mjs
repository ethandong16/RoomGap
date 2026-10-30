import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecipheriv} from 'node:crypto';
import {encryptPassword, loginWithPassword} from '../cas-login.mjs';

const AUTH='https://id.tust.edu.cn/authserver';
const CLASS='https://jwxtxs.tust.edu.cn';
const SERVICE=`${CLASS}/`;
const CLASSROOM=`${CLASS}/student/teachingResources/classroomUseStatus/index`;

function response(status,headers={},body=''){
 const values={};for(const [key,value] of Object.entries(headers))values[key.toLowerCase()]=value;
 return {status,headers:{get:key=>values[String(key).toLowerCase()]??null,getSetCookie:()=>{const value=values['set-cookie'];return value?Array.isArray(value)?value:[value]:[];}},text:async()=>body,json:async()=>JSON.parse(body)};
}

function loginHtml(type='3'){
 return `<form id="pwdFromId"><input name="username" value="old"><input name="passwordText" value=""><input name="password" value=""><input name="captcha" value=""><input name="_eventId" value="submit"><input name="cllt" value="5"><input name="dllt" value="generalLogin"><input name="lt" value="LT-1"><input name="execution" value="e1"></form><input id="pwdEncryptSalt" value="1234567890abcdef"><input name="reAuthType" value="${type}">`;
}

function baseOptions(extra={}){return {user:'alice',password:'secret',bfp:'BFPTEST',fetchImpl:extra.fetchImpl,fetchRecentSmsImpl:extra.fetchRecentSmsImpl,timeoutMs:extra.timeoutMs??1000,now:extra.now??Date.now,sleep:extra.sleep??(async()=>{})};}

test('trusted fingerprint login reaches classroom',async()=>{
 const calls=[];let passwordCookie='';
 const fetchImpl=async(url,init={})=>{
  calls.push({url,init});const method=init.method||'GET';
  if(url===`${AUTH}/login?service=${encodeURIComponent(SERVICE)}`&&method==='GET')return response(200,{},loginHtml());
  if(url.startsWith(`${AUTH}/checkNeedCaptcha.htl?username=alice`))return response(200,{},JSON.stringify({isNeed:false}));
  if(url.startsWith(`${AUTH}/bfp/info?`))return response(200,{'set-cookie':'MULTIFACTOR_BROWSER_FINGERPRINT=BFPTEST; Domain=.tust.edu.cn; Path=/; Secure'},'{}');
  if(url===`${AUTH}/login?service=${encodeURIComponent(SERVICE)}`&&method==='POST'){
   passwordCookie=init.headers.Cookie||init.headers.cookie||'';return response(302,{location:`${CLASS}/j_spring_cas_security_check?ticket=T`});
  }
  if(url===`${CLASS}/j_spring_cas_security_check?ticket=T`)return response(404,{},'');
  if(url===CLASSROOM)return response(200,{},'<div id="jxlBody">ok</div>');
  throw new Error(`unexpected ${method} ${url}`);
 };
 const result=await loginWithPassword(baseOptions({fetchImpl}));
 assert.equal(result.smsUsed,false);assert.equal(result.bfp,'BFPTEST');assert.match(passwordCookie,/MULTIFACTOR_BROWSER_FINGERPRINT=BFPTEST/);
 assert.equal(calls.filter(call=>call.url.includes('dynamicCode')).length,0);
 assert.ok(calls[0].url.includes(`service=${encodeURIComponent(SERVICE)}`));
 assert.ok(result.cookies.some(cookie=>cookie.name==='MULTIFACTOR_BROWSER_FINGERPRINT'));
});

test('reauth sends and submits sms code',async()=>{
 const calls=[];let recentCalls=0;let loginGets=0;
 const fetchRecentSmsImpl=async()=>{recentCalls++;return recentCalls===1?{messages:[{id:4,text:'old 111111'}]}:{messages:[{id:5,text:'Your verification code is 654321'}]};};
 const fetchImpl=async(url,init={})=>{
  calls.push({url,init});const method=init.method||'GET';
  if(url===`${AUTH}/login?service=${encodeURIComponent(SERVICE)}`&&method==='GET'){loginGets++;if(loginGets===1)return response(200,{},loginHtml());return response(302,{location:`${CLASS}/j_spring_cas_security_check?ticket=T2`});}
  if(url.startsWith(`${AUTH}/checkNeedCaptcha.htl`))return response(200,{},JSON.stringify({isNeed:false}));
  if(url.startsWith(`${AUTH}/bfp/info?`))return response(200,{},'{}');
  if(url===`${AUTH}/login?service=${encodeURIComponent(SERVICE)}`&&method==='POST')return response(302,{location:`${AUTH}/reAuthCheck/reAuthLoginView.do?isMultifactor=true`});
  if(url===`${AUTH}/reAuthCheck/reAuthLoginView.do?isMultifactor=true`)return response(200,{},'<input name="reAuthType" value="3">');
  if(url===`${AUTH}/dynamicCode/getDynamicCodeByReauth.do`)return response(200,{},JSON.stringify({res:'success'}));
  if(url===`${AUTH}/reAuthCheck/reAuthSubmit.do`){const body=String(init.body);assert.match(body,/skipTmpReAuth=true/);assert.match(body,/dynamicCode=654321/);return response(200,{},JSON.stringify({code:'reAuth_success'}));}
  if(url===`${CLASS}/j_spring_cas_security_check?ticket=T2`)return response(404,{},'');
  if(url===CLASSROOM)return response(200,{},'<div id="jxlBody">ok</div>');
  throw new Error(`unexpected ${method} ${url}`);
 };
 const result=await loginWithPassword({...baseOptions({fetchImpl,fetchRecentSmsImpl}),sms:{url:'u',token:'t'}});
 assert.equal(result.smsUsed,true);assert.equal(recentCalls,2);
});

test('captcha required is reported',async()=>{
 let calls=0;
 const fetchImpl=async(url)=>{calls++;if(url.includes('/login?'))return response(200,{},loginHtml());if(url.includes('checkNeedCaptcha'))return response(200,{},JSON.stringify({isNeed:true}));throw new Error('must stop');};
 await assert.rejects(loginWithPassword(baseOptions({fetchImpl})),error=>error.message==='captcha_required');assert.equal(calls,2);
});

test('unsupported reauth type is reported',async()=>{
 const fetchImpl=async(url,init={})=>{const method=init.method||'GET';if(url.includes('/login?')&&method==='GET')return response(200,{},loginHtml('2'));if(url.includes('checkNeedCaptcha'))return response(200,{},JSON.stringify({isNeed:false}));if(url.includes('/bfp/info'))return response(200,{},'{}');if(url.includes('/login?')&&method==='POST')return response(302,{location:`${AUTH}/reAuthCheck/reAuthLoginView.do?isMultifactor=true`});if(url.includes('reAuthLoginView'))return response(200,{},'<input name="reAuthType" value="2">');throw new Error('unexpected');};
 await assert.rejects(loginWithPassword(baseOptions({fetchImpl,sms:{url:'u',token:'t'}})),error=>error.message==='unsupported_reauth_type');
});

test('password encryption is deterministic',()=>{
 const salt='1234567890abcdef';const iv='ABCDEFGHJKMNPQRS';const prefix='a'.repeat(64);const encoded=encryptPassword('secret',salt,{iv,prefix});
 const decipher=createDecipheriv('aes-128-cbc',Buffer.from(salt),Buffer.from(iv));const plain=Buffer.concat([decipher.update(Buffer.from(encoded,'base64')),decipher.final()]).toString();
 assert.equal(plain,prefix+'secret');
});

test('sms send failure and timeout are reported',async()=>{
 const makeFetch=sendBody=>async(url,init={})=>{const method=init.method||'GET';if(url.includes('/login?')&&method==='GET')return response(200,{},loginHtml());if(url.includes('checkNeedCaptcha'))return response(200,{},JSON.stringify({isNeed:false}));if(url.includes('/bfp/info'))return response(200,{},'{}');if(url.includes('/login?')&&method==='POST')return response(302,{location:`${AUTH}/reAuthCheck/reAuthLoginView.do?isMultifactor=true`});if(url.includes('reAuthLoginView'))return response(200,{},'<input name="reAuthType" value="3">');if(url.includes('dynamicCode'))return response(200,{},JSON.stringify(sendBody));throw new Error('unexpected');};
 const sms={url:'u',token:'t'};const common={fetchRecentSmsImpl:async()=>({messages:[{id:1,text:'old'}]}),sleep:async()=>{},now:()=>0};
 await assert.rejects(loginWithPassword({...baseOptions({fetchImpl:makeFetch({res:'error'}),...common}),sms}),error=>error.message==='sms_send_failed');
 let now=0;await assert.rejects(loginWithPassword({...baseOptions({fetchImpl:makeFetch({res:'success'}),fetchRecentSmsImpl:async()=>({messages:[]}),now:()=>now,sleep:async()=>{now=2000},timeoutMs:1}),sms}),error=>/timeout/i.test(error.message));
});
