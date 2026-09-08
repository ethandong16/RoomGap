export const FULL_DAY_MASK = (1 << 13) - 1;
export function intervalMask(start, end) {
  let mask = 0;
  for (let p = Math.max(1, start); p <= Math.min(13, end); p++) mask |= 1 << (p - 1);
  return mask;
}
export function freeIntervals(mask) {
  const result=[];
  for(let p=1;p<=13;p++) {
    if(!(mask & (1 << (p-1)))) continue;
    const start=p;
    while(p<13 && (mask & (1 << p)))p++;
    result.push([start,p]);
  }
  return result;
}
export function roomDay(occupancies, term) {
  let occupiedMask=0,unknownMask=0;
  const categories={};const anomalies=[];
  const modules={'06':'course','07':'exam','14':'lab','room':'reservation'};
  for(const r of occupancies) {
    const type=term.sectionTypes.find(t=>t.code===r.sessionType);
    if(!type||!Number.isInteger(r.start)||r.start<1||!Number.isInteger(r.length)||r.length<1){unknownMask=FULL_DAY_MASK;anomalies.push('invalid_session');continue;}
    let start;
    if(r.sessionType==='02') {
      const matches=term.examMappings.filter(m=>String(m.xqdm)===String(term.termSeason)&&String(m.xqlxdm)===String(term.termType)&&Number(m.ksjc)===r.start).map(m=>Number(m.skjc));
      if(!matches.length){unknownMask=FULL_DAY_MASK;anomalies.push('missing_exam_mapping');continue;}
      start=Math.min(...matches);
    }else start=(r.start-1)*Number(type.multiplier)+1;
    const end=start-1+r.length*Number(type.multiplier);
    if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end>13){unknownMask=FULL_DAY_MASK;anomalies.push('out_of_range');}
    const mask=intervalMask(start,end);
    const category=modules[r.module]||'other';
    categories[category]=(categories[category]||0)|mask;
    occupiedMask|=mask;
  }
  const freeMask=FULL_DAY_MASK & ~(occupiedMask|unknownMask);
  return {occupiedMask,unknownMask,freeMask,freeIntervals:freeIntervals(freeMask),categories,anomalies:[...new Set(anomalies)]};
}
