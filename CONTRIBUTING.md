# 参与开发

## 本地验证

需要 Node.js 20+，推荐 22 / 24 LTS。

```bash
npm ci
npm test
npm run build:data
npm run build:web
npm run test:web
```

Linux 还需执行 `npm run test:runner`。测试使用临时文件、本地替身和本地裸仓库检查依赖预检、任务互斥、失败阶段、通知失败以及 Git 提交范围和推送重试，不登录学校、不发送真实通知、不推送外部仓库。Windows 会跳过这个 Linux 专用测试集。

`build:data` 会根据原始快照重新生成数据并改变 `coverage.generatedAt`。只改代码时，提交前检查 diff，避免夹带无意的数据变更。

UI 修改可在启动 `npm run preview` 后运行 `npm run test:browser`，需已安装 Chrome。截图和测试报告生成在 `artifacts/`，不进入 Git。部分浏览器断言使用当前学期的固定场景，更换学期或数据时需要核对预期，不能只为通过测试而改计数。

## 修改约定

- 数据计算共用根目录的 `semester-model.mjs`；`site/semester-model.mjs` 是开发时的导入桥，构建时复制共享模块，不维护第二份计算逻辑。
- 学校接口的空校区、空楼栋查询仅用于目录，不能据此推算全校空闲。
- 校验失败、未知节次和不匹配的目录版本必须阻止错误推荐。
- 采集入口、参数或数据字段变化时同步更新 `docs/` 和 `deploy/`。
- 提交前用 `git diff --check` 检查格式，并确认没有 Cookie、浏览器配置、Bark Key 或个人调试响应。

## 提交问题与变更

Issue 请给出系统和 Node 版本、复现步骤、预期与实际行为、脱敏后的错误日志。排课差异请注明日期、校区、楼栋、节次和网页显示的采集时间，不要附课程人员信息或账号会话。

Pull Request 说明具体问题、最终行为和验证结果；尽量将代码变更与单纯的数据快照刷新分开。CI 会重新计算数据、验证完整性并构建网站，无需提交 `dist/`。

## 许可

提交的代码和文档按本项目 [MIT License](LICENSE) 提供。学校来源数据的原有权利与使用条件独立于代码许可。
