# Reference Creation Controls Status

## Checkpoint: 2026-08-03 00:10 +08:00

- 当前目标：把参考仓库截图对应的空图片节点工具栏、紧凑 AI 生成配置和大型画布创作框迁移到当前产品，同时保留现有持久化、三用户密钥、开放模型、类型化参考上下文和生成结果契约。
- 已完成：创建 Codex 活动目标；按规定读取恢复文档；确认本地与 `origin/codex/infinite-canvas` 均为 `bd3635825cb4a9afc9b91502a0ce59380528dc91` 且工作树起始干净；确认真实 `3102/5182` HTTP 200、`3000/5174` 未占用；检查当前 `CanvasNodeView`、AI 生成函数、持久化字段、节点工具栏与聚焦测试；检查本地 AGPL 参考仓库对应 toolbar/config/composer 组件，只提取行为和层级，不逐行复制。
- 未完成：添加聚焦失败契约；实现空图片工具栏、紧凑 AI 配置卡和大型画布创作框；运行聚焦测试、完整测试、build、差异/秘密检查；使用隔离浏览器完成桌面/移动端深浅主题、交互、溢出和 console 验收；清理夹具并写最终检查点。
- 最后验证结果：本目标尚未修改产品代码或运行修改后测试；上一交付基线 `npm.cmd test` 为 `58/58`、build 和 `git diff --check` 通过。当前只读健康检查确认 API `3102` 与前端 `5182` 均返回 HTTP 200。
- 修改文件：当前仅修改 `GOALS.md`、`PLAN.md`、`STATUS.md` 并新增本文件；起始工作树干净，没有接手前未提交修改。预计产品范围为 `src/App.tsx`、`src/styles/canvas-nodes-reference.css` 和 `tests/ai-creation-contract.test.mjs`，必要时才添加一个小型纯前端 helper。
- 下一步：读取当前 AI 节点数据注入和参考 composer 的定位方式，先在 `tests/ai-creation-contract.test.mjs` 添加三个聚焦契约，再做最小产品修改。
- 恢复命令：`Set-Location 'C:\Users\Administrator\Documents\无限画布'`; `Get-Content -Encoding UTF8 HANDOFF.md`; `Get-Content -Encoding UTF8 GOALS.md`; `Get-Content -Encoding UTF8 PLAN.md`; `Get-Content -Encoding UTF8 STATUS.md`; `Get-Content -Encoding UTF8 coordination/STATUS-reference-creation-controls.md`; `git status --short --branch`; `git diff -- GOALS.md PLAN.md STATUS.md coordination/STATUS-reference-creation-controls.md src/App.tsx src/styles/canvas-nodes-reference.css tests/ai-creation-contract.test.mjs`; `node --test tests/ai-creation-contract.test.mjs`。

## Checkpoint: 2026-08-03 implementation complete, browser acceptance active

- 当前目标：完成空图片节点三操作工具栏、紧凑 AI 配置节点和跟随节点的大型创作框，并以隔离数据完成桌面/移动端深浅主题浏览器验收。
- 已完成：`src/App.tsx` 已增加瞬时 `composerNodeId`、DOM-owned/IME-safe `AIComposerPanel`、现有 `runAI/runImage/runVideo` 回调复用、参考图预览和计数；空图片节点已改为 `信息 / 删除 / 上传图片` 工具栏并保留原上传、地址、压缩和持久化路径；AI 默认/最小高度已压缩；`src/styles/canvas-nodes-reference.css` 已补齐浅色、深色和移动端约束；聚焦测试新增三项并通过。
- 未完成：完成隔离浏览器桌面 `1440x1000`、移动端 `390x844`、深浅主题、节点跟随、溢出与 console 验收；清理临时画布；同步最终项目状态并写最终检查点。
- 最后验证结果：`node --test tests/ai-creation-contract.test.mjs` 通过 `20/20`；`npm.cmd run build` 通过；`npm.cmd test` 通过 `61/61`；`git diff --check` 通过，仅有仓库既有的 LF/CRLF 提示；源码与文档扫描未发现新增密钥值或 Authorization 内容。
- 修改文件：`GOALS.md`、`PLAN.md`、`STATUS.md`、`coordination/STATUS-reference-creation-controls.md`、`src/App.tsx`、`src/styles/canvas-nodes-reference.css`、`tests/ai-creation-contract.test.mjs`。
- 下一步：在 `http://localhost:5182/` 的隔离来源中创建一次性画布，添加空图片和 AI 节点、建立图片上下文连接，验证创作框与响应式布局后删除夹具。
- 恢复命令：`Set-Location 'C:\Users\Administrator\Documents\无限画布'`; `git status --short --branch`; `git diff --check`; `node --test tests/ai-creation-contract.test.mjs`; `npm.cmd run build`; `npm.cmd test`; `Get-Content -Encoding UTF8 coordination/STATUS-reference-creation-controls.md`。

## Checkpoint: 2026-08-03 01:19 +08:00

- 当前目标：完成参考创建控件的最终浏览器验收与夹具清理，确认空图片节点工具栏、紧凑 AI 节点和大型创作框在桌面/移动端、深浅主题、节点移动与画布缩放下均可用。
- 已完成：产品实现已落盘；大型创作框使用瞬时 `composerNodeId`，复用现有文字/图片/视频生成回调和最多四张类型化参考图；提示词 textarea 在 IME 组合期间由 DOM 持有；空图片节点使用 `信息 / 删除 / 上传图片` 三操作工具栏；AI 节点默认 `336x216`、最小 `300x190`。初轮桌面验收已确认 AI 节点尺寸、空图片加载、图片到 AI 的 `context` 连接、`参考图 1`/`1 张参考图` 显示，以及深色主题左右连接点分别为青绿色和蓝色。初版创作框在右缘溢出后，定位逻辑已改为打开时计算、`ResizeObserver` 监听尺寸、`pointermove`/`wheel`/窗口 `resize` 经 `requestAnimationFrame` 节流重算；已移除创作框中会自触发的 `MutationObserver`。
- 未完成：在干净浏览器标签验证事件驱动版本不会忙循环或崩溃；验证右缘夹取、节点拖动后跟随、滚轮缩放后跟随；输入单个 `，` 并确认长度为 1；完成浅色主题和 `390x844` 移动端溢出、重叠、console 验收；删除 `localhost:5182` 来源的临时“未命名画布”并关闭验收标签；最终重新运行完整门禁并写最终检查点。本目标不包含提交、推送或生产部署。
- 最后验证结果：最终事件驱动修改后，`node --test tests/ai-creation-contract.test.mjs` 通过 `20/20`，`npm.cmd run build` 通过，`git diff --check` 通过且仅有 LF/CRLF 提示；较早一次完整 `npm.cmd test` 通过 `61/61`，最终事件驱动修改后尚未重跑。真实 API `3102` 和前端 `5182` 仍在监听。旧版自观察实现曾使临时内嵌浏览器渲染进程忙循环并崩溃，该临时进程已退出，项目服务未受影响。
- 修改文件：本目标修改 `GOALS.md`、`PLAN.md`、`STATUS.md`、`src/App.tsx`、`src/styles/canvas-nodes-reference.css`、`tests/ai-creation-contract.test.mjs`，并新增本文件；起始工作树干净，不包含接手前修改。
- 下一步：重新连接内嵌浏览器，关闭崩溃提示页并新建干净标签，首先打开 `http://localhost:5182/` 验证创作框静止时不会持续触发布局或崩溃，再依次完成右缘、拖动、缩放、单标点、浅色和移动端验收。
- 恢复命令：`Set-Location 'C:\Users\Administrator\Documents\无限画布'`; `Get-Content -Encoding UTF8 HANDOFF.md`; `Get-Content -Encoding UTF8 GOALS.md`; `Get-Content -Encoding UTF8 PLAN.md`; `Get-Content -Encoding UTF8 STATUS.md`; `Get-Content -Encoding UTF8 coordination/STATUS-reference-creation-controls.md`; `git status --short --branch`; `git diff -- GOALS.md PLAN.md STATUS.md coordination/STATUS-reference-creation-controls.md src/App.tsx src/styles/canvas-nodes-reference.css tests/ai-creation-contract.test.mjs`; `node --test tests/ai-creation-contract.test.mjs`; `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3102/api/health`; `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5182/`。

## Checkpoint: 2026-08-03 02:04 +08:00

- 当前目标：完成参考创建控件目标的隔离夹具清理和最终落盘，产品实现、自动化与桌面/移动端浏览器验收均已完成，目标保持活动状态。
- 已完成：空图片节点三操作工具栏、紧凑 AI 配置节点和瞬时大型创作框已实现；创作框复用现有 `runAI`、`runImage`、`runVideo`，显示最多四张连接参考图，并以 DOM-owned textarea 保持 IME 输入安全。桌面 `1440x1000` 和移动端 `390x844` 的深浅主题验收已通过右缘夹取、节点拖动跟随、画布缩放跟随、参考图计数、单个 `，` 长度 `1`、Dock/导航避让、无页面溢出和真实空图片节点删除；移动端创作框与视口、Dock、导航之间保留可用间距。
- 未完成：尚未确认 `http://localhost:5182/` 来源的临时“未命名画布”是否已由前两次 UI 删除请求移除；如仍存在，需先调查保存队列状态，再仅通过应用 UI 删除。清理后关闭隔离标签、重置 viewport、重新运行最终门禁并写最终检查点。不得直接删除数据库、会话或真实用户数据。
- 最后验证结果：`node --test tests/ai-creation-contract.test.mjs` 通过 `20/20`；`npm.cmd run build` 通过并生成 `index-BX6NdpM7.css`、`index--iha24vM.js`；`npm.cmd test` 通过 `61/61`；`git diff --check` 通过，仅有 LF/CRLF 提示。浏览器未观察到页面错误；开发态仍有 React Flow `nodeTypes/edgeTypes` HMR 警告，源码对象已在组件外定义。
- 修改文件：`GOALS.md`、`PLAN.md`、`STATUS.md`、`coordination/STATUS-reference-creation-controls.md`、`src/App.tsx`、`src/styles/canvas-nodes-reference.css`、`tests/ai-creation-contract.test.mjs`。起始工作树干净，当前修改均属于本目标且未提交、未推送。
- 下一步：新开 `http://localhost:5182/` 标签只读确认画布状态；若提示画布已被其他页面删除，使用现有“放弃本地草稿”动作；若画布仍存在，先检查可见的待保存状态，再通过应用 UI 删除。不得打开或修改 `http://127.0.0.1:5182/` 来源中的真实画布。
- 恢复命令：`Set-Location 'C:\Users\Administrator\Documents\无限画布'`; `Get-Content -Encoding UTF8 HANDOFF.md`; `Get-Content -Encoding UTF8 GOALS.md`; `Get-Content -Encoding UTF8 PLAN.md`; `Get-Content -Encoding UTF8 STATUS.md`; `Get-Content -Encoding UTF8 coordination/STATUS-reference-creation-controls.md`; `git status --short --branch`; `git diff -- GOALS.md PLAN.md STATUS.md coordination/STATUS-reference-creation-controls.md src/App.tsx src/styles/canvas-nodes-reference.css tests/ai-creation-contract.test.mjs`; `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3102/api/health`; `Invoke-WebRequest -UseBasicParsing http://localhost:5182/`。

## Final Checkpoint: 2026-08-03 02:10 +08:00

- 当前目标：完成参考仓库对应的空图片节点工具栏、紧凑 AI 配置节点和大型画布创作框适配迁移，并完成自动化、桌面/移动端验收、隔离夹具清理和可恢复交接。
- 已完成：产品实现、聚焦契约、桌面 `1440x1000` 与移动端 `390x844` 深浅主题验收全部完成。创作框跟随节点拖动和画布缩放，右缘与底部会自动夹取并避开 Dock/移动导航；最多四张连接参考图可见；单个 `，` 长度为 `1`；空图片工具栏真实删除可用。最终打开 `http://localhost:5182/` 时临时画布已被此前应用 UI 删除，页面停留在空白开始页，无“其他页面删除”、待保存或冲突提示；浏览器 error 日志为空，标签已关闭，viewport 已复位。
- 未完成：本目标范围内无未完成事项。当前修改尚未提交、尚未推送，生产尚未部署；三者均属于后续用户明确指令下的独立目标。
- 最后验证结果：最终 `node --test tests/ai-creation-contract.test.mjs` 通过 `20/20`；`npm.cmd run build` 通过并生成 `index-BX6NdpM7.css`、`index--iha24vM.js`；`npm.cmd test` 通过 `61/61`；`git diff --check` 通过，仅有 LF/CRLF 提示；`http://127.0.0.1:3102/api/health` 返回 `200 {"ok":true}`，`http://127.0.0.1:5182/` 返回 HTTP 200。
- 修改文件：`HANDOFF.md`、`GOALS.md`、`PROJECT_MEMORY.md`、`PLAN.md`、`STATUS.md`、`DECISIONS.md`、`coordination/STATUS-reference-creation-controls.md`、`src/App.tsx`、`src/styles/canvas-nodes-reference.css`、`tests/ai-creation-contract.test.mjs`。起始工作树干净，全部修改属于本目标。
- 下一步：等待用户决定是否创建独立 GitHub 交付目标；若要求推送，先审查完整差异和秘密边界，再正常提交、推送、fetch 并核对远端完整 SHA，不进行生产部署。
- 恢复命令：`Set-Location 'C:\Users\Administrator\Documents\无限画布'`; `Get-Content -Encoding UTF8 HANDOFF.md`; `Get-Content -Encoding UTF8 GOALS.md`; `Get-Content -Encoding UTF8 PROJECT_MEMORY.md`; `Get-Content -Encoding UTF8 PLAN.md`; `Get-Content -Encoding UTF8 STATUS.md`; `Get-Content -Encoding UTF8 DECISIONS.md`; `Get-Content -Encoding UTF8 coordination/STATUS-reference-creation-controls.md`; `git status --short --branch`; `git diff -- HANDOFF.md GOALS.md PROJECT_MEMORY.md PLAN.md STATUS.md DECISIONS.md coordination/STATUS-reference-creation-controls.md src/App.tsx src/styles/canvas-nodes-reference.css tests/ai-creation-contract.test.mjs`; `node --test tests/ai-creation-contract.test.mjs`; `npm.cmd run build`; `npm.cmd test`; `git diff --check`。
