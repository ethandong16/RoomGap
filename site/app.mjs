import {loadCatalog} from './data.mjs';
import {beijingDate, initialDate, dateInTerm, moveDate, teachingWeek, buildingKey, compareRooms, selectRooms} from './query.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="./icons.svg#${name}"/></svg>`;
const prettyDate = date => new Intl.DateTimeFormat('zh-CN', {timeZone:'UTC', month:'long', day:'numeric', weekday:'long'}).format(new Date(`${date}T00:00:00Z`));
const intervalText = ([a, b]) => a === b ? `第 ${a} 节` : `第 ${a}–${b} 节`;
const controls = {date:$('date'),campus:$('campus'),building:$('building'),start:$('start-period'),end:$('end-period'),search:$('search'),capacity:$('capacity')};
let catalog, currentDay, matches = [], visibleCount = 24, loading = true, hadError = false;
let detailTrigger;

function announce(text) { $('announcement').textContent = text; }
function filters() {
  return {campus:controls.campus.value, building:controls.building.value, search:controls.search.value, minCapacity:Number(controls.capacity.value), start:Number(controls.start.value), end:Number(controls.end.value)};
}
function showState(kind, title, description, action) {
  $('state-panel').hidden = false;
  $('state-panel').innerHTML = `${kind === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : icon(kind === 'error' ? 'info' : 'empty')}<h3>${esc(title)}</h3><p>${esc(description)}</p>${action ? `<button type="button" id="state-action">${esc(action)}</button>` : ''}`;
  if (action) $('state-action').onclick = kind === 'error' ? () => catalog ? loadSelectedDay() : initialize() : clearAdditional;
  $('room-grid').replaceChildren();
  $('load-more').hidden = true;
}
function syncDateLabels() {
  const date = controls.date.value;
  const valid = dateInTerm(date, catalog.term);
  $('previous-day').disabled = !valid || date <= catalog.term.startDate;
  $('next-day').disabled = !valid || date >= catalog.term.endDate;
  $('today').disabled = !dateInTerm(beijingDate(), catalog.term) || date === beijingDate();
  $('week-label').textContent = valid ? `第 ${teachingWeek(date,catalog.term)} 周` : '';
  if (valid) $('selection-summary').textContent = `${prettyDate(date)} · 第 ${controls.start.value}–${controls.end.value} 节 · ${controls.campus.selectedOptions[0]?.textContent || '全部校区'}`;
}
function updateBuildings() {
  const old = controls.building.value;
  const available = catalog.candidates.filter(r => !controls.campus.value || r.campusCode === controls.campus.value).sort(compareRooms);
  const buildings = new Map(available.map(r => [buildingKey(r), controls.campus.value ? (r.building || r.buildingCode) : `${r.campus} · ${r.building || r.buildingCode}`]));
  controls.building.replaceChildren(new Option('全部教学楼', ''), ...[...buildings].map(([value,label]) => new Option(label,value)));
  if (buildings.has(old)) controls.building.value = old;
}
function saveCampus() { try { localStorage.setItem('roomgap-campus',controls.campus.value); } catch {} }
function periodStrip(state, start, end) {
  return Array.from({length:13}, (_,i) => {
    const bit=1<<i, status = state.unknownMask & bit ? 'unknown' : state.occupiedMask & bit ? 'busy' : 'free';
    return `<span class="period-cell ${status}${i+1>=start && i+1<=end ? ' selected' : ''}">${i+1}</span>`;
  }).join('');
}
function roomCard(entry, index) {
  const {room,state,interval,continuousLength}=entry;
  return `<article class="room-card"><div class="room-card-head"><span class="campus-tag">${esc(room.campus)}</span><span class="available-tag">${icon('check')}所选时段空闲</span></div><h3>${esc(room.name)}</h3><p class="location-line">${icon('pin')}${esc(room.building || room.buildingCode)}</p><div class="room-meta"><span>${icon('people')}${room.capacity == null ? '容量未注明' : `${esc(room.capacity)} 人`}</span><span class="type-label">${esc(room.type || '类型未注明')}</span></div><div class="period-strip" aria-hidden="true">${periodStrip(state,Number(controls.start.value),Number(controls.end.value))}</div><p class="strip-caption">${icon('clock')}${intervalText(interval)}连续空闲</p><div class="card-footer"><span>可连空 ${continuousLength} 节</span><button type="button" data-room="${index}" aria-label="查看${esc(room.campus)}${esc(room.building || room.buildingCode)}${esc(room.name)}全天安排">查看全天${icon('arrow-right')}</button></div></article>`;
}
function paintCards(append = false) {
  const start = append ? $('room-grid').children.length : 0;
  const html = matches.slice(start, visibleCount).map((entry,i) => roomCard(entry,start+i)).join('');
  if (append) $('room-grid').insertAdjacentHTML('beforeend',html); else $('room-grid').innerHTML = html;
  $('load-more').hidden = visibleCount >= matches.length;
  $('load-more').innerHTML = `查看更多教室 · 还有 ${Math.max(0,matches.length-visibleCount)} 间${icon('chevron-right')}`;
}
function renderResults() {
  if (!catalog) return;
  syncDateLabels();
  if (loading || hadError || !currentDay) return;
  matches = selectRooms(catalog.rooms, currentDay, filters());
  visibleCount = 24;
  $('results-title').firstChild.textContent = '这些教室，等你来坐';
  $('result-count').textContent = `${matches.length} 间`;
  $('results-section').setAttribute('aria-busy','false');
  if (!matches.length) {
    showState('empty','这段时间，暂时没有匹配的教室','试试更换节次或校区，也可以清除教学楼、名称和容量条件，扩大查找范围。','清除附加筛选');
  } else {
    $('state-panel').hidden = true;
    paintCards();
  }
  announce(`${prettyDate(controls.date.value)}，第 ${controls.start.value} 至 ${controls.end.value} 节，找到 ${matches.length} 间空闲教室`);
}
async function loadSelectedDay() {
  syncDateLabels();
  if (!dateInTerm(controls.date.value,catalog.term)) {
    controls.date.reportValidity();
    currentDay=null;hadError=true;loading=false;
    $('result-count').textContent='';
    $('results-title').firstChild.textContent='请选择学期内的日期';
    $('results-section').setAttribute('aria-busy','false');
    showState('empty','日期不在当前学期内',`可查询 ${catalog.term.startDate} 至 ${catalog.term.endDate}。`);
    return;
  }
  loading=true;hadError=false;currentDay=null;
  $('results-section').setAttribute('aria-busy','true');
  $('results-title').firstChild.textContent='正在寻找空闲教室';
  $('result-count').textContent='';
  showState('loading','正在加载教室安排','稍等一下，你的专注空间马上就好。');
  const date=controls.date.value;
  try {
    const result=await catalog.loader.select(date);
    if(result.stale || controls.date.value!==date)return;
    currentDay=result.day;loading=false;
    renderResults();
  } catch(error) {
    if(controls.date.value!==date)return;
    loading=false;hadError=true;
    $('results-section').setAttribute('aria-busy','false');
    $('results-title').firstChild.textContent='暂时无法查询';
    showState('error','教室安排没有加载成功',error.message,'重新加载数据');
    // A catalog mismatch requires fetching a fresh manifest, not repeatedly requesting an old version.
    $('state-action').onclick=initialize;
    announce('教室安排加载失败，请重新加载数据');
  }
}
function clearAdditional() {
  controls.building.value='';controls.search.value='';controls.capacity.value='0';
  renderResults();
}
function openRoom(index, trigger) {
  const entry=matches[index];if(!entry)return;
  const {room,state}=entry;
  detailTrigger=trigger;
  $('dialog-title').textContent=room.name;
  const start=Number(controls.start.value),end=Number(controls.end.value);
  const periods=Array.from({length:13},(_,i)=>{
    const status=state.unknownMask&(1<<i)?'unknown':state.occupiedMask&(1<<i)?'busy':'free';
    return `<div class="detail-period ${status}${i+1>=start&&i+1<=end?' chosen':''}"><strong>第 ${i+1} 节</strong><span>${{free:'空闲',busy:'占用',unknown:'未知'}[status]}</span></div>`;
  }).join('');
  $('dialog-body').className='dialog-body';
  $('dialog-body').innerHTML=`<p class="dialog-location">${esc(room.campus)} / ${esc(room.building || room.buildingCode)}</p><div class="room-meta"><span>${icon('people')}${room.capacity==null?'容量未注明':`${esc(room.capacity)} 人`}</span><span class="type-label">${esc(room.type || '类型未注明')}</span></div><div class="detail-date"><strong>${prettyDate(controls.date.value)}</strong><span>第 ${teachingWeek(controls.date.value,catalog.term)} 周</span></div><div class="legend"><span><i></i>空闲</span><span><i class="busy"></i>占用</span><span><i class="unknown"></i>未知</span></div><div class="detail-periods">${periods}</div><p class="detail-caption">绿色边框标出你选择的第 ${start}–${end} 节</p><h3 class="interval-heading">当天连续空闲时段</h3><div class="interval-tags">${state.freeIntervals.map(interval=>`<span>${intervalText(interval)}</span>`).join('')}</div><p class="detail-note">排课空闲不保证实际开放，临时调整以学校安排为准。容量是教室座位总数，不代表当前剩余座位。</p>`;
  $('room-dialog').showModal();
  document.body.style.overflow='hidden';
  $('close-dialog').focus();
}

async function initialize() {
  const previous=catalog ? {...filters(),date:controls.date.value} : null;
  catalog=null;currentDay=null;loading=true;hadError=false;
  $('filters').disabled=true;
  $('results-section').setAttribute('aria-busy','true');
  showState('loading','正在加载教室安排','稍等一下，你的专注空间马上就好。');
  try {
    catalog=await loadCatalog();
    const {term,candidates,coverage}=catalog;
    const campuses=[...new Map(candidates.map(r=>[r.campusCode,r.campus]))].sort(([a],[b])=>a.localeCompare(b));
    controls.campus.replaceChildren(new Option('全部校区',''),...campuses.map(([value,label])=>new Option(label,value)));
    let saved='';try{saved=localStorage.getItem('roomgap-campus')||'';}catch{}
    if(campuses.some(([code])=>code===saved))controls.campus.value=saved;
    for(const control of [controls.start,controls.end])control.replaceChildren(...Array.from({length:13},(_,i)=>new Option(`第${i+1}节`,String(i+1))));
    controls.start.value=String(previous?.start || 1);controls.end.value=String(previous?.end || 2);
    controls.date.min=term.startDate;controls.date.max=term.endDate;
    const initial=initialDate(term);
    controls.date.value=previous&&dateInTerm(previous.date,term)?previous.date:initial.date;
    $('range-notice').hidden=!initial.outsideTerm;
    $('range-notice').textContent=`今天不在已收录学期内，当前展示本学期安排。可查询 ${term.startDate} 至 ${term.endDate}。`;
    updateBuildings();
    if(previous&&[...controls.building.options].some(o=>o.value===previous.building))controls.building.value=previous.building;
    $('candidate-count').textContent=candidates.length;
    $('campus-count').textContent=campuses.length;
    $('term-range').textContent=`${term.startDate.replaceAll('-','.')} — ${term.endDate.replaceAll('-','.')}`;
    const captured=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(coverage.lastCapture));
    $('data-meta').textContent=`数据更新于 ${captured}（北京时间） · ${term.weeks} 周安排 · ${candidates.length} 间候选教室`;
    $('filters').disabled=false;
    await loadSelectedDay();
  } catch(error) {
    catalog=null;loading=false;hadError=true;
    $('results-section').setAttribute('aria-busy','false');
    $('results-title').firstChild.textContent='暂时无法查询';$('result-count').textContent='';
    $('selection-summary').textContent='数据加载完成后即可查询';
    showState('error','教室数据没有加载成功',error.message,'重试');
    announce('教室数据加载失败，请重试');
  }
}

$('query-form').addEventListener('submit',event=>{event.preventDefault();renderResults();});
controls.date.addEventListener('change',loadSelectedDay);
controls.campus.addEventListener('change',()=>{updateBuildings();saveCampus();renderResults();});
controls.start.addEventListener('change',()=>{if(Number(controls.start.value)>Number(controls.end.value))controls.end.value=controls.start.value;renderResults();});
controls.end.addEventListener('change',()=>{if(Number(controls.end.value)<Number(controls.start.value))controls.start.value=controls.end.value;renderResults();});
for(const control of [controls.building,controls.capacity])control.addEventListener('change',renderResults);
controls.search.addEventListener('input',renderResults);
$('previous-day').onclick=()=>{controls.date.value=moveDate(controls.date.value,-1);loadSelectedDay();};
$('next-day').onclick=()=>{controls.date.value=moveDate(controls.date.value,1);loadSelectedDay();};
$('today').onclick=()=>{controls.date.value=beijingDate();loadSelectedDay();};
$('reset-filters').onclick=clearAdditional;
$('load-more').onclick=()=>{const oldCount=$('room-grid').children.length;visibleCount+=24;paintCards(true);$('room-grid').children[oldCount]?.querySelector('button')?.focus();announce(`已显示 ${Math.min(visibleCount,matches.length)} 间教室，共 ${matches.length} 间`);};
$('room-grid').addEventListener('click',event=>{const trigger=event.target.closest('button[data-room]');if(trigger)openRoom(Number(trigger.dataset.room),trigger);});
$('close-dialog').onclick=()=>$('room-dialog').close();
$('room-dialog').addEventListener('click',event=>{if(event.target===$('room-dialog')){const rect=$('room-dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('room-dialog').close();}});
$('room-dialog').addEventListener('close',()=>{document.body.style.overflow='';detailTrigger?.focus();});
initialize();
