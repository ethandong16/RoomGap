import test from 'node:test';
import assert from 'node:assert/strict';
import {cookieHeaderForUrl} from '../cookie-header.mjs';

test('sends only cookies matching the request domain',()=>{
  const cookies=[
    {name:'JSESSIONID',value:'identity',domain:'id.tust.edu.cn',path:'/authserver',expires:-1},
    {name:'route',value:'identity-route',domain:'id.tust.edu.cn',path:'/authserver',expires:-1},
    {name:'JSESSIONID',value:'classroom',domain:'jwxtxs.tust.edu.cn',path:'/',expires:-1},
    {name:'route',value:'classroom-route',domain:'jwxtxs.tust.edu.cn',path:'/',expires:-1},
  ];
  assert.equal(cookieHeaderForUrl(cookies,'http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/index'),'JSESSIONID=classroom; route=classroom-route');
});

test('honors cookie path, secure flag and expiration',()=>{
  const cookies=[
    {name:'root',value:'yes',domain:'.example.com',path:'/',expires:-1},
    {name:'nested',value:'yes',domain:'example.com',path:'/student',expires:-1},
    {name:'secure',value:'no',domain:'example.com',path:'/',secure:true,expires:-1},
    {name:'expired',value:'no',domain:'example.com',path:'/',expires:99},
  ];
  assert.equal(cookieHeaderForUrl(cookies,'http://example.com/student/page',100_000),'nested=yes; root=yes');
  assert.equal(cookieHeaderForUrl(cookies,'http://example.com/other',100_000),'root=yes');
});
