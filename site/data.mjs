import {createDayLoader, validateDay, candidateKinds} from './query.mjs';

async function get(url, text = false) {
  try {
    const response = await fetch(url, {cache: 'no-store'});
    if (!response.ok) throw new Error('unavailable');
    return await (text ? response.text() : response.json());
  } catch {
    throw new Error('数据暂时无法加载，请检查网络后重试');
  }
}

export async function loadCatalog() {
  const manifest = await get('./dataset.json');
  if (!/^[a-f0-9]{24}$/.test(manifest.version)) throw new Error('数据版本有误，请重新加载');
  const base = `./data/${manifest.version}/`;
  const [roomText, term, schema, coverage] = await Promise.all([
    get(`${base}rooms.json`, true), get(`${base}term.json`), get(`${base}schema.json`), get(`${base}coverage.json`)
  ]);
  if (!coverage.complete || schema.version !== 1 || schema.periods !== 13) throw new Error('数据尚未准备完整，请稍后重试');
  if (!globalThis.crypto?.subtle) throw new Error('请通过 HTTPS 或本机预览地址访问网站');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(roomText)))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== schema.catalogDigest) throw new Error('教室目录版本不一致，请重新加载');
  const rooms = JSON.parse(roomText);
  if (!Array.isArray(rooms) || rooms.length !== coverage.roomCount || new Set(rooms.map(r => r.id)).size !== rooms.length) throw new Error('教室目录不完整，请重新加载');
  for (const room of rooms) {
    if (room.campus === '泰达') room.campus = '泰达中院';
  }
  const candidates = rooms.filter(r => candidateKinds.has(r.resourceKind));
  const loader = createDayLoader(date => get(`${base}days/${date}.json`), (day, date) => validateDay(day, date, rooms, hash));
  return {rooms, candidates, term, schema, coverage, loader};
}
