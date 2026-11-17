import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='data/dataset';
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const roomText=await readFile(`${root}/rooms.json`,'utf8');
const rooms=JSON.parse(roomText);
const [schema,term,coverage,manifest]=await Promise.all([load(`${root}/schema.json`),load(`${root}/term.json`),load(`${root}/coverage.json`),load('data/semester/manifest.json')]);
assert.equal(manifest.complete,true,'Source collection incomplete');
assert.equal(coverage.complete,true,'Dataset coverage incomplete');
assert.equal(coverage.missing.length,0);
assert.equal(coverage.unknownRoomDays,0);
assert.equal(coverage.anomalies.length,0);
assert.equal(coverage.weekdayMismatches,0);
assert.equal(coverage.weekMaskMismatches,0);
assert.equal(createHash('sha256').update(roomText).digest('hex'),schema.catalogDigest);
assert.equal(new Set(rooms.map(r=>r.id)).size,rooms.length);
const expected=Array.from({length:140},(_,i)=>new Date(Date.parse(`${term.startDate}T00:00:00Z`)+i*86400000).toISOString().slice(0,10));
assert.equal(expected.at(-1),term.endDate);
assert.deepEqual((await readdir(`${root}/days`)).filter(f=>f.endsWith('.json')).sort(),expected.map(d=>`${d}.json`));
const mondayOf=date=>{
 const value=new Date(`${date}T00:00:00Z`),day=value.getUTCDay();
 return new Date(value.getTime()+(day===0?-6:1-day)*86400000).toISOString().slice(0,10);
};
const weekStarts=new Map();
for(const date of expected){
 const weekStart=mondayOf(date);
 if(!weekStarts.has(weekStart))weekStarts.set(weekStart,[]);
 weekStarts.get(weekStart).push(date);
}
let roomDays=0;
for(const date of expected){
 const d=await load(`${root}/days/${date}.json`);
 assert.equal(d.date,date);assert.equal(d.catalogDigest,schema.catalogDigest);assert.equal(d.rooms.length,rooms.length);
 assert.equal(new Set(d.rooms.map(r=>r.room)).size,rooms.length);
 for(const r of d.rooms){
  assert.ok(Number.isInteger(r.room)&&r.room>=0&&r.room<rooms.length);
  for(const m of [r.freeMask,r.occupiedMask,r.unknownMask])assert.ok(Number.isInteger(m)&&m>=0&&m<=8191);
  assert.equal(r.freeMask&r.occupiedMask,0);assert.equal(r.freeMask&r.unknownMask,0);
  assert.equal(r.freeMask|r.occupiedMask|r.unknownMask,8191);
  let intervalMask=0,lastEnd=0;
  for(const [start,end] of r.freeIntervals){assert.ok(start>lastEnd&&start>=1&&end<=13&&end>=start);lastEnd=end;for(let p=start;p<=end;p++)intervalMask|=1<<(p-1);}
  assert.equal(intervalMask,r.freeMask);roomDays++;
 }
}
assert.equal(roomDays,coverage.roomDays);
assert.equal(roomDays*13,coverage.periodStates);
const weekFiles=(await readdir(`${root}/weeks`)).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
assert.deepEqual(weekFiles,[...weekStarts.keys()].sort().map(date=>`${date}.json`));
let weekMasks=0;
for(const [weekStart,dates] of weekStarts){
 const week=await load(`${root}/weeks/${weekStart}.json`);
 assert.equal(week.weekStart,weekStart);assert.equal(week.catalogDigest,schema.catalogDigest);
 assert.ok(Array.isArray(week.rooms)&&week.rooms.length>0);
 assert.equal(new Set(week.rooms).size,week.rooms.length);
 for(const index of week.rooms){
  assert.ok(Number.isInteger(index)&&index>=0&&index<rooms.length);
  assert.equal(rooms[index].candidateEligible!==false&&['classroom','unspecified'].includes(rooms[index].resourceKind),true);
 }
 assert.deepEqual(week.days.map(day=>day.date),dates);
 for(const day of week.days){
  assert.equal(day.masks.length,week.rooms.length);
  for(const [free,occupied,unknown] of day.masks){
   for(const mask of [free,occupied,unknown])assert.ok(Number.isInteger(mask)&&mask>=0&&mask<=8191);
   assert.equal(free&occupied,0);assert.equal(free&unknown,0);
   assert.equal(free|occupied|unknown,8191);weekMasks++;
  }
 }
}
assert.equal(weekStarts.size,20);
console.log(JSON.stringify({verified:true,dates:140,rooms:rooms.length,roomDays,periodStates:roomDays*13,weeks:weekStarts.size,weekMasks,sourceQueries:coverage.verifiedBuildingDays}));
