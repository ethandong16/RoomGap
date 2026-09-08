import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Keep unknown states explicit. Never infer other dates from one day's timetable.
export function normalizeSnapshot(snapshot) {
  if (!snapshot.displayedHeader.includes(snapshot.queryDate)) throw new Error('Result date mismatch');
  const legend = new Map(snapshot.legend.filter(x => x.label !== '空闲').map(x => [x.background, x.label]));
  if (legend.size !== 4 || !snapshot.legend.some(x => x.label === '空闲')) throw new Error('Incomplete legend');
  const grid = [];
  snapshot.rows.forEach((row, r) => {
    grid[r] ||= [];
    let col = 0;
    for (const cell of row) {
      while (grid[r][col]) col++;
      for (let y = 0; y < cell.rowSpan; y++) for (let x = 0; x < cell.colSpan; x++) {
        grid[r + y] ||= [];
        if (grid[r + y][col + x]) throw new Error('Overlapping merged cells');
        grid[r + y][col + x] = cell;
      }
      col += cell.colSpan;
    }
  });
  return grid.map(row => {
    if (row.length !== 16 || row.some(x => !x)) throw new Error('Expected 3 room columns and 13 periods');
    const periods = row.slice(3).map(cell => {
      if (legend.has(cell.background)) return legend.get(cell.background);
      if (cell.children.length || cell.text || !cell.cssClass.split(/\s+/).includes('td-b')) return '未知';
      // An empty period uses the same stripe background as its room label.
      return cell.background === row[0].background ? '空闲' : '未知';
    });
    const freeIntervals = [];
    for (let i = 0; i < periods.length; i++) {
      if (periods[i] !== '空闲') continue;
      const first = i + 1;
      while (i + 1 < periods.length && periods[i + 1] === '空闲') i++;
      freeIntervals.push({ startPeriod: first, endPeriod: i + 1 });
    }
    return {
      roomId: `${snapshot.building.campus}/${snapshot.building.building}/${row[0].text}`,
      campus: snapshot.building.campus, building: snapshot.building.building,
      name: row[0].text, capacity: /^\d+$/.test(row[1].text) ? Number(row[1].text) : null,
      type: row[2].text || null, date: snapshot.queryDate, periods, freeIntervals,
      capturedAt: snapshot.capturedAt
    };
  });
}

const root = resolve('data');
const snapshots = (await readdir(join(root, 'raw'))).filter(name => /^building-\d+-\d{4}-\d{2}-\d{2}\.json$/.test(name));
const records = [];
for (const name of snapshots) records.push(...normalizeSnapshot(JSON.parse(await readFile(join(root, 'raw', name), 'utf8'))));
await mkdir(join(root, 'normalized'), { recursive: true });
await writeFile(join(root, 'normalized', 'room-days.json'), JSON.stringify({
  scope: { start: '2026-08-31', end: '2027-01-17', weeks: 20, basis: '用户提供开课日及暂定20周；学校校历未核实' },
  coverage: { snapshots: snapshots.length, roomDays: records.length, complete: false },
  note: '无记录日期为未知。空闲只表示该节无排课或其他已显示占用，不保证教室开放。尚无节次钟点表。', records
}, null, 2), 'utf8');
console.log(JSON.stringify({ snapshots: snapshots.length, roomDays: records.length, periods: records.length * 13, unknownPeriods: records.reduce((n,r) => n + r.periods.filter(s => s === '未知').length, 0) }));
