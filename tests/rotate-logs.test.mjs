import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm, symlink, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {rotateLog} from '../scripts/rotate-logs.mjs';

test('rotation keeps the last three compressed logs and leaves small logs alone', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'roomgap-log-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const log = path.join(root, 'collect.log');
  assert.equal(await rotateLog(log, 10), false);
  await writeFile(log, 'short');
  assert.equal(await rotateLog(log, 10), false);
  for (let i = 1; i <= 4; i++) {
    await writeFile(log, String(i).repeat(20));
    assert.equal(await rotateLog(log, 10), true);
    assert.equal(await readFile(log, 'utf8'), '');
  }
  for (let i = 1; i <= 3; i++) {
    assert.equal(gunzipSync(await readFile(`${log}.${i}.gz`)).toString(), String(5 - i).repeat(20));
  }
  assert.deepEqual((await readdir(root)).sort(), ['collect.log', 'collect.log.1.gz', 'collect.log.2.gz', 'collect.log.3.gz']);
});

test('rotation refuses a symlink instead of truncating its target', {skip: process.platform === 'win32'}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'roomgap-log-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const target = path.join(root, 'keep.txt'), link = path.join(root, 'collect.log');
  await writeFile(target, 'keep this data');
  await symlink(target, link);
  await assert.rejects(rotateLog(link, 1), /regular file/);
  assert.equal(await readFile(target, 'utf8'), 'keep this data');
});
