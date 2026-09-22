import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {parseClassroomIndex,parseClassroomSearch} from './classroom-page.mjs';
const base='http://jwxtxs.tust.edu.cn:46110';
const index=base+'/student/teachingResources/classroomUseStatus/index';
const endpoint=base+'/student/teachingResources/classroomUseStatus/jasInfo';
const out='data/semester';
const userAgent='Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
await mkdir(out+'/days',{recursive:true});
let manifest;
const save=async(name,value)=>writeFile(`${out}/${name}`,JSON.stringify(value),'utf8');
const id=r=>[r.campusNumber,r.teachingBuildingNumber,r.classroomNumber].join('/');
try {
 const cookies=JSON.parse(await readFile(process.env.ROOMGAP_COOKIES_FILE||'.roomgap-auth.json','utf8'));
 if(!Array.isArray(cookies)||!cookies.length)throw Error('Cookie file must contain a non-empty array');
 const cookie=cookies.map(item=>`${item.name}=${item.value}`).join('; ');
 const fetchText=async url=>{
  const response=await fetch(url,{headers:{cookie,'user-agent':userAgent},redirect:'manual',signal:AbortSignal.timeout(30000)});
  if([301,302,303,307,308].includes(response.status))throw Error('Login expired: scan the QR code again');
  if(!response.ok)throw Error(`GET ${new URL(url).pathname} returned HTTP ${response.status}`);
  return response.text();
 };
 const indexPage=await fetchText(index);
 let parsedIndex;
 try{parsedIndex=parseClassroomIndex(indexPage);}catch(error){
  if(/authserver|qrLoginForm|统一身份认证/.test(indexPage))throw Error('Login expired: scan the QR code again');
  throw error;
 }
 const {notes,buildings}=parsedIndex;
 await save('building-notes.json',notes);
 const firstBuilding=buildings.find(b=>b.queryable);
 if(!firstBuilding)throw Error('No queryable buildings found');
 const requestReferer=new URL(firstBuilding.path,base).href;
 const {form,roomTypes,sections}=parseClassroomSearch(await fetchText(requestReferer));
 const request=async(f)=>{
  for(let attempt=0;attempt<3;attempt++){
   try {
    const response=await fetch(endpoint,{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded;charset=UTF-8',origin:base,referer:requestReferer,'user-agent':userAgent,'x-requested-with':'XMLHttpRequest'},body:new URLSearchParams(f),redirect:'manual',signal:AbortSignal.timeout(30000)});
    if([301,302,303,307,308].includes(response.status))throw Error('Login expired: scan the QR code again');
    if(!response.ok)throw Error(`HTTP ${response.status()}`);
    const d=await response.json();
    if(!Array.isArray(d.classrooms)||!Array.isArray(d.classroomTime)||!d.jhZxjxjhb)throw Error('Invalid data or login expired');
    return d;
   }
   catch(e){if(attempt===2)throw e;await delay(1000*(attempt+1));}
  }
 };
 const catalog=await request({...form,xqh:'',jxlh:'',searchDate:'2026-08-31'});
 // Blank filters are only valid for the room catalog. Their occupancy result is known to be incomplete.
 const term=catalog.jhZxjxjhb;
 if(term.kxrq!=='20260831'||Number(term.codeXqb.xqzs)!==20)throw Error('Official term differs from requested range');
 const start=Date.UTC(2026,7,31);const dates=Array.from({length:140},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
 const roster=catalog.classrooms.map(r=>({id:id(r.id),campusCode:r.id.campusNumber,buildingCode:r.id.teachingBuildingNumber,roomCode:r.id.classroomNumber,name:r.classroomName,capacity:r.placeNum===''?null:Number(r.placeNum),typeCode:r.classroomTypeCode||null,statusCode:r.classroomStatusCode}));
 if(new Set(roster.map(r=>r.id)).size!==roster.length)throw Error('Duplicate room IDs');
 const groups=buildings.filter(b=>b.queryable).map(b=>({...b,roomIds:roster.filter(r=>r.campusCode===b.campusCode&&r.buildingCode===b.buildingCode).map(r=>r.id)}));
 const matched=new Set(groups.flatMap(g=>g.roomIds));
 for(const room of roster.filter(r=>!matched.has(r.id))){
  let extra=groups.find(g=>g.campusCode===room.campusCode&&g.buildingCode===room.buildingCode);
  if(!extra){extra={rowIndex:buildings.length,campus:buildings.find(b=>b.campusCode===room.campusCode)?.campus||null,name:null,campusCode:room.campusCode,buildingCode:room.buildingCode,queryable:true,source:'room_catalog_only',roomIds:[]};groups.push(extra);buildings.push({...extra,roomIds:undefined});}
  extra.roomIds.push(room.id);
 }
 const active=groups.filter(b=>b.roomIds.length);
 await save('rooms.json',roster);
 await save('buildings.json',buildings.map(b=>({...b,roomCount:groups.find(g=>g.rowIndex===b.rowIndex)?.roomIds.length||0})));
 await save('term.json',{id:term.zxjxjhh,startDate:dates[0],endDate:dates.at(-1),weeks:20,daysPerWeek:Number(term.codeXqb.zts),source:'official_query_response',periodsPerDay:sections[0].tjc,sections,roomTypes:roomTypes.map(t=>({code:t.classroomtypecode,name:t.classroomtypename})),sectionTypes:catalog.sectionType.map(s=>({code:s.jclxdm,name:s.jclxmc,multiplier:s.jcxss})),examMappings:catalog.codeJclxdzb.map(x=>x.id),termSeason:term.xqdm,termType:term.xqlxdm});
 const tasks=[];let cached=0;
 for(const b of active)for(const date of dates){
  const file=`days/${b.rowIndex}-${date}.json`;
  try{const old=JSON.parse(await readFile(`${out}/${file}`,'utf8'));if(process.env.ROOMGAP_REFRESH!=='1'&&old.complete&&old.date===date&&old.campusCode===b.campusCode&&old.buildingCode===b.buildingCode&&old.roomCount===b.roomIds.length){cached++;continue;}}catch{}
  tasks.push({b,date,file});
 }
 manifest={complete:false,startedAt:new Date().toISOString(),range:{start:dates[0],end:dates.at(-1)},roomCount:roster.length,buildingsWithRooms:active.length,buildingsWithoutRooms:groups.filter(b=>!b.roomIds.length),expectedQueries:active.length*dates.length,completedQueries:cached,failures:[],source:endpoint};
 await save('manifest.json',manifest);
 console.log(`START ${roster.length} rooms, ${active.length} buildings, ${tasks.length} pending day queries`);
 let cursor=0,stopped=false,nextRequestAt=0;
 const throttle=async()=>{const at=Math.max(Date.now(),nextRequestAt);nextRequestAt=at+100;await delay(Math.max(0,at-Date.now()));};
 const worker=async()=>{
  while(!stopped&&cursor<tasks.length){
   const task=tasks[cursor++];const {b,date,file}=task;
   try{
    await throttle();const d=await request({...form,xqh:b.campusCode,jxlh:b.buildingCode,searchDate:date});
    if(d.date!==date||d.jhZxjxjhb.zxjxjhh!==term.zxjxjhh)throw Error('Date or term mismatch');
    const actual=new Set(d.classrooms.map(r=>id(r.id)));
    if(actual.size!==b.roomIds.length||b.roomIds.some(r=>!actual.has(r)))throw Error('Room catalog mismatch');
    const busy=d.classroomTime.map(r=>({roomId:id(r.id),sessionType:r.id.sessiontype,start:Number(r.id.sessionstart),length:Number(r.continuingsession),module:r.occupancymoduleId,weekMask:r.id.week,weekday:r.id.xq}));
    const prefix=`${b.campusCode}/${b.buildingCode}/`;
    if(busy.some(r=>!r.roomId.startsWith(prefix)))throw Error('Occupancy returned from another building');
    const orphanRoomIds=[...new Set(busy.filter(r=>!actual.has(r.roomId)).map(r=>r.roomId))];
    await save(file,{complete:true,date,campusCode:b.campusCode,buildingCode:b.buildingCode,buildingIndex:b.rowIndex,roomCount:actual.size,teachingWeek:Number(d.jxzc),weekday:Number(d.week),capturedAt:new Date().toISOString(),orphanRoomIds,busy});
    manifest.completedQueries++;
    if(manifest.completedQueries%50===0){console.log(`PROGRESS ${manifest.completedQueries}/${manifest.expectedQueries} ${b.campus} ${b.name||b.buildingCode} ${date}`);}
   }catch(e){manifest.failures.push({building:b.rowIndex,date,message:e.message});console.error('FAILED',b.rowIndex,date,e.message);stopped=true;}
  }
 };
 const ticker=setInterval(()=>save('manifest.json',manifest).catch(()=>{}),5000);
 await Promise.all([worker(),worker(),worker()]);clearInterval(ticker);
 manifest.complete=manifest.completedQueries===manifest.expectedQueries&&manifest.failures.length===0;
 manifest.finishedAt=new Date().toISOString();await save('manifest.json',manifest);
 console.log('FINISHED',JSON.stringify({complete:manifest.complete,completed:manifest.completedQueries,expected:manifest.expectedQueries,failures:manifest.failures}));
 if(!manifest.complete)process.exitCode=1;
}catch(e){console.error(e.message);if(manifest){manifest.failures.push({message:e.message});await save('manifest.json',manifest);}process.exitCode=1;}
