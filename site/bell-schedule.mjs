// Reference bell schedule. Keep this file as the single source of truth.
// The school's catalog does not publish clock times; when the official bell
// times are confirmed, update `periods`, set `verified: true` and `source`.
export const BELL_SCHEDULE = {
  version: 1,
  verified: false,
  source: '参考作息：45 分钟一节；待学校实际铃声核对',
  periods: [
    {period: 1, start: '08:00', end: '08:45', group: '上午'},
    {period: 2, start: '08:55', end: '09:40', group: '上午'},
    {period: 3, start: '10:00', end: '10:45', group: '上午'},
    {period: 4, start: '10:55', end: '11:40', group: '上午'},
    {period: 5, start: '13:30', end: '14:15', group: '下午'},
    {period: 6, start: '14:20', end: '15:05', group: '下午'},
    {period: 7, start: '15:25', end: '16:10', group: '下午'},
    {period: 8, start: '16:15', end: '17:00', group: '下午'},
    {period: 9, start: '17:05', end: '17:50', group: '下午'},
    {period: 10, start: '18:30', end: '19:15', group: '晚上'},
    {period: 11, start: '19:20', end: '20:05', group: '晚上'},
    {period: 12, start: '20:10', end: '20:55', group: '晚上'},
    {period: 13, start: '21:00', end: '21:45', group: '晚上'}
  ]
};

export const PERIOD_GROUPS = [
  {label: '上午', periods: [1, 2, 3, 4]},
  {label: '下午', periods: [5, 6, 7, 8, 9]},
  {label: '晚上', periods: [10, 11, 12, 13]}
];

export function minutesOf(time) {
  const [hour, minute] = String(time).split(':').map(Number);
  return hour * 60 + minute;
}

export function beijingClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find(part => part.type === 'minute')?.value || 0);
  return {hour, minute, minutes: hour * 60 + minute, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`};
}

export function periodAt(now = new Date(), schedule = BELL_SCHEDULE) {
  const clock = beijingClock(now);
  const current = schedule.periods.find(item => clock.minutes >= minutesOf(item.start) && clock.minutes < minutesOf(item.end)) || null;
  const next = schedule.periods.find(item => clock.minutes < minutesOf(item.start)) || null;
  return {clock, current, next};
}

export function formatPeriod(period) {
  return `第 ${period.period} 节 · ${period.start}–${period.end}`;
}

export function groupRange(periods, schedule = BELL_SCHEDULE) {
  const selected = schedule.periods.filter(item => periods.includes(item.period));
  return selected.length ? `${selected[0].start}–${selected[selected.length - 1].end}` : '';
}
