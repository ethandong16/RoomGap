import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAnalyticsStore, normalizeEvent} from '../scripts/analytics-store.mjs';
import {startServer} from '../scripts/serve-site.mjs';

test('analytics normalizes anonymous events and aggregates usage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'roomgap-analytics-'));
  try {
    const store = createAnalyticsStore({file: path.join(root, 'events.jsonl')});
    const first = Date.parse('2026-09-10T03:00:00.000Z');
    await store.record({type: 'page_view', sessionId: 'session-one', path: '/?secret=1', ip: '127.0.0.1', userAgent: 'test'}, first);
    await store.record({type: 'query', sessionId: 'session-one', path: '/', data: {campus: '东丽校区', building: '基础实验楼', periods: [1, 2, 2, 99], resultCount: 12}}, first + 1000);
    await store.record({type: 'room_detail', sessionId: 'session-two', data: {campus: '东丽校区', building: '基础实验楼', room: 'A101'}}, first + 2000);
    const summary = await store.summary({days: 2, now: Date.parse('2026-09-10T12:00:00.000Z')});
    assert.deepEqual(summary.metrics, {visits: 1, sessions: 2, queries: 1, details: 1});
    assert.deepEqual(summary.popular.campuses, [{label: '东丽校区', count: 1}]);
    assert.deepEqual(summary.popular.periods, [{label: '第 1 节', count: 1}, {label: '第 2 节', count: 1}]);
    assert.equal(summary.recent[0].type, 'room_detail');
    assert.equal(summary.recent[0].ip, undefined);
    assert.equal(normalizeEvent({type: 'page_view', sessionId: 'bad id'}), null);
  } finally { await rm(root, {recursive: true, force: true}); }
});
test('analytics API accepts events and protects admin data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'roomgap-server-'));
  const server = await startServer({port: 0, analyticsFile: path.join(root, 'events.jsonl'), adminToken: 'test-admin-token'});
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const event = await fetch(`${base}/api/analytics/events`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({type: 'page_view', sessionId: 'session-api', path: '/'})});
    assert.equal(event.status, 204);
    assert.equal((await fetch(`${base}/api/analytics/summary`)).status, 401);
    const summary = await fetch(`${base}/api/analytics/summary`, {headers: {'x-roomgap-admin-token': 'test-admin-token'}});
    assert.equal(summary.status, 200);
    assert.equal((await summary.json()).metrics.visits, 1);
    assert.equal((await fetch(`${base}/admin`)).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  }
});
