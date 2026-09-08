import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../scripts/serve-site.mjs';
test('standalone dist serves modules and data, never project or browser files',async t=>{
  const server=await startServer({port:0});t.after(()=>server.close());
  assert.equal(server.address().address,'0.0.0.0');
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/RoomGap/);
  const module=await fetch(`${base}/app.mjs`);assert.match(module.headers.get('content-type'),/javascript/);
  const {version}=await (await fetch(`${base}/dataset.json`)).json();
  const rooms=await fetch(`${base}/data/${version}/rooms.json`);assert.equal((await rooms.json()).length,623);
  for(const resource of ['/package.json','/.roomgap-browser/Default/Cookies','/collect-api.mjs','/data/semester/manifest.json','/%2e%2e%5cpackage.json','/..%2fpackage.json'])assert.notEqual((await fetch(base+resource)).status,200);
  assert.equal((await fetch(base,{method:'POST'})).status,405);
});
