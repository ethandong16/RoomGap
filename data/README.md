# 数据快照

`semester/` 保留逐楼逐日的原始占用快照，`dataset/` 是经过计算和校验的网站数据。两者成套提交，便于重建和复核。原始记录不含课程名称、教师、学生资料或登录凭据。

状态以自动生成的文件为准，不在文档中维护一份容易过期的计数：

- [采集 manifest](semester/manifest.json)：查询范围、完成数、失败记录。
- [覆盖报告](dataset/coverage.json)：教室数、楼栋日覆盖、缺失、未知、异常和采集时间区间。
- [数据格式](../docs/data-format.md)：目录、节次掩码与类别说明。
- [刷新与采集](../docs/collection.md)、[网站发布](../docs/deployment.md)。

在仓库根目录执行 `node verify-dataset.mjs` 检查此快照。网站显示的采集时间使用 `lastCapture`；它是包内原始快照中最晚一次内容采集时间。内容未变化的刷新会保留旧 `capturedAt`，因此它不能代表本轮完整检查时间；本轮运行时间查看 `semester/manifest.json` 的 `startedAt` / `finishedAt`。

学校来源数据不因项目代码采用 MIT 而改变原有权利和使用条件。无已记录占用不代表实际开放；网站不推荐虚拟、体育及专用资源，目录外的占用编号仅保留供复核。
