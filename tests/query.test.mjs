import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectRooms, validateDay, initialDate, beijingDate, dateInTerm, moveDate, teachingWeek, createDayLoader} from '../site/query.mjs';
const load=async p=>JSON.parse(await readFile(new URL(`../data/dataset/${p}`,import.meta.url),'utf8'));
const [rooms,day,term,schema]=await Promise.all(['rooms.json','days/2026-09-08.json','term.json','schema.json'].map(load));

test('official snapshot: west TEDA 2026-09-08 periods 1–4 has 19 candidates',()=>{
  validateDay(day,'2026-09-08',rooms,schema.catalogDigest);
  const results=selectRooms(rooms,day,{campus:'04',start:1,end:4});
  assert.equal(results.length,19);
  assert.ok(results.some(r=>r.room.id==='04/11/111(d)'));
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
