# AI Runtime Repair Status

## Checkpoint: 2026-08-02 22:00 +08:00

- 当前目标：修复 AI 创作文字请求超时、文字模式遗漏已连接参考图、中文输入法标点或发送重复三个关联问题；本地实现与验收已完成。
- 已完成：文字模式始终显示连接图片计数与最多四张预览，`runAI` 转换并发送引用；服务端 `/api/ai/chat` 校验最多四张 PNG/JPEG/WebP data URL，并为 Responses/Chat Completions 生成各自兼容的多模态内容块；两种文字协议显式 `stream:false`。画布助手 textarea 在 composition 期间由 DOM 持有正在组合的值，composition 结束后才同步 React 状态，避免受控值回写造成中文标点重复；提交直接读取 DOM 最终值，不做可能吞掉合法双标点的字符级去重。新增 `src/ime.ts`，阻止 composition、`nativeEvent.isComposing` 和 Windows `keyCode 229` 期间的 Enter 提交，同时保留普通 Enter 单次发送和 Shift+Enter。聚焦回归、完整自动化、隔离浏览器验收、控制台检查和夹具清理均完成。
- 未完成：无。产品修复已提交并正常推送为 `90e091aab59bdbeaf8f3b8edcdc2e28bd06c8098`，主要交接文档已推送为 `44dd2441a9df836277905fdf784aeda0ac725c32`，最终交付检查点也已推送并经 fetch 核对；生产仍未部署。
- 最后验证结果：2026-08-02 22:00 +08:00 重新运行 `node --test tests/ai-creation-contract.test.mjs` 通过 `17/17`、`node --test tests/relay-modernization.test.mjs` 通过 `5/5`、`npm.cmd test` 通过 `58/58`、`npm.cmd run build` 通过并生成 `index-Bo6TNF-x.css` 与 `index-Bcuyr84L.js`；`node --check server/app.js` 通过。最新隔离浏览器在新 DOM 持值实现上验证：输入一个 `，` 的 DOM 长度为 1，主动输入两个 `，，` 的长度为 2；普通 Enter 后输入框清空，只产生一条用户消息、一条助手回复和一次 `/v1/responses` 调用，请求为 `stream:false`，浏览器 warning/error 为 0。此前同一目标的参考图场景还显示 `0 段文本 · 1 张图片`、`1 张参考图`，生成结果为 `AI 已识别 1 张参考图`，中转摘要为 `imageCount:1`。真实操作系统中文 IME 的候选组合过程无法由隔离浏览器完整模拟，仍是部署后现场复核项；代码契约已覆盖 composition、`isComposing`、`keyCode 229` 和 DOM 持值。真实 `3102/5182` 返回 HTTP 200，隔离标签、临时数据库/日志/脚本均已删除，端口 `3143/3144` 无监听。
- 修改文件：本目标产品/测试文件为 `src/App.tsx`、`src/ime.ts`、`server/app.js`、`tests/ai-creation-contract.test.mjs`、`tests/relay-modernization.test.mjs`；状态与长期契约同步文件为 `GOALS.md`、`PLAN.md`、`STATUS.md`、`HANDOFF.md`、`PROJECT_MEMORY.md`、`SPEC.md`、`DECISIONS.md` 和本文件。接手前这些长期文档中的多份文件以及 `AGENTS.md`、`coordination/STATUS-handoff.md` 已有未提交交接修改，均被保留且未撤销。
- 下一步：本目标无后续动作。若用户要求生产更新，另建部署目标并保持 GitHub 交付与生产部署分离；否则从最新 `HANDOFF.md` 和实际 Git 状态建立下一个目标。
- 恢复命令：`Set-Location 'C:\Users\Administrator\Documents\无限画布'`; `Get-Content -Encoding UTF8 HANDOFF.md`; `Get-Content -Encoding UTF8 GOALS.md`; `Get-Content -Encoding UTF8 STATUS.md`; `Get-Content -Encoding UTF8 coordination/STATUS-ai-runtime.md`; `git status --short --branch`; `git diff -- src/App.tsx src/ime.ts server/app.js tests/ai-creation-contract.test.mjs tests/relay-modernization.test.mjs GOALS.md PLAN.md STATUS.md HANDOFF.md PROJECT_MEMORY.md SPEC.md DECISIONS.md coordination/STATUS-ai-runtime.md`; `node --test tests/ai-creation-contract.test.mjs`; `node --test tests/relay-modernization.test.mjs`; `npm.cmd test`; `npm.cmd run build`; `git diff --check`。

## Checkpoint: 2026-08-02 20:38 +08:00

- 当前目标：修复 AI 创作文字请求超时、文字模式遗漏已连接参考图、中文输入法标点或发送重复三个关联问题。
- 已完成：重新核对活动目标、强制恢复文档、实际 Git、服务端口和相关源码；确认 `HEAD` 与远端仍同为 `3995f17d98fa1718d4084720674693e603757cb7`，真实 `3102/5182` 正常监听且 `3000/5174` 空闲；确认文字模式 UI 用 `mode !== 'text'` 主动隐藏图片计数和预览，`runAI` 只取 `buildGenerationContext(...).prompt` 且 `/api/ai/chat` 只接受字符串消息，因此文字创作既不显示也不传递连接图片；确认助手 textarea 的 Enter 提交没有 `isComposing` 防护。
- 未完成：用聚焦测试复现 Responses/Chat 中转超时差异和 IME 单次提交契约；实现文字多模态引用、协议级超时兼容和 composition 安全提交；运行全套门禁；完成隔离浏览器验收、夹具清理和最终检查点。
- 最后验证结果：本目标仍未修改产品代码；旧基线为完整测试 `55/55`、build 和 `git diff --check` 通过。静态源码证据显示助手与 AI 节点都调用 `/api/ai/chat`，所以不能把超时归因于不同后端接口，也不能只靠扩大 `AI_TIMEOUT_MS` 处理。
- 修改文件：本目标已修改 `GOALS.md`、`PLAN.md`、`STATUS.md` 和本文件；尚无产品代码修改。接手前已有 `AGENTS.md`、`DECISIONS.md`、`GOALS.md`、`HANDOFF.md`、`PLAN.md`、`PROJECT_MEMORY.md`、`SPEC.md`、`STATUS.md` 与 `coordination/STATUS-handoff.md` 未提交修改，必须保留。
- 下一步：在 `tests/ai-creation-contract.test.mjs` 和文字中转测试中添加先失败回归，分别锁定文字参考图可见/可发送、IME composition 期间 Enter 不提交，以及中转协议完成响应的兼容行为。
- 恢复命令：`Set-Location 'C:\Users\Administrator\Documents\无限画布'`; `Get-Content -Encoding UTF8 HANDOFF.md`; `Get-Content -Encoding UTF8 GOALS.md`; `Get-Content -Encoding UTF8 STATUS.md`; `Get-Content -Encoding UTF8 coordination/STATUS-ai-runtime.md`; `git status --short --branch`; `git diff -- src/App.tsx src/generation-context.ts server/app.js tests/ai-creation-contract.test.mjs tests/relay-modernization.test.mjs GOALS.md PLAN.md STATUS.md coordination/STATUS-ai-runtime.md`; `node --test tests/ai-creation-contract.test.mjs`。

## Checkpoint: 2026-08-02 20:09 +08:00

- 当前目标：修复 AI 创作文字请求超时、已连接图片未识别为参考图、中文输入法标点或发送重复三个关联问题。
- 已完成：按单图规则分析唯一用户原图；读取强制恢复文档和协调状态；核对本地/远端均为 `3995f17d98fa1718d4084720674693e603757cb7`，现有未提交差异仅为前两轮交接文档；确认真实 API `3102` 与前端 `5182` 已运行，禁用端口 `3000/5174` 无监听；定位 `src/App.tsx`、`src/generation-context.ts`、`src/api.ts`、`server/app.js` 和 AI 契约测试。
- 未完成：复现并证明三个根因；添加聚焦回归；实施修复；运行构建、完整测试、差异/秘密检查和隔离浏览器验收；清理夹具并写最终检查点。
- 最后验证结果：上一文档目标 build、完整测试 `55/55` 和 `git diff --check` 通过；本目标尚未运行修改后的测试。当前源码显示助手与 AI 节点都调用 `/ai/chat`，AI 节点固定请求 `maxTokens: 1024`；现有上下文测试只覆盖标准 `data.kind/imageUrl` 节点和少数边 ID/角色；输入框没有显式 IME composition 防护。
- 修改文件：本目标目前只修改 `GOALS.md`、`PLAN.md`、`STATUS.md` 并新增本文件。接手前已有 `AGENTS.md`、`DECISIONS.md`、`GOALS.md`、`HANDOFF.md`、`PLAN.md`、`PROJECT_MEMORY.md`、`SPEC.md`、`STATUS.md` 和 `coordination/STATUS-handoff.md` 的未提交交接文档修改，均须保留。
- 下一步：读取 AI 助手发送实现、节点/边加载规范化和真实旧字段兼容路径，建立能失败的单元/契约测试，再根据证据做最小代码修改。
- 恢复命令：`Set-Location 'C:\Users\Administrator\Documents\无限画布'`; `Get-Content -Encoding UTF8 HANDOFF.md`; `Get-Content -Encoding UTF8 GOALS.md`; `Get-Content -Encoding UTF8 STATUS.md`; `Get-Content -Encoding UTF8 coordination/STATUS-ai-runtime.md`; `git status --short --branch`; `git diff -- src/App.tsx src/generation-context.ts src/api.ts server/app.js tests/ai-creation-contract.test.mjs GOALS.md PLAN.md STATUS.md coordination/STATUS-ai-runtime.md`; `node --test tests/ai-creation-contract.test.mjs`.
