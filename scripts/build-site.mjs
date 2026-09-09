import {readFile, writeFile, mkdir, cp, rm, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
await import('../verify-dataset.mjs');
const source=path.join(root,'data','dataset');
const days=(await readdir(path.join(source,'days'))).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const files=['rooms.json','term.json','schema.json','coverage.json',...days.map(f=>`days/${f}`)];
const entries=await Promise.all(files.map(async name=>[name,await readFile(path.join(source,name))]));
const hash=createHash('sha256');
for(const [name,content] of entries)hash.update(name).update('\0').update(content).update('\0');
const version=hash.digest('hex').slice(0,24);
const dist=path.resolve(root,'dist');
// Only this fixed generated folder may be replaced, never a caller-supplied directory.
if(path.dirname(dist)!==path.resolve(root)||path.basename(dist)!=='dist')throw Error('Unsafe build target');
console.log(`Building verified website in ${dist}`);
await rm(dist,{recursive:true,force:true});
await mkdir(path.join(dist,'data',version,'days'),{recursive:true});
const assets=['index.html','app.mjs','data.mjs','query.mjs','styles.css','icons.svg','favicon.svg'];
for(const file of assets)await cp(path.join(root,'site',file),path.join(dist,file));
await cp(path.join(root,'semester-model.mjs'),path.join(dist,'semester-model.mjs'));
for(const [name,content]of entries)await writeFile(path.join(dist,'data',version,name),content);
await writeFile(path.join(dist,'dataset.json'),JSON.stringify({version})+'\n');
await writeFile(path.join(dist,'_headers'),`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: same-origin\n/\n  Cache-Control: no-cache\n/index.html\n  Cache-Control: no-cache\n/dataset.json\n  Cache-Control: no-cache\n/app.mjs\n  Cache-Control: no-cache\n/data.mjs\n  Cache-Control: no-cache\n/query.mjs\n  Cache-Control: no-cache\n/semester-model.mjs\n  Cache-Control: no-cache\n/styles.css\n  Cache-Control: no-cache\n/icons.svg\n  Cache-Control: no-cache\n/favicon.svg\n  Cache-Control: no-cache\n/data/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
console.log(JSON.stringify({built:true,version,dates:days.length,output:dist}));
