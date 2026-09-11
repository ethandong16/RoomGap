import {appendFile, mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const allowedTypes = new Set(['page_view', 'query', 'room_detail', 'theme_change']);
const maxStringLength = 120;

function stringValue(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxStringLength);
}

function dateValue(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function periodsValue(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(period => Number.isInteger(period) && period >= 1 && period <= 13))]
    .sort((a, b) => a - b).slice(0, 13);
}

function numericValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(99999, Math.round(number))) : fallback;
}

function eventData(type, input) {
  const source = input && typeof input === 'object' ? input : {};
  if (type === 'query') {
    return {
      date: dateValue(source.date),
      campus: stringValue(source.campus, '全部校区'),
      building: stringValue(source.building, '全部教学楼'),
      periods: periodsValue(source.periods),
      resultCount: numericValue(source.resultCount)
    };
  }
  if (type === 'room_detail') {
    return {
      room: stringValue(source.room, '未知教室'),
      campus: stringValue(source.campus, '未知校区'),
      building: stringValue(source.building, '未知教学楼')
    };
  }
  if (type === 'theme_change') return {theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : 'system'};
  return {};
}

function eventDate(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(timestamp));
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function dayRange(days, now) {
  const safeDays = Math.max(1, Math.min(90, Number.isInteger(Number(days)) ? Number(days) : 7));
  const end = new Date(now);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - safeDays + 1);
  start.setUTCHours(0, 0, 0, 0);
  return {days: safeDays, from: start, to: end};
}

export function normalizeEvent(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || !allowedTypes.has(input.type)) return null;
  const sessionId = stringValue(input.sessionId);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) return null;
  const route = stringValue(input.path || '/', '/');
  return {
    id: randomUUID(),
    timestamp: new Date(now).toISOString(),
    type: input.type,
    sessionId,
    path: route.startsWith('/') ? route.split(/[?#]/, 1)[0] : '/',
    data: eventData(input.type, input.data)
  };
}

function increment(map, key, amount = 1) {
  const safeKey = key || '未填写';
  map.set(safeKey, (map.get(safeKey) || 0) + amount);
}

function ranked(map, limit = 8) {
  return [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit).map(([label, count]) => ({label, count}));
}

export function createAnalyticsStore({file = path.resolve('data', 'analytics', 'events.jsonl')} = {}) {
  async function ensureFile() {
    await mkdir(path.dirname(file), {recursive: true});
  }

  async function readEvents() {
    try {
      const text = await readFile(file, 'utf8');
      return text.split(/\r?\n/).filter(Boolean).flatMap(line => {
        try {
          const value = JSON.parse(line);
          return value && typeof value === 'object' && value.timestamp ? [value] : [];
        } catch {
          return [];
        }
      });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  return {
    file,
    async record(input, now = Date.now()) {
      const event = normalizeEvent(input, now);
      if (!event) return null;
      await ensureFile();
      await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
      return event;
    },
    async summary({days = 7, now = Date.now()} = {}) {
      const range = dayRange(days, now);
      const all = await readEvents();
      const fromMs = range.from.getTime();
      const toMs = range.to.getTime();
      const events = all.filter(event => {
        const timestamp = Date.parse(event.timestamp);
        return Number.isFinite(timestamp) && timestamp >= fromMs && timestamp <= toMs;
      });
      const sessions = new Set(events.map(event => event.sessionId).filter(Boolean));
      const dailyMap = new Map();
      const cursor = new Date(range.from);
      for (let index = 0; index < range.days; index += 1) {
        dailyMap.set(toDateKey(cursor), {date: toDateKey(cursor), visits: 0, queries: 0, details: 0, sessions: new Set()});
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const campuses = new Map();
      const buildings = new Map();
      const periods = new Map();
      const rooms = new Map();
      let visits = 0;
      let queries = 0;
      let details = 0;
      for (const event of events) {
        const day = dailyMap.get(eventDate(event.timestamp));
        if (day) day.sessions.add(event.sessionId);
        if (event.type === 'page_view') { visits += 1; if (day) day.visits += 1; }
        if (event.type === 'query') {
          queries += 1;
          if (day) day.queries += 1;
          increment(campuses, event.data?.campus);
          increment(buildings, event.data?.building);
          for (const period of event.data?.periods || []) increment(periods, `第 ${period} 节`);
        }
        if (event.type === 'room_detail') {
          details += 1;
          if (day) day.details += 1;
          increment(rooms, event.data?.room);
        }
      }
      const lastEvents = events.slice().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 30);
      return {
        generatedAt: new Date(now).toISOString(),
        range: {days: range.days, from: range.from.toISOString(), to: range.to.toISOString()},
        metrics: {visits, sessions: sessions.size, queries, details},
        daily: [...dailyMap.values()].map(day => ({date: day.date, visits: day.visits, queries: day.queries, details: day.details, sessions: day.sessions.size})),
        popular: {campuses: ranked(campuses), buildings: ranked(buildings), periods: ranked(periods, 13), rooms: ranked(rooms)},
        recent: lastEvents
      };
    },
    async events({days = 7, limit = 100, now = Date.now()} = {}) {
      const summary = await this.summary({days, now});
      return summary.recent.slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
    }
  };
}
