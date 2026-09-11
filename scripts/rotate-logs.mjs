import {createReadStream, createWriteStream} from 'node:fs';
import {lstat, rename, rm, truncate, mkdtemp} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Called under flock by the hourly job. Copy/truncate preserves open log descriptors.
export async function rotateLog(file, maxBytes = 1024 * 1024) {
  const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return false;
  if (!info.isFile()) throw Error(`Log must be a regular file, not a symlink: ${file}`);
  if (info.size < maxBytes) return false;
  const temporary = await mkdtemp(path.join(path.dirname(file), '.roomgap-log-'));
  try {
    const archive = path.join(temporary, 'archive.gz');
    await pipeline(createReadStream(file), createGzip(), createWriteStream(archive, {mode: 0o600}));
    for (let index = 3; index >= 1; index--) {
      if (index === 3) await rm(`${file}.3.gz`, {force: true});
      else await rename(`${file}.${index}.gz`, `${file}.${index + 1}.gz`).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    await rename(archive, `${file}.1.gz`);
    await truncate(file, 0);
    return true;
  } finally {
    await rm(temporary, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length < 3) throw Error('Usage: node scripts/rotate-logs.mjs /absolute/path/to/collect.log ...');
  for (const file of process.argv.slice(2)) {
    if (await rotateLog(path.resolve(file))) console.log(`ROTATED: ${file}`);
  }
}
