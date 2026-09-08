import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {roomDay,FULL_DAY_MASK} from './semester-model.mjs';
import {createHash} from 'node:crypto';
const source='data/semester',dest='data/dataset';
const load=async path=>JSON.parse(await readFile(path,'utf8'));
const [rooms,buildings,term]=await Promise.all(['rooms','buildings','term'].map(n=>load(`${source}/${n}.json`)));
const buildingNotes=await load(`${source}/building-notes.json`).catch(()=>[]);
const roomIndex=new Map(rooms.map((r,i)=>[r.id,i]));
const byBuilding=new Map();
for(let i=0;i<rooms.length;i++){const r=rooms[i],key=`${r.campusCode}/${r.buildingCode}`;if(!byBuilding.has(key))byBuilding.set(key,[]);byBuilding.get(key).push(i);}
const types=new Map(term.roomTypes.map(t=>[t.code,t.name]));
const roster=rooms.map(r=>{
 const b=buildings.find(b=>b.campusCode===r.campusCode&&b.buildingCode===r.buildingCode);
 const note=buildingNotes.find(n=>n.campusCode===r.campusCode&&n.buildingCode===r.buildingCode)?.note||'';
 const text=`${b?.name||''} ${r.name} ${note}`;
 const resourceKind=/虚拟|线上|在线|网络|智慧树|雨课堂|自主学习/.test(text)?'virtual':/运动场|田径场|体育馆|体育场/.test(text)?'sports':/实验|实训|机房|舞蹈|表演|活动中心/.test(text)?'special-purpose':['1','2','17'].includes(r.typeCode)?'classroom':r.typeCode?'special-purpose':'unspecified';
 return {...r,campus:b?.campus||null,building:b?.name||null,type:types.get(r.typeCode)||null,resourceKind};
});
await mkdir(`${dest}/days`,{recursive:true});
const rosterJson=JSON.stringify(roster);
const catalogDigest=createHash('sha256').update(rosterJson).digest('hex');
await writeFile(`${dest}/rooms.json`,rosterJson);
await writeFile(`${dest}/term.json`,JSON.stringify(term));
const files=(await readdir(`${source}/days`)).filter(f=>/^\d+-\d{4}-\d{2}-\d{2}\.json$/.test(f));
const dayFiles=new Map();for(const f of files){const date=f.match(/\d{4}-\d{2}-\d{2}/)[0];if(!dayFiles.has(date))dayFiles.set(date,[]);dayFiles.get(date).push(f);}
const dates=Array.from({length:140},(_,i)=>new Date(Date.parse(`${term.startDate}T00:00:00Z`)+i*86400000).toISOString().slice(0,10));
const report={complete:false,roomCount:rooms.length,expectedBuildingDays:byBuilding.size*140,verifiedBuildingDays:0,roomDays:0,periodStates:0,unknownRoomDays:0,orphanRoomIds:[],missing:[],anomalies:[],dateCoverage:[],weekdayMismatches:0,weekMaskMismatches:0,generatedAt:new Date().toISOString()};
const orphans=new Set();let occupiedRoomDays=0,firstCapture=null,lastCapture=null;
for(const date of dates){
 const result=rooms.map((r,i)=>({room:i,freeMask:0,occupiedMask:0,unknownMask:FULL_DAY_MASK,freeIntervals:[]}));
 const seen=new Set();
 for(const file of dayFiles.get(date)||[]){
  const d=await load(`${source}/days/${file}`);const key=`${d.campusCode}/${d.buildingCode}`;
  if(!d.complete||d.date!==date||!byBuilding.has(key)||d.roomCount!==byBuilding.get(key).length||seen.has(key))throw Error(`Invalid/duplicate query snapshot ${file}`);
  seen.add(key);report.verifiedBuildingDays++;
  firstCapture=!firstCapture||d.capturedAt<firstCapture?d.capturedAt:firstCapture;lastCapture=!lastCapture||d.capturedAt>lastCapture?d.capturedAt:lastCapture;
  const grouped=new Map();
  for(const r of d.busy){
   if(Number(r.weekday)%7!==Number(d.weekday)%7)report.weekdayMismatches++;
   if(typeof r.weekMask==='string'&&/^[01]+$/.test(r.weekMask)&&r.weekMask[d.teachingWeek-1]!=='1')report.weekMaskMismatches++;
   if(!roomIndex.has(r.roomId)){orphans.add(r.roomId);continue;}
   if(!grouped.has(r.roomId))grouped.set(r.roomId,[]);grouped.get(r.roomId).push(r);
  }
  for(const i of byBuilding.get(key)){
   const state=roomDay(grouped.get(rooms[i].id)||[],term);
   result[i]={room:i,freeMask:state.freeMask,occupiedMask:state.occupiedMask,unknownMask:state.unknownMask,freeIntervals:state.freeIntervals};
   if(state.anomalies.length)report.anomalies.push({date,roomId:rooms[i].id,reasons:state.anomalies});
   if(state.occupiedMask)occupiedRoomDays++;
   report.roomDays++;report.periodStates+=13;
  }
 }
 for(const key of byBuilding.keys())if(!seen.has(key))report.missing.push({date,building:key});
 report.unknownRoomDays+=result.filter(r=>r.unknownMask!==0).length;
 report.dateCoverage.push({date,buildings:seen.size,expected:byBuilding.size});
 await writeFile(`${dest}/days/${date}.json`,JSON.stringify({date,catalogDigest,rooms:result}));
}
report.orphanRoomIds=[...orphans].sort();report.occupiedRoomDays=occupiedRoomDays;report.firstCapture=firstCapture;report.lastCapture=lastCapture;
report.complete=report.verifiedBuildingDays===report.expectedBuildingDays&&!report.missing.length;
report.resourceKinds=roster.reduce((m,r)=>(m[r.resourceKind]=(m[r.resourceKind]||0)+1,m),{});
await writeFile(`${dest}/coverage.json`,JSON.stringify(report,null,2));
await writeFile(`${dest}/schema.json`,JSON.stringify({version:1,catalogDigest,periods:13,roomReference:'room字段为rooms.json的零起始数组索引',maskEncoding:'第n节对应1<<(n-1)；13节全为1是8191',intervalEncoding:'freeIntervals为闭区间[startPeriod,endPeriod]',missingData:'未知节次不得当作空闲',timezone:'Asia/Shanghai'},null,2));
console.log(JSON.stringify({...report,dateCoverage:undefined,missing:report.missing.length,anomalies:report.anomalies.length,orphanRoomIds:report.orphanRoomIds.length}));
