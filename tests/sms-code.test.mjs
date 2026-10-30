import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSmsCode,fetchRecentSms,maxSmsId,waitForSmsCode} from '../sms-code.mjs';

const cps=(...codes)=>String.fromCodePoint(...codes);
const VERIFY=cps(0x9a8c,0x8bc1,0x7801);
const PASSWORD_PREFIX=cps(0x53e3,0x4ee4,0x4e3a);
const SAMPLE=`${cps(0x3010,0x5929,0x6d25,0x79d1,0x6280,0x5927,0x5b66,0x3011)}${cps(0x60a8,0x597d)}${VERIFY}${cps(0x8fdb,0x884c,0x8ba4,0x8bc1)}${PASSWORD_PREFIX}123456`;

test('extracts the real school SMS sample code',()=>{
 assert.equal(extractSmsCode(SAMPLE),'123456');
});

test('extracts codes with full-width punctuation and extra spaces',()=>{
 assert.equal(extractSmsCode(`  ${VERIFY} ${cps(0xff1a,0x3000,0xff11,0xff12,0xff13,0xff14,0xff15,0xff16)}  `),'123456');
});

test('rejects phone numbers and dates',()=>{
 assert.equal(extractSmsCode('please call 13800138000'),null);
 assert.equal(extractSmsCode(`date 20241031`),null);
 assert.equal(extractSmsCode(`${VERIFY} 20241031`),null);
 assert.equal(extractSmsCode(`${VERIFY} 138-0013-8000`),null);
});

test('fetches and normalizes SMS messages',async()=>{
 let request;
 const result=await fetchRecentSms({url:'https://sms.test/recent',token:'secret',fetchImpl:async(...args)=>{
  request=args;
  return {status:200,json:async()=>({source_checked_at_utc:'now',messages:[{id:'4',received_at_raw:'raw',sender:'school',text:`${VERIFY}123456`,imported_at_utc:'later'}]})};
 }});
 assert.deepEqual(request,['https://sms.test/recent',{method:'GET',headers:{Authorization:'Bearer secret',Accept:'application/json'}}]);
 assert.deepEqual(result,{sourceCheckedAt:'now',messages:[{id:'4',receivedAtRaw:'raw',receivedAtMs:null,sender:'school',text:`${VERIFY}123456`,importedAt:'later'}]});
 assert.equal(maxSmsId(result.messages),4);
});

test('deduplicates baseline IDs and picks the newest new message',async()=>{
 const sleeps=[];let clock=0;let calls=0;
 const result=await waitForSmsCode({url:'x',token:'t',baselineId:'5',timeoutMs:100,intervalMs:10,now:()=>clock,sleep:async ms=>{sleeps.push(ms);clock+=ms;},fetchImpl:async()=>{
  calls++;
  return {status:200,json:async()=>({messages:[
   {id:'4',text:`${VERIFY}1111`},
   {id:'6',text:`${VERIFY}2222`},
   {id:'8',text:`${VERIFY}888888`}
  ]})};
 }});
 assert.equal(result.code,'888888');
 assert.equal(result.message.id,'8');
 assert.equal(calls,1);assert.deepEqual(sleeps,[]);
});

test('requires the accept filter',async()=>{
 const result=await waitForSmsCode({url:'x',token:'t',baselineId:0,accept:message=>message.sender==='school',fetchImpl:async()=>({status:200,json:async()=>({messages:[
  {id:2,sender:'other',text:`${VERIFY}2222`},
  {id:1,sender:'school',text:`${VERIFY}1111`}
 ]})})});
 assert.equal(result.code,'1111');assert.equal(result.message.sender,'school');
});

test('ignores delayed SMS received before notBefore',async()=>{
 const rawTime=date=>{
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad=n=>String(n).padStart(2,'0');
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
 };
 const now=Date.now();
 const oldRaw=rawTime(new Date(now-300000));
 const freshRaw=rawTime(new Date(now-1000));
 const result=await waitForSmsCode({url:'x',token:'t',baselineId:0,notBefore:now-60000,fetchImpl:async()=>({status:200,json:async()=>({messages:[
  {id:9,text:`${VERIFY}999999`,received_at_raw:freshRaw},
  {id:8,text:`${VERIFY}888888`,received_at_raw:oldRaw}
 ]})})});
 assert.equal(result.code,'999999');
});

test('times out without sleeping after the last attempt',async()=>{
 let clock=0;let calls=0;const sleeps=[];
 await assert.rejects(waitForSmsCode({url:'x',token:'t',baselineId:0,timeoutMs:20,intervalMs:10,now:()=>clock,sleep:async ms=>{sleeps.push(ms);clock+=ms;},fetchImpl:async()=>{calls++;return {status:200,json:async()=>({messages:[]})};}}),{message:'SMS code timeout'});
 assert.equal(calls,3);assert.deepEqual(sleeps,[10,10]);
});

test('throws on SMS API errors',async()=>{
 await assert.rejects(fetchRecentSms({url:'x',token:'t',fetchImpl:async()=>({status:503})}),{message:'SMS API HTTP 503'});
});
