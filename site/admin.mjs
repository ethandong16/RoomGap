const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
const timeFormat = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
const dateFormat = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai', month:'2-digit', day:'2-digit'});
const state = {days:7, authenticated:false};

function formatTime(value) { try { return timeFormat.format(new Date(value)); } catch { return '—'; } }
function formatDay(value) { try { return dateFormat.format(new Date(`${value}T00:00:00+08:00`)); } catch { return value; } }
function setError(message = '') { $('dashboard-error').textContent = message; $('dashboard-error').hidden = !message; }
function showLogin(message = '') {
  state.authenticated = false;
  $('dashboard').hidden = true;
  $('auth-panel').hidden = false;
  $('auth-error').textContent = message;
}
function showDashboard() {
  state.authenticated = true;
  $('auth-panel').hidden = true;
  $('dashboard').hidden = false;
}

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
  if (event.type === 'query') return ['提交查询', `${data.date ? `查询日期 ${data.date}` : '查询日期未知'} · ${data.campus || '全部校区'} · ${data.building || '全部教学楼'} · ${(data.periods || []).map(period => `第 ${period} 节`).join('、') || '未选节次'} · ${number(data.resultCount)} 间结果`];
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
  if (!state.authenticated) return;
  setError('');
  $('refresh-button').disabled = true;
  try {
    const response = await fetch(`/api/analytics/summary?days=${state.days}`, {cache:'no-store'});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.error || '观测数据加载失败');
    renderDashboard(payload);
  } catch (error) {
    if (error.message.includes('授权')) showLogin(error.message);
    else setError(`${error.message}。请确认 Cloudflare Pages 已绑定 D1，并完成管理环境配置。`);
  } finally { $('refresh-button').disabled = false; }
}

function collectionLabel(status) {
  return ({idle:'空闲', checking:'检查会话', waiting_for_scan:'等待扫码', establishing_session:'建立会话', collecting:'正在采集', complete:'已完成', expired:'二维码已过期', error:'任务失败'})[status] || '未知';
}

function renderCollectionStatus(payload) {
  const status = payload.active ? payload.status : (payload.persisted?.lastResult || payload.status || 'idle');
  $('collection-status').dataset.status = status;
  $('collection-status').textContent = collectionLabel(status);
  $('collection-description').textContent = payload.lastError || payload.persisted?.lastError || (status === 'waiting_for_scan' ? '二维码已通过 Bark 发送，等待扫码' : status === 'collecting' ? '正在刷新全部教室数据' : '可手动生成新的登录二维码');
  const lastSuccess = payload.persisted?.lastSuccessAt;
  $('collection-last-success').textContent = lastSuccess ? `上次成功 ${formatTime(lastSuccess)}` : '暂无成功记录';
  $('collection-trigger').disabled = Boolean(payload.active);
}

async function loadCollectionStatus() {
  if (!state.authenticated) return;
  $('collection-refresh').disabled = true;
  try {
    const response = await fetch('/api/admin/collection/status', {cache:'no-store'});
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) return showLogin('设备授权已失效，请重新验证');
    if (!response.ok) throw Error(payload.error || '采集状态读取失败');
    renderCollectionStatus(payload);
  } catch (error) {
    $('collection-status').dataset.status = 'error';
    $('collection-status').textContent = '连接失败';
    $('collection-description').textContent = error.message;
  } finally { $('collection-refresh').disabled = false; }
}

async function checkSession() {
  try {
    const response = await fetch('/api/admin/session', {cache:'no-store'});
    if (!response.ok) return showLogin();
    showDashboard();
    await Promise.all([loadDashboard(), loadCollectionStatus()]);
  } catch { showLogin('无法连接管理认证服务'); }
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

$('auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const token = $('admin-token').value.trim();
  $('auth-error').textContent = token ? '' : '请输入管理令牌';
  if (!token) return;
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    const response = await fetch('/api/admin/session', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({token})});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.error || '设备验证失败');
    $('admin-token').value = '';
    showDashboard();
    await Promise.all([loadDashboard(), loadCollectionStatus()]);
  } catch (error) { $('auth-error').textContent = error.message; }
  finally { if (button) button.disabled = false; }
});
document.querySelector('.range-picker').addEventListener('click', event => {
  const button = event.target.closest('button[data-days]');
  if (!button) return;
  state.days = Number(button.dataset.days);
  document.querySelectorAll('.range-picker button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  loadDashboard();
});
$('refresh-button').addEventListener('click', loadDashboard);
$('collection-refresh').addEventListener('click', loadCollectionStatus);
$('collection-trigger').addEventListener('click', async () => {
  if (!confirm('生成新的登录二维码并通过 Bark 推送？二维码约 3 分钟有效。')) return;
  $('collection-trigger').disabled = true;
  try {
    const response = await fetch('/api/admin/collection/trigger', {method:'POST'});
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) return showLogin('设备授权已失效，请重新验证');
    if (!response.ok) throw Error(payload.error || payload.reason || '二维码触发失败');
    await loadCollectionStatus();
  } catch (error) { setError(error.message); $('collection-trigger').disabled = false; }
});
$('logout-button').addEventListener('click', async () => {
  await fetch('/api/admin/session', {method:'DELETE'}).catch(()=>{});
  showLogin();
  $('admin-token').value = '';
  $('admin-token').focus();
});
document.querySelector('.theme-switcher').addEventListener('click', event => {
  const button = event.target.closest('button[data-theme]');
  if (button) applyTheme(button.dataset.theme);
});
applyTheme(document.documentElement.dataset.themePreference || 'system', false);
checkSession();
