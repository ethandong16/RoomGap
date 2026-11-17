import {freeIntervals, FULL_DAY_MASK} from './semester-model.mjs';

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

// Display helpers. The school catalog has no floor field, so floor is derived from
// the room number only when the name follows the common 3-digit convention.
export function buildingLabel(roomOrName) {
  const raw = typeof roomOrName === 'string' ? roomOrName : (roomOrName?.building || roomOrName?.buildingCode || '');
  const text = String(raw).trim();
  const numbered = text.match(/^(\d+)-$/);
  if (numbered) return `${numbered[1]}号楼`;
  if (/^[A-Z]$/i.test(text)) return `${text.toUpperCase()}楼`;
  return text;
}

const FLOOR_UNKNOWN_BUILDINGS = new Set(['9-', '阶梯']);

export function floorOf(room) {
  const building = String(room?.building || '');
  if (FLOOR_UNKNOWN_BUILDINGS.has(building)) return null;
  const name = normalizeText(room?.name);
  // 1008-style four-digit names are ambiguous (1F-008 vs 10F-08); keep them unknown.
  if (/^\d{4,}/.test(name)) return null;
  const match = name.match(/^(\d)\d{2}/);
  if (!match) return null;
  const floor = Number(match[1]);
  return floor >= 1 && floor <= 9 ? floor : null;
}

export function floorLabel(floor) { return floor == null ? '未标注' : `${floor}F`; }

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\(\s*d\s*\)/gi, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

const CJK_DIGITS = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};

function chineseNumber(text) {
  if (!text) return null;
  if (text === '十') return 10;
  if (text.startsWith('十')) return 10 + (CJK_DIGITS[text[1]] || 0);
  if (text.includes('十')) {
    const [tens, ones] = text.split('十');
    return (CJK_DIGITS[tens] || 0) * 10 + (CJK_DIGITS[ones] || 0);
  }
  return CJK_DIGITS[text] ?? null;
}

export function parseFloorQuery(value) {
  const text = normalizeText(value);
  const arabic = text.match(/^(\d{1,2})(?:楼|f|层)$/);
  if (arabic) return Number(arabic[1]);
  const cjk = text.match(/^([一二三四五六七八九十]+)(?:楼|层)$/);
  return cjk ? chineseNumber(cjk[1]) : null;
}

// Exact room numbers rank above prefix matches, building aliases and types.
export function searchScore(room, value) {
  const needle = normalizeText(value);
  if (!needle) return 0;
  const floorQuery = parseFloorQuery(needle);
  if (floorQuery != null) return floorOf(room) === floorQuery ? 0 : -1;
  const name = normalizeText(room.name);
  const building = normalizeText(buildingLabel(room));
  const rawBuilding = normalizeText(room.building || room.buildingCode);
  const type = normalizeText(room.type || '');
  const floor = normalizeText(floorLabel(floorOf(room)));
  const campus = normalizeText(room.campus || '');
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  if (name.includes(needle)) return 2;
  if (building.includes(needle) || rawBuilding.includes(needle)) return 3;
  if (floor.includes(needle)) return 4;
  if (type.includes(needle)) return 5;
  if (campus.includes(needle)) return 6;
  return -1;
}

export function formatInterval([start, end]) {
  return start === end ? `第 ${start} 节` : `第 ${start}–${end} 节`;
}

export function formatIntervals(intervals) {
  return intervals.length ? intervals.map(formatInterval).join('、') : '今天没有整段空闲';
}

export function longestFreeInterval(state) {
  return (state.freeIntervals || freeIntervals(state.freeMask)).reduce((best, [start, end]) => {
    const length = end - start + 1;
    return length > best.length ? {start, end, length} : best;
  }, {start: 0, end: 0, length: 0});
}

// Room-first browsing: unlike selectRooms, occupancy is a display state, not a filter.
export function browseRooms(rooms, day, filters = {}) {
  if (!day?.rooms) return [];
  const {campus = '', building = '', search = '', minCapacity = 0, type = '', floor = '', freeOnly = false} = filters;
  const floorFilter = floor === '' ? null : floor === 'unknown' ? null : Number(floor);
  const hasFloor = floor !== '';
  const needle = String(search || '').trim();
  return day.rooms.flatMap(state => {
    const room = rooms[state.room];
    if (!room || room.candidateEligible === false || !candidateKinds.has(room.resourceKind)) return [];
    if (campus && room.campusCode !== campus) return [];
    if (building && buildingKey(room) !== building) return [];
    if (hasFloor) {
      const roomFloor = floorOf(room);
      if (floor === 'unknown' ? roomFloor !== null : roomFloor !== floorFilter) return [];
    }
    if (type && (type === '__none__' ? Boolean(room.type) : (room.type || '') !== type)) return [];
    if (minCapacity > 0 && !(Number.isFinite(room.capacity) && room.capacity >= minCapacity)) return [];
    const score = searchScore(room, needle);
    if (score < 0) return [];
    if (freeOnly && !state.freeMask) return [];
    const intervals = state.freeIntervals || freeIntervals(state.freeMask);
    const longest = longestFreeInterval({...state, freeIntervals: intervals});
    return [{room, state, freeIntervals: intervals, longest, searchScore: score}];
  }).sort((a, b) => {
    if (needle && a.searchScore !== b.searchScore) return a.searchScore - b.searchScore;
    return collator.compare(a.room.campus, b.room.campus)
      || collator.compare(buildingLabel(a.room), buildingLabel(b.room))
      || (floorOf(a.room) ?? 99) - (floorOf(b.room) ?? 99)
      || collator.compare(a.room.name, b.room.name)
      || collator.compare(a.room.id, b.room.id);
  });
}

export function periodCounts(rooms, day, filters = {}) {
  const counts = Array(13).fill(0);
  for (const {state} of browseRooms(rooms, day, filters)) {
    for (let i = 0; i < 13; i++) {
      const bit = 1 << i;
      if ((state.freeMask & bit) && !(state.unknownMask & bit)) counts[i]++;
    }
  }
  return counts;
}

export function overviewByBuilding(rooms, day, filters = {}) {
  const groups = new Map();
  for (const entry of browseRooms(rooms, day, {...filters, building: ''})) {
    const key = buildingKey(entry.room);
    if (!groups.has(key)) groups.set(key, {
      key, campus: entry.room.campus, label: buildingLabel(entry.room),
      roomCount: 0, freeCount: 0, continuousCount: 0, floors: new Set(), examples: []
    });
    const group = groups.get(key);
    group.roomCount++;
    if (entry.state.freeMask) group.freeCount++;
    if (entry.longest.length >= 2) group.continuousCount++;
    group.floors.add(floorOf(entry.room));
    if (group.examples.length < 3) group.examples.push(entry.room.name);
  }
  return [...groups.values()].map(group => ({
    ...group,
    floors: [...group.floors].filter(value => value != null).sort((a, b) => a - b),
    hasUnknownFloor: group.floors.has(null)
  })).sort((a, b) => collator.compare(a.campus, b.campus) || collator.compare(a.label, b.label));
}

export function weekDates(date) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  const monday = new Date(value.getTime() + (day === 0 ? -6 : 1 - day) * 86400000);
  return Array.from({length: 7}, (_, index) => new Date(monday.getTime() + index * 86400000).toISOString().slice(0, 10));
}

export function selectRooms(rooms, day, filters) {
  const {campus = '', building = '', search = '', minCapacity = 0, type = '', floor = '', start = 1, end = 2} = filters;
  let periods=filters.periods;
  if(periods===undefined){
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||start>13||start>end)throw new Error('请选择有效的起止节次');
    periods=Array.from({length:end-start+1},(_,index)=>start+index);
  }
  if (!Array.isArray(periods) || periods.some(period => !Number.isInteger(period) || period < 1 || period > 13) || new Set(periods).size !== periods.length) throw new Error('请选择有效的节次');
  if (!periods.length) return [];
  const required = periods.reduce((mask, period) => mask | (1 << (period - 1)), 0);
  const floorFilter = floor === '' ? null : floor === 'unknown' ? null : Number(floor);
  const hasFloor = floor !== '';
  return day.rooms.flatMap(state => {
    const room = rooms[state.room];
    if (!room || room.candidateEligible === false || !candidateKinds.has(room.resourceKind) || (campus && room.campusCode !== campus) || (building && buildingKey(room) !== building)) return [];
    if (hasFloor) {
      const roomFloor = floorOf(room);
      if (floor === 'unknown' ? roomFloor !== null : roomFloor !== floorFilter) return [];
    }
    if (type && (type === '__none__' ? Boolean(room.type) : (room.type || '') !== type)) return [];
    if (minCapacity > 0 && !(Number.isFinite(room.capacity) && room.capacity >= minCapacity)) return [];
    if (searchScore(room, search) < 0) return [];
    // Never let occupied or unknown periods enter an available result, even in malformed input.
    if ((state.freeMask & required) !== required || ((state.unknownMask | state.occupiedMask) & required)) return [];
    const relevantIntervals = freeIntervals(state.freeMask).filter(([a, b]) => periods.some(period => period >= a && period <= b));
    const continuousLength = Math.max(...relevantIntervals.map(([a, b]) => b - a + 1));
    const relevantFreeLength = relevantIntervals.reduce((total, [a, b]) => total + b - a + 1, 0);
    return [{room, state, continuousLength, relevantFreeLength, freeIntervals: state.freeIntervals || freeIntervals(state.freeMask)}];
  }).sort((a, b) => b.continuousLength - a.continuousLength || b.relevantFreeLength - a.relevantFreeLength || compareRooms(a.room, b.room));
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
  const pending = new Map();
  let generation = 0;
  async function load(date) {
    if (cache.has(date)) return cache.get(date);
    if (pending.has(date)) return pending.get(date);
    const request = fetchDay(date)
      .then(day => { const validated = validate(day, date); cache.set(date, validated); return validated; })
      .finally(() => pending.delete(date));
    pending.set(date, request);
    return request;
  }
  return {
    async select(date) {
      const current = ++generation;
      try {
        const day = await load(date);
        return current === generation ? {day} : {stale: true};
      } catch (error) {
        if (current !== generation) return {stale: true};
        throw error;
      }
    },
    // Room-first views need several days at once; these must not race the generation guard.
    load,
    has: date => cache.has(date)
  };
}
