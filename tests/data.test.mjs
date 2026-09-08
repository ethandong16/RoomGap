import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {sha256Fallback} from '../site/data.mjs';

test('SHA-256 fallback matches standard vectors',()=>{
  assert.equal(sha256Fallback(''),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Fallback('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Fallback('空闲教室'),'09f6683adadb72621f5f1752f3db472a05a2f931c683744fa97b0a94fb790c40');
});

test('SHA-256 fallback verifies the real classroom catalog',async()=>{
  const rooms=await readFile(new URL('../data/dataset/rooms.json',import.meta.url),'utf8');
  assert.equal(sha256Fallback(rooms),createHash('sha256').update(rooms).digest('hex'));
});
