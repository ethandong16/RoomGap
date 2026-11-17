import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectRooms, validateDay, initialDate, beijingDate, dateInTerm, moveDate, teachingWeek, createDayLoader,
  buildingLabel, floorOf, parseFloorQuery, searchScore, browseRooms, overviewByBuilding, periodCounts,
  weekDates, formatIntervals, longestFreeInterval, validateWeek} from '../site/query.mjs';
const load=async p=>JSON.parse(await readFile(new URL(`../data/dataset/${p}`,import.meta.url),'utf8'));
const [rooms,day,term,schema]=await Promise.all(['rooms.json','days/2026-09-08.json','term.json','schema.json'].map(load));

test('official snapshot: west TEDA only recommends room numbers ending in 09, 10 or 11',()=>{
  validateDay(day,'2026-09-08',rooms,schema.catalogDigest);
  const results=selectRooms(rooms,day,{campus:'04',start:1,end:4});
  assert.ok(results.length > 0);
  assert.ok(results.some(r=>r.room.id==='04/11/111(d)'));
  assert.ok(results.every(({room})=>/^\d*(09|10|11)(?:\D|$)/.test(room.roomCode)));
  assert.ok(results.every(({room})=>!String(room.building).includes('基地')));
  for(let i=1;i<results.length;i++)assert.ok(results[i-1].continuousLength>=results[i].continuousLength);
});
test('combined building, name and capacity filters keep only valid matches',()=>{
  const result=selectRooms(rooms,day,{campus:'04',building:'04/11',search:'111',minCapacity:100,start:1,end:4});
  assert.deepEqual(result.map(r=>r.room.id),['04/11/111(d)']);
  assert.equal(selectRooms(rooms,day,{search:'a classroom that does not exist'}).length,0);
});
test('non-contiguous periods must all be free',()=>{
  const roster=['all-free','middle-busy','last-busy'].map(name=>({id:name,name,resourceKind:'classroom',campus:'a',campusCode:'01',building:'1',buildingCode:'1'}));
  const snapshot={rooms:[
    {room:0,freeMask:8191,occupiedMask:0,unknownMask:0},
    {room:1,freeMask:8189,occupiedMask:2,unknownMask:0},
    {room:2,freeMask:8187,occupiedMask:4,unknownMask:0}
  ]};
  assert.deepEqual(selectRooms(roster,snapshot,{periods:[1,3]}).map(r=>r.room.id),['all-free','middle-busy']);
  assert.deepEqual(selectRooms(roster,snapshot,{periods:[]}),[]);
  assert.throws(()=>selectRooms(roster,snapshot,{periods:[1,1]}));
});
test('partial occupancy, unknown periods and non-classroom resources are never recommended',()=>{
  const roster=Array.from({length:5},(_,i)=>({id:String(i),name:String(i),resourceKind:i===4?'virtual':'classroom',campus:'a',campusCode:'01',building:'1',buildingCode:'1'}));
  const snapshot={rooms:[
    {room:0,freeMask:8191,occupiedMask:0,unknownMask:0},
    {room:1,freeMask:8190,occupiedMask:1,unknownMask:0},
    {room:2,freeMask:8189,occupiedMask:0,unknownMask:2},
    {room:3,freeMask:8191,occupiedMask:0,unknownMask:1},
    {room:4,freeMask:8191,occupiedMask:0,unknownMask:0}
  ]};
  assert.deepEqual(selectRooms(roster,snapshot,{start:1,end:2}).map(r=>r.room.id),['0']);
  assert.throws(()=>selectRooms(roster,snapshot,{start:4,end:1}));
});
test('rooms excluded by access policy are never recommended',()=>{
  const roster=[
    {id:'allowed',name:'110',resourceKind:'classroom',candidateEligible:true,campus:'a',campusCode:'01',building:'1',buildingCode:'1'},
    {id:'locked',name:'112',resourceKind:'classroom',candidateEligible:false,campus:'a',campusCode:'01',building:'1',buildingCode:'1'}
  ];
  const snapshot={rooms:[0,1].map(room=>({room,freeMask:8191,occupiedMask:0,unknownMask:0}))};
  assert.deepEqual(selectRooms(roster,snapshot,{start:1,end:2}).map(r=>r.room.id),['allowed']);
});
test('sort by containing interval, then natural classroom number',()=>{
  const roster=['10','2','3'].map(name=>({id:name,name,resourceKind:'classroom',campus:'a',campusCode:'01',building:'1',buildingCode:'1'}));
  const snapshot={rooms:[{room:0,freeMask:15,occupiedMask:8176,unknownMask:0},{room:1,freeMask:15,occupiedMask:8176,unknownMask:0},{room:2,freeMask:8191,occupiedMask:0,unknownMask:0}]};
  assert.deepEqual(selectRooms(roster,snapshot,{start:1,end:2}).map(r=>r.room.name),['3','2','10']);
});
test('Beijing dates, cross-month movement and term edges',()=>{
  assert.equal(beijingDate(new Date('2026-09-07T16:30:00Z')),'2026-09-08');
  assert.deepEqual(initialDate(term,new Date('2026-07-01T12:00:00Z')),{date:'2026-08-31',outsideTerm:true});
  assert.equal(moveDate('2026-08-31',1),'2026-09-01');
  assert.equal(moveDate('2027-01-01',-1),'2026-12-31');
  assert.equal(teachingWeek(term.endDate,term),20);
  assert.equal(dateInTerm('2027-01-17',term),true);
  for(const date of ['2027-01-18','2026-08-30','2026-09-31','2026-13-01',''])assert.equal(dateInTerm(date,term),false);
});
test('reject mismatched versions, missing rows and contradictory free states',()=>{
  assert.throws(()=>validateDay({...day,catalogDigest:'old'},day.date,rooms,schema.catalogDigest));
  assert.throws(()=>validateDay({...day,rooms:day.rooms.slice(1)},day.date,rooms,schema.catalogDigest));
  const broken=structuredClone(day);broken.rooms[0].unknownMask=broken.rooms[0].freeMask;
  assert.throws(()=>validateDay(broken,day.date,rooms,schema.catalogDigest));
});
test('slow old date cannot overwrite new selection; successful dates are cached',async()=>{
  const pending=new Map();let calls=0;
  const loader=createDayLoader(date=>{calls++;return new Promise(resolve=>pending.set(date,resolve));},d=>d);
  const old=loader.select('old'),recent=loader.select('recent');
  pending.get('recent')({date:'recent'});assert.equal((await recent).day.date,'recent');
  pending.get('old')({date:'old'});assert.deepEqual(await old,{stale:true});
  assert.equal((await loader.select('recent')).day.date,'recent');assert.equal(calls,2);
});
test('failed loads can retry and stale errors are ignored',async()=>{
  let attempt=0;
  const loader=createDayLoader(async()=>{if(!attempt++)throw Error('network');return day;},d=>d);
  await assert.rejects(loader.select(day.date));assert.equal((await loader.select(day.date)).day,day);
  let rejectOld;
  const racing=createDayLoader(date=>date==='old'?new Promise((_,reject)=>rejectOld=reject):Promise.resolve(day),d=>d);
  const old=racing.select('old');await racing.select('new');rejectOld(Error('offline'));
  assert.deepEqual(await old,{stale:true});
});

test('display aliases and floor derivation stay conservative',()=>{
  assert.equal(buildingLabel('3-'),'3号楼');
  assert.equal(buildingLabel('1号楼'),'1号楼');
  assert.equal(buildingLabel('A'),'A楼');
  assert.equal(floorOf({name:'101(d)',building:'3-'}),1);
  assert.equal(floorOf({name:'205（d）',building:'5-'}),2);
  assert.equal(floorOf({name:'401研究生',building:'3-'}),4);
  assert.equal(floorOf({name:'201预科',building:'E'}),2);
  assert.equal(floorOf({name:'1008',building:'E'}),null);
  assert.equal(floorOf({name:'10阶梯',building:'9-'}),null);
  assert.equal(parseFloorQuery('2楼'),2);
  assert.equal(parseFloorQuery('二层'),2);
  assert.equal(parseFloorQuery('F2'),null);
});

test('search ranks exact room numbers above building aliases and types',()=>{
  const room={name:'201',building:'18-',campus:'河西',type:'普通教室'};
  assert.equal(searchScore(room,'201'),0);
  assert.equal(searchScore({name:'201服装工艺室',building:'1号楼',campus:'河西',type:'普通教室'},'201'),1);
  assert.equal(searchScore({name:'中澳教室',building:'201',campus:'泰达',type:'多媒体教室'},'201'),3);
  assert.equal(searchScore(room,'2楼'),0);
  assert.equal(searchScore(room,'多媒体'),-1);
  assert.equal(searchScore(room,'不存在'),-1);
});

test('room-first browsing includes occupied rooms and applies floor, type and capacity',()=>{
  const roster=[
    {id:'free',name:'101',building:'3-',buildingCode:'3',campus:'泰达',campusCode:'02',resourceKind:'classroom',type:'多媒体教室',capacity:72},
    {id:'busy',name:'102',building:'3-',buildingCode:'3',campus:'泰达',campusCode:'02',resourceKind:'classroom',type:'普通教室',capacity:40},
    {id:'unknown',name:'103',building:'3-',buildingCode:'3',campus:'泰达',campusCode:'02',resourceKind:'classroom',type:'多媒体教室',capacity:100}
  ];
  const snapshot={rooms:[
    {room:0,freeMask:8191,occupiedMask:0,unknownMask:0,freeIntervals:[[1,13]]},
    {room:1,freeMask:0,occupiedMask:8191,unknownMask:0,freeIntervals:[]},
    {room:2,freeMask:0,occupiedMask:0,unknownMask:8191,freeIntervals:[]}
  ]};
  assert.equal(browseRooms(roster,snapshot,{}).length,3);
  assert.deepEqual(browseRooms(roster,snapshot,{freeOnly:true}).map(entry=>entry.room.id),['free']);
  assert.deepEqual(browseRooms(roster,snapshot,{floor:'1'}).map(entry=>entry.room.id),['free','busy','unknown']);
  assert.deepEqual(browseRooms(roster,snapshot,{type:'多媒体教室',minCapacity:80}).map(entry=>entry.room.id),['unknown']);
  assert.deepEqual(browseRooms(roster,snapshot,{type:'__none__'}).map(entry=>entry.room.id),[]);
});

test('building overview and period counts exclude unknown and occupied periods',()=>{
  const roster=[
    {id:'free',name:'101',building:'3-',buildingCode:'3',campus:'泰达',campusCode:'02',resourceKind:'classroom',type:'多媒体教室',capacity:72},
    {id:'busy',name:'102',building:'3-',buildingCode:'3',campus:'泰达',campusCode:'02',resourceKind:'classroom',type:'普通教室',capacity:40},
    {id:'unknown',name:'103',building:'3-',buildingCode:'3',campus:'泰达',campusCode:'02',resourceKind:'classroom',type:'多媒体教室',capacity:100}
  ];
  const snapshot={rooms:[
    {room:0,freeMask:8191,occupiedMask:0,unknownMask:0,freeIntervals:[[1,13]]},
    {room:1,freeMask:0,occupiedMask:8191,unknownMask:0,freeIntervals:[]},
    {room:2,freeMask:0,occupiedMask:0,unknownMask:8191,freeIntervals:[]}
  ]};
  const [group]=overviewByBuilding(roster,snapshot,{});
  assert.equal(group.label,'3号楼');
  assert.equal(group.roomCount,3);
  assert.equal(group.freeCount,1);
  assert.equal(group.continuousCount,1);
  assert.deepEqual(group.floors,[1]);
  assert.deepEqual(periodCounts(roster,snapshot,{}),Array(13).fill(1));
  assert.deepEqual(browseRooms(roster,snapshot,{search:'2楼'}),[]);
  assert.equal(formatIntervals([[1,4],[9,13]]),'第 1–4 节、第 9–13 节');
  assert.deepEqual(longestFreeInterval(snapshot.rooms[0]),{start:1,end:13,length:13});
});

test('week starts on Monday and the shared loader deduplicates requests',async()=>{
  assert.deepEqual(weekDates('2026-09-08'),['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13']);
  assert.deepEqual(weekDates('2026-09-13'),['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12','2026-09-13']);
  let calls=0;
  const loader=createDayLoader(async date=>{calls++;return {date};},d=>d);
  const [a,b]=await Promise.all([loader.load('2026-09-08'),loader.load('2026-09-08')]);
  assert.equal(calls,1);
  assert.equal(a,b);
  assert.equal(await loader.load('2026-09-08'),a);
  assert.equal(calls,1);
  assert.equal(loader.has('2026-09-08'),true);
});

test('weekly bundle validates catalog digest, room indices and masks',async()=>{
  const week=await load('weeks/2026-09-07.json');
  validateWeek(week,'2026-09-07',rooms.length,schema.catalogDigest);
  assert.equal(week.days.length,7);
  assert.ok(week.rooms.length>0);
  const bundle={weekStart:'2026-09-07',catalogDigest:schema.catalogDigest,rooms:[0],days:[{date:'2026-09-07',masks:[[8191,0,0]]}]};
  assert.equal(validateWeek(bundle,'2026-09-07',rooms.length,schema.catalogDigest),bundle);
  assert.throws(()=>validateWeek({...bundle,catalogDigest:'old'},'2026-09-07',rooms.length,schema.catalogDigest));
  assert.throws(()=>validateWeek({...bundle,rooms:[rooms.length]},'2026-09-07',rooms.length,schema.catalogDigest));
  assert.throws(()=>validateWeek({...bundle,days:[{date:'2026-09-07',masks:[[8190,0,0]]}]},'2026-09-07',rooms.length,schema.catalogDigest));
});
