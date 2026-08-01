# 墨屿画布

一个可自行部署的中文无限画布。用户可以在画布里创建便签、文本、图片和 AI 对话节点，拖拽、连线、缩放并自动保存。站点内置积分账本、兑换码、人工充值审核、文字/视频中转管理，以及使用用户自有密钥的图片生成代理。

## 已实现

- 邮箱注册/登录；生产环境使用一次性初始化码创建首位管理员
- 每个用户独立的多画布空间，支持节点拖拽、连线、缩放、小地图和自动保存
- 便签、文本、图片、分组和 AI 创作节点，支持曲线连线、删除、对齐与分布
- 服务端代理 OpenAI-compatible /v1/chat/completions，中转密钥不会进入浏览器
- 文字 AI 请求先预占积分，成功后按 usage 结算并退回差额，失败全额退回
- 图片生成固定使用 `https://www.bkbk.baby/v1`，每位用户在账户设置中保存自己的加密 API 密钥
- 图片费用由中转站账户处理，不扣站内积分；相同请求标识重试可恢复缓存结果
- 整数积分余额与不可变流水；兑换码哈希存储、限次核销
- 用户提交充值申请，管理员审核后幂等到账
- 管理后台统计、批量生成兑换码、充值审核和中转配置状态
- Helmet 安全头、JWT、资源归属校验和接口分级限流

## 本地运行

要求 Node.js 24+。

~~~powershell
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run dev
~~~

本地开发前端地址为 http://localhost:5182，开发 API 默认为 http://localhost:3102/api/health；Vite 会把前端发出的 `/api` 请求代理到该后端。Compose 部署时应用容器内部监听 3102，宿主机发布地址由 `PUBLIC_BIND` 与 `PUBLIC_PORT` 决定，默认是 `0.0.0.0:3102`，不使用 5182。

开发环境未配置 `ADMIN_SETUP_TOKEN` 时，第一个账号会获得管理员权限。生产环境必须配置初始化码，站长首次注册时填写该值；管理员创建成功后可从 `.env` 删除 `ADMIN_SETUP_TOKEN` 并重启。点击右上角齿轮可生成兑换码、审核充值申请并查看中转站配置状态。

生产示例默认 `WELCOME_POINTS=0`。站点尚未接入邮箱验证时不建议赠送注册积分，否则用户可通过批量注册重复领取。
服务端默认限制每个账号 100 张画布、200 个素材，单画布或单素材 2 MiB，画布与素材合计 20 MiB；视频媒体另设每账号 512 MiB 配额，单个视频上传或中转响应默认最多 64 MiB。系统还限制同一来源 IP 每 15 分钟成功注册 5 次。登录失败会按账号持久计数，15 分钟内连续失败 5 次后锁定 15 分钟，更换来源 IP 不能绕过。可按服务器磁盘和业务套餐调整 `.env` 中的 `MAX_CANVASES_PER_USER`、`MAX_ASSETS_PER_USER`、`MAX_CANVAS_BYTES`、`MAX_USER_STORAGE_BYTES`、`AI_VIDEO_MAX_RESPONSE_BYTES`、`MAX_USER_MEDIA_BYTES` 和 `REGISTRATION_RATE_LIMIT`；`MAX_USER_MEDIA_BYTES` 不得低于 `AI_VIDEO_MAX_RESPONSE_BYTES`，也不要只依赖前端限制。
用户可从侧栏头像进入“账户安全”修改密码。修改成功后，其他设备上的旧登录令牌会立即失效。
运营管理会记录兑换码生成和充值审批操作，包含操作者、时间与积分/金额；审计记录不保存兑换码明文，并由数据库禁止更新或删除。

## 对接中转站

复制 .env.example 为 .env，至少设置：

~~~dotenv
JWT_SECRET=使用随机生成的长密钥
ADMIN_SETUP_TOKEN=使用另一个随机生成的长初始化码
AI_BASE_URL=https://你的中转域名/v1
AI_API_KEY=你的中转密钥
AI_MODELS=gpt-4o-mini
AI_IMAGE_MODELS=GPT-image-2
AI_VIDEO_BASE_URL=https://你的视频中转域名/v1
AI_VIDEO_API_KEY=你的视频中转密钥
AI_VIDEO_MEDIA_ORIGINS=https://你的视频媒体域名
AI_VIDEO_MODELS=你的视频模型
AI_VIDEO_POINTS=24
AI_VIDEO_TIMEOUT_MS=600000
AI_VIDEO_POLL_MS=2500
AI_VIDEO_PENDING_RECOVERY_MS=660000
AI_VIDEO_MAX_RESPONSE_BYTES=67108864
MAX_USER_MEDIA_BYTES=536870912
~~~

文字会调用管理员配置的 `AI_BASE_URL/chat/completions`。图片生成固定调用 `https://www.bkbk.baby/v1/images/generations`，参考图编辑调用同一端点下的 `/images/edits`；每位用户从“账户安全”保存和测试自己的图片 API 密钥，密钥只在服务端加密保存且不会返回浏览器。视频会调用 `AI_VIDEO_BASE_URL/videos` 并按任务状态轮询，也可由管理员在运营管理中保存视频中转配置。`AI_IMAGE_MODELS` 与 `AI_VIDEO_MODELS` 都是服务端模型白名单，多个模型用英文逗号分隔。

视频结果默认只允许从 `AI_VIDEO_BASE_URL` 的精确 origin 下载。如果中转站返回独立媒体 CDN，可在 `AI_VIDEO_MEDIA_ORIGINS` 中填写逗号分隔的精确 origin，例如 `https://media.example.com`；不得包含路径、凭据、查询参数或片段。应用会逐跳检查重定向与解析地址，拒绝回环、私网、链路本地和保留地址，并且不会把视频中转 Authorization 发送给这些额外媒体来源。

`AI_VIDEO_PENDING_RECOVERY_MS` 必须至少为 `AI_VIDEO_TIMEOUT_MS + 10000`，避免仍在处理的任务被恢复流程提前标记失败；默认值 660000 比 10 分钟视频超时多保留 60 秒。`AI_VIDEO_MAX_RESPONSE_BYTES` 同时限制视频上传与中转下载响应，默认 64 MiB；`MAX_USER_MEDIA_BYTES` 是每位用户的媒体总配额，必须不小于该单次上限，默认 512 MiB。

`JWT_SECRET` 当前不仅签发登录令牌，还派生数据库中已保存的文字/视频中转密钥、用户图片密钥的加密密钥，以及媒体访问签名。当前实现没有密钥迁移机制；恢复数据库或计划轮换时必须继续使用与该数据库对应的原值，不能直接生成新值替换，否则已保存密钥无法解密且已有媒体地址会失效。

## 服务器部署与公网访问

一键脚本默认直接发布公网 IP 加端口，不要求域名或 Nginx。默认地址是 http://公网IP:3102；这是未加密的 HTTP，登录密码和 API 密钥不应在长期生产环境中通过该地址传输。正式使用请在安装后通过 h 配置域名和 HTTPS。

### 一键部署（Ubuntu / Debian）

在 Ubuntu/Debian systemd 服务器执行下面一行即可。脚本会安装 Docker/Compose，首次生成生产密钥，部署 `codex/infinite-canvas` 分支，并输出探测到的公网 IPv4 地址：

~~~bash
curl -fsSL https://github.com/bykedie/huabu/raw/refs/heads/codex/infinite-canvas/deploy/install.sh | sudo bash
~~~

默认安装目录为 `/opt/moyu-canvas`，数据库使用 Docker 的 `canvas-data` volume，更新前备份写入 `/srv/canvas-backups`。同一命令可以重复执行：脚本保留已有 `.env` 和数据卷，拒绝脏仓库或非快进更新，检测到新版本时会先创建并校验备份；构建、健康检查或 Nginx 切换失败时会回退代码、环境、应用和已捕获的站点状态。旧域名部署重跑时会继续强制应用绑定 `127.0.0.1`，避免通过公网应用端口绕过 Nginx。可用 `--port 8080` 改宿主端口，`--bind 127.0.0.1` 改为仅本机访问；容器内部端口始终是 3102。首次域名或证书配置失败时，脚本会尽量保留可用应用并明确回退到公网 HTTP；该回退未加密，不能继续传输登录密码或 API 密钥。

安装器会创建 `/usr/local/bin/h`。若该路径已有不属于本项目的命令，脚本会拒绝覆盖。输入 `sudo h` 打开管理面板；`sudo h status` 查看服务状态和访问地址。面板可启动、停止、重启、执行带备份和健康回滚的安全快进更新、修改端口、配置域名/HTTPS，并提供“配置文字中转”“配置图片中转”“配置视频中转”三个独立入口，以及商业配额、备份恢复、日志、诊断及管理员初始化码。文字和视频入口的 API 密钥使用隐藏输入且不会在状态中显示；留空表示保留，输入 `CLEAR` 表示显式清除。保存时密钥通过标准输入传给一次性维护进程，加密写入数据库，旧 `.env` 密钥随后清空，并强制重建主应用容器。中转 URL 不允许内嵌用户名或密码。图片入口固定显示 `https://www.bkbk.baby/`，只维护 `.env` 中的 `AI_IMAGE_MODELS` 开放模型列表；它不接受管理员图片密钥或可编辑地址，每位用户仍须在“账户安全”中保存自己的图片 API 密钥。图片模型保存会强制重建应用并进行健康检查，失败时恢复原 `.env` 和服务。

首次部署不会把管理员初始化码打印到安装日志。需要创建首位管理员时，在服务器执行：

~~~bash
sudo sed -n 's/^ADMIN_SETUP_TOKEN=//p' /opt/moyu-canvas/.env
~~~

首位管理员创建成功后，从 `.env` 删除 `ADMIN_SETUP_TOKEN`，再重跑同一条一键部署命令使容器使用更新后的配置。旧部署若仍在 `.env` 保存文字或视频中转密钥，可通过 `sudo h` 的中转配置选择“留空保留”完成加密迁移；显式 `CLEAR` 会留下数据库管理标记，之后不会从旧环境变量复活。

### 手动部署

1. 克隆仓库并创建生产配置：

   ~~~bash
   git clone --branch codex/infinite-canvas https://github.com/bykedie/huabu.git
   cd huabu
   cp .env.example .env
   openssl rand -hex 32 # 生成 JWT_SECRET
   openssl rand -hex 32 # 另生成 ADMIN_SETUP_TOKEN
   # 将两个不同的输出写入 .env，并按需填写文字/视频中转配置
   docker compose up -d --build
   ~~~

2. 如需手动域名代理，先在 `.env` 设置 `PUBLIC_BIND=127.0.0.1`、`MOYU_DOMAIN=你的域名`，并按是否已启用 HTTPS 设置 `MOYU_TLS=0` 或 `1`，然后重建容器。再将 `deploy/nginx.conf` 复制到服务器的 Nginx 站点目录，把 `__DOMAIN__` 和 `__PUBLIC_PORT__` 替换为真实值并启用配置。域名模式只信任回环 Nginx 的一个代理跳数；公网 IP 模式不信任客户端提交的转发头。

   ~~~bash
   sudo nginx -t
   sudo systemctl reload nginx
   sudo certbot --nginx -d 你的域名
   ~~~

3. 检查状态：

   ~~~bash
   docker compose ps
   curl https://你的域名/api/health
   ~~~

容器内应用监听 3102，Compose 通过 PUBLIC_BIND:PUBLIC_PORT 发布到宿主机；公网模式默认是 0.0.0.0:3102。域名模式由 Nginx 代理到当前 PUBLIC_PORT。部署示例的 Nginx 请求体上限为 64 MiB，与后端默认视频上传上限一致。不要把 `.env`、数据库或中转密钥提交到 Git。
Compose 已将应用容器日志设置为单文件 10 MiB、最多保留 3 个文件，避免日志无限增长占满数据库所在磁盘。生产服务器仍应配置磁盘用量和容器健康状态告警。

## 积分与充值

积分为整数。文字 AI 调用根据输入和输出 token 分别计价，视频按管理员配置计价；图片生成不扣站内积分，费用由用户自己的中转站账户处理。同一个图片请求标识成功后重放会直接返回缓存结果，不会重复请求中转站。

当前充值方式是可用的人工审核流程：在 `.env` 的 `TOPUP_INSTRUCTIONS` 填写微信、支付宝或其他收款方式和备注要求；用户可看到预计积分、提交唯一付款交易单号并跟踪待审核/已到账/已驳回状态，重复交易单号会被拒绝，管理员确认实际收款后点击通过，积分只会到账一次。真正的微信支付或支付宝自动收款还需要商户号、证书和回调域名；拿到这些资料后应新增支付订单签名与异步回调，不要在前端直接处理支付密钥。

## 数据备份

数据库保存在 Compose 管理的 `canvas-data` volume。Compose 会强制容器使用 `/app/data/app.db`，避免 `.env` 将数据库写到临时容器层。更新版本不会删除该 volume。使用仓库内脚本创建一致性快照：

~~~bash
chmod +x deploy/backup.sh deploy/restore.sh
./deploy/backup.sh # 默认写入 /srv/canvas-backups
# 也可指定另一个仓库外绝对路径：./deploy/backup.sh /mnt/canvas-backups
~~~

备份根目录必须使用项目仓库外的绝对路径；脚本在创建目录前后都会解析真实路径并拒绝仓库根目录及其任何子目录，避免完整数据库进入 Git 工作区或 Docker 构建上下文。`app.db`、WAL 和 SHM 必须是普通文件，符号链接会被拒绝。默认根目录为 `/srv/canvas-backups`，可用第一个参数覆盖。脚本使用秒级时间戳和进程号创建全新目录，拒绝覆盖已有备份；数据库校验成功并且应用重新恢复健康后才返回成功。若备份已校验但应用恢复失败，备份会保留并输出路径。请定期把备份目录同步到另一台服务器或对象存储。数据库备份与其对应的 `JWT_SECRET` 必须按同一生命周期安全保存和恢复；秘密应进入受控的秘密管理或加密备份流程，不要把明文密钥放入仓库、普通备份目录或文档。

恢复时传入一个包含 `app.db` 的备份目录：

~~~bash
./deploy/restore.sh /srv/canvas-backups/canvas-YYYYMMDD-HHMMSS-PID
~~~

恢复脚本先在临时候选副本上执行当前版本数据库迁移和严格校验，再停服保存当前数据库的回滚快照。替换、最终校验或健康检查任一步失败时会自动恢复原数据库；若自动回滚本身失败，脚本会输出并保留回滚快照路径。当前部署只支持一个应用副本共享这份 SQLite 数据库；不要将 `app` 横向扩容为多个副本。

## 验证

~~~bash
npm ci
npm test
npm run build
npm audit --audit-level=low
~~~

测试覆盖生产密钥与计费配置、管理员初始化、账号角色、画布归属、保存读取、兑换码防重复、充值审批幂等、用户图片密钥加密与隔离、固定图片端点、图片零站内扣费，以及文字和视频请求的积分完整性。
