import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequestDelete, onRequestGet, onRequestPost} from '../functions/api/admin/session.js';
import {onRequestPost as triggerCollection} from '../functions/api/admin/collection/trigger.js';

class AdminStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() {
    if (this.sql.includes('FROM admin_trusted_devices')) return this.db.devices.get(this.values[0]) || null;
    return null;
  }
  async run() {
    if (this.sql.includes('INSERT INTO admin_trusted_devices')) {
      const [device_id, secret_hash, user_agent_hash, created_at, last_seen_at, expires_at] = this.values;
      this.db.devices.set(device_id, {device_id, secret_hash, user_agent_hash, created_at, last_seen_at, expires_at});
    } else if (this.sql.includes('DELETE FROM admin_trusted_devices WHERE device_id')) this.db.devices.delete(this.values[0]);
    else if (this.sql.includes('DELETE FROM admin_trusted_devices WHERE expires_at')) {
      for (const [id, device] of this.db.devices) if (device.expires_at <= this.values[0]) this.db.devices.delete(id);
    } else if (this.sql.includes('UPDATE admin_trusted_devices')) {
      const device = this.db.devices.get(this.values[1]);
      if (device) device.last_seen_at = this.values[0];
    }
    return {success: true};
  }
}

class AdminDB {
  constructor() { this.devices = new Map(); }
  prepare(sql) { return new AdminStatement(this, sql); }
}

const env = db => ({DB: db, ANALYTICS_ADMIN_TOKEN: 'one-time-admin-token'});
const userAgent = 'RoomGap test browser';

test('exchanges the admin token for a 15-day trusted-device cookie', async () => {
  const db = new AdminDB();
  const response = await onRequestPost({request: new Request('https://roomgap.example/api/admin/session', {
    method: 'POST', headers: {'content-type': 'application/json', 'user-agent': userAgent},
    body: JSON.stringify({token: 'one-time-admin-token'})
  }), env: env(db)});
  assert.equal(response.status, 201);
  const payload = await response.json();
  const remainingDays = (Date.parse(payload.expiresAt) - Date.now()) / 86400000;
  assert.ok(remainingDays > 14.99 && remainingDays <= 15.01);
  const setCookie = response.headers.get('set-cookie');
  assert.match(setCookie, /^roomgap_admin_device=/);
  assert.match(setCookie, /Max-Age=1296000/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.equal(db.devices.size, 1);
  const stored = [...db.devices.values()][0];
  assert.notEqual(setCookie.includes(stored.secret_hash), true);

  const cookie = setCookie.split(';', 1)[0];
  const session = await onRequestGet({request: new Request('https://roomgap.example/api/admin/session', {
    headers: {cookie, 'user-agent': userAgent}
  }), env: env(db)});
  assert.equal(session.status, 200);
  assert.equal((await session.json()).method, 'trusted_device');
});

test('rejects a trusted-device cookie when the device signature changes', async () => {
  const db = new AdminDB();
  const login = await onRequestPost({request: new Request('https://roomgap.example/api/admin/session', {
    method: 'POST', headers: {'content-type': 'application/json', 'user-agent': userAgent},
    body: JSON.stringify({token: 'one-time-admin-token'})
  }), env: env(db)});
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const response = await onRequestGet({request: new Request('https://roomgap.example/api/admin/session', {
    headers: {cookie, 'user-agent': 'Different browser'}
  }), env: env(db)});
  assert.equal(response.status, 401);
  assert.equal(db.devices.size, 0);
});

test('logout revokes the current trusted device and clears its cookie', async () => {
  const db = new AdminDB();
  const login = await onRequestPost({request: new Request('https://roomgap.example/api/admin/session', {
    method: 'POST', headers: {'content-type': 'application/json', 'user-agent': userAgent},
    body: JSON.stringify({token: 'one-time-admin-token'})
  }), env: env(db)});
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const response = await onRequestDelete({request: new Request('https://roomgap.example/api/admin/session', {headers: {cookie}}), env: env(db)});
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(db.devices.size, 0);
});

test('collection trigger stays server-side and forwards only the configured bearer token', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = {url, options};
    return new Response(JSON.stringify({accepted: true, status: 'started'}), {status: 202, headers: {'content-type': 'application/json'}});
  };
  try {
    const response = await triggerCollection({
      request: new Request('https://roomgap.example/api/admin/collection/trigger', {method: 'POST', headers: {'x-roomgap-admin-token': 'one-time-admin-token'}}),
      env: {...env(new AdminDB()), ROOMGAP_AUTH_URL: 'https://collector.example/', ROOMGAP_AUTH_TOKEN: 'collector-secret'}
    });
    assert.equal(response.status, 202);
    assert.equal(forwarded.url, 'https://collector.example/trigger');
    assert.equal(forwarded.options.headers.Authorization, 'Bearer collector-secret');
    assert.deepEqual(await response.json(), {accepted: true, status: 'started'});
  } finally { globalThis.fetch = originalFetch; }
});
