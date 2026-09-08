import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve('data');
const output = join(root, 'daily');
const indexUrl = 'http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/index';
const startDate = '2026-08-31';
const endDate = '2027-01-17';
const dayNumber = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
const isoDay = day => new Date(day * 86400000).toISOString().slice(0, 10);
const dates = Array.from({length: dayNumber(endDate) - dayNumber(startDate) + 1}, (_, i) => isoDay(dayNumber(startDate) + i));
const exists = async path => { try { await access(path); return true; } catch { return false; } };
await mkdir(output, {recursive: true});

// Separate browser profile; never read or copy the user's existing credentials.
const { chromium } = await import(process.env.ROOMGAP_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ROOMGAP_PLAYWRIGHT_MODULE).href : 'playwright');
const context = await chromium.launchPersistentContext(resolve('.roomgap-browser'), {
  channel: 'chrome', headless: false, viewport: null,
  args: ['--window-position=80,80', '--window-size=1200,850'],
});
const page = context.pages()[0] || await context.newPage();
await page.bringToFront();
page.setDefaultTimeout(30000);
await page.goto(indexUrl, {waitUntil: 'domcontentloaded'});
console.log('LOGIN_WAIT: 请在新Chrome窗口登录并打开教室使用状况查询；检测到目录后自动继续。');
while (!await page.locator('#jxlBody').isVisible()) {
  if (page.isClosed()) throw new Error('登录窗口已关闭');
  await page.locator('#jxlBody').waitFor({state: 'visible', timeout: 30000}).catch(() => {});
}
console.log('LOGIN_READY: 已检测到教学楼目录');

const inventory = await page.locator('#jxlBody').evaluate(el => {
  let campus = '';
  return Array.from(el.querySelectorAll('tr')).map((row, rowIndex) => {
    const cells = Array.from(row.cells);
    if (cells.length === 4) campus = cells[1].innerText.trim();
    const queryable = Boolean(row.querySelector('[id="td_div"]'));
    if (!queryable && cells.length > 1) campus = cells[1].innerText.trim();
    return {rowIndex, campus, building: queryable ? cells[cells.length - 2].innerText.trim() : null, queryable};
  });
});
if (!inventory.length) throw new Error('没有教学楼目录，停止采集');
await writeFile(join(root, 'daily-inventory.json'), JSON.stringify(inventory, null, 2));
const manifest = {
  startDate, endDate, weeks: 20, rangeBasis: '用户提供的开课日期及暂定20周，未核实官方校历',
  complete: false, expectedBuildingDays: inventory.filter(b => b.queryable).length * dates.length,
  completedBuildingDays: 0, failures: [], emptyBuildingDays: 0, startedAt: new Date().toISOString(),
};
const saveManifest = async () => writeFile(join(root, 'daily-manifest.json'), JSON.stringify(manifest, null, 2));
await saveManifest();

async function settle() {
  // Wait for actual page requests and then check the rendered table.
  await page.waitForLoadState('networkidle', {timeout: 30000});
  await page.locator('#classroomInfoTable').waitFor({state: 'visible'});
}

async function displayedDate() {
  const text = await page.locator('#classInfoTableHead').innerText();
  const match = text.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error('结果表头没有日期');
  return match[0];
}

async function moveTo(date) {
  let current = await displayedDate();
  let steps = 0;
  while (current !== date) {
    if (++steps > 160) throw new Error('日期导航超出预期步数');
    const direction = dayNumber(date) > dayNumber(current) ? 1 : -1;
    const expected = isoDay(dayNumber(current) + direction);
    // Both arrows have been observed on the school's rendered table header.
    const arrow = page.locator(direction > 0 ? '#classInfoTableHead a:has(.fa-angle-double-right)' : '#classInfoTableHead a:has(.fa-angle-double-left)');
    if (await arrow.count() !== 1) throw new Error('日期箭头结构改变，需要重新检查页面');
    await arrow.click();
    await page.locator('#classInfoTableHead').getByText(expected, {exact: false}).waitFor({state: 'visible'});
    await settle();
    current = await displayedDate();
    if (current !== expected) throw new Error('日期切换结果不匹配');
  }
}

async function capture(date, building) {
  const value = await page.evaluate(() => {
    const table = document.getElementById('classroomInfoTableBody');
    const header = document.getElementById('classInfoTableHead');
    if (!table || !header) throw new Error('教室表格缺失');
    const colors = new Map(Array.from(document.querySelectorAll('li'))
      .filter(el => ['有课','考试','实验','借用'].includes(el.innerText.trim()))
      .map(el => [getComputedStyle(el).backgroundColor, el.innerText.trim()]));
    if (colors.size !== 4) throw new Error('颜色图例不完整');
    const rows = Array.from(table.querySelectorAll('tr')).map(row => {
      const cells = Array.from(row.cells);
      if (cells.length !== 16 || cells.some(c => c.rowSpan !== 1 || c.colSpan !== 1)) {
        throw new Error('表格列数或合并结构改变，需要复核，未将其判为空闲');
      }
      const stripe = getComputedStyle(cells[0]).backgroundColor;
      const periods = cells.slice(3).map(cell => {
        const background = getComputedStyle(cell).backgroundColor;
        if (colors.has(background)) return colors.get(background);
        if (!cell.innerText.trim() && !cell.children.length && cell.classList.contains('td-b') && background === stripe) return '空闲';
        return '未知';
      });
      const freeIntervals = [];
      for (let i = 0; i < periods.length; i++) {
        if (periods[i] !== '空闲') continue;
        const startPeriod = i + 1;
        while (i + 1 < periods.length && periods[i + 1] === '空闲') i++;
        freeIntervals.push({startPeriod, endPeriod: i + 1});
      }
      return {name: cells[0].innerText.trim(), capacity: /^\d+$/.test(cells[1].innerText.trim()) ? Number(cells[1].innerText.trim()) : null,
        type: cells[2].innerText.trim() || null, periods, freeIntervals};
    });
    return {header: header.innerText, inputDate: document.getElementById('searchDate')?.value, rows};
  });
  if (!value.header.includes(date) || value.inputDate !== date) throw new Error('输入日期与结果表头不匹配');
  const seen = new Set();
  for (const room of value.rows) {
    if (!room.name || seen.has(room.name)) throw new Error('空教室名称或重复教室名称，需要复核');
    seen.add(room.name);
    if (room.periods.includes('未知')) throw new Error('存在未知颜色，停止将本页计入完整覆盖');
  }
  return {building, date, capturedAt: new Date().toISOString(), source: page.url(),
    status: value.rows.length ? 'captured' : 'empty_table_unverified', rooms: value.rows};
}

try {
  for (const building of inventory.filter(b => b.queryable)) {
    const pending = [];
    for (const date of dates) {
      const filename = join(output, `building-${building.rowIndex}-${date}.json`);
      if (await exists(filename)) {
        const old = JSON.parse(await readFile(filename, 'utf8'));
        if (old.date === date && old.status === 'captured' && old.building.campus === building.campus && old.building.building === building.building) {
          manifest.completedBuildingDays++;
          continue;
        }
      }
      pending.push(date);
    }
    if (!pending.length) continue;
    await page.goto(indexUrl, {waitUntil: 'domcontentloaded'});
    await page.locator('#jxlBody').waitFor({state: 'visible'});
    const row = page.locator('#jxlBody tr').nth(building.rowIndex);
    if (building.building && !(await row.innerText()).includes(building.building)) throw new Error('教学楼目录顺序发生变化');
    await row.getByRole('button').click();
    await settle();
    for (const date of pending) {
      await moveTo(date);
      const snapshot = await capture(date, building);
      await writeFile(join(output, `building-${building.rowIndex}-${date}.json`), JSON.stringify(snapshot));
      if (snapshot.status === 'captured') manifest.completedBuildingDays++;
      else manifest.emptyBuildingDays++;
      manifest.lastSaved = {building, date};
      await saveManifest();
      console.log(`${manifest.completedBuildingDays}/${manifest.expectedBuildingDays} ${building.campus} ${building.building || '(无名资源)'} ${date}: ${snapshot.rooms.length}间`);
    }
  }
  manifest.complete = manifest.completedBuildingDays === manifest.expectedBuildingDays;
  manifest.finishedAt = new Date().toISOString();
} catch (error) {
  manifest.failures.push({at: new Date().toISOString(), message: error.message});
  console.error('采集已暂停，已保存的数据可断点续采：', error.message);
  process.exitCode = 1;
} finally {
  await saveManifest();
  await context.close();
}
