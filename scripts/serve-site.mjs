import http from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
export async function startServer({port=4173,root=fileURLToPath(new URL('../dist',import.meta.url))}={}) {
  const dist=await realpath(root);
  await stat(path.join(dist,'index.html')).catch(()=>{throw Error('请先执行 node scripts/build-site.mjs');});
  const server=http.createServer(async(req,res)=>{
    try {
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'}).end();return;}
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname.includes('\\')||pathname.includes('\0')){res.writeHead(400).end();return;}
      const target=path.resolve(dist,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
      if(!target.startsWith(dist+path.sep)){res.writeHead(404).end();return;}
      const resolved=await realpath(target);
      if(!resolved.startsWith(dist+path.sep)||!(await stat(resolved)).isFile()||!mime[path.extname(resolved)]){res.writeHead(404).end();return;}
      const content=await readFile(resolved);
      res.writeHead(200,{'Content-Type':mime[path.extname(resolved)],'Content-Length':content.length,'Cache-Control':pathname.startsWith('/data/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
      res.end(req.method==='HEAD'?undefined:content);
    } catch(error) {res.writeHead(error instanceof URIError?400:404,{'Content-Type':'text/plain; charset=utf-8'}).end('未找到文件');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.ROOMGAP_PORT||4173);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('ROOMGAP_PORT 必须是有效端口');
  const server=await startServer({port});
  console.log(`RoomGap preview: http://127.0.0.1:${server.address().port}`);
}
