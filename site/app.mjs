import {loadCatalog} from './data.mjs';
import {beijingDate, initialDate, dateInTerm, moveDate, teachingWeek, buildingKey, compareRooms, selectRooms} from './query.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="./icons.svg#${name}"/></svg>`;
const prettyDate = date => new Intl.DateTimeFormat('zh-CN', {timeZone:'UTC', month:'long', day:'numeric', weekday:'long'}).format(new Date(`${date}T00:00:00Z`));
const intervalText = ([a, b]) => a === b ? `第 ${a} 节` : `第 ${a}–${b} 节`;
const controls = {date:$('date'),campus:$('campus'),building:$('building'),search:$('search'),capacity:$('capacity')};
const themeMedia=matchMedia('(prefers-color-scheme: dark)');
let themePreference=document.documentElement.dataset.themePreference||'system';
let selectedPeriods = new Set();
let catalog, currentDay, matches = [], visibleCount = 24, loading = true, hadError = false;
let detailTrigger;
let authorTrigger;
let lastTrackedQuery = '';

const analytics = (() => {
  let sessionId = '';
  try { sessionId = localStorage.getItem('roomgap-session') || ''; } catch {}
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) {
    sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem('roomgap-session', sessionId); } catch {}
  }
  function track(type, data = {}) {
    const payload = JSON.stringify({type, sessionId, path: location.pathname, data});
    try {
      if (navigator.sendBeacon) {
        const accepted = navigator.sendBeacon('/api/analytics/events', new Blob([payload], {type: 'application/json'}));
        if (accepted) return;
      }
      fetch('/api/analytics/events', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: payload, keepalive: true}).catch(() => {});
    } catch {}
  }
  return {track};
})();
analytics.track('page_view');

const moreObserver = new IntersectionObserver(entries=>{
  if(entries.some(entry=>entry.isIntersecting))appendMoreRooms();
}, {rootMargin:'0px 0px 300px 0px'});

function announce(text) { $('announcement').textContent = text; }
function applyTheme(preference,{persist=true}={}) {
  themePreference=['system','light','dark'].includes(preference)?preference:'system';
  const theme=themePreference==='system'?(themeMedia.matches?'dark':'light'):themePreference;
  document.documentElement.dataset.theme=theme;
  document.documentElement.dataset.themePreference=themePreference;
  document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#111613':'#f4f5f2';
  document.querySelectorAll('.theme-option').forEach(button=>{
    const selected=button.dataset.theme===themePreference;
    button.setAttribute('aria-checked',String(selected));
    button.tabIndex=selected?0:-1;
  });
  if(persist)try{localStorage.setItem('roomgap-theme',themePreference);}catch{}
}
function selectedPeriodList() { return [...selectedPeriods].sort((a,b)=>a-b); }
function selectedPeriodText() {
  const periods=selectedPeriodList(),groups=[];
  if(!periods.length)return '未选节次';
  let start=periods[0],end=start;
  for(const period of periods.slice(1)) {
    if(period===end+1){end=period;continue;}
    groups.push(start===end?String(start):`${start}–${end}`);start=end=period;
  }
  groups.push(start===end?String(start):`${start}–${end}`);
  return `第 ${groups.join('、')} 节`;
}
function filters() {
  return {campus:controls.campus.value, building:controls.building.value, search:controls.search.value, minCapacity:Number(controls.capacity.value), periods:selectedPeriodList()};
}
function renderPeriodPicker() {
  $('period-picker').innerHTML=Array.from({length:13},(_,index)=>{
    const period=index+1,selected=selectedPeriods.has(period);
    return `<button type="button" class="period-option${selected?' selected':''}" data-period="${period}" aria-pressed="${selected}"><strong>${period}</strong><span>节</span></button>`;
  }).join('');
  $('period-selection-count').textContent=selectedPeriods.size?`已选 ${selectedPeriods.size} 节`:'未选节次';
  document.querySelectorAll('.period-preset').forEach(button=>{
    const periods=button.dataset.periods.split(',').map(Number);
    const active=periods.length===selectedPeriods.size&&periods.every(period=>selectedPeriods.has(period));
    button.setAttribute('aria-pressed',String(active));
  });
  document.querySelector('.period-clear').disabled=!selectedPeriods.size;
}
function showState(kind, title, description, action) {
  $('state-panel').hidden = false;
  $('state-panel').innerHTML = `${kind === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : icon(kind === 'error' ? 'info' : 'empty')}<h3>${esc(title)}</h3><p>${esc(description)}</p>${action ? `<button type="button" id="state-action">${esc(action)}</button>` : ''}`;
  if (action) $('state-action').onclick = kind === 'error' ? () => catalog ? loadSelectedDay() : initialize() : clearAdditional;
  $('room-grid').replaceChildren();
  moreObserver.disconnect();
  $('load-more').hidden = true;
}
function syncDateLabels() {
  const date = controls.date.value;
  const valid = dateInTerm(date, catalog.term);
  $('previous-day').disabled = !valid || date <= catalog.term.startDate;
  $('next-day').disabled = !valid || date >= catalog.term.endDate;
  $('today').disabled = !dateInTerm(beijingDate(), catalog.term) || date === beijingDate();
  $('week-label').textContent = valid ? `第 ${teachingWeek(date,catalog.term)} 周` : '';
  $('date-display').textContent = valid ? prettyDate(date) : '选择日期';
  if (valid) $('selection-summary').textContent = `${prettyDate(date)} · ${selectedPeriodText()} · ${controls.campus.selectedOptions[0]?.textContent || '全部校区'}`;
}
function updateBuildings() {
  const old = controls.building.value;
  const available = catalog.candidates.filter(r => !controls.campus.value || r.campusCode === controls.campus.value).sort(compareRooms);
  const buildings = new Map(available.map(r => [buildingKey(r), controls.campus.value ? (r.building || r.buildingCode) : `${r.campus} · ${r.building || r.buildingCode}`]));
  controls.building.replaceChildren(new Option('全部教学楼', ''), ...[...buildings].map(([value,label]) => new Option(label,value)));
  if (buildings.has(old)) controls.building.value = old;
}
function saveCampus() { try { localStorage.setItem('roomgap-campus',controls.campus.value); } catch {} }
function periodStrip(state) {
  return Array.from({length:13}, (_,i) => {
    const bit=1<<i, status = state.unknownMask & bit ? 'unknown' : state.occupiedMask & bit ? 'busy' : 'free';
    return `<span class="period-cell ${status}${selectedPeriods.has(i+1) ? ' selected' : ''}">${i+1}</span>`;
  }).join('');
}
function roomCard(entry, index) {
  const {room,state,continuousLength}=entry;
  return `<article class="room-card"><div class="room-card-head"><span class="campus-tag">${esc(room.campus)}</span><span class="available-tag">${icon('check')}所选节次空闲</span></div><h3>${esc(room.name)}</h3><p class="location-line">${icon('pin')}${esc(room.building || room.buildingCode)}</p><div class="room-meta"><span>${icon('people')}${room.capacity == null ? '容量未注明' : `${esc(room.capacity)} 人`}</span><span class="type-label">${esc(room.type || '类型未注明')}</span></div><div class="period-strip" aria-hidden="true">${periodStrip(state)}</div><p class="strip-caption">${icon('clock')}${selectedPeriodText()} 均空闲</p><div class="card-footer"><span>最长连空 ${continuousLength} 节</span><button type="button" data-room="${index}" aria-label="查看${esc(room.campus)}${esc(room.building || room.buildingCode)}${esc(room.name)}全天安排">查看全天${icon('arrow-right')}</button></div></article>`;
}
function paintCards(append = false) {
  const start = append ? $('room-grid').children.length : 0;
  const html = matches.slice(start, visibleCount).map((entry,i) => roomCard(entry,start+i)).join('');
  if (append) $('room-grid').insertAdjacentHTML('beforeend',html); else $('room-grid').innerHTML = html;
  moreObserver.disconnect();
  $('load-more').hidden = false;
  const remaining=Math.max(0,matches.length-visibleCount);
  $('load-more').textContent = remaining ? `继续下滑加载 · 还有 ${remaining} 间` : `已显示全部 ${matches.length} 间教室`;
  if(remaining)moreObserver.observe($('load-more'));
}
function appendMoreRooms() {
  if(loading||hadError||!currentDay||!selectedPeriods.size||visibleCount>=matches.length||$('load-more').hidden)return;
  visibleCount+=24;
  paintCards(true);
  announce(`已显示 ${Math.min(visibleCount,matches.length)} 间教室，共 ${matches.length} 间`);
}
function renderResults() {
  if (!catalog) return;
  syncDateLabels();
  if (loading || hadError || !currentDay) return;
  if (!selectedPeriods.size) {
    matches=[];visibleCount=24;
    $('results-title').firstChild.textContent='先选择要查询的节次';
    $('result-count').textContent='';
    $('results-section').setAttribute('aria-busy','false');
    showState('empty','请选择节次','可以选择一个或多个节次，不必连续。');
    announce(`${prettyDate(controls.date.value)}，尚未选择节次`);
    return;
  }
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
  const queryData = {
    date: controls.date.value,
    campus: controls.campus.selectedOptions[0]?.textContent || '全部校区',
    building: controls.building.selectedOptions[0]?.textContent || '全部教学楼',
    periods: selectedPeriodList(),
    resultCount: matches.length
  };
  const querySignature = JSON.stringify(queryData);
  if (querySignature !== lastTrackedQuery) {
    lastTrackedQuery = querySignature;
    analytics.track('query', queryData);
  }
  announce(`${prettyDate(controls.date.value)}，${selectedPeriodText()}，找到 ${matches.length} 间空闲教室`);
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
function resetFilters() {
  if(!catalog)return;
  controls.campus.value='';
  updateBuildings();
  controls.building.value='';controls.search.value='';controls.capacity.value='0';
  selectedPeriods.clear();
  renderPeriodPicker();saveCampus();
  const defaultDate=initialDate(catalog.term).date;
  if(controls.date.value!==defaultDate){controls.date.value=defaultDate;loadSelectedDay();}else renderResults();
}
function openRoom(index, trigger) {
  const entry=matches[index];if(!entry)return;
  const {room,state}=entry;
  analytics.track('room_detail', {room: room.name, campus: room.campus, building: room.building || room.buildingCode});
  detailTrigger=trigger;
  $('dialog-title').textContent=room.name;
  const periods=Array.from({length:13},(_,i)=>{
    const status=state.unknownMask&(1<<i)?'unknown':state.occupiedMask&(1<<i)?'busy':'free';
    return `<div class="detail-period ${status}${selectedPeriods.has(i+1)?' chosen':''}"><strong>第 ${i+1} 节</strong><span>${{free:'空闲',busy:'占用',unknown:'未知'}[status]}</span></div>`;
  }).join('');
  $('dialog-body').className='dialog-body';
  $('dialog-body').innerHTML=`<p class="dialog-location">${esc(room.campus)} / ${esc(room.building || room.buildingCode)}</p><div class="room-meta"><span>${icon('people')}${room.capacity==null?'容量未注明':`${esc(room.capacity)} 人`}</span><span class="type-label">${esc(room.type || '类型未注明')}</span></div><div class="detail-date"><strong>${prettyDate(controls.date.value)}</strong><span>第 ${teachingWeek(controls.date.value,catalog.term)} 周</span></div><div class="legend"><span><i></i>空闲</span><span><i class="busy"></i>占用</span><span><i class="unknown"></i>未知</span></div><div class="detail-periods">${periods}</div><p class="detail-caption">绿色边框标出你选择的${selectedPeriodText()}</p><h3 class="interval-heading">当天连续空闲时段</h3><div class="interval-tags">${state.freeIntervals.map(interval=>`<span>${intervalText(interval)}</span>`).join('')}</div><p class="detail-note">排课空闲不保证实际开放，临时调整以学校安排为准。容量是教室座位总数，不代表当前剩余座位。</p>`;
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
    selectedPeriods=new Set(previous?.periods??[]);
    renderPeriodPicker();
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
const themeSwitcher=$('theme-switcher');
themeSwitcher.addEventListener('click',event=>{
  const button=event.target.closest('button[data-theme]');
  if(!button)return;
  applyTheme(button.dataset.theme);
  analytics.track('theme_change', {theme: button.dataset.theme});
});
themeSwitcher.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const options=[...themeSwitcher.querySelectorAll('.theme-option')];
  const current=options.indexOf(document.activeElement);
  const next=event.key==='Home'?0:event.key==='End'?options.length-1:(current+(event.key==='ArrowRight'?1:-1)+options.length)%options.length;
  applyTheme(options[next].dataset.theme);options[next].focus();
});
const systemThemeChanged=()=>{if(themePreference==='system')applyTheme('system',{persist:false});};
if(themeMedia.addEventListener)themeMedia.addEventListener('change',systemThemeChanged);else themeMedia.addListener(systemThemeChanged);
function openNativeDatePicker(event) {
  if(event.type==='keydown') {
    if(!['Enter',' '].includes(event.key))return;
    event.preventDefault();
  }
  if(typeof controls.date.showPicker!=='function')return;
  try{controls.date.showPicker();}catch{}
}
controls.date.addEventListener('click',openNativeDatePicker);
controls.date.addEventListener('keydown',openNativeDatePicker);
controls.date.addEventListener('change',loadSelectedDay);
controls.campus.addEventListener('change',()=>{updateBuildings();saveCampus();renderResults();});
$('period-picker').addEventListener('click',event=>{
  const button=event.target.closest('button[data-period]');if(!button)return;
  const period=Number(button.dataset.period);
  if(selectedPeriods.has(period))selectedPeriods.delete(period);else selectedPeriods.add(period);
  renderPeriodPicker();renderResults();
});
$('period-presets').addEventListener('click',event=>{
  const button=event.target.closest('button[data-periods]');if(!button)return;
  selectedPeriods=new Set(button.dataset.periods?button.dataset.periods.split(',').map(Number):[]);
  renderPeriodPicker();renderResults();
});
for(const control of [controls.building,controls.capacity])control.addEventListener('change',renderResults);
controls.search.addEventListener('input',renderResults);
$('previous-day').onclick=()=>{controls.date.value=moveDate(controls.date.value,-1);loadSelectedDay();};
$('next-day').onclick=()=>{controls.date.value=moveDate(controls.date.value,1);loadSelectedDay();};
$('today').onclick=()=>{controls.date.value=beijingDate();loadSelectedDay();};
$('reset-filters').onclick=resetFilters;
$('room-grid').addEventListener('click',event=>{const trigger=event.target.closest('button[data-room]');if(trigger)openRoom(Number(trigger.dataset.room),trigger);});
$('close-dialog').onclick=()=>$('room-dialog').close();
$('room-dialog').addEventListener('click',event=>{if(event.target===$('room-dialog')){const rect=$('room-dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('room-dialog').close();}});
$('room-dialog').addEventListener('close',()=>{document.body.style.overflow='';detailTrigger?.focus();});
const authorDialog=$('author-dialog');
$('author-trigger').onclick=()=>{
  authorTrigger=document.activeElement;
  authorDialog.showModal();
  document.body.style.overflow='hidden';
  $('close-author-dialog').focus();
};
$('close-author-dialog').onclick=()=>authorDialog.close();
authorDialog.addEventListener('click',event=>{
  if(event.target!==authorDialog)return;
  const rect=authorDialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)authorDialog.close();
});
authorDialog.addEventListener('close',()=>{document.body.style.overflow='';authorTrigger?.focus();});
const backToTop=$('back-to-top');
let scrollUpdatePending=false;
function updateBackToTop() {
  const visible=window.scrollY>Math.min(480,window.innerHeight*.65);
  backToTop.dataset.visible=String(visible);
  backToTop.setAttribute('aria-hidden',String(!visible));
  backToTop.tabIndex=visible?0:-1;
  scrollUpdatePending=false;
}
window.addEventListener('scroll',()=>{
  if(scrollUpdatePending)return;
  scrollUpdatePending=true;
  requestAnimationFrame(updateBackToTop);
},{passive:true});
backToTop.addEventListener('click',()=>window.scrollTo({top:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'}));
updateBackToTop();
applyTheme(themePreference,{persist:false});
initialize();
