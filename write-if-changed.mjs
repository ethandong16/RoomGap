import {readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
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

// Building indexes come from the school's index page and can shift when buildings
// are added or removed. A stale snapshot at a now-inactive index duplicates a room
// key or carries an outdated room count, which makes the dataset build fail.
export async function removeStaleDaySnapshots(directory,activeIndexes,dates) {
 const active=new Set(activeIndexes),wanted=new Set(dates),removed=[];
 for(const file of await readdir(directory)){
  const match=/^(\d+)-(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
  if(!match||!wanted.has(match[2])||active.has(Number(match[1])))continue;
  await rm(join(directory,file));
  removed.push(file);
 }
 return removed.sort();
}
