import {json} from './_analytics.js';

const cookieName = 'roomgap_admin_device';
const trustedDeviceDays = 15;
const trustedDeviceSeconds = trustedDeviceDays * 24 * 60 * 60;
const encoder = new TextEncoder();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function digest(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function cookies(request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(Boolean).map(value => {
    const separator = value.indexOf('=');
    return separator < 1 ? ['', ''] : [value.slice(0, separator), value.slice(separator + 1)];
  }).filter(([name]) => name));
}

function deviceCredential(request) {
  const value = cookies(request)[cookieName] || '';
  const match = value.match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32,})$/i);
  return match ? {id: match[1], secret: match[2]} : null;
}

function cookie(value, maxAge = trustedDeviceSeconds) {
  return `${cookieName}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function adminConfigError() {
  return json({error: '管理认证尚未配置'}, 503);
}

export function adminTokenAuthorized(token, env) {
  const expected = typeof env?.ANALYTICS_ADMIN_TOKEN === 'string' ? env.ANALYTICS_ADMIN_TOKEN : '';
  return Boolean(expected && token && constantTimeEqual(String(token), expected));
}

export async function ensureAdminSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_trusted_devices (
    device_id TEXT PRIMARY KEY NOT NULL,
    secret_hash TEXT NOT NULL,
    user_agent_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS admin_trusted_devices_expires_at_idx ON admin_trusted_devices(expires_at)').run();
}

export async function createTrustedDevice(request, env) {
  const id = crypto.randomUUID();
  const secret = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + trustedDeviceSeconds * 1000).toISOString();
  const userAgentHash = await digest(request.headers.get('user-agent') || 'unknown');
  await env.DB.prepare(`INSERT INTO admin_trusted_devices
    (device_id, secret_hash, user_agent_hash, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, await digest(secret), userAgentHash, now.toISOString(), now.toISOString(), expiresAt).run();
  return {id, expiresAt, setCookie: cookie(`${id}.${secret}`)};
}

export async function authenticateAdmin(request, env, {touch = true} = {}) {
  const headerToken = request.headers.get('x-roomgap-admin-token') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (adminTokenAuthorized(headerToken, env)) return {authenticated: true, method: 'token', expiresAt: null};
  if (!env?.DB) return {authenticated: false};
  const credential = deviceCredential(request);
  if (!credential) return {authenticated: false};
  const row = await env.DB.prepare(`SELECT device_id, secret_hash, user_agent_hash, expires_at
    FROM admin_trusted_devices WHERE device_id = ?`).bind(credential.id).first();
  const expired = !row || Date.parse(row.expires_at) <= Date.now();
  const secretHash = row ? await digest(credential.secret) : '';
  const userAgentHash = row ? await digest(request.headers.get('user-agent') || 'unknown') : '';
  if (expired || !constantTimeEqual(secretHash, row?.secret_hash || '') || !constantTimeEqual(userAgentHash, row?.user_agent_hash || '')) {
    if (row) await env.DB.prepare('DELETE FROM admin_trusted_devices WHERE device_id = ?').bind(credential.id).run();
    return {authenticated: false};
  }
  if (touch) await env.DB.prepare('UPDATE admin_trusted_devices SET last_seen_at = ? WHERE device_id = ?').bind(new Date().toISOString(), credential.id).run();
  return {authenticated: true, method: 'trusted_device', deviceId: credential.id, expiresAt: row.expires_at};
}

export async function revokeTrustedDevice(request, env) {
  const credential = deviceCredential(request);
  if (credential && env?.DB) await env.DB.prepare('DELETE FROM admin_trusted_devices WHERE device_id = ?').bind(credential.id).run();
  return cookie('', 0);
}

export async function requireAdmin(request, env) {
  const session = await authenticateAdmin(request, env);
  return session.authenticated ? {session} : {error: json({error: '需要有效的管理授权'}, 401)};
}
