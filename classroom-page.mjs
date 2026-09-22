const namedEntities={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};

export function decodeHtml(value){
 return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi,(entity,body)=>{
  if(body[0]==='#'){
   const radix=body[1]?.toLowerCase()==='x'?16:10;
   const number=Number.parseInt(body.slice(radix===16?2:1),radix);
   return Number.isFinite(number)?String.fromCodePoint(number):entity;
  }
  return namedEntities[body.toLowerCase()]??entity;
 });
}

function attributes(tag){
 const result={};
 const head=tag.match(/^<\s*[^\s/>]+\s*([\s\S]*?)\/?\s*>$/)?.[1]||'';
 const pattern=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
 for(const match of head.matchAll(pattern))result[match[1].toLowerCase()]=decodeHtml(match[2]??match[3]??match[4]??'');
 return result;
}

function elementWithId(html,id){
 for(const match of html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)){
  const attrs=attributes(match[0]);
  if(attrs.id!==id)continue;
  const tag=match[1].toLowerCase();
  if(['input','meta','link','img','br','hr'].includes(tag))return {tag,open:match[0],inner:'',attrs};
  const close=new RegExp(`<\\/${tag}\\s*>`,'ig');
  close.lastIndex=match.index+match[0].length;
  const end=close.exec(html);
  if(!end)throw Error(`Element #${id} is not closed`);
  return {tag,open:match[0],inner:html.slice(match.index+match[0].length,end.index),attrs};
 }
 throw Error(`Element #${id} was not found`);
}

function textContent(html){
 return decodeHtml(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' '))
  .replace(/\s+/g,' ').trim();
}

function jsonValue(html,id){
 const element=elementWithId(html,id);
 if(!('value' in element.attrs))throw Error(`Element #${id} has no value`);
 try{return JSON.parse(element.attrs.value);}catch{throw Error(`Element #${id} did not contain valid JSON`);}
}

export function parseClassroomIndex(html){
 const campuses=jsonValue(html,'xqList');
 const catalog=jsonValue(html,'jxlList');
 const buildings=[];
 let rowIndex=0;
 for(const campus of campuses){
  const matches=catalog.filter(building=>building.id.campusNumber===campus.campusNumber);
  if(!matches.length){buildings.push({campus:campus.campusName,rowIndex:rowIndex++,queryable:false});continue;}
  for(const building of matches){
   const campusCode=campus.campusNumber,buildingCode=building.id.teachingBuildingNumber,name=building.teachingBuildingName;
   const path=`/student/teachingResources/classroomUseStatus/${campusCode}/${buildingCode}/${campus.campusName}/${name}`;
   buildings.push({rowIndex:rowIndex++,campus:campus.campusName,name,campusCode,buildingCode,path,queryable:true});
  }
 }
 if(!buildings.length)throw Error('Classroom building table was empty');
 return {
  notes:catalog.map(building=>({campusCode:building.id.campusNumber,buildingCode:building.id.teachingBuildingNumber,name:building.teachingBuildingName,note:building.remark})),
  buildings,
 };
}

export function parseClassroomSearch(html){
 const formElement=elementWithId(html,'searchCondition');
 const form={};
 for(const match of formElement.inner.matchAll(/<input\b[^>]*>/gi)){
  const attrs=attributes(match[0]);
  const type=(attrs.type||'text').toLowerCase();
  if(!attrs.name||'disabled' in attrs||['submit','button','image','reset','file'].includes(type))continue;
  if(['checkbox','radio'].includes(type)&&!('checked' in attrs))continue;
  form[attrs.name]=attrs.value||'';
 }
 for(const match of formElement.inner.matchAll(/<select\b[^>]*>([\s\S]*?)<\/select>/gi)){
  const attrs=attributes(match[0].slice(0,match[0].indexOf('>')+1));
  if(!attrs.name||'disabled' in attrs)continue;
  const options=[...match[1].matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)].map(option=>({attrs:attributes(option[0].slice(0,option[0].indexOf('>')+1)),text:textContent(option[1])}));
  const selected=options.find(option=>'selected' in option.attrs&&!('disabled' in option.attrs))||options.find(option=>!('disabled' in option.attrs));
  if(selected)form[attrs.name]=selected.attrs.value??selected.text;
 }
 for(const match of formElement.inner.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/gi)){
  const attrs=attributes(match[0].slice(0,match[0].indexOf('>')+1));
  if(attrs.name&&!('disabled' in attrs))form[attrs.name]=textContent(match[1]);
 }
 return {form,roomTypes:jsonValue(html,'classroomTypes'),sections:jsonValue(html,'section')};
}
