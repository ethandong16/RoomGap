// Run with the already connected browser Tab, inside the browser tool's session.
// This module does not initialize another browser, read credentials, or call hidden APIs.
export async function createCollector(tab, fs, outputDir) {
  const indexUrl = 'http://jwxtxs.tust.edu.cn:46110/student/teachingResources/classroomUseStatus/index';
  await fs.mkdir(outputDir, { recursive: true });
  const write = async (name, value) => fs.writeFile(`${outputDir}/${name}`, JSON.stringify(value, null, 2), 'utf8');
  const listing = async () => {
    if (await tab.url() !== indexUrl) await tab.goto(indexUrl);
    await tab.playwright.locator('#jxlBody').waitFor({ state: 'visible' });
    return tab.playwright.locator('#jxlBody').evaluate(el => {
      let campus = '';
      return Array.from(el.querySelectorAll('tr')).map((row, rowIndex) => {
        const cells = Array.from(row.cells);
        if (cells.length === 4) campus = cells[1].innerText.trim();
        const button = row.querySelector('[id="td_div"]');
        if (!button) {
          if (cells.length > 1) campus = cells[1].innerText.trim();
          return { rowIndex, campus, building: null, queryable: false };
        }
        return { rowIndex, campus, building: cells[cells.length - 2].innerText.trim(), queryable: true };
      });
    });
  };
  const buildings = await listing();
  await write('buildings.json', { source: indexUrl, capturedAt: new Date().toISOString(), buildings });
  const capture = async () => tab.playwright.evaluate(() => {
    const table = document.getElementById('classroomInfoTable');
    const body = document.getElementById('classroomInfoTableBody');
    if (!table || !body) throw new Error('Occupancy table missing');
    const cellData = cell => ({
      text: cell.innerText.trim(), rowSpan: cell.rowSpan, colSpan: cell.colSpan,
      background: getComputedStyle(cell).backgroundColor,
      cssClass: cell.className,
      children: Array.from(cell.children).map(child => ({
        text: child.innerText?.trim() || '',
        background: getComputedStyle(child).backgroundColor,
        cssClass: child.className
      }))
    });
    const labels = ['有课', '考试', '实验', '借用', '空闲'];
    const legend = Array.from(document.querySelectorAll('li')).filter(el => labels.includes(el.innerText.trim())).map(el => ({
      label: el.innerText.trim(), background: getComputedStyle(el).backgroundColor,
      children: Array.from(el.children).map(c => ({ background: getComputedStyle(c).backgroundColor, text: c.innerText.trim() }))
    }));
    const dateInput = document.getElementById('searchDate');
    return {
      capturedAt: new Date().toISOString(), url: location.href,
      queryDate: dateInput?.value || null,
      displayedHeader: document.getElementById('classInfoTableHead')?.innerText || '',
      headings: Array.from(document.querySelectorAll('h4')).map(h => h.innerText.trim()),
      dateBounds: { min: dateInput?.getAttribute('min'), max: dateInput?.getAttribute('max'), readonly: dateInput?.readOnly },
      legend,
      rows: Array.from(body.querySelectorAll('tr')).map(row => Array.from(row.cells).map(cellData))
    };
  });
  async function collectBuilding(building, dates = null) {
    const currentList = await listing();
    const match = currentList[building.rowIndex];
    if (!match || match.campus !== building.campus || match.building !== building.building || !match.queryable) {
      throw new Error('Building listing changed; refresh the inventory before collecting');
    }
    await tab.playwright.locator('#jxlBody').locator('tr').nth(building.rowIndex).getByRole('button').click();
    await tab.playwright.locator('#classroomInfoTable').waitFor({ state: 'visible' });
    let snapshot = await capture();
    const datesToRead = dates || [snapshot.queryDate];
    const saved = [];
    for (const date of datesToRead) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('A verified ISO date is required');
      if (date !== snapshot.queryDate) {
        // Stop on a readonly picker; do not silently bypass its date restrictions.
        if (snapshot.dateBounds.readonly) throw new Error('Date input is readonly; use the observed calendar UI to select dates');
        await tab.playwright.locator('#searchDate').fill(date);
        await tab.playwright.locator('#btn-query').click();
        await tab.playwright.locator('#classInfoTableHead').getByText(date, {exact:false}).waitFor({state:'visible'});
        snapshot = await capture();
      }
      if (snapshot.queryDate !== date || !snapshot.displayedHeader.includes(date)) throw new Error('Query date and result date do not match');
      const filename = `building-${building.rowIndex}-${date}.json`;
      await write(filename, { building, ...snapshot, normalization: 'raw; colors and merged cells require validation before deriving availability' });
      saved.push({ filename, rows: snapshot.rows.length, date });
    }
    return saved;
  }
  return { buildings, capture, collectBuilding };
}
