// The catalog exposes 13 small periods. A normal teaching class is two small
// periods (about 1 h 40 min). Period 9 is not a teaching class, but it is kept
// as a queryable gap because rooms are usually free between afternoon and
// evening classes. Times are a reference table and must be checked against the
// school bell.
export const BELL_SCHEDULE = {
  version: 4,
  verified: false,
  source: '参考作息：08:20 第一节课；第9节为非教学空档；整节约 1 小时 40 分钟（两小节）；待学校实际铃声核对',
  blocks: [
    {label: '第1–2节', periods: [1, 2], start: '08:20', end: '10:00', group: '上午'},
    {label: '第3–4节', periods: [3, 4], start: '10:20', end: '12:00', group: '上午'},
    {label: '第5–6节', periods: [5, 6], start: '13:30', end: '15:10', group: '下午'},
    {label: '第7–8节', periods: [7, 8], start: '15:25', end: '17:05', group: '下午'},
    {label: '第9节（空档）', periods: [9], start: '17:20', end: '18:05', group: '下午', kind: 'gap'},
    {label: '第10–11节', periods: [10, 11], start: '18:30', end: '20:10', group: '晚上'},
    {label: '第12–13节', periods: [12, 13], start: '20:20', end: '22:00', group: '晚上'}
  ]
};

export const VISIBLE_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

export const GAP_PERIODS = new Set([9]);

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
  const current = schedule.blocks.find(block => clock.minutes >= minutesOf(block.start) && clock.minutes < minutesOf(block.end)) || null;
  const next = schedule.blocks.find(block => clock.minutes < minutesOf(block.start)) || null;
  return {clock, current, next};
}

export function formatPeriod(block) {
  return `${block.label} · ${block.start}–${block.end}`;
}

export function groupRange(periods, schedule = BELL_SCHEDULE) {
  const blocks = schedule.blocks.filter(block => block.periods.some(period => periods.includes(period)));
  return blocks.length ? `${blocks[0].start}–${blocks[blocks.length - 1].end}` : '';
}
