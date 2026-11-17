import test from 'node:test';
import assert from 'node:assert/strict';
import {BELL_SCHEDULE, PERIOD_GROUPS, beijingClock, periodAt, formatPeriod, groupRange, minutesOf} from '../site/bell-schedule.mjs';

test('reference schedule covers 13 ordered periods and the 4/5/4 groups',()=>{
  assert.equal(BELL_SCHEDULE.periods.length,13);
  assert.deepEqual(BELL_SCHEDULE.periods.map(period=>period.period),Array.from({length:13},(_,i)=>i+1));
  for(let i=1;i<BELL_SCHEDULE.periods.length;i++){
    const previous=BELL_SCHEDULE.periods[i-1],current=BELL_SCHEDULE.periods[i];
    assert.ok(minutesOf(current.start)>=minutesOf(previous.end));
  }
  assert.deepEqual(PERIOD_GROUPS.map(group=>group.periods.length),[4,5,4]);
  assert.equal(BELL_SCHEDULE.verified,false);
  assert.match(BELL_SCHEDULE.source,/待.*核对/);
});

test('Beijing clock and current/next period use Asia/Shanghai',()=>{
  assert.equal(beijingClock(new Date('2026-11-17T00:10:00Z')).time,'08:10');
  const first=periodAt(new Date('2026-11-17T00:10:00Z'));
  assert.equal(first.current.period,1);assert.equal(first.next.period,2);
  const between=periodAt(new Date('2026-11-17T00:50:00Z'));
  assert.equal(between.current,null);assert.equal(between.next.period,2);
  const second=periodAt(new Date('2026-11-17T01:00:00Z'));
  assert.equal(second.current.period,2);assert.equal(second.next.period,3);
  const lunch=periodAt(new Date('2026-11-17T04:00:00Z'));
  assert.equal(lunch.current,null);assert.equal(lunch.next.period,5);
  const afternoon=periodAt(new Date('2026-11-17T05:30:00Z'));
  assert.equal(afternoon.current.period,5);assert.equal(afternoon.next.period,6);
  const night=periodAt(new Date('2026-11-17T13:50:00Z'));
  assert.equal(night.current,null);assert.equal(night.next,null);
});

test('period labels and group ranges are stable',()=>{
  assert.equal(formatPeriod(BELL_SCHEDULE.periods[0]),'第 1 节 · 08:00–08:45');
  assert.equal(groupRange([1,2,3,4]),'08:00–11:40');
  assert.equal(groupRange([5,6,7,8,9]),'13:30–17:50');
  assert.equal(groupRange([10,11,12,13]),'18:30–21:45');
  assert.equal(groupRange([]),'');
});
