import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvent, rangeForDays} from '../functions/_analytics.js';
import {onRequestPost} from '../functions/api/analytics/events.js';
import {onRequestGet} from '../functions/api/analytics/summary.js';

class FakeStatement {
  constructor(sql) { this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
}

class FakeDB {
  constructor(results = []) { this.results = results; this.prepared = []; this.batches = []; }
  prepare(sql) { const statement = new FakeStatement(sql); this.prepared.push(statement); return statement; }
  async batch(statements) { this.batches.push(statements); return this.results; }
}

function request(body, options = {}) {
  return new Request('https://roomgap.example/api/analytics/events', {
    method: 'POST',
    headers: {'content-type': 'application/json', ...(options.headers || {})},
    body: JSON.stringify(body)
  });
}

test('normalizes anonymous events and discards identifying or unsupported fields', () => {
  const event = normalizeEvent({
    type: 'query',
    sessionId: 'session-valid',
    path: '/?secret=1',
    ip: '127.0.0.1',
    userAgent: 'test',
    data: {date: '2026-09-10', campus: ' 东丽校区 ', periods: [3, 1, 2, 2, 99], resultCount: '12', email: 'private@example.com'}
  }, Date.parse('2026-09-10T03:00:00.000Z'));
  assert.equal(event.timestamp, '2026-09-10T03:00:00.000Z');
  assert.equal(event.path, '/');
  assert.deepEqual(event.data, {date: '2026-09-10', campus: '东丽校区', building: '全部教学楼', periods: [1, 2, 3], resultCount: 12});
  assert.equal(event.ip, undefined);
  assert.equal(event.userAgent, undefined);
  assert.equal(normalizeEvent({type: 'unsupported', sessionId: 'session-valid'}), null);
  assert.equal(normalizeEvent({type: 'page_view', sessionId: 'bad id'}), null);
});

test('uses Beijing midnight for analytics day ranges', () => {
  const range = rangeForDays(2, Date.parse('2026-09-10T12:00:00.000Z'));
  assert.equal(range.days, 2);
  assert.equal(range.from.toISOString(), '2026-09-08T16:00:00.000Z');
  assert.equal(range.to.toISOString(), '2026-09-10T12:00:00.000Z');
});

test('rejects invalid event requests before touching D1', async () => {
  const db = new FakeDB();
  const response = await onRequestPost({request: request({type: 'query', sessionId: 'bad id'}), env: {DB: db}});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {error: '无效的观测事件'});
  assert.equal(db.batches.length, 0);
});

test('writes a query event and its selected periods in one D1 batch', async () => {
  const db = new FakeDB();
  const response = await onRequestPost({request: request({
    type: 'query', sessionId: 'session-api', path: '/',
    data: {campus: '东丽校区', building: '基础实验楼', periods: [1, 2], resultCount: 12}
  }), env: {DB: db}});
  assert.equal(response.status, 204);
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 3);
  assert.match(db.batches[0][0].sql, /INSERT INTO analytics_events/);
  assert.deepEqual(db.batches[0][1].values.slice(1), [1]);
  assert.deepEqual(db.batches[0][2].values.slice(1), [2]);
});

test('protects the summary with the Cloudflare secret', async () => {
  const db = new FakeDB();
  const response = await onRequestGet({
    request: new Request('https://roomgap.example/api/analytics/summary'),
    env: {DB: db, ANALYTICS_ADMIN_TOKEN: 'secret-token'}
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {error: '需要有效的管理令牌'});
  assert.equal(db.batches.length, 0);
});

test('returns the expected D1-backed summary shape for an authorized request', async () => {
  const db = new FakeDB([
    {results: [{visits: 3, sessions: 2, queries: 4, details: 1}]},
    {results: [{date: '2026-09-10', visits: 3, queries: 4, details: 1, sessions: 2}]},
    {results: [{label: '东丽校区', count: 4}]},
    {results: [{label: '基础实验楼', count: 3}]},
    {results: [{label: '第 1 节', count: 4}]},
    {results: [{label: 'A101', count: 2}]},
    {results: [{id: 'event-1', timestamp: '2026-09-10T03:00:00.000Z', type: 'room_detail', sessionId: 'session-api', path: '/', data_json: '{"room":"A101"}'}]}
  ]);
  const response = await onRequestGet({
    request: new Request('https://roomgap.example/api/analytics/summary?days=2', {headers: {'x-roomgap-admin-token': 'secret-token'}}),
    env: {DB: db, ANALYTICS_ADMIN_TOKEN: 'secret-token'}
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.metrics, {visits: 3, sessions: 2, queries: 4, details: 1});
  assert.equal(payload.range.days, 2);
  assert.equal(payload.daily.length, 2);
  assert.deepEqual(payload.popular.campuses, [{label: '东丽校区', count: 4}]);
  assert.deepEqual(payload.popular.periods, [{label: '第 1 节', count: 4}]);
  assert.deepEqual(payload.recent[0].data, {room: 'A101'});
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 7);
});
