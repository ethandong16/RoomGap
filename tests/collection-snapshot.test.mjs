import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {daySnapshotsEqualIgnoringCapturedAt,hasValidCapturedAt,removeStaleDaySnapshots,writeDayIfChanged,writeTextIfChanged} from '../write-if-changed.mjs';

const snapshot=overrides=>({
 complete:true,
 date:'2026-11-06',
 campusCode:'01',
 buildingCode:'12',
 buildingIndex:0,
 roomCount:15,
 teachingWeek:10,
 weekday:5,
 capturedAt:'2026-11-05T04:30:00.000Z',
 orphanRoomIds:[],
 busy:[{roomId:'01/12/107',sessionType:'01',start:5,length:1,module:'06',weekMask:'000000011110000000000000',weekday:5}],
 ...overrides,
});

async function fixture(t,contents) {
 const root=await mkdtemp(path.join(tmpdir(),'roomgap-snapshot-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const file=path.join(root,'day.json');
 if(contents!==undefined)await writeFile(file,contents,'utf8');
 return file;
}

test('unchanged day content preserves old bytes and capturedAt',async t=>{
 const oldText=JSON.stringify(snapshot({capturedAt:'2026-11-01T01:02:03.000Z'}),null,2)+'\n';
 const file=await fixture(t,oldText);
 const candidate=snapshot({capturedAt:'2026-11-06T04:30:00.000Z'});
 assert.equal(daySnapshotsEqualIgnoringCapturedAt(JSON.parse(oldText),candidate),true);
 assert.equal(await writeDayIfChanged(file,candidate),false);
 assert.equal(await readFile(file,'utf8'),oldText);
});

test('semantic day changes rewrite the snapshot',async t=>{
 const file=await fixture(t,JSON.stringify(snapshot({capturedAt:'2026-11-01T01:02:03.000Z'})));
 const candidate=snapshot({capturedAt:'2026-11-06T04:30:00.000Z',busy:[]});
 assert.equal(await writeDayIfChanged(file,candidate),true);
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),candidate);
});

test('missing, malformed, or timestamp-invalid snapshots are replaced',async t=>{
 const candidate=snapshot({capturedAt:'2026-11-06T04:30:00.000Z'});
 for(const oldText of [undefined,'not json',JSON.stringify({...candidate,capturedAt:undefined}),JSON.stringify({...candidate,capturedAt:'not-a-date'})]) {
  const file=await fixture(t,oldText);
  assert.equal(await writeDayIfChanged(file,candidate),true);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),candidate);
 }
});

test('comparison ignores object key order but not array order',()=>{
 const busy=[snapshot().busy[0],{...snapshot().busy[0],start:6}];
 const old=snapshot({capturedAt:'2026-11-01T01:02:03.000Z',busy});
 const candidate={busy:old.busy,orphanRoomIds:old.orphanRoomIds,weekday:old.weekday,teachingWeek:old.teachingWeek,roomCount:old.roomCount,buildingIndex:old.buildingIndex,buildingCode:old.buildingCode,campusCode:old.campusCode,date:old.date,complete:old.complete,capturedAt:'2026-11-06T04:30:00.000Z'};
 assert.equal(daySnapshotsEqualIgnoringCapturedAt(old,candidate),true);
 assert.equal(daySnapshotsEqualIgnoringCapturedAt(old,{...candidate,busy:[...old.busy].reverse()}),false);
});

test('text writer skips identical bytes',async t=>{
 const file=await fixture(t,'old bytes\n');
 assert.equal(await writeTextIfChanged(file,'old bytes\n'),false);
 assert.equal(await writeTextIfChanged(file,'new bytes\n'),true);
 assert.equal(await readFile(file,'utf8'),'new bytes\n');
 assert.equal(await writeTextIfChanged(path.join(path.dirname(file),'missing.json'),'created'),true);
});

test('capturedAt validation accepts parseable dates only',()=>{
 assert.equal(hasValidCapturedAt({capturedAt:'2026-11-06T04:30:00.000Z'}),true);
 assert.equal(hasValidCapturedAt({capturedAt:'not-a-date'}),false);
 assert.equal(hasValidCapturedAt({}),false);
 assert.equal(hasValidCapturedAt(null),false);
});

test('stale day snapshots at inactive building indexes are removed only in range',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'roomgap-stale-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 for(const file of ['24-2026-08-31.json','25-2026-08-31.json','26-2026-08-31.json','25-2026-09-01.json','25-2026-09-02.json','notes-2026-08-31.json'])await writeFile(path.join(root,file),file,'utf8');
 assert.deepEqual(await removeStaleDaySnapshots(root,[24,26],['2026-08-31','2026-09-01']),['25-2026-08-31.json','25-2026-09-01.json']);
 assert.deepEqual((await readdir(root)).sort(),['24-2026-08-31.json','25-2026-09-02.json','26-2026-08-31.json','notes-2026-08-31.json']);
});
