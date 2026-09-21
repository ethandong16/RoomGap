import {requireAdmin} from '../../../_admin.js';
import {json} from '../../../_analytics.js';

export async function onRequestGet({request, env}) {
  const {error} = await requireAdmin(request, env);
  if (error) return error;
  if (!env?.ROOMGAP_AUTH_URL || !env?.ROOMGAP_AUTH_TOKEN) return json({error: '采集控制尚未配置'}, 503);
  try {
    const response = await fetch(`${String(env.ROOMGAP_AUTH_URL).replace(/\/+$/, '')}/status`, {
      headers: {Authorization: `Bearer ${env.ROOMGAP_AUTH_TOKEN}`},
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(() => ({}));
    return json(payload, response.ok ? 200 : response.status);
  } catch (error) {
    console.error('collection status proxy failed', error);
    return json({error: '无法连接采集机'}, 502);
  }
}
