import {authorized, beijingDate, configError, dayKeys, json, rangeForDays} from '../../_analytics.js';

function rows(result) { return result?.results || []; }
function ranked(result, limit = 8) {
  return rows(result).slice(0, limit).map(row => ({label: row.label || '未填写', count: Number(row.count) || 0}));
}

export async function onRequestGet({request, env}) {
  if (!env?.DB || !env?.ANALYTICS_ADMIN_TOKEN) return configError();
  if (!authorized(request, env)) return json({error: '需要有效的管理令牌'}, 401);
  const days = Number(new URL(request.url).searchParams.get('days') || 7);
  const range = rangeForDays(days);
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`SELECT
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS visits,
        SUM(CASE WHEN event_type = 'query' THEN 1 ELSE 0 END) AS queries,
        SUM(CASE WHEN event_type = 'room_detail' THEN 1 ELSE 0 END) AS details,
        COUNT(DISTINCT session_id) AS sessions
        FROM analytics_events WHERE created_at >= ? AND created_at <= ?`).bind(from, to),
      env.DB.prepare(`SELECT strftime('%Y-%m-%d', datetime(created_at, '+8 hours')) AS date,
        SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS visits,
        SUM(CASE WHEN event_type = 'query' THEN 1 ELSE 0 END) AS queries,
        SUM(CASE WHEN event_type = 'room_detail' THEN 1 ELSE 0 END) AS details,
        COUNT(DISTINCT session_id) AS sessions
        FROM analytics_events WHERE created_at >= ? AND created_at <= ? GROUP BY date ORDER BY date`).bind(from, to),
      env.DB.prepare(`SELECT json_extract(data_json, '$.campus') AS label, COUNT(*) AS count
        FROM analytics_events WHERE event_type = 'query' AND created_at >= ? AND created_at <= ? GROUP BY label ORDER BY count DESC, label LIMIT 8`).bind(from, to),
      env.DB.prepare(`SELECT json_extract(data_json, '$.building') AS label, COUNT(*) AS count
        FROM analytics_events WHERE event_type = 'query' AND created_at >= ? AND created_at <= ? GROUP BY label ORDER BY count DESC, label LIMIT 8`).bind(from, to),
      env.DB.prepare(`SELECT '第 ' || period || ' 节' AS label, COUNT(*) AS count
        FROM analytics_query_periods p JOIN analytics_events e ON e.id = p.event_id
        WHERE e.created_at >= ? AND e.created_at <= ? GROUP BY period ORDER BY count DESC, period LIMIT 13`).bind(from, to),
      env.DB.prepare(`SELECT json_extract(data_json, '$.room') AS label, COUNT(*) AS count
        FROM analytics_events WHERE event_type = 'room_detail' AND created_at >= ? AND created_at <= ? GROUP BY label ORDER BY count DESC, label LIMIT 8`).bind(from, to),
      env.DB.prepare(`SELECT id, created_at AS timestamp, event_type AS type, session_id AS sessionId, path, data_json
        FROM analytics_events WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT 30`).bind(from, to)
    ]);
    const [metricResult, dailyResult, campusResult, buildingResult, periodResult, roomResult, recentResult] = results;
    const metric = rows(metricResult)[0] || {};
    const dailyByDate = new Map(rows(dailyResult).map(row => [row.date, {
      date: row.date, visits: Number(row.visits) || 0, queries: Number(row.queries) || 0,
      details: Number(row.details) || 0, sessions: Number(row.sessions) || 0
    }]));
    const daily = dayKeys(range).map(date => dailyByDate.get(date) || {date, visits: 0, queries: 0, details: 0, sessions: 0});
    const recent = rows(recentResult).map(event => {
      let data = {};
      try { data = JSON.parse(event.data_json || '{}'); } catch {}
      return {id: event.id, timestamp: event.timestamp, type: event.type, sessionId: event.sessionId, path: event.path, data};
    });
    return json({
      generatedAt: new Date().toISOString(),
      range: {days: range.days, from, to},
      metrics: {visits: Number(metric.visits) || 0, sessions: Number(metric.sessions) || 0, queries: Number(metric.queries) || 0, details: Number(metric.details) || 0},
      daily,
      popular: {campuses: ranked(campusResult), buildings: ranked(buildingResult), periods: ranked(periodResult, 13), rooms: ranked(roomResult)},
      recent
    });
  } catch (error) {
    console.error('analytics summary query failed', error);
    return json({error: '观测数据读取失败'}, 500);
  }
}
