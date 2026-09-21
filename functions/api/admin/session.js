import {adminConfigError, adminTokenAuthorized, authenticateAdmin, createTrustedDevice, revokeTrustedDevice} from '../../_admin.js';
import {json} from '../../_analytics.js';

export async function onRequestGet({request, env}) {
  if (!env?.DB || !env?.ANALYTICS_ADMIN_TOKEN) return adminConfigError();
  const session = await authenticateAdmin(request, env);
  return session.authenticated
    ? json({authenticated: true, method: session.method, expiresAt: session.expiresAt})
    : json({authenticated: false}, 401);
}

export async function onRequestPost({request, env}) {
  if (!env?.DB || !env?.ANALYTICS_ADMIN_TOKEN) return adminConfigError();
  if (Number(request.headers.get('content-length') || 0) > 4096) return json({error: '请求体过大'}, 413);
  let payload;
  try { payload = await request.json(); } catch { return json({error: '请求体不是有效 JSON'}, 400); }
  if (!adminTokenAuthorized(payload?.token, env)) return json({error: '管理令牌无效'}, 401);
  await env.DB.prepare('DELETE FROM admin_trusted_devices WHERE expires_at <= ?').bind(new Date().toISOString()).run();
  const device = await createTrustedDevice(request, env);
  return new Response(JSON.stringify({authenticated: true, expiresAt: device.expiresAt}), {status: 201, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Set-Cookie': device.setCookie,
    'X-Content-Type-Options': 'nosniff'
  }});
}

export async function onRequestDelete({request, env}) {
  const clearCookie = await revokeTrustedDevice(request, env);
  return new Response(null, {status: 204, headers: {'Cache-Control': 'no-store', 'Set-Cookie': clearCookie}});
}
