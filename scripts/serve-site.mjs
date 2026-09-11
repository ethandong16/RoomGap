import http from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {createAnalyticsStore} from './analytics-store.mjs';

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const maxBodyBytes=32*1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body='';
    let size=0;
    let tooLarge=false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBodyBytes) { tooLarge=true; return; }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) { reject(Object.assign(new Error('请求体过大'), {statusCode:413})); return; }
      try { resolve(JSON.parse(body || '{}')); } catch { reject(Object.assign(new Error('请求体不是有效 JSON'), {statusCode:400})); }
    });
    req.on('error', reject);
  });
}

function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const actual=Buffer.from(provided);
  const target=Buffer.from(expected);
  return actual.length===target.length && timingSafeEqual(actual,target);
}

export async function startServer({port=4173,root=fileURLToPath(new URL('../dist',import.meta.url)),analyticsFile,adminToken}={}) {
  const dist=await realpath(root);
  await stat(path.join(dist,'index.html')).catch(()=>{throw Error('请先执行 node scripts/build-site.mjs');});
  const analytics=createAnalyticsStore({file:analyticsFile});
  const resolvedAdminToken=adminToken || process.env.ROOMGAP_ADMIN_TOKEN || randomBytes(18).toString('hex');
  const server=http.createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname.includes('\\')||pathname.includes('\0')){res.writeHead(400).end();return;}
      if(req.method==='POST' && pathname==='/api/analytics/events') {
        const payload=await readJsonBody(req);
        const event=await analytics.record(payload);
        if(!event){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify({error:'无效的观测事件'}));return;}
        res.writeHead(204,{'Cache-Control':'no-store'}).end();
        return;
      }
      if(req.method==='GET' && (pathname==='/api/analytics/summary' || pathname==='/api/analytics/events')) {
        const provided=req.headers['x-roomgap-admin-token'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
        if(!tokenMatches(String(provided),resolvedAdminToken)){res.writeHead(401,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify({error:'需要有效的管理令牌'}));return;}
        const query=new URL(req.url,'http://localhost').searchParams;
        const days=Math.max(1,Math.min(90,Number(query.get('days') || 7) || 7));
        const payload=pathname.endsWith('/events') ? await analytics.events({days,limit:Number(query.get('limit') || 100)}) : await analytics.summary({days});
        const content=Buffer.from(JSON.stringify(payload));
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(content);
        return;
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD, POST'}).end();return;}
      const staticPath=pathname==='/admin'?'/admin.html':pathname;
      const target=path.resolve(dist,'.'+staticPath+(staticPath.endsWith('/')?'index.html':''));
      if(!target.startsWith(dist+path.sep)){res.writeHead(404).end();return;}
      const resolved=await realpath(target);
      if(!resolved.startsWith(dist+path.sep)||!(await stat(resolved)).isFile()||!mime[path.extname(resolved)]){res.writeHead(404).end();return;}
      const content=await readFile(resolved);
      res.writeHead(200,{'Content-Type':mime[path.extname(resolved)],'Content-Length':content.length,'Cache-Control':pathname.startsWith('/data/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
      res.end(req.method==='HEAD'?undefined:content);
    } catch(error) {
      const status=error.statusCode || (error instanceof URIError ? 400 : 404);
      const message=status===400||status===413 ? error.message : '未找到文件';
      if(!res.headersSent)res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'}).end(message);
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve);});
  server.analytics=analytics;
  server.analyticsAdminToken=resolvedAdminToken;
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.ROOMGAP_PORT||4173);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('ROOMGAP_PORT 必须是有效端口');
  const server=await startServer({port});
  console.log(`RoomGap preview listening on http://0.0.0.0:${server.address().port}`);
  console.log(`管理后台：http://127.0.0.1:${server.address().port}/admin.html`);
  console.log(`管理令牌：${server.analyticsAdminToken}`);
}
