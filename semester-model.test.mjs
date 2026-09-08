import test from 'node:test';
import assert from 'node:assert/strict';
import {roomDay,FULL_DAY_MASK,freeIntervals} from './semester-model.mjs';
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
