import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAccessPolicy} from '../room-policy.mjs';

const policy={
  campusRules:[],
  excludedBuildingNameIncludes:[{text:'基地',reason:'managed'}]
};

test('west campus policy keeps ordinary rooms eligible without a room-number allowlist',()=>{
  const rooms=['109','110(d)','111(d)','209(d)','310(d)','411','112','1阶梯(d)'].map(roomCode=>({campusCode:'04',buildingCode:'10',building:'10-',roomCode,name:roomCode}));
  const result=applyAccessPolicy(rooms,policy).rooms;
  assert.deepEqual(result.filter(room=>room.candidateEligible).map(room=>room.roomCode),rooms.map(room=>room.roomCode));
});

test('managed bases are excluded regardless of campus',()=>{
  const rooms=[
    {campusCode:'04',buildingCode:'15',building:'智能实践基地',roomCode:'110',name:'110'},
    {campusCode:'01',buildingCode:'base',building:'创新基地',roomCode:'110',name:'110'}
  ];
  const result=applyAccessPolicy(rooms,policy).rooms;
  assert.ok(result.every(room=>room.candidateEligible===false));
  assert.ok(result.every(room=>room.eligibilityNote==='managed'));
});
