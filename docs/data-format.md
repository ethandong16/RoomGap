# 数据格式与复核

网站使用 `data/dataset`。`data/semester` 是逐楼逐日查询得到的必要原始占用记录，用来复核或重新计算；它没有课程名称、教师或学生资料。

## 文件

| 文件 | 内容 |
| --- | --- |
| `rooms.json` | 学校教室ID、校区、楼栋、房间、容量、类型、资源类别 |
| `term.json` | 官方接口返回的开课日、20周、13节及考试节次对应关系 |
| `days/YYYY-MM-DD.json` | 每间教室当天的空闲、占用、未知节次及连续空闲区间 |
| `coverage.json` | 日期和楼栋覆盖情况、缺失项、异常、采集时间 |
| `schema.json` | 格式版本、教室目录摘要及节次编码说明 |

开始使用前，检查 `coverage.json` 的 `complete` 为 `true`。同时检查 `unknownRoomDays` 和 `anomalies`；即使数据已采全，也不能把无法解析的状态当作空闲。

每天的 `rooms[].room` 是 `rooms.json` 的数组下标（从0开始）。`catalogDigest` 必须与同包 `schema.json` 一致，不要混用不同版本的目录和每日文件。

## 按节次查询

每天共13节，第n节对应位 `1 << (n - 1)`。`freeMask`、`occupiedMask`、`unknownMask` 分别表示空闲、占用和未知。

`freeIntervals: [[3,4],[9,13]]` 表示第3–4节、第9–13节连续空闲，端点均包含。它不表示钟点时间；当前来源没有采集到学校铃声时间表。

以下判断用于查询指定连续节次：

```js
let required = 0;
for (let n = startPeriod; n <= endPeriod; n++) required |= 1 << (n - 1);
const available = (roomDay.freeMask & required) === required;
```

命令行示例：`node query-free.mjs 2026-09-08 1 4 泰达西院`。

## 显示范围

`resourceKind` 根据学校类型、房间名称及楼栋备注区分：

- `classroom`：普通、多媒体、智慧教室等候选教室。
- `unspecified`：学校未明确填写类型，需结合实际使用。
- `special-purpose`：实验、实训、机房等专用场所，默认不作为普通自习室推荐。
- `virtual`：网络、虚拟、直播等资源，排除自习推荐。
- `sports`：体育场地，排除自习推荐。

无已记录占用不代表门已开、允许自习或没有临时活动。网站应展示采集时间；未来调课、考试和借用变更需要刷新数据。

## 复核依据

仅使用指定校区和楼栋的 `classroomUseStatus/jasInfo` 查询占用。验证发现该接口在校区/楼栋为空时虽然返回全校教室目录，却没有正确返回占用记录，因此“全校空过滤条件”的结果只用于目录，不用于推算空闲。

考试节次通过学校返回的映射换算；占用重叠取并集。未知占用模块仍计为占用，无法换算的节次计为未知。目录外的房间占用记录保存在原始数据并在覆盖报告列出，不产生这些房间的空闲推荐。
