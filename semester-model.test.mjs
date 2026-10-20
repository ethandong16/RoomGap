import test from 'node:test';
import assert from 'node:assert/strict';
import {roomDay,FULL_DAY_MASK,freeIntervals} from './semester-model.mjs';
import {readFile} from 'node:fs/promises';
const term={termSeason:'1',termType:'1',sectionTypes:[{code:'01',multiplier:1},{code:'02',multiplier:2}],examMappings:[{xqdm:'1',xqlxdm:'1',ksjc:2,skjc:3}]};
test('overlapping reservations and courses combine without opening occupied periods',()=>{
 const day=roomDay([{sessionType:'01',start:1,length:4,module:'06'},{sessionType:'01',start:3,length:4,module:'room'}],term);
 assert.equal(day.occupiedMask,63);assert.deepEqual(day.freeIntervals,[[7,13]]);
});
test('exam periods use the official mapping, not the session number',()=>{
 const day=roomDay([{sessionType:'02',start:2,length:1,module:'07'}],term);
 assert.equal(day.occupiedMask,12);assert.deepEqual(day.freeIntervals,[[1,2],[5,13]]);
});
test('unmapped exams do not create false free rooms',()=>{
 const day=roomDay([{sessionType:'02',start:8,length:1,module:'07'}],term);
 assert.equal(day.unknownMask,FULL_DAY_MASK);assert.equal(day.freeMask,0);
});
test('unknown occupancy modules remain occupied',()=>{
 const day=roomDay([{sessionType:'01',start:13,length:1,module:'new-module'}],term);
 assert.equal(day.categories.other,4096);assert.equal(day.freeMask,4095);
});
test('empty occupancy is free only when the caller has a verified day response',()=>{
 assert.equal(roomDay([],term).freeMask,FULL_DAY_MASK);assert.deepEqual(freeIntervals(0),[]);
});

test('official final-period exams occupy period 13 without making the day unknown',async()=>{
 const officialTerm=JSON.parse(await readFile(new URL('./data/semester/term.json',import.meta.url),'utf8'));
 const day=roomDay([{sessionType:'02',start:13,length:1,module:'07'}],officialTerm);
 assert.equal(day.occupiedMask,4096);assert.equal(day.categories.exam,4096);
 assert.equal(day.unknownMask,0);assert.deepEqual(day.anomalies,[]);
 assert.deepEqual(day.freeIntervals,[[1,12]]);
});
test('overlapping exams preserve all occupied in-day periods at the boundary',()=>{
 const mapped={...term,examMappings:[7,8,12,13].map(p=>({xqdm:'1',xqlxdm:'1',ksjc:p,skjc:p}))};
 const day=roomDay([7,8,12,13].map(start=>({sessionType:'02',start,length:1,module:'07'})),mapped);
 assert.equal(day.occupiedMask,6592);assert.equal(day.unknownMask,0);
 assert.deepEqual(day.freeIntervals,[[1,6],[10,11]]);assert.deepEqual(day.anomalies,[]);
});
test('longer mapped exams keep their complete in-day overlap',()=>{
 const mapped={...term,examMappings:[{xqdm:'1',xqlxdm:'1',ksjc:6,skjc:12}]};
 const day=roomDay([{sessionType:'02',start:6,length:2,module:'07'}],mapped);
 assert.equal(day.occupiedMask,6144);assert.equal(day.unknownMask,0);
 assert.deepEqual(day.freeIntervals,[[1,11]]);
});
test('an exam mapping outside the day is still unknown',()=>{
 for(const skjc of [0,14,1.5,'bad']){
  const mapped={...term,examMappings:[{xqdm:'1',xqlxdm:'1',ksjc:13,skjc}]};
  const day=roomDay([{sessionType:'02',start:13,length:1,module:'07'}],mapped);
  assert.equal(day.unknownMask,FULL_DAY_MASK);assert.equal(day.freeMask,0);
  assert.deepEqual(day.anomalies,['out_of_range']);
 }
});
test('invalid exam multipliers are still unknown',()=>{
 for(const multiplier of [0,-1,NaN,Infinity]){
  const mapped={...term,sectionTypes:[{code:'02',multiplier}]};
  const day=roomDay([{sessionType:'02',start:2,length:1,module:'07'}],mapped);
  assert.equal(day.unknownMask,FULL_DAY_MASK);assert.equal(day.freeMask,0);
 }
});
test('out-of-range courses remain unknown and preserve their in-day occupancy',()=>{
 const day=roomDay([{sessionType:'01',start:13,length:2,module:'06'}],term);
 assert.equal(day.occupiedMask,4096);assert.equal(day.unknownMask,FULL_DAY_MASK);
 assert.equal(day.freeMask,0);assert.deepEqual(day.anomalies,['out_of_range']);
});
