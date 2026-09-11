import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, copyFile, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';

const options = {skip: process.platform !== 'linux', timeout: 30000};
const execute = promisify(execFile);
async function fixture(t, {missingModel = false, failBuild = false, hold = false, bark = false} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'roomgap-runner-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await copyFile(new URL('../run-collect.sh', import.meta.url), path.join(root, 'run-collect.sh'));
  await writeFile(path.join(root, 'config.env'), bark ? "ROOMGAP_BARK_URL='https://example.invalid/device'\n" : '');
  await writeFile(path.join(root, 'playwright.mjs'), 'export {};\n');
  if (!missingModel) await writeFile(path.join(root, 'semester-model.mjs'), 'export {};\n');
  for (const [file, stage] of [['collect-api.mjs', 'collect'], ['build-dataset.mjs', 'build'], ['verify-dataset.mjs', 'verify']]) {
    await writeFile(path.join(root, file), `import {appendFile, writeFile} from 'node:fs/promises';
await appendFile('stages.log', '${stage}\\n');
${stage === 'build' ? "if(process.env.ROOMGAP_GIT_PUSH==='1')await writeFile('data/dataset/rooms.json','[1]\\n');" : ''}
${stage === 'collect' && hold ? 'await new Promise(resolve => setTimeout(resolve, 2500));' : ''}
${stage === 'build' && failBuild ? 'process.exit(7);' : ''}\n`);
  }
  // Notifications stay inside the fixture; this test never calls Bark or the school.
  await mkdir(path.join(root, 'bin'));
  await writeFile(path.join(root, 'bin', 'curl'), '#!/bin/sh\nprintf "%s\\n" "$@" >> bark.log\nexit 22\n', {mode: 0o755});
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ROOMGAP_')));
  Object.assign(env, {
    ROOMGAP_CONFIG: path.join(root, 'config.env'),
    ROOMGAP_PLAYWRIGHT_MODULE: path.join(root, 'playwright.mjs'),
    PATH: `${path.join(root, 'bin')}:${env.PATH}`,
  });
  const run = () => new Promise((resolve, reject) => {
    const child = spawn('bash', ['run-collect.sh'], {cwd: root, env});
    let output = '';
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({code, output}));
  });
  return {root, env, run, stages: () => readFile(path.join(root, 'stages.log'), 'utf8')};
}

async function publicationFixture(t) {
  const f = await fixture(t);
  const remote = path.join(f.root, 'remote.git');
  const git = async (...args) => (await execute('git', args, {cwd: f.root})).stdout.trim();
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'RoomGap Test');
  await git('config', 'user.email', 'test@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('init', '--bare', remote);
  await mkdir(path.join(f.root, 'data/semester'), {recursive: true});
  await mkdir(path.join(f.root, 'data/dataset'), {recursive: true});
  await writeFile(path.join(f.root, 'data/semester/manifest.json'), '{}\n');
  await writeFile(path.join(f.root, 'data/dataset/rooms.json'), '[]\n');
  await git('add', 'data');
  await git('commit', '-m', 'Initial data');
  await git('remote', 'add', 'origin', remote);
  await git('push', 'origin', 'main');
  f.env.ROOMGAP_GIT_PUSH = '1';
  return {...f, git, remote};
}

test('missing shared model fails before contacting the school', options, async t => {
  const f = await fixture(t, {missingModel: true});
  const result = await f.run();
  assert.equal(result.code, 1);
  assert.match(result.output, /missing semester-model.mjs/);
  await assert.rejects(f.stages(), {code: 'ENOENT'});
});

test('successful run executes each data stage in order despite Bark failure', options, async t => {
  const f = await fixture(t, {bark: true});
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.equal(await f.stages(), 'collect\nbuild\nverify\n');
  assert.match(result.output, /SUCCESS:/);
  assert.match(result.output, /WARN: Bark notification failed/);
  assert.match(await readFile(path.join(f.root, 'bark.log'), 'utf8'), /RoomGap 采集完成/);
});

test('build failure preserves exit status and skips verification and success notification', options, async t => {
  const f = await fixture(t, {failBuild: true, bark: true});
  const result = await f.run();
  assert.equal(result.code, 7, result.output);
  assert.equal(await f.stages(), 'collect\nbuild\n');
  assert.doesNotMatch(result.output, /SUCCESS:/);
  const notifications = await readFile(path.join(f.root, 'bark.log'), 'utf8');
  assert.match(notifications, /数据构建/);
  assert.doesNotMatch(notifications, /RoomGap 采集完成/);
});

test('overlapping manual and scheduled runs cannot overwrite the same snapshots', options, async t => {
  const f = await fixture(t, {hold: true});
  const first = f.run();
  try {
    const deadline = Date.now() + 5000;
    while (!await f.stages().catch(() => '') && Date.now() < deadline) await delay(25);
    assert.equal(await f.stages(), 'collect\n');
    const second = await f.run();
    assert.equal(second.code, 0, second.output);
    assert.match(second.output, /SKIPPED: another collection/);
  } finally {
    assert.equal((await first).code, 0);
  }
  assert.equal(await f.stages(), 'collect\nbuild\nverify\n');
});

test('automatic publication commits only data and pushes to a local bare repository', options, async t => {
  const f = await publicationFixture(t);
  await writeFile(path.join(f.root, 'unrelated.txt'), 'do not publish\n');
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.equal(await f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'data/dataset/rooms.json');
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
});

test('automatic publication refuses unrelated staged changes before collection', options, async t => {
  const f = await publicationFixture(t);
  await writeFile(path.join(f.root, 'unrelated.txt'), 'do not publish\n');
  await f.git('add', 'unrelated.txt');
  const result = await f.run();
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /existing staged changes/);
  await assert.rejects(f.stages(), {code: 'ENOENT'});
  assert.equal(await f.git('diff', '--cached', '--name-only'), 'unrelated.txt');
});

test('a failed push can be retried even when no new data diff exists', options, async t => {
  const f = await publicationFixture(t);
  const hook = path.join(f.remote, 'hooks/pre-receive');
  await writeFile(hook, '#!/bin/sh\nexit 1\n', {mode: 0o755});
  const failed = await f.run();
  assert.notEqual(failed.code, 0);
  assert.doesNotMatch(failed.output, /SUCCESS:/);
  const commit = await f.git('rev-parse', 'HEAD');
  assert.notEqual(commit, await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
  await rm(hook);
  const retried = await f.run();
  assert.equal(retried.code, 0, retried.output);
  assert.equal(await f.git('rev-parse', 'HEAD'), commit);
  assert.equal(await f.git('--git-dir', f.remote, 'rev-parse', 'main'), commit);
});
