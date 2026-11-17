import test from 'node:test';
import assert from 'node:assert/strict';
import {BELL_SCHEDULE, PERIOD_GROUPS, beijingClock, periodAt, formatPeriod, groupRange, minutesOf} from '../site/bell-schedule.mjs';

test('reference schedule uses 100-minute blocks of two small periods',()=>{
  assert.equal(BELL_SCHEDULE.blocks.length,7);
  assert.deepEqual(BELL_SCHEDULE.blocks.map(block=>block.periods),[[1,2],[3,4],[5,6],[7,8],[9],[10,11],[12,13]]);
  for(const block of BELL_SCHEDULE.blocks){
    const duration=minutesOf(block.end)-minutesOf(block.start);
    assert.ok(duration>0);
    if(block.periods.length===2)assert.equal(duration,100);
  }
  assert.deepEqual(PERIOD_GROUPS.map(group=>group.periods.length),[4,5,4]);
  assert.equal(BELL_SCHEDULE.verified,false);
  assert.match(BELL_SCHEDULE.source,/待.*核对/);
});

test('Beijing clock and current/next class blocks',()=>{
  assert.equal(beijingClock(new Date('2026-11-17T00:10:00Z')).time,'08:10');
  const first=periodAt(new Date('2026-11-17T00:30:00Z'));
  assert.equal(first.current.label,'第1–2节');assert.equal(first.next.label,'第3–4节');
  const between=periodAt(new Date('2026-11-17T02:05:00Z'));
  assert.equal(between.current,null);assert.equal(between.next.label,'第3–4节');
  const second=periodAt(new Date('2026-11-17T02:20:00Z'));
  assert.equal(second.current.label,'第3–4节');assert.equal(second.next.label,'第5–6节');
  const lunch=periodAt(new Date('2026-11-17T04:00:00Z'));
  assert.equal(lunch.current,null);assert.equal(lunch.next.label,'第5–6节');
  const nine=periodAt(new Date('2026-11-17T09:30:00Z'));
  assert.equal(nine.current.label,'第9节');assert.equal(nine.next.label,'第10–11节');
  const night=periodAt(new Date('2026-11-17T14:10:00Z'));
  assert.equal(night.current,null);assert.equal(night.next,null);
});

test('block labels and group ranges are stable',()=>{
  assert.equal(formatPeriod(BELL_SCHEDULE.blocks[0]),'第1–2节 · 08:20–10:00');
  assert.equal(groupRange([1,2,3,4]),'08:20–12:00');
  assert.equal(groupRange([5,6,7,8,9]),'13:30–18:05');
  assert.equal(groupRange([10,11,12,13]),'18:30–22:00');
  assert.equal(groupRange([]),'');
});
