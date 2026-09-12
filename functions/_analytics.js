const allowedTypes = new Set(['page_view', 'query', 'room_detail', 'theme_change']);
const maxStringLength = 120;
const maxBodyBytes = 32 * 1024;

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
  if (type === 'query') return {
    date: dateValue(source.date),
    campus: stringValue(source.campus, '全部校区'),
    building: stringValue(source.building, '全部教学楼'),
    periods: periodsValue(source.periods),
    resultCount: numericValue(source.resultCount)
  };
  if (type === 'room_detail') return {
    room: stringValue(source.room, '未知教室'),
    campus: stringValue(source.campus, '未知校区'),
    building: stringValue(source.building, '未知教学楼')
  };
  if (type === 'theme_change') return {theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : 'system'};
  return {};
}

export function normalizeEvent(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || !allowedTypes.has(input.type)) return null;
  const sessionId = stringValue(input.sessionId);
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) return null;
  const route = stringValue(input.path || '/', '/');
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date(now).toISOString(),
    type: input.type,
    sessionId,
    path: route.startsWith('/') ? route.split(/[?#]/, 1)[0] : '/',
    data: eventData(input.type, input.data)
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }});
}

export function empty(status = 204) {
  return new Response(null, {status, headers: {'Cache-Control': 'no-store'}});
}

export function configError() {
  return json({error: '观测数据库尚未配置'}, 503);
}

export function authorized(request, env) {
  const expected = typeof env?.ANALYTICS_ADMIN_TOKEN === 'string' ? env.ANALYTICS_ADMIN_TOKEN : '';
  const provided = request.headers.get('x-roomgap-admin-token') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return Boolean(expected && provided && provided === expected);
}

export async function readEventRequest(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBodyBytes) return {error: json({error: '请求体过大'}, 413)};
  let payload;
  try { payload = await request.json(); } catch { return {error: json({error: '请求体不是有效 JSON'}, 400)}; }
  const event = normalizeEvent(payload);
  return event ? {event} : {error: json({error: '无效的观测事件'}, 400)};
}

export function rangeForDays(days = 7, now = Date.now()) {
  const safeDays = Math.max(1, Math.min(90, Number.isInteger(Number(days)) ? Number(days) : 7));
  const to = new Date(now);
  const beijingOffset = 8 * 60 * 60 * 1000;
  const localMidnight = new Date(to.getTime() + beijingOffset);
  localMidnight.setUTCDate(localMidnight.getUTCDate() - safeDays + 1);
  localMidnight.setUTCHours(0, 0, 0, 0);
  const from = new Date(localMidnight.getTime() - beijingOffset);
  return {days: safeDays, from, to};
}

export function beijingDate(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(timestamp));
}

export function dayKeys(range) {
  const keys = [];
  const cursor = new Date(range.from);
  for (let index = 0; index < range.days; index += 1) {
    keys.push(beijingDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}
