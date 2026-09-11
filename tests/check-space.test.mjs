import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSpace} from '../scripts/check-space.mjs';

const blocks = mib => () => ({bavail: mib * 256, bsize: 4096});
test('disk guard accepts its exact threshold and blocks one block below it', () => {
  assert.match(checkSpace('.', 128, blocks(128)), /DISK_OK/);
  assert.throws(() => checkSpace('.', 128, () => ({bavail: 128 * 256 - 1, bsize: 4096})), /DISK_LOW/);
});
test('reserved filesystem blocks are not treated as available space', () => {
  assert.throws(() => checkSpace('.', 128, () => ({bavail: 1, bfree: 1000000, bsize: 4096})), /DISK_LOW/);
});
test('invalid thresholds and unreadable filesystem capacity fail closed', () => {
  for (const value of ['', 0, -1, 'abc', 1.5, Infinity]) {
    assert.throws(() => checkSpace('.', value, blocks(1024)), /positive whole number/);
  }
  assert.throws(() => checkSpace('.', 128, () => ({})), /Cannot determine/);
});
