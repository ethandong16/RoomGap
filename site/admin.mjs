const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
const timeFormat = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const dateFormat = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit'});
const state = {token:'', days:7};

function formatTime(value) { try { return timeFormat.format(new Date(value)); } catch { return '—'; } }
function formatDay(value) { try { return dateFormat.format(new Date(`${value}T00:00:00+08:00`)); } catch { return value; } }
function setError(message = '') { $('dashboard-error').textContent = message; $('dashboard-error').hidden = !message; }

function renderMetrics(metrics) {
  $('metric-visits').textContent = number(metrics.visits);
  $('metric-sessions').textContent = number(metrics.sessions);
  $('metric-queries').textContent = number(metrics.queries);
  $('metric-details').textContent = number(metrics.details);
}

function renderTrend(daily) {
  const max = Math.max(1, ...daily.flatMap(day => [day.visits, day.queries]));
  $('trend-bars').innerHTML = daily.map(day => {
    const visitHeight = Math.max(2, Math.round(day.visits / max * 143));
    const queryHeight = Math.max(2, Math.round(day.queries / max * 143));
    return `<div class="trend-day" title="${esc(day.date)}：访问 ${number(day.visits)}，查询 ${number(day.queries)}"><div class="bar-stack"><i class="bar" style="height:${visitHeight}px"></i><i class="bar query" style="height:${queryHeight}px"></i></div><output>${number(day.visits + day.queries)}</output><label>${esc(formatDay(day.date))}</label></div>`;
  }).join('');
}

function renderRankList(id, rows) {
  const target = $(id);
  if (!rows?.length) { target.innerHTML = '<p class="empty-list">暂无数据</p>'; return; }
  const max = Math.max(1, ...rows.map(row => row.count));
  target.innerHTML = rows.map((row, index) => `<div class="rank-row"><span>${String(index + 1).padStart(2, '0')}</span><span class="rank-label" title="${esc(row.label)}">${esc(row.label)}</span><strong class="rank-count">${number(row.count)}</strong><span class="rank-track"><i style="width:${Math.max(5, Math.round(row.count / max * 100))}%"></i></span></div>`).join('');
}

function eventDescription(event) {
  const data = event.data || {};
  if (event.type === 'page_view') return ['访问首页', '打开查询页面'];
  if (event.type === 'query') return ['提交查询', `${data.campus || '全部校区'} · ${data.building || '全部教学楼'} · ${(data.periods || []).map(period => `第 ${period} 节`).join('、') || '未选节次'} · ${number(data.resultCount)} 间结果`];
  if (event.type === 'room_detail') return ['查看详情', `${data.campus || '未知校区'} · ${data.building || '未知教学楼'} · ${data.room || '未知教室'}`];
  if (event.type === 'theme_change') return ['切换主题', data.theme || 'system'];
  return [event.type, ''];
}

function renderRecent(events) {
  $('recent-count').textContent = `最近 ${events.length} 条`;
  $('recent-events').innerHTML = events.length ? events.map(event => {
    const [label, detail] = eventDescription(event);
    return `<tr><td>${esc(formatTime(event.timestamp))}</td><td>${esc(label)}</td><td>${esc(String(event.sessionId || '').slice(0, 10) || '—')}</td><td class="event-detail">${esc(detail)}<small>${esc(event.path || '/')}</small></td></tr>`;
  }).join('') : '<tr><td colspan="4" class="empty-list">这个时间范围还没有访问记录</td></tr>';
}

function renderDashboard(payload) {
  renderMetrics(payload.metrics || {});
  renderTrend(payload.daily || []);
  renderRankList('popular-campuses', payload.popular?.campuses);
  renderRankList('popular-buildings', payload.popular?.buildings);
  renderRankList('popular-periods', payload.popular?.periods);
  renderRankList('popular-rooms', payload.popular?.rooms);
  renderRecent(payload.recent || []);
  $('last-updated').textContent = `更新于 ${formatTime(payload.generatedAt)}`;
}

async function loadDashboard() {
  if (!state.token) return;
  setError('');
  $('refresh-button').disabled = true;
  try {
    const response = await fetch(`/api/analytics/summary?days=${state.days}`, {headers:{'x-roomgap-admin-token':state.token}, cache:'no-store'});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.error || '观测数据加载失败');
    renderDashboard(payload);
    $('auth-panel').hidden = true;
    $('dashboard').hidden = false;
  } catch (error) {
    if (error.message.includes('令牌')) {
      state.token = '';
      try { sessionStorage.removeItem('roomgap-admin-token'); } catch {}
      $('auth-panel').hidden = false;
      $('dashboard').hidden = true;
      $('auth-error').textContent = error.message;
    } else setError(`${error.message}。请确认预览服务已启用观测 API。`);
  } finally { $('refresh-button').disabled = false; }
}

function applyTheme(preference, persist = true) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const selected = ['system', 'light', 'dark'].includes(preference) ? preference : 'system';
  const theme = selected === 'system' ? (media.matches ? 'dark' : 'light') : selected;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themePreference = selected;
  document.querySelectorAll('.theme-switcher button').forEach(button => button.setAttribute('aria-checked', String(button.dataset.theme === selected)));
  if (persist) try { localStorage.setItem('roomgap-theme', selected); } catch {}
}

$('auth-form').addEventListener('submit', event => {
  event.preventDefault();
  const token = $('admin-token').value.trim();
  $('auth-error').textContent = token ? '' : '请输入管理令牌';
  if (!token) return;
  state.token = token;
  try { sessionStorage.setItem('roomgap-admin-token', token); } catch {}
  loadDashboard();
});
document.querySelector('.range-picker').addEventListener('click', event => {
  const button = event.target.closest('button[data-days]');
  if (!button) return;
  state.days = Number(button.dataset.days);
  document.querySelectorAll('.range-picker button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  loadDashboard();
});
$('refresh-button').addEventListener('click', loadDashboard);
$('logout-button').addEventListener('click', () => {
  state.token = '';
  try { sessionStorage.removeItem('roomgap-admin-token'); } catch {}
  $('dashboard').hidden = true;
  $('auth-panel').hidden = false;
  $('admin-token').value = '';
  $('admin-token').focus();
});
document.querySelector('.theme-switcher').addEventListener('click', event => {
  const button = event.target.closest('button[data-theme]');
  if (button) applyTheme(button.dataset.theme);
});
applyTheme(document.documentElement.dataset.themePreference || 'system', false);
try { state.token = sessionStorage.getItem('roomgap-admin-token') || ''; } catch {}
if (state.token) loadDashboard();
