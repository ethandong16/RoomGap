import {loadCatalog} from './data.mjs';
import {
  beijingDate, initialDate, dateInTerm, moveDate, teachingWeek, buildingKey,
  buildingLabel, floorOf, floorLabel, selectRooms, browseRooms,
  overviewByBuilding, periodCounts, weekDates, formatInterval, formatIntervals,
  longestFreeInterval
} from './query.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="./icons.svg#${name}"/></svg>`;
const WEEKDAY_NAMES = ['周日','周一','周二','周三','周四','周五','周六'];
const prettyDate = date => {
  const value = new Date(`${date}T00:00:00Z`);
  return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日 ${WEEKDAY_NAMES[value.getUTCDay()]}`;
};
const shortDate = date => {
  const value = new Date(`${date}T00:00:00Z`);
  return `${value.getUTCMonth() + 1}/${value.getUTCDate()}`;
};
const weekdayIndex = date => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
};
const intervalText = ([a, b]) => a === b ? `第 ${a} 节` : `第 ${a}–${b} 节`;
const FULL_DAY_MASK = 8191;
const controls = {
  date:$('date'),campus:$('campus'),building:$('building'),search:$('search'),
  capacity:$('capacity'),type:$('type')
};
const themeMedia=matchMedia('(prefers-color-scheme: dark)');
let themePreference=document.documentElement.dataset.themePreference||'system';
let viewMode = 'time';
let selectedPeriods = new Set();
let catalog, currentDay, matches = [], visibleCount = 24, loading = true, hadError = false;
let currentFloor = '';
let roomById = new Map(), roomIndexById = new Map(), buildingLabels = new Map();
let detailTrigger;
let authorTrigger;
let dialogToken = 0;
let lastTrackedQuery = '';

const analytics = (() => {
  let sessionId = '';
  try { sessionId = localStorage.getItem('roomgap-session') || ''; } catch {}
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(sessionId)) {
    sessionId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem('roomgap-session', sessionId); } catch {}
  }
  function track(type, data = {}) {
    if (['localhost', '127.0.0.1'].includes(location.hostname)) return;
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

const rippleSelector='.query-submit, .hero-quick-button, .period-option, .building-card';
function spawnButtonRipple(event){
  const button=event.target.closest?.(rippleSelector);
  if(!button||button.disabled||event.button!==0||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const rect=button.getBoundingClientRect();
  const size=Math.max(rect.width,rect.height)*2.1;
  const ripple=document.createElement('span');
  ripple.className='button-ripple';
  ripple.style.width=ripple.style.height=`${size}px`;
  ripple.style.left=`${event.clientX-rect.left-size/2}px`;
  ripple.style.top=`${event.clientY-rect.top-size/2}px`;
  button.append(ripple);
  ripple.addEventListener('animationend',()=>ripple.remove(),{once:true});
}
document.addEventListener('pointerdown',spawnButtonRipple,{passive:true});

const moreObserver = new IntersectionObserver(entries=>{
  if(entries.some(entry=>entry.isIntersecting))appendMoreRooms();
}, {rootMargin:'0px 0px 300px 0px'});

function announce(text) { $('announcement').textContent = text; }
function setResultsTitle(lead, {tail = true, tailText = '空教室'} = {}) {
  const title = $('results-title');
  title.querySelector('.title-lead').textContent = lead;
  const tailNode = title.querySelector('.title-tail');
  tailNode.textContent = tailText;
  tailNode.hidden = !tail;
}
function applyTheme(preference,{persist=true}={}) {
  themePreference=['system','light','dark'].includes(preference)?preference:'system';
  const theme=themePreference==='system'?(themeMedia.matches?'dark':'light'):themePreference;
  document.documentElement.dataset.theme=theme;
  document.documentElement.dataset.themePreference=themePreference;
  document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#0f0f10':'#f5f2ea';
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
function baseFilters() {
  return {
    campus: controls.campus.value,
    building: controls.building.value,
    search: controls.search.value,
    minCapacity: Number(controls.capacity.value),
    type: controls.type.value,
    floor: currentFloor
  };
}
function filters() {
  return {...baseFilters(), periods: selectedPeriodList()};
}
function buildingLabelFromKey(key) {
  return buildingLabels.get(key) || key;
}
function typeLabel(value) {
  if (!value) return '';
  return value === '__none__' ? '未注明' : value;
}
function rebuildBuildingLabels() {
  buildingLabels = new Map();
  for (const room of catalog?.candidates || []) buildingLabels.set(buildingKey(room), buildingLabel(room));
}
function saveCampus() { try { localStorage.setItem('roomgap-campus', controls.campus.value); } catch {} }

function updateBuildings() {
  if (!catalog) return;
  const old = controls.building.value;
  const available = catalog.candidates.filter(r => !controls.campus.value || r.campusCode === controls.campus.value);
  const buildings = new Map();
  for (const room of available) {
    const key = buildingKey(room);
    if (!buildings.has(key)) buildings.set(key, {
      key, campus: room.campus, label: buildingLabel(room), count: 0
    });
    buildings.get(key).count++;
  }
  const options = [...buildings.values()].sort((a, b) =>
    a.campus.localeCompare(b.campus, 'zh-CN') || a.label.localeCompare(b.label, 'zh-CN')
  ).map(item => new Option(`${controls.campus.value ? '' : `${item.campus} · `}${item.label}（${item.count} 间）`, item.key));
  controls.building.replaceChildren(new Option('全部教学楼', ''), ...options);
  if (buildings.has(old)) controls.building.value = old;
  else { controls.building.value = ''; currentFloor = ''; }
}
function renderTypeOptions() {
  if (!catalog) return;
  const old = controls.type.value;
  const types = [...new Set(catalog.candidates.map(room => room.type).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  controls.type.replaceChildren(
    new Option('全部类型', ''),
    ...types.map(type => new Option(type, type)),
    new Option('未注明', '__none__')
  );
  if ([...controls.type.options].some(option => option.value === old)) controls.type.value = old;
}

function updateViewChrome() {
  const isTime = viewMode === 'time';
  $('view-time').classList.toggle('selected', isTime);
  $('view-room').classList.toggle('selected', !isTime);
  $('view-time').setAttribute('aria-selected', String(isTime));
  $('view-room').setAttribute('aria-selected', String(!isTime));
  $('view-time').tabIndex = isTime ? 0 : -1;
  $('view-room').tabIndex = isTime ? -1 : 0;
  $('time-panel').hidden = !isTime;
  $('room-panel').hidden = isTime;
  $('submit-label').textContent = isTime ? '查看结果' : (controls.building.value ? '查看本楼教室' : '查看楼栋概览');
  $('query-tip').innerHTML = isTime
    ? (selectedPeriods.size
      ? `${icon('spark')}连续空闲优先；未知节次不会算作空闲。`
      : `${icon('spark')}不选节次时，先看每栋楼今天有多少空教室。`)
    : `${icon('spark')}点教室卡片查看本周 7×13 日程；不用先选节次。`;
  document.body.dataset.view = viewMode;
  renderFloorTabs();
}

function renderFloorTabs() {
  if (!catalog) return;
  const key = controls.building.value;
  if (!key) {
    currentFloor = '';
    $('floor-row').hidden = true;
    $('floor-tabs').replaceChildren();
    $('room-panel-meta').textContent = '先选一栋教学楼，或直接在下方楼栋概览里点选。';
    return;
  }
  const rooms = catalog.candidates.filter(room => buildingKey(room) === key);
  const counts = new Map([['', rooms.length]]);
  for (const room of rooms) {
    const floor = floorOf(room);
    const value = floor == null ? 'unknown' : String(floor);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const floors = [...counts.keys()].filter(value => value !== '').sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return Number(a) - Number(b);
  });
  if (currentFloor !== '' && !counts.has(currentFloor)) currentFloor = '';
  $('floor-row').hidden = false;
  $('floor-tabs').innerHTML = [
    `<button type="button" class="floor-tab${currentFloor === '' ? ' selected' : ''}" data-floor="" aria-pressed="${currentFloor === ''}">全部 <small>${rooms.length}</small></button>`,
    ...floors.map(floor => {
      const value = floor === 'unknown' ? 'unknown' : floor;
      const label = floor === 'unknown' ? '未标注' : `${floor}F`;
      const selected = currentFloor === value;
      return `<button type="button" class="floor-tab${selected ? ' selected' : ''}" data-floor="${value}" aria-pressed="${selected}">${label} <small>${counts.get(value)}</small></button>`;
    })
  ].join('');
  const knownFloors = floors.filter(floor => floor !== 'unknown');
  $('room-panel-meta').textContent = `${buildingLabelFromKey(key)} · ${rooms.length} 间 · ${knownFloors.length ? `${knownFloors.length} 层` : '楼层未标注'}${knownFloors.length && counts.has('unknown') ? ' · 含未标注' : ''}`;
  $('back-to-buildings').textContent = viewMode === 'room' || !selectedPeriods.size ? '返回楼栋' : '全部教学楼';
}

function renderPeriodPicker() {
  const counts = currentDay && catalog ? periodCounts(catalog.rooms, currentDay, baseFilters()) : null;
  const bands = [
    {label: '上午', range: '1–4', periods: [1, 2, 3, 4]},
    {label: '下午', range: '5–9', periods: [5, 6, 7, 8, 9]},
    {label: '晚上', range: '10–13', periods: [10, 11, 12, 13]}
  ];
  $('period-picker').innerHTML = bands.map(band => `
    <div class="period-band">
      <div class="period-band-label"><strong>${band.label}</strong><span>${band.range}</span></div>
      <div class="period-band-cells">
        ${band.periods.map(period => {
          const selected = selectedPeriods.has(period);
          const count = counts ? counts[period - 1] : null;
          const countText = count == null ? '—' : `${count} 间`;
          return `<button type="button" class="period-option${selected ? ' selected' : ''}${count === 0 ? ' is-empty' : ''}" data-period="${period}" aria-pressed="${selected}" aria-label="第 ${period} 节，${count == null ? '数量读取中' : `${count} 间空闲`}"><strong>${period}</strong><span>${countText}</span></button>`;
        }).join('')}
      </div>
    </div>`).join('');
  $('period-selection-count').textContent = selectedPeriods.size ? `已选 ${selectedPeriods.size} 节` : '不选 = 看今日概览';
  document.querySelectorAll('.period-preset').forEach(button => {
    const periods = button.dataset.periods ? button.dataset.periods.split(',').map(Number) : [];
    const active = periods.length > 0 && periods.length === selectedPeriods.size && periods.every(period => selectedPeriods.has(period));
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelector('.period-clear').disabled = !selectedPeriods.size;
}

function showState(kind, title, description, action, onAction) {
  matches = [];
  $('state-panel').hidden = false;
  $('state-panel').innerHTML = `${kind === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : icon(kind === 'error' ? 'info' : 'empty')}<h3>${esc(title)}</h3><p>${esc(description)}</p>${action ? `<button type="button" id="state-action">${esc(action)}</button>` : ''}`;
  if (action) $('state-action').onclick = onAction || (() => catalog ? loadSelectedDay() : initialize());
  $('overview-grid').hidden = true;
  $('overview-grid').replaceChildren();
  $('room-grid').replaceChildren();
  moreObserver.disconnect();
  $('load-more').hidden = true;
}
function syncDateLabels() {
  if (!catalog) return;
  const date = controls.date.value;
  const valid = dateInTerm(date, catalog.term);
  $('previous-day').disabled = !valid || date <= catalog.term.startDate;
  $('next-day').disabled = !valid || date >= catalog.term.endDate;
  $('today').disabled = !dateInTerm(beijingDate(), catalog.term) || date === beijingDate();
  $('week-label').textContent = valid ? `第 ${teachingWeek(date,catalog.term)} 周` : '';
  if (!valid) {
    $('date-display').innerHTML = '<span class="date-main">选择日期</span><span class="date-week"></span>';
    $('selection-summary').textContent = '请选择学期内的日期。';
    return;
  }
  $('date-display').innerHTML = `<span class="date-main">${prettyDate(date)}</span><span class="date-week">第 ${teachingWeek(date,catalog.term)} 周</span>`;
  const parts = [prettyDate(date), `第 ${teachingWeek(date,catalog.term)} 周`];
  if (controls.campus.value) parts.push(controls.campus.selectedOptions[0]?.textContent || '');
  if (controls.building.value) {
    parts.push(`${buildingLabelFromKey(controls.building.value)}${currentFloor ? ` · ${floorLabel(currentFloor === 'unknown' ? null : Number(currentFloor))}` : ''}`);
  }
  parts.push(viewMode === 'room' ? '本周安排' : (selectedPeriods.size ? selectedPeriodText() : '不限节次'));
  if (controls.search.value.trim()) parts.push(`搜索“${controls.search.value.trim()}”`);
  if (Number(controls.capacity.value) > 0) parts.push(`≥ ${controls.capacity.value} 人`);
  if (controls.type.value) parts.push(typeLabel(controls.type.value));
  $('selection-summary').textContent = parts.filter(Boolean).join(' · ');
}

function periodStrip(state) {
  return Array.from({length:13}, (_,i) => {
    const bit=1<<i, status = state.unknownMask & bit ? 'unknown' : state.occupiedMask & bit ? 'busy' : 'free';
    return `<span class="period-cell ${status}${selectedPeriods.has(i+1) ? ' selected' : ''}" title="第 ${i+1} 节 ${{free:'空闲',busy:'占用',unknown:'未知'}[status]}">${i+1}</span>`;
  }).join('');
}
function roomCard(entry, index) {
  const {room,state}=entry;
  const intervals = entry.freeIntervals || state.freeIntervals || [];
  const longest = entry.longest || longestFreeInterval(state);
  const streak = viewMode === 'time' && selectedPeriods.size ? (entry.continuousLength ?? longest.length) : longest.length;
  const allUnknown = state.unknownMask === FULL_DAY_MASK;
  const status = allUnknown || (!state.freeMask && state.unknownMask) ? 'unknown' : state.freeMask ? 'free' : 'busy';
  const floor = floorOf(room);
  const freeLabel = intervals.length ? `空闲：${formatIntervals(intervals)}` : allUnknown ? '今日数据未采集' : state.unknownMask ? '今日部分时段未知' : '今日无整段空闲';
  const streakLabel = allUnknown ? '暂无<br>数据' : streak ? '节<br>连空' : (state.unknownMask ? '数据<br>不全' : '今日<br>无空');
  return `<article class="room-card ${status}" style="--index:${index % 12}">
    <div class="room-card-top">
      <div class="room-identity">
        <span class="campus-tag">${esc(room.campus)}</span>
        <h3>${esc(room.name)}</h3>
        <p class="location-line">${icon('pin')}<span>${esc(buildingLabel(room))} · ${floorLabel(floor)}</span></p>
      </div>
      <div class="room-streak" title="${streak ? `最长连续空闲 ${streak} 节` : allUnknown ? '今天没有可用数据' : '今天没有记录到整段空闲'}"><strong>${streak || '—'}</strong><span>${streakLabel}</span></div>
    </div>
    <div class="period-strip" aria-label="第 1 到 13 节状态">${periodStrip(state)}</div>
    <p class="room-intervals">${esc(freeLabel)}</p>
    <div class="room-card-foot">
      <div class="room-facts">
        <span>${icon('people')}${room.capacity == null ? '容量未注明' : `${esc(room.capacity)} 人`}</span>
        ${room.type ? `<span class="fact-sep" aria-hidden="true"></span><span class="type-label">${esc(room.type)}</span>` : ''}
      </div>
      <button type="button" data-room-id="${esc(room.id)}" aria-label="查看${esc(room.campus)}${esc(buildingLabel(room))}${esc(room.name)}本周安排">本周安排${icon('arrow-right')}</button>
    </div>
  </article>`;
}
function paintCards(append = false) {
  const start = append ? $('room-grid').children.length : 0;
  const html = matches.slice(start, visibleCount).map((entry,i) => roomCard(entry,start+i)).join('');
  if (append) $('room-grid').insertAdjacentHTML('beforeend',html);
  else $('room-grid').innerHTML = html;
  moreObserver.disconnect();
  $('load-more').hidden = false;
  const remaining=Math.max(0,matches.length-visibleCount);
  $('load-more').textContent = remaining ? `继续下滑加载 · 还有 ${remaining} 间` : `已显示全部 ${matches.length} 间教室`;
  if(remaining)moreObserver.observe($('load-more'));
}
function appendMoreRooms() {
  if(loading||hadError||!currentDay||visibleCount>=matches.length||$('load-more').hidden)return;
  visibleCount+=24;
  paintCards(true);
  announce(`已显示 ${Math.min(visibleCount,matches.length)} 间教室，共 ${matches.length} 间`);
}
function paintBuildings(groups) {
  const searching = Boolean(controls.search.value.trim());
  $('overview-grid').innerHTML = groups.map((group,index) => {
    const knownFloors = group.floors;
    const contiguousFloors = knownFloors.every((floor, i) => i === 0 || floor === knownFloors[i - 1] + 1);
    const floorText = knownFloors.length === 0 ? '楼层未标注'
      : knownFloors.length === 1 ? `${knownFloors[0]}F`
      : contiguousFloors ? `${knownFloors[0]}F–${knownFloors[knownFloors.length - 1]}F`
      : knownFloors.map(floor => `${floor}F`).join('/');
    const percent = group.roomCount ? Math.round(group.freeCount / group.roomCount * 100) : 0;
    const stat = searching ? `${group.roomCount} 间匹配` : `${group.freeCount} 间今日有空`;
    const meta = [floorText];
    if (!searching) meta.push(`${group.roomCount} 间`);
    if (group.continuousCount) meta.push(`${group.continuousCount} 间可连空 2 节+`);
    return `<button type="button" class="building-card" data-building="${esc(group.key)}" style="--index:${index % 12}">
      <span class="building-card-top"><span class="campus-tag">${esc(group.campus)}</span><span class="building-free">${stat}</span></span>
      <strong>${esc(group.label)}</strong>
      <span class="building-meta">${meta.join(' · ')}</span>
      <span class="building-bar" aria-hidden="true"><i style="width:${percent}%"></i></span>
      <span class="building-examples">${group.examples.map(esc).join(' · ')}${group.roomCount > group.examples.length ? ' …' : ''}</span>
    </button>`;
  }).join('');
  $('overview-grid').hidden = false;
  $('room-grid').replaceChildren();
  $('load-more').hidden = true;
  moreObserver.disconnect();
}
function trackQuery(resultCount, resultKind) {
  const queryData = {
    view: viewMode,
    date: controls.date.value,
    campus: controls.campus.selectedOptions[0]?.textContent || '全部校区',
    building: controls.building.value ? buildingLabelFromKey(controls.building.value) : '全部教学楼',
    floor: currentFloor ? floorLabel(currentFloor === 'unknown' ? null : Number(currentFloor)) : '全部楼层',
    periods: selectedPeriodList(),
    search: controls.search.value.trim(),
    resultCount,
    resultKind
  };
  const signature = JSON.stringify(queryData);
  if (signature !== lastTrackedQuery) {
    lastTrackedQuery = signature;
    analytics.track('query', queryData);
  }
}
function renderRoomList(entries, {lead, tail, countLabel, kicker, sort, emptyTitle, emptyDescription, emptyAction, onEmptyAction}) {
  matches = entries;
  visibleCount = 24;
  $('overview-grid').hidden = true;
  $('overview-grid').replaceChildren();
  $('results-section').setAttribute('aria-busy','false');
  $('results-kicker').textContent = kicker;
  $('sort-label').innerHTML = `${icon('sort')}${sort}`;
  $('result-count').textContent = countLabel;
  setResultsTitle(lead, {tail:Boolean(tail), tailText: tail || '空教室'});
  if (!entries.length) {
    showState('empty', emptyTitle, emptyDescription, emptyAction, onEmptyAction);
    announce(`${prettyDate(controls.date.value)}，${emptyTitle}`);
    trackQuery(0, 'rooms');
    return;
  }
  $('state-panel').hidden = true;
  paintCards();
  announce(`${prettyDate(controls.date.value)}，${kicker}，共 ${entries.length} 间`);
  trackQuery(entries.length, 'rooms');
}
function renderBuildingOverview(groups, {mode}) {
  matches = [];
  $('results-section').setAttribute('aria-busy','false');
  $('results-kicker').textContent = mode === 'time' ? '楼栋概览' : '教室浏览';
  $('sort-label').innerHTML = `${icon('sort')}按楼栋浏览`;
  $('result-count').textContent = `${groups.length} 栋`;
  setResultsTitle(mode === 'time' ? '今天，哪里有空？' : '先从一栋楼开始', {tail:false});
  if (!groups.length) {
    const searching = Boolean(controls.search.value.trim());
    showState('empty', searching ? '没有楼栋匹配这个搜索' : '没有可浏览的楼栋',
      searching ? '换一个房号、楼栋或类型试试，也可以清除搜索。' : '试试切换校区，或重置筛选条件。',
      searching ? '清除搜索' : '重置筛选',
      () => {
        if (searching) { controls.search.value=''; renderPeriodPicker(); renderResults(); }
        else resetFilters();
      });
    announce('没有匹配的楼栋');
    trackQuery(0, 'buildings');
    return;
  }
  $('state-panel').hidden = true;
  paintBuildings(groups);
  announce(`${groups.length} 栋楼，${mode === 'time' ? '按今日空闲情况浏览' : '按楼栋浏览教室'}`);
  trackQuery(groups.length, 'buildings');
}
function renderResults() {
  if (!catalog) return;
  syncDateLabels();
  updateViewChrome();
  if (loading || hadError || !currentDay) return;
  const base = baseFilters();
  const periods = selectedPeriodList();
  const hasPeriods = periods.length > 0;
  const building = controls.building.value;
  const label = building ? buildingLabelFromKey(building) : '';
  const searching = Boolean(controls.search.value.trim());

  if (viewMode === 'room') {
    if (!building) {
      const groups = overviewByBuilding(catalog.rooms, currentDay, {...base, building: '', floor: '', search: controls.search.value});
      renderBuildingOverview(groups, {mode:'room'});
      return;
    }
    const entries = browseRooms(catalog.rooms, currentDay, {...base, freeOnly:false});
    renderRoomList(entries, {
      lead: `${label} · `, tail: '教室', countLabel: `${entries.length} 间`,
      kicker: '教室浏览', sort: '按楼层和房号排序',
      emptyTitle: '这栋楼没有匹配的教室',
      emptyDescription: searching ? '换个房号、楼层或类型试试，也可以清除搜索。' : '试试清除容量或类型筛选，或换一栋楼。',
      emptyAction: '清除筛选', onEmptyAction: clearAdditional
    });
    return;
  }

  if (!hasPeriods) {
    if (!building) {
      const groups = overviewByBuilding(catalog.rooms, currentDay, {...base, building: '', floor: '', search: controls.search.value});
      renderBuildingOverview(groups, {mode:'time'});
      return;
    }
    const entries = browseRooms(catalog.rooms, currentDay, {...base, freeOnly:true})
      .sort((a, b) => b.longest.length - a.longest.length
        || (floorOf(a.room) ?? 99) - (floorOf(b.room) ?? 99)
        || a.room.name.localeCompare(b.room.name, 'zh-CN'));
    renderRoomList(entries, {
      lead: `${label} · 今日有空 `, tail: null, countLabel: `${entries.length} 间`,
      kicker: '楼栋空教室', sort: '按连续空闲排序',
      emptyTitle: '这栋楼今天没有记录到空闲',
      emptyDescription: '可以返回楼栋概览换一栋，或先选一个节次再试。',
      emptyAction: '返回楼栋', onEmptyAction: backToBuildings
    });
    return;
  }

  const entries = selectRooms(catalog.rooms, currentDay, {...base, periods});
  renderRoomList(entries, {
    lead: '找到 ', tail: '空教室', countLabel: `${entries.length} 间`,
    kicker: '查询结果', sort: '按连续空闲排序',
    emptyTitle: '这段时间，暂时没有匹配的教室',
    emptyDescription: '试试更换节次或校区，也可以清除教学楼、搜索、容量和类型条件。',
    emptyAction: '清除附加筛选', onEmptyAction: clearAdditional
  });
}
async function loadSelectedDay() {
  if (!catalog) return;
  syncDateLabels();
  if (!dateInTerm(controls.date.value, catalog.term)) {
    controls.date.reportValidity();
    currentDay = null; hadError = false; loading = false;
    $('result-count').textContent = '';
    $('results-section').setAttribute('aria-busy','false');
    setResultsTitle('请选择学期内的日期', {tail:false});
    showState('empty','日期不在当前学期内',`可查询 ${catalog.term.startDate} 至 ${catalog.term.endDate}。`);
    return;
  }
  loading = true; hadError = false; currentDay = null;
  $('results-section').setAttribute('aria-busy','true');
  setResultsTitle('正在加载教室安排', {tail:false});
  $('result-count').textContent = '';
  showState('loading','正在加载教室安排','稍等一下，你的专注空间马上就好。');
  const date = controls.date.value;
  try {
    const result = await catalog.loader.select(date);
    if (result.stale || controls.date.value !== date) return;
    currentDay = result.day;
    loading = false;
    renderPeriodPicker();
    renderResults();
  } catch (error) {
    if (controls.date.value !== date) return;
    loading = false; hadError = true;
    $('results-section').setAttribute('aria-busy','false');
    setResultsTitle('暂时无法查询', {tail:false});
    showState('error','教室安排没有加载成功',error.message,'重新加载数据',() => initialize());
    // A catalog mismatch requires fetching a fresh manifest, not repeatedly requesting an old version.
    announce('教室安排加载失败，请重新加载数据');
  }
}
function clearAdditional() {
  controls.building.value='';
  currentFloor='';
  controls.search.value='';
  controls.capacity.value='0';
  controls.type.value='';
  renderFloorTabs();
  renderPeriodPicker();
  renderResults();
}
function backToBuildings() {
  controls.building.value='';
  currentFloor='';
  renderFloorTabs();
  renderPeriodPicker();
  renderResults();
}
function resetFilters() {
  if(!catalog)return;
  controls.campus.value='';
  updateBuildings();
  controls.building.value=''; controls.search.value=''; controls.capacity.value='0'; controls.type.value='';
  currentFloor=''; selectedPeriods.clear();
  viewMode='time';
  renderFloorTabs();
  renderPeriodPicker();
  saveCampus();
  updateViewChrome();
  const defaultDate=initialDate(catalog.term).date;
  if(controls.date.value!==defaultDate){controls.date.value=defaultDate;loadSelectedDay();}else renderResults();
}
function setView(view, {track=true}={}) {
  viewMode = view === 'room' ? 'room' : 'time';
  updateViewChrome();
  syncDateLabels();
  if (track) analytics.track('view_mode', {view: viewMode});
  renderResults();
}

function roomWeekMarkup(room, weekData) {
  const index = roomIndexById.get(room.id);
  const today = controls.date.value;
  const dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
  const rows = weekData.map(({date, day, unavailable, error}) => {
    const state = day?.rooms?.[index];
    const cells = Array.from({length:13}, (_,i) => {
      const status = !state ? 'none' : state.unknownMask & (1<<i) ? 'unknown' : state.occupiedMask & (1<<i) ? 'busy' : 'free';
      const chosen = selectedPeriods.has(i+1) ? ' chosen' : '';
      return `<td class="week-cell ${status}${chosen}" title="${dayNames[weekdayIndex(date)]} 第 ${i+1} 节 ${status === 'none' ? '无数据' : {free:'空闲',busy:'占用',unknown:'未知'}[status]}" aria-label="${dayNames[weekdayIndex(date)]} 第 ${i+1} 节 ${status === 'none' ? '无数据' : {free:'空闲',busy:'占用',unknown:'未知'}[status]}"></td>`;
    }).join('');
    return `<tr class="${date === today ? 'today' : ''}">
      <th scope="row"><button type="button" class="week-day" data-week-date="${date}" title="在主页查看 ${prettyDate(date)}">${dayNames[weekdayIndex(date)]}<small>${shortDate(date)}${unavailable ? ' · 学期外' : error ? ' · 读取失败' : ''}</small></button></th>
      ${cells}
    </tr>`;
  }).join('');
  const todayIndex = weekData.findIndex(item => item.date === today);
  const todayEntry = todayIndex >= 0 ? weekData[todayIndex] : null;
  const todayState = todayEntry?.day?.rooms?.[index];
  const intervals = todayState?.freeIntervals || [];
  const todaySummary = todayEntry?.error ? '今天的数据读取失败' : todayEntry?.unavailable ? '今天不在学期内' : intervals.length ? formatIntervals(intervals) : '今天没有整段空闲';
  const chosenCaption = selectedPeriods.size ? `描边标出你选择的${selectedPeriodText()}；` : '当前没有选择节次；';
  return `<div class="detail-top">
      <p class="dialog-location">${esc(room.campus)}<span class="location-slash">/</span>${esc(buildingLabel(room))} · ${floorLabel(floorOf(room))}</p>
      <div class="room-meta"><span>${icon('people')}${room.capacity == null ? '容量未注明' : `${esc(room.capacity)} 人`}</span>${room.type ? `<span class="type-label">${esc(room.type)}</span>` : ''}</div>
    </div>
    <div class="detail-date"><strong>${prettyDate(today)}</strong><span>第 ${teachingWeek(today,catalog.term)} 周</span></div>
    <div class="legend"><span><i></i>空闲</span><span><i class="busy"></i>占用</span><span><i class="unknown"></i>未知</span><span><i class="chosen"></i>所选</span></div>
    <div class="week-scroll">
      <table class="week-table" aria-label="本周 13 节安排">
        <thead>
          <tr class="week-groups"><th aria-hidden="true"></th><th colspan="4">上午</th><th colspan="5">下午</th><th colspan="4">晚上</th></tr>
          <tr class="week-periods"><th aria-hidden="true"></th>${Array.from({length:13},(_,i)=>`<th>${i+1}</th>`).join('')}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="week-summary">
      <strong>${prettyDate(today)}</strong>
      <span>${todaySummary}</span>
    </div>
    <p class="detail-caption">${chosenCaption}点日期可在主页查看当天。</p>
    <p class="detail-note">排课快照不保证实际开放，未知节次不算空闲。数据不含钟点时间，第 1–13 节对应学校节次。</p>`;
}
async function openRoom(roomId, trigger) {
  const room = roomById.get(roomId);
  if (!room) return;
  const index = roomIndexById.get(room.id);
  const state = currentDay?.rooms?.[index];
  if (!state) return;
  analytics.track('room_detail', {room: room.name, campus: room.campus, building: buildingLabel(room), floor: floorLabel(floorOf(room))});
  detailTrigger = trigger;
  dialogToken++;
  const token = dialogToken;
  $('dialog-title').textContent = room.name;
  $('dialog-body').className = 'dialog-body';
  $('dialog-body').innerHTML = `<div class="detail-top"><p class="dialog-location">${esc(room.campus)}<span class="location-slash">/</span>${esc(buildingLabel(room))} · ${floorLabel(floorOf(room))}</p><div class="room-meta"><span>${icon('people')}${room.capacity == null ? '容量未注明' : `${esc(room.capacity)} 人`}</span>${room.type ? `<span class="type-label">${esc(room.type)}</span>` : ''}</div></div><div class="week-loading"><span class="spinner" aria-hidden="true"></span><p>正在加载本周 7 天安排…</p></div>`;
  $('room-dialog').showModal();
  document.body.style.overflow = 'hidden';
  $('close-dialog').focus();
  const dates = weekDates(controls.date.value);
  const weekData = await Promise.all(dates.map(async date => {
    if (!dateInTerm(date, catalog.term)) return {date, unavailable: true};
    try { return {date, day: await catalog.loader.load(date)}; }
    catch { return {date, error: true}; }
  }));
  if (token !== dialogToken || !$('room-dialog').open) return;
  $('dialog-body').innerHTML = roomWeekMarkup(room, weekData);
}

async function initialize() {
  const previous = catalog ? {...baseFilters(), periods: selectedPeriodList(), date: controls.date.value, view: viewMode} : null;
  catalog=null;currentDay=null;loading=true;hadError=false;
  $('filters').disabled=true;
  $('results-section').setAttribute('aria-busy','true');
  showState('loading','正在加载教室安排','稍等一下，你的专注空间马上就好。');
  try {
    catalog=await loadCatalog();
    roomById = new Map(catalog.rooms.map(room => [room.id, room]));
    roomIndexById = new Map(catalog.rooms.map((room,index) => [room.id, index]));
    rebuildBuildingLabels();
    const {term,candidates,coverage}=catalog;
    const campuses=[...new Map(candidates.map(r=>[r.campusCode,r.campus]))].sort(([a],[b])=>a.localeCompare(b));
    controls.campus.replaceChildren(new Option('全部校区',''),...campuses.map(([value,label])=>new Option(label,value)));
    let saved='';try{saved=localStorage.getItem('roomgap-campus')||'';}catch{}
    if (previous && campuses.some(([code])=>code===previous.campus)) controls.campus.value=previous.campus;
    else if (campuses.some(([code])=>code===saved)) controls.campus.value=saved;
    updateBuildings();
    if (previous && [...controls.building.options].some(option=>option.value===previous.building)) controls.building.value=previous.building;
    renderTypeOptions();
    if (previous && [...controls.type.options].some(option=>option.value===previous.type)) controls.type.value=previous.type;
    selectedPeriods=new Set(previous?.periods ?? []);
    currentFloor=previous?.floor ?? '';
    controls.date.min=term.startDate;controls.date.max=term.endDate;
    const initial=initialDate(term);
    controls.date.value=previous&&dateInTerm(previous.date,term)?previous.date:initial.date;
    $('range-notice').hidden=!initial.outsideTerm;
    $('range-notice').textContent=`今天不在已收录学期内，当前展示本学期安排。可查询 ${term.startDate} 至 ${term.endDate}。`;
    renderFloorTabs();
    renderPeriodPicker();
    $('candidate-count').textContent=candidates.length;
    $('campus-count').textContent=campuses.length;
    $('sync-label').textContent='数据已同步';
    $('term-range').textContent=`${term.startDate.replaceAll('-','.')} — ${term.endDate.replaceAll('-','.')}`;
    const captured=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(coverage.lastCapture));
    $('data-meta').textContent=`数据快照采集于 ${captured}（北京时间）`;
    $('filters').disabled=false;
    updateViewChrome();
    await loadSelectedDay();
  } catch(error) {
    catalog=null;loading=false;hadError=true;
    $('sync-label').textContent='数据未加载';
    $('results-section').setAttribute('aria-busy','false');
    setResultsTitle('暂时无法查询', {tail:false});$('result-count').textContent='';
    $('selection-summary').textContent='数据加载完成后即可查询';
    showState('error','教室数据没有加载成功',error.message,'重试',() => initialize());
    announce('教室数据加载失败，请重试');
  }
}

$('query-form').addEventListener('submit',event=>{
  event.preventDefault();
  renderResults();
  $('results-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
});
$('view-time').addEventListener('click',()=>setView('time'));
$('view-room').addEventListener('click',()=>setView('room'));
for (const [button, other] of [[$('view-time'), $('view-room')], [$('view-room'), $('view-time')]]) {
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    setView(other === $('view-time') ? 'time' : 'room');
    other.focus();
  });
}
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
controls.campus.addEventListener('change',()=>{updateBuildings();saveCampus();currentFloor='';renderFloorTabs();renderPeriodPicker();renderResults();});
controls.building.addEventListener('change',()=>{currentFloor='';renderFloorTabs();renderPeriodPicker();renderResults();});
$('floor-tabs').addEventListener('click',event=>{
  const button=event.target.closest('button[data-floor]');
  if(!button)return;
  currentFloor=button.dataset.floor;
  renderFloorTabs();
  renderPeriodPicker();
  renderResults();
});
$('back-to-buildings').addEventListener('click',backToBuildings);
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
for(const control of [controls.capacity,controls.type])control.addEventListener('change',()=>{renderPeriodPicker();renderResults();});
controls.search.addEventListener('input',()=>{renderPeriodPicker();renderResults();});
$('previous-day').onclick=()=>{controls.date.value=moveDate(controls.date.value,-1);loadSelectedDay();};
$('next-day').onclick=()=>{controls.date.value=moveDate(controls.date.value,1);loadSelectedDay();};
$('today').onclick=()=>{controls.date.value=beijingDate();loadSelectedDay();};
$('reset-filters').onclick=resetFilters;
$('room-grid').addEventListener('click',event=>{const trigger=event.target.closest('button[data-room-id]');if(trigger)openRoom(trigger.dataset.roomId,trigger);});
$('overview-grid').addEventListener('click',event=>{
  const button=event.target.closest('button[data-building]');
  if(!button)return;
  controls.building.value=button.dataset.building;
  currentFloor='';
  renderFloorTabs();
  renderPeriodPicker();
  renderResults();
});
$('dialog-body').addEventListener('click',event=>{
  const button=event.target.closest('button[data-week-date]');
  if(!button)return;
  const date=button.dataset.weekDate;
  if(!dateInTerm(date,catalog.term))return;
  controls.date.value=date;
  $('room-dialog').close();
  loadSelectedDay();
});
$('close-dialog').onclick=()=>$('room-dialog').close();
$('room-dialog').addEventListener('click',event=>{if(event.target===$('room-dialog')){const rect=$('room-dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('room-dialog').close();}});
$('room-dialog').addEventListener('close',()=>{dialogToken++;document.body.style.overflow='';detailTrigger?.focus();detailTrigger=null;});
const authorDialog=$('author-dialog');
let authorCopyTimer;
$('author-trigger').onclick=()=>{
  authorTrigger=document.activeElement;
  clearTimeout(authorCopyTimer);
  $('author-copy-status').textContent='';
  authorDialog.showModal();
  document.body.style.overflow='hidden';
  $('close-author-dialog').focus();
};
$('copy-qq').onclick=async()=>{
  const status=$('author-copy-status');
  try {
    await navigator.clipboard.writeText('2675943788');
    status.textContent='已复制到剪贴板';
    $('copy-qq').dataset.copied='true';
    clearTimeout(authorCopyTimer);
    authorCopyTimer=setTimeout(()=>{status.textContent='';delete $('copy-qq').dataset.copied;},2400);
  } catch {
    status.textContent='复制失败，请重试';
  }
};
$('close-author-dialog').onclick=()=>authorDialog.close();
authorDialog.addEventListener('click',event=>{
  if(event.target!==authorDialog)return;
  const rect=authorDialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)authorDialog.close();
});
authorDialog.addEventListener('close',()=>{clearTimeout(authorCopyTimer);$('author-copy-status').textContent='';delete $('copy-qq').dataset.copied;document.body.style.overflow='';authorTrigger?.focus();});
const backToTop=$('back-to-top');
let scrollUpdatePending=false;
function updateBackToTop() {
  const visible=window.scrollY>Math.min(480,window.innerHeight*.65);
  document.documentElement.classList.toggle('is-scrolled',window.scrollY>12);
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
