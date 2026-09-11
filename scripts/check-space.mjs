import {statfsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const MiB = 1024 * 1024;
export function checkSpace(directory, minimumMiB = 128, statfs = statfsSync) {
  const minimum = Number(minimumMiB);
  if (!Number.isSafeInteger(minimum) || minimum < 1 || !Number.isSafeInteger(minimum * MiB)) {
    throw Error('ROOMGAP_MIN_FREE_MB must be a positive whole number of MiB');
  }
  const {bavail, bsize} = statfs(directory);
  const available = bavail * bsize;
  if (!Number.isFinite(available) || available < 0) throw Error('Cannot determine available disk space');
  const summary = `available=${Math.floor(available / MiB)} MiB, required=${minimum} MiB`;
  if (available < minimum * MiB) throw Error(`DISK_LOW: ${summary}; free space before retrying`);
  return `DISK_OK: ${summary}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(checkSpace(process.cwd(), process.env.ROOMGAP_MIN_FREE_MB ?? 128));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
