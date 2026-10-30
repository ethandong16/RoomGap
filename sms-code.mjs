const KEYWORD='(?:\\u9a8c\\u8bc1\\u7801|\\u6821\\u9a8c\\u7801|\\u52a8\\u6001\\u7801|\\u52a8\\u6001\\u5bc6\\u7801|\\u77ed\\u4fe1\\u9a8c\\u8bc1\\u7801|\\u77ed\\u4fe1\\u6821\\u9a8c\\u7801|\\u5b89\\u5168\\u7801|\\u9a8c\\u8bc1\\u4ee3\\u7801|\\u8ba4\\u8bc1\\u7801|\\u767b\\u5f55\\u9a8c\\u8bc1\\u7801|\\u767b\\u5f55\\u7801|\\u4e00\\u6b21\\u6027\\u5bc6\\u7801|\\u53e3\\u4ee4|verification\\s*code|passcode|security\\s*code)';

function isDateCode(code){
 if(!/^(?:19|20)\d{6}$/.test(code))return false;
 const year=Number(code.slice(0,4)),month=Number(code.slice(4,6)),day=Number(code.slice(6,8));
 const date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}

export function extractSmsCode(text){
 const normalized=String(text??'').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'');
 if(!normalized)return null;
 const hasKeyword=new RegExp(KEYWORD,'iu').test(normalized);
 const keywordRe=new RegExp(`${KEYWORD}[^0-9]{0,24}(\\d{4,8})(?!\\d)`,'giu');
 for(const match of normalized.matchAll(keywordRe)){
  if(!isDateCode(match[1]))return match[1];
 }
 if(hasKeyword)return null;
 const standalone=normalized.match(/(?<!\d)(\d{6})(?!\d)/u);
 return standalone&&!isDateCode(standalone[1])?standalone[1]:null;
}

function parseReceivedAt(raw){
 const text=String(raw??'').trim();
 const match=text.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/);
 if(!match)return null;
 const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
 const month=months[match[1]];
 if(month===undefined)return null;
 const now=new Date();
 let time=Date.UTC(now.getUTCFullYear(),month,Number(match[2]),Number(match[3]),Number(match[4]),Number(match[5]));
 if(time-now.getTime()>86400000)time-=Date.UTC(now.getUTCFullYear()+1,0,1)-Date.UTC(now.getUTCFullYear(),0,1);
 return time;
}

function normalizeMessage(message){
 return {
  id:message?.id,
  receivedAtRaw:message?.received_at_raw??message?.received_at,
  receivedAtMs:parseReceivedAt(message?.received_at_raw??message?.received_at),
  sender:message?.sender,
  text:message?.text,
  importedAt:message?.imported_at_utc??message?.imported_at
 };
}

export async function fetchRecentSms({url,token,fetchImpl=fetch}){
 const response=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
 if(response.status<200||response.status>=300)throw new Error(`SMS API HTTP ${response.status}`);
 const payload=await response.json();
 const rows=Array.isArray(payload?.messages)?payload.messages:[];
 return {
  messages:rows.map(normalizeMessage),
  sourceCheckedAt:payload?.source_checked_at_utc??payload?.source_checked_at??null
 };
}

export async function waitForSmsCode({url,token,baselineId,notBefore,timeoutMs=180000,intervalMs=2000,accept,fetchImpl=fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const deadline=now()+timeoutMs;
 const baseline=Number(baselineId);
 while(true){
  const {messages}=await fetchRecentSms({url,token,fetchImpl});
  const newer=(Array.isArray(messages)?messages:[])
   .filter(message=>Number(message.id)>baseline)
   .filter(message=>notBefore===undefined||message.receivedAtMs==null||message.receivedAtMs>=notBefore)
   .sort((a,b)=>Number(b.id)-Number(a.id));
  for(const message of newer){
   if(accept&&!await accept(message))continue;
   const code=extractSmsCode(message.text);
   if(code)return {code,message};
  }
  const remaining=deadline-now();
  if(remaining<=0)throw new Error('SMS code timeout');
  await sleep(Math.min(intervalMs,remaining));
 }
}

export function maxSmsId(messages){
 let max=null;
 for(const message of Array.isArray(messages)?messages:[]){
  const id=Number(message?.id);
  if(!Number.isFinite(id)||(max!==null&&id<=max))continue;
  max=id;
 }
 return max;
}
