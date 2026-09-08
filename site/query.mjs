import {intervalMask, freeIntervals, FULL_DAY_MASK} from './semester-model.mjs';

export const candidateKinds = new Set(['classroom', 'unspecified']);
const collator = new Intl.Collator('zh-CN', {numeric: true});

export function beijingDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
}

export function moveDate(date, offset) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
}

export function dateInTerm(date, term) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= term.startDate && date <= term.endDate && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && moveDate(date, 0) === date;
}

export function initialDate(term, now = new Date()) {
  const today = beijingDate(now);
  return {date: dateInTerm(today, term) ? today : term.startDate, outsideTerm: !dateInTerm(today, term)};
}

export function teachingWeek(date, term) {
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${term.startDate}T00:00:00Z`)) / (7 * 86400000)) + 1;
}

export function buildingKey(room) { return `${room.campusCode}/${room.buildingCode}`; }
export function roomTitle(room) { return `${room.campus} · ${room.building || room.buildingCode} · ${room.name}`; }
export function compareRooms(a, b) {
  return collator.compare(a.campus, b.campus) || collator.compare(a.building || a.buildingCode, b.building || b.buildingCode) || collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
}

export function selectRooms(rooms, day, filters) {
  const {campus = '', building = '', search = '', minCapacity = 0, start = 1, end = 2} = filters;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 13 || start > end) throw new Error('请选择有效的起止节次');
  const required = intervalMask(start, end);
  const needle = search.trim().toLocaleLowerCase();
  return day.rooms.flatMap(state => {
    const room = rooms[state.room];
    if (!room || !candidateKinds.has(room.resourceKind) || (campus && room.campusCode !== campus) || (building && buildingKey(room) !== building)) return [];
    if (minCapacity > 0 && !(Number.isFinite(room.capacity) && room.capacity >= minCapacity)) return [];
    if (needle && !roomTitle(room).toLocaleLowerCase().includes(needle)) return [];
    // Never let occupied or unknown periods enter an available result, even in malformed input.
    if ((state.freeMask & required) !== required || ((state.unknownMask | state.occupiedMask) & required)) return [];
    const interval = freeIntervals(state.freeMask).find(([a, b]) => a <= start && b >= end);
    return [{room, state, interval, continuousLength: interval[1] - interval[0] + 1}];
  }).sort((a, b) => b.continuousLength - a.continuousLength || compareRooms(a.room, b.room));
}

export function validateDay(day, date, rooms, digest) {
  if (day.date !== date || day.catalogDigest !== digest) throw new Error('数据版本不一致，请重新加载');
  if (!Array.isArray(day.rooms) || day.rooms.length !== rooms.length) throw new Error('当日教室数据不完整，请重试');
  const seen = new Set();
  for (const state of day.rooms) {
    if (!Number.isInteger(state.room) || state.room < 0 || state.room >= rooms.length || seen.has(state.room)) throw new Error('当日教室目录有误，请重试');
    seen.add(state.room);
    for (const mask of [state.freeMask, state.occupiedMask, state.unknownMask]) {
      if (!Number.isInteger(mask) || mask < 0 || mask > FULL_DAY_MASK) throw new Error('当日节次数据有误，请重试');
    }
    if ((state.freeMask & (state.occupiedMask | state.unknownMask)) || (state.freeMask | state.occupiedMask | state.unknownMask) !== FULL_DAY_MASK) throw new Error('当日节次数据有误，请重试');
    const expected = freeIntervals(state.freeMask);
    if (JSON.stringify(state.freeIntervals) !== JSON.stringify(expected)) throw new Error('当日空闲区间有误，请重试');
  }
  return day;
}

// Each selection gets a generation; a slow earlier response cannot replace the current date.
export function createDayLoader(fetchDay, validate) {
  const cache = new Map();
  let generation = 0;
  return {
    async select(date) {
      const current = ++generation;
      try {
        let day = cache.get(date);
        if (!day) { day = validate(await fetchDay(date), date); cache.set(date, day); }
        return current === generation ? {day} : {stale: true};
      } catch (error) {
        if (current !== generation) return {stale: true};
        throw error;
      }
    }
  };
}
