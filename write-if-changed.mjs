import {readFile,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';

async function readExisting(path) {
 try { return await readFile(path,'utf8'); }
 catch(error) {
  if(error.code==='ENOENT') return null;
  throw error;
 }
}

export async function writeTextIfChanged(path,text) {
 const old=await readExisting(path);
 if(old===text)return false;
 await writeFile(path,text,'utf8');
 return true;
}

export function hasValidCapturedAt(value) {
 return Boolean(value&&typeof value.capturedAt==='string'&&Number.isFinite(Date.parse(value.capturedAt)));
}

function withoutCapturedAt(value) {
 if(!value||typeof value!=='object'||Array.isArray(value))return value;
 const {capturedAt:_capturedAt,...rest}=value;
 return rest;
}

export function daySnapshotsEqualIgnoringCapturedAt(oldSnapshot,candidate) {
 return hasValidCapturedAt(oldSnapshot)&&hasValidCapturedAt(candidate)&&
  isDeepStrictEqual(withoutCapturedAt(oldSnapshot),withoutCapturedAt(candidate));
}

export async function writeDayIfChanged(path,candidate) {
 const text=JSON.stringify(candidate);
 const candidateSnapshot=JSON.parse(text);
 const oldText=await readExisting(path);
 if(oldText!==null){
  try {
   const oldSnapshot=JSON.parse(oldText);
   if(daySnapshotsEqualIgnoringCapturedAt(oldSnapshot,candidateSnapshot))return false;
  }catch(error){
   if(!(error instanceof SyntaxError))throw error;
  }
 }
 if(oldText===text)return false;
 await writeFile(path,text,'utf8');
 return true;
}
