import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCatalogs,catalogChanged,catalogShrinkError} from '../catalog-change.mjs';

const room=(campus,building,number)=>({id:`${campus}/${building}/${number}`,campusCode:campus,buildingCode:building});
const building=(campus,code,rowIndex)=>({campusCode:campus,buildingCode:code,rowIndex,roomCount:1});

test('unchanged catalogs produce no changes',()=>{
 const rooms=[room('01','1',101),room('01','2',201)];
 const buildings=[building('01','1',0),building('01','2',1)];
 const change=compareCatalogs({rooms,buildings},{rooms,buildings});
 assert.equal(change.initial,false);
 assert.equal(change.roomsAdded,0);assert.equal(change.roomsRemoved,0);
 assert.equal(change.buildingsAdded,0);assert.equal(change.buildingsRemoved,0);
 assert.equal(change.indexChanges,0);assert.deepEqual(change.campusesRemoved,[]);
 assert.equal(catalogChanged(change),false);assert.equal(catalogShrinkError(change),null);
});

test('a new building at an earlier index records its shift',()=>{
 const previous={rooms:[room('01','1',101),room('01','2',201)],buildings:[building('01','1',0),building('01','2',1)]};
 const current={rooms:[room('01','1',101),room('01','3',301),room('01','2',201)],buildings:[building('01','1',0),building('01','3',1),building('01','2',2)]};
 const change=compareCatalogs(previous,current);
 assert.equal(change.roomsAdded,1);assert.equal(change.roomsRemoved,0);
 assert.equal(change.buildingsAdded,1);assert.equal(change.buildingsRemoved,0);
 assert.equal(change.buildingsBefore,2);assert.equal(change.buildingsAfter,3);
 assert.equal(change.indexChanges,1);
 assert.deepEqual(change.indexChangeSamples,[{key:'01/2',from:1,to:2}]);
 assert.equal(catalogChanged(change),true);assert.equal(catalogShrinkError(change),null);
});

test('a large catalog drop is rejected and can be overridden',()=>{
 const previousRooms=Array.from({length:10},(_,i)=>room('01',String(i+1),101));
 const currentRooms=previousRooms.slice(0,9);
 const change=compareCatalogs(
  {rooms:previousRooms,buildings:previousRooms.map((r,i)=>building('01',String(i+1),i))},
  {rooms:currentRooms,buildings:currentRooms.map((r,i)=>building('01',String(i+1),i))}
 );
 assert.match(catalogShrinkError(change),/^CATALOG_SHRINK buildings 10→9, rooms 10→9, limit 5\.0%/);
 assert.match(catalogShrinkError(change),/ROOMGAP_ALLOW_CATALOG_SHRINK=1/);
 assert.equal(catalogShrinkError(change,{limit:0.2}),null);
 assert.equal(catalogShrinkError(change,{allow:true}),null);
});

test('losing all buildings on one campus is rejected even below the ratio limit',()=>{
 const previousRooms=[...Array.from({length:99},(_,i)=>room('01',String(i+1),101)),room('02','1',101)];
 const currentRooms=previousRooms.filter(r=>r.campusCode==='01');
 const change=compareCatalogs(
  {rooms:previousRooms,buildings:previousRooms.map((r,i)=>({campusCode:r.campusCode,buildingCode:r.buildingCode,rowIndex:i,roomCount:1}))},
  {rooms:currentRooms,buildings:currentRooms.map((r,i)=>({campusCode:r.campusCode,buildingCode:r.buildingCode,rowIndex:i,roomCount:1}))}
 );
 assert.deepEqual(change.campusesRemoved,['02']);
 assert.match(catalogShrinkError(change),/campuses lost: 02/);
});

test('first run skips comparison and shrink protection',()=>{
 const change=compareCatalogs({rooms:null,buildings:null},{rooms:[room('01','1',101)],buildings:[building('01','1',0)]});
 assert.equal(change.initial,true);assert.equal(catalogChanged(change),false);assert.equal(catalogShrinkError(change),null);
});

test('invalid shrink limits are rejected',()=>{
 const change=compareCatalogs({rooms:[room('01','1',101)],buildings:[building('01','1',0)]},{rooms:[],buildings:[]});
 for(const limit of [-0.1,1.1,NaN])assert.throws(()=>catalogShrinkError(change,{limit}),/between 0 and 1/);
});
