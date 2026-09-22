import test from 'node:test';
import assert from 'node:assert/strict';
import {parseClassroomIndex,parseClassroomSearch} from '../classroom-page.mjs';

test('parses the classroom building index without a browser DOM',()=>{
 const html=`
  <input id="xqList" value="[{&quot;campusName&quot;:&quot;河西&quot;,&quot;campusNumber&quot;:&quot;01&quot;},{&quot;campusName&quot;:&quot;滨海&quot;,&quot;campusNumber&quot;:&quot;02&quot;}]">
  <input id="jxlList" value="[{&quot;id&quot;:{&quot;campusNumber&quot;:&quot;01&quot;,&quot;teachingBuildingNumber&quot;:&quot;12&quot;},&quot;teachingBuildingName&quot;:&quot;12号楼&quot;,&quot;remark&quot;:&quot;河西&quot;}]">
  <tbody id="jxlBody"></tbody>`;
 const result=parseClassroomIndex(html);
 assert.deepEqual(result.notes,[{campusCode:'01',buildingCode:'12',name:'12号楼',note:'河西'}]);
 assert.deepEqual(result.buildings[0],{rowIndex:0,campus:'河西',name:'12号楼',campusCode:'01',buildingCode:'12',path:'/student/teachingResources/classroomUseStatus/01/12/河西/12号楼',queryable:true});
 assert.deepEqual(result.buildings[1],{rowIndex:1,campus:'滨海',queryable:false});
});

test('parses successful form controls and JSON metadata',()=>{
 const html=`
  <form id='searchCondition'>
   <input type="hidden" name="xqh" value="01"><input name="jxlh" value="12">
   <input type="checkbox" name="checked" value="yes" checked><input type="checkbox" name="ignored" value="no">
   <select name="searchType"><option value="room">教室</option><option value="date" selected>日期</option></select>
   <textarea name="memo"> A &amp; B </textarea><input name="disabled" value="x" disabled>
  </form>
  <input id="classroomTypes" value='[{"classroomtypecode":"01","classroomtypename":"多媒体"}]'>
  <input id="section" value='[{"tjc":12}]'>`;
 const result=parseClassroomSearch(html);
 assert.deepEqual(result.form,{xqh:'01',jxlh:'12',checked:'yes',searchType:'date',memo:'A & B'});
 assert.equal(result.roomTypes[0].classroomtypename,'多媒体');
 assert.equal(result.sections[0].tjc,12);
});
