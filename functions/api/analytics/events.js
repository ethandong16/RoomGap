import {configError, empty, json, readEventRequest} from '../../_analytics.js';

export async function onRequestPost({request, env}) {
  if (!env?.DB) return configError();
  const {event, error} = await readEventRequest(request);
  if (error) return error;
  const statements = [env.DB.prepare(
    'INSERT INTO analytics_events (id, created_at, event_type, session_id, path, data_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(event.id, event.timestamp, event.type, event.sessionId, event.path, JSON.stringify(event.data))];
  if (event.type === 'query') {
    for (const period of event.data.periods) statements.push(env.DB.prepare(
      'INSERT INTO analytics_query_periods (event_id, period) VALUES (?, ?)'
    ).bind(event.id, period));
  }
  try {
    await env.DB.batch(statements);
    return empty();
  } catch (error) {
    console.error('analytics event insert failed', error);
    return json({error: '观测事件保存失败'}, 500);
  }
}
