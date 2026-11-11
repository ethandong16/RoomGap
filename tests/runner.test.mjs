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
  await mkdir(path.join(root, 'scripts'));
  await copyFile(new URL('../scripts/check-space.mjs', import.meta.url), path.join(root, 'scripts/check-space.mjs'));
  await writeFile(path.join(root, 'config.env'), bark ? "ROOMGAP_BARK_URL='https://example.invalid/device'\n" : '');
  await writeFile(path.join(root, 'classroom-page.mjs'), 'export {};\n');
  await writeFile(path.join(root, 'cookie-header.mjs'), 'export {};\n');
  await copyFile(new URL('../write-if-changed.mjs', import.meta.url), path.join(root, 'write-if-changed.mjs'));
  await writeFile(path.join(root, 'catalog-change.mjs'), 'export {};\n');
  if (!missingModel) await writeFile(path.join(root, 'semester-model.mjs'), 'export {};\n');
  for (const [file, stage] of [['collect-api.mjs', 'collect'], ['build-dataset.mjs', 'build'], ['verify-dataset.mjs', 'verify']]) {
    await writeFile(path.join(root, file), `import {appendFile, writeFile} from 'node:fs/promises';
await appendFile('stages.log', '${stage}\\n');
${stage === 'collect' ? "await writeFile('refresh-mode.log',process.env.ROOMGAP_REFRESH||'unset');" : ''}
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
    ROOMGAP_MIN_FREE_MB: '1',
    ROOMGAP_GIT_FETCH_ATTEMPTS: '3',
    ROOMGAP_GIT_FETCH_RETRY_SECONDS: '0',
    ROOMGAP_GIT_PUSH_ATTEMPTS: '1',
    ROOMGAP_GIT_PUSH_RETRY_SECONDS: '0',
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

async function publicationFixture(t, options = {}) {
  const f = await fixture(t, options);
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

async function mockFetchFailures(f, failures, {sleep = false, succeedFirst = false} = {}) {
  const realGit = (await execute('which', ['git'])).stdout.trim();
  await writeFile(path.join(f.root, 'bin/git'), `#!/bin/sh
if [ "$1" = fetch ]; then
  count=0
  if [ -f fetch-count ]; then count=$(cat fetch-count); fi
  count=$((count+1))
  printf '%s' "$count" > fetch-count
  printf '%s\\n' "\${GIT_TERMINAL_PROMPT:-unset}" >> fetch-prompts.log
  if [ "$count" -le ${failures + (succeedFirst ? 1 : 0)} ] && [ "$count" -gt ${succeedFirst ? 1 : 0} ]; then
    echo "mock Git fetch timeout $count" >&2
    exit 1
  fi
fi
exec "${realGit}" "$@"
`, {mode: 0o755});
  if (sleep) await writeFile(path.join(f.root, 'bin/sleep'), '#!/bin/sh\nprintf "%s\\n" "$1" >> sleep.log\n', {mode: 0o755});
}

function assertPushOnlyLog(output, exitCode) {
  assert.match(output, /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}\] START: GitHub push-only/);
  assert.match(output, new RegExp(`\\[\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}[+-]\\d{4}\\] END: GitHub push-only \\(exit ${exitCode}\\)`));
}

test('missing shared model fails before contacting the school', options, async t => {
  const f = await fixture(t, {missingModel: true});
  const result = await f.run();
  assert.equal(result.code, 1);
  assert.match(result.output, /missing semester-model.mjs/);
  await assert.rejects(f.stages(), {code: 'ENOENT'});
});

test('low disk space blocks collection and includes capacity in the failure notification', options, async t => {
  const f = await fixture(t, {bark: true});
  f.env.ROOMGAP_MIN_FREE_MB = '1000000000';
  const result = await f.run();
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /DISK_LOW/);
  await assert.rejects(f.stages(), {code: 'ENOENT'});
  const notifications = await readFile(path.join(f.root, 'bark.log'), 'utf8');
  assert.match(notifications, /DISK_LOW/);
  assert.doesNotMatch(notifications, /RoomGap 开始采集|RoomGap 采集完成/);
});

test('successful run executes each data stage in order despite Bark failure', options, async t => {
  const f = await fixture(t, {bark: true});
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.equal(await f.stages(), 'collect\nbuild\nverify\n');
  assert.equal(await readFile(path.join(f.root, 'refresh-mode.log'), 'utf8'), '1');
  assert.match(result.output, /SUCCESS:/);
  assert.match(result.output, /WARN: Bark notification failed/);
  assert.match(await readFile(path.join(f.root, 'bark.log'), 'utf8'), /RoomGap 采集完成/);
});

test('resume mode must be selected explicitly', options, async t => {
  const f = await fixture(t);
  f.env.ROOMGAP_REFRESH = '0';
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.equal(await readFile(path.join(f.root, 'refresh-mode.log'), 'utf8'), '0');
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
  const f = await fixture(t, {hold: true, bark: true});
  f.env.ROOMGAP_LOCK_WAIT = '0';
  const first = f.run();
  try {
    const deadline = Date.now() + 5000;
    while (!await f.stages().catch(() => '') && Date.now() < deadline) await delay(25);
    assert.equal(await f.stages(), 'collect\n');
    const second = await f.run();
    assert.equal(second.code, 75, second.output);
    assert.match(second.output, /SKIPPED: another collection/);
    assert.doesNotMatch(await readFile(path.join(f.root, 'bark.log'), 'utf8'), /任务失败/);
  } finally {
    assert.equal((await first).code, 0);
  }
  assert.equal(await f.stages(), 'collect\nbuild\nverify\n');
});

test('a short-lived lock holder does not make collection skip', options, async t => {
  const f = await fixture(t, {hold: true});
  f.env.ROOMGAP_LOCK_WAIT = '10';
  const first = f.run();
  try {
    const deadline = Date.now() + 5000;
    while (!await f.stages().catch(() => '') && Date.now() < deadline) await delay(25);
    const second = await f.run();
    assert.equal(second.code, 0, second.output);
    assert.doesNotMatch(second.output, /SKIPPED: another collection/);
  } finally {
    assert.equal((await first).code, 0);
  }
  assert.equal(await f.stages(), 'collect\nbuild\nverify\ncollect\nbuild\nverify\n');
});

test('automatic publication commits only data and pushes to a local bare repository', options, async t => {
  const f = await publicationFixture(t);
  await writeFile(path.join(f.root, 'unrelated.txt'), 'do not publish\n');
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.equal(await f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'data/dataset/rooms.json');
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
});

test('automatic publication rebases a data commit when origin advances first', options, async t => {
  const f = await publicationFixture(t);
  const other = await mkdtemp(path.join(tmpdir(), 'roomgap-remote-'));
  t.after(() => rm(other, {recursive: true, force: true}));
  await execute('git', ['clone', '--branch', 'main', f.remote, other]);
  const remoteGit = async (...args) => (await execute('git', args, {cwd: other})).stdout.trim();
  await remoteGit('config', 'user.name', 'Remote Writer');
  await remoteGit('config', 'user.email', 'remote@example.invalid');
  await writeFile(path.join(other, 'remote-note.txt'), 'remote moved first\n');
  await remoteGit('add', 'remote-note.txt');
  await remoteGit('commit', '-m', 'Remote change before collection');
  await remoteGit('push', 'origin', 'main');

  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
  assert.equal(await readFile(path.join(f.root, 'remote-note.txt'), 'utf8'), 'remote moved first\n');
  assert.deepEqual(await f.git('log', '-2', '--format=%s'), 'Update collected classroom data\nRemote change before collection');
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

test('automatic publication retries transient push failures', options, async t => {
  const f = await publicationFixture(t);
  f.env.ROOMGAP_GIT_PUSH_ATTEMPTS = '3';
  f.env.ROOMGAP_GIT_PUSH_RETRY_SECONDS = '0';
  const hook = path.join(f.remote, 'hooks/pre-receive');
  await writeFile(hook, `#!/bin/sh
counter="$0.count"
attempts=0
if [ -f "$counter" ]; then attempts=$(cat "$counter"); fi
attempts=$((attempts+1))
printf '%s' "$attempts" > "$counter"
if [ "$attempts" -lt 3 ]; then exit 1; fi
`, {mode: 0o755});
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Git push attempt 1\/3 failed/);
  assert.match(result.output, /Git push attempt 2\/3 failed/);
  assert.equal(await readFile(`${hook}.count`, 'utf8'), '3');
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
});

test('push-only mode retries transient fetch failures before publishing', options, async t => {
  const f = await publicationFixture(t);
  await writeFile(path.join(f.root, 'data/dataset/rooms.json'), '[2]\n');
  await f.git('add', 'data/dataset/rooms.json');
  await f.git('commit', '-m', 'Pending collected data');
  await mockFetchFailures(f, 2, {sleep: true});
  f.env.ROOMGAP_GIT_PUSH_ONLY = '1';
  delete f.env.ROOMGAP_GIT_FETCH_ATTEMPTS;
  delete f.env.ROOMGAP_GIT_FETCH_RETRY_SECONDS;
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Git fetch attempt 1\/3 failed; retrying in 15 seconds/);
  assert.match(result.output, /Git fetch attempt 2\/3 failed; retrying in 30 seconds/);
  assert.match(result.output, /SUCCESS: pushed 1 pending commit/);
  assertPushOnlyLog(result.output, 0);
  assert.equal(await readFile(path.join(f.root, 'fetch-count'), 'utf8'), '3');
  assert.equal(await readFile(path.join(f.root, 'fetch-prompts.log'), 'utf8'), '0\n0\n0\n');
  assert.equal(await readFile(path.join(f.root, 'sleep.log'), 'utf8'), '15\n30\n');
  await assert.rejects(f.stages(), {code: 'ENOENT'});
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
});

test('push-only fetch exhaustion reports the correct stage and leaves pending commits untouched', options, async t => {
  const f = await publicationFixture(t, {bark: true});
  await writeFile(path.join(f.root, 'data/dataset/rooms.json'), '[2]\n');
  await f.git('add', 'data/dataset/rooms.json');
  await f.git('commit', '-m', 'Pending collected data');
  await mockFetchFailures(f, 99);
  f.env.ROOMGAP_GIT_PUSH_ONLY = '1';
  const result = await f.run();
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /mock Git fetch timeout 3/);
  assert.match(result.output, /ERROR: GitHub 补推 failed \(exit 1\)/);
  assert.doesNotMatch(result.output, /ERROR: 依赖检查 failed|SUCCESS:|SKIPPED: no unpushed commits/);
  assertPushOnlyLog(result.output, 1);
  assert.equal(await readFile(path.join(f.root, 'fetch-count'), 'utf8'), '3');
  const notifications = await readFile(path.join(f.root, 'bark.log'), 'utf8');
  assert.match(notifications, /阶段：GitHub 补推/);
  assert.match(notifications, /Git fetch failed before GitHub push after 3 attempts/);
  assert.doesNotMatch(notifications, /RoomGap 数据已补推/);
  await assert.rejects(f.stages(), {code: 'ENOENT'});
  assert.notEqual(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
});

test('automatic publication retries the initial fetch without recollecting', options, async t => {
  const f = await publicationFixture(t);
  await mockFetchFailures(f, 2);
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.equal(await f.stages(), 'collect\nbuild\nverify\n');
  assert.equal(await readFile(path.join(f.root, 'fetch-count'), 'utf8'), '3');
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
});

test('automatic publication keeps its commit when initial fetch attempts are exhausted', options, async t => {
  const f = await publicationFixture(t, {bark: true});
  await mockFetchFailures(f, 99);
  const result = await f.run();
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /ERROR: GitHub 推送 failed \(exit 1\)/);
  assert.equal(await f.stages(), 'collect\nbuild\nverify\n');
  assert.equal(await readFile(path.join(f.root, 'fetch-count'), 'utf8'), '3');
  assert.notEqual(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
  const notifications = await readFile(path.join(f.root, 'bark.log'), 'utf8');
  assert.match(notifications, /阶段：GitHub 推送/);
  assert.match(notifications, /Git fetch failed before GitHub push after 3 attempts/);
  assert.doesNotMatch(notifications, /RoomGap 采集完成|RoomGap 数据已推送/);
});

test('synchronization retries fetch after a transient push failure', options, async t => {
  const f = await publicationFixture(t);
  // Let the initial synchronization succeed, then fail two synchronization fetches after push.
  await mockFetchFailures(f, 2, {succeedFirst: true});
  f.env.ROOMGAP_GIT_PUSH_ATTEMPTS = '2';
  const hook = path.join(f.remote, 'hooks/pre-receive');
  await writeFile(hook, '#!/bin/sh\nif [ ! -f "$0.count" ]; then touch "$0.count"; exit 1; fi\n', {mode: 0o755});
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Git push attempt 1\/2 failed/);
  assert.match(result.output, /Git fetch attempt 1\/3 failed/);
  assert.match(result.output, /Git fetch attempt 2\/3 failed/);
  assert.equal(await readFile(path.join(f.root, 'fetch-count'), 'utf8'), '4');
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
});

test('push-only mode publishes a pending commit without collecting again', options, async t => {
  const f = await publicationFixture(t);
  await writeFile(path.join(f.root, 'data/dataset/rooms.json'), '[2]\n');
  await f.git('add', 'data/dataset/rooms.json');
  await f.git('commit', '-m', 'Pending collected data');
  f.env.ROOMGAP_GIT_PUSH_ONLY = '1';
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /SUCCESS: pushed 1 pending commit/);
  assertPushOnlyLog(result.output, 0);
  await assert.rejects(f.stages(), {code: 'ENOENT'});
  assert.equal(await f.git('rev-parse', 'HEAD'), await f.git('--git-dir', f.remote, 'rev-parse', 'main'));
});

test('push-only skip is bracketed by timestamped run boundaries', options, async t => {
  const f = await publicationFixture(t);
  f.env.ROOMGAP_GIT_PUSH_ONLY = '1';
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /SKIPPED: no unpushed commits/);
  assertPushOnlyLog(result.output, 0);
});

test('push-only lock contention is timestamped without a failure notification', options, async t => {
  const f = await publicationFixture(t, {hold: true, bark: true});
  const first = f.run();
  try {
    const deadline = Date.now() + 5000;
    while (!await f.stages().catch(() => '') && Date.now() < deadline) await delay(25);
    assert.equal(await f.stages(), 'collect\n');
    f.env.ROOMGAP_GIT_PUSH_ONLY = '1';
    f.env.ROOMGAP_LOCK_WAIT = '0';
    const result = await f.run();
    assert.equal(result.code, 75, result.output);
    assert.match(result.output, /SKIPPED: another collection/);
    assertPushOnlyLog(result.output, 75);
    assert.doesNotMatch(await readFile(path.join(f.root, 'bark.log'), 'utf8'), /任务失败/);
  } finally {
    assert.equal((await first).code, 0);
  }
});

test('push-only rejects invalid fetch retry configuration', options, async t => {
  const f = await publicationFixture(t);
  f.env.ROOMGAP_GIT_PUSH_ONLY = '1';
  f.env.ROOMGAP_GIT_FETCH_ATTEMPTS = '0';
  const result = await f.run();
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /ROOMGAP_GIT_FETCH_ATTEMPTS must be a positive integer/);
  assert.match(result.output, /ERROR: GitHub 补推 failed/);
  assertPushOnlyLog(result.output, 1);
});

test('fetch retry settings honor a single attempt and cap exponential backoff', options, async t => {
  const f = await publicationFixture(t);
  await mockFetchFailures(f, 99, {sleep: true});
  f.env.ROOMGAP_GIT_PUSH_ONLY = '1';
  f.env.ROOMGAP_GIT_FETCH_ATTEMPTS = '1';
  f.env.ROOMGAP_GIT_FETCH_RETRY_SECONDS = '0';
  const once = await f.run();
  assert.equal(once.code, 1, once.output);
  assert.doesNotMatch(once.output, /Git fetch attempt .* retrying/);
  assert.equal(await readFile(path.join(f.root, 'fetch-count'), 'utf8'), '1');
  await assert.rejects(readFile(path.join(f.root, 'sleep.log')), {code: 'ENOENT'});

  f.env.ROOMGAP_GIT_FETCH_ATTEMPTS = '4';
  f.env.ROOMGAP_GIT_FETCH_RETRY_SECONDS = '200';
  const capped = await f.run();
  assert.equal(capped.code, 1, capped.output);
  assert.equal(await readFile(path.join(f.root, 'fetch-count'), 'utf8'), '5');
  assert.equal(await readFile(path.join(f.root, 'sleep.log'), 'utf8'), '200\n300\n300\n');
  assertPushOnlyLog(capped.output, 1);
});

test('push-only rejects invalid fetch retry delay', options, async t => {
  const f = await publicationFixture(t);
  f.env.ROOMGAP_GIT_PUSH_ONLY = '1';
  f.env.ROOMGAP_GIT_FETCH_RETRY_SECONDS = '-1';
  const result = await f.run();
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /ROOMGAP_GIT_FETCH_RETRY_SECONDS must be a non-negative integer/);
  assert.match(result.output, /ERROR: GitHub 补推 failed/);
  assertPushOnlyLog(result.output, 1);
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
