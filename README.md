# 墨屿画布

一个可自行部署的中文无限画布。用户可以在画布里创建便签、文本、图片和 AI 对话节点，拖拽、连线、缩放并自动保存。文字、图片、视频生成均使用当前用户自己保存的 API 密钥；站内积分与充值界面当前默认关闭。

## 已实现

- 邮箱注册/登录；生产环境使用一次性初始化码创建首位管理员
- 每个用户独立的多画布空间，支持节点拖拽、连线、缩放、小地图和自动保存
- 便签、文本、图片、分组和 AI 创作节点，支持曲线连线、删除、对齐与分布
- 服务端优先代理 OpenAI-compatible `/v1/responses`，仅在上游返回 404/405 时回退 `/v1/chat/completions`
- 文字、图片、视频中转地址和开放模型由网页“运营管理”配置，每位用户在账户安全中保存自己的三类加密 API 密钥
- 三类上游模型都可由管理员使用自己的对应 API 密钥获取，再明确勾选要向用户开放的模型
- 图片费用由中转站账户处理，不扣站内积分；相同请求标识重试可恢复缓存结果
- 站内计费默认关闭，用户界面隐藏余额、兑换码、充值申请和充值审核；底层账本与商业 API 保留供后续恢复
- 管理后台显示站点统计、中转配置、三类模型发现和操作审计
- Helmet 安全头、JWT、资源归属校验和接口分级限流

## 本地运行

要求 Node.js 24+。

~~~powershell
Copy-Item .env.example .env
npm.cmd ci
npm.cmd run dev
~~~

本地开发前端地址为 http://localhost:5182，开发 API 默认为 http://localhost:3102/api/health；Vite 会把前端发出的 `/api` 请求代理到该后端。Compose 部署时应用容器内部监听 3102，宿主机发布地址由 `PUBLIC_BIND` 与 `PUBLIC_PORT` 决定，默认是 `0.0.0.0:3102`，不使用 5182。

开发环境未配置 `ADMIN_SETUP_TOKEN` 时，第一个账号会获得管理员权限。生产环境必须配置初始化码，站长首次注册时填写该值；管理员创建成功后可从 `.env` 删除 `ADMIN_SETUP_TOKEN` 并重启。点击右上角齿轮可配置三类中转地址、获取上游模型、选择开放模型并查看操作审计。

生产示例默认 `WELCOME_POINTS=0`。站点尚未接入邮箱验证时不建议赠送注册积分，否则用户可通过批量注册重复领取。
服务端默认限制每个账号 100 张画布、200 个素材，单画布或单素材 2 MiB，画布与素材合计 20 MiB；生成图片原始字节和视频媒体共用每账号 512 MiB 的媒体配额，单次图片 JSON 响应默认最多 50 MiB，单个视频上传或中转响应默认最多 64 MiB。系统还限制同一来源 IP 每 15 分钟成功注册 5 次。登录失败会按账号持久计数，15 分钟内连续失败 5 次后锁定 15 分钟，更换来源 IP 不能绕过。可按服务器磁盘和业务套餐调整 `.env` 中的 `MAX_CANVASES_PER_USER`、`MAX_ASSETS_PER_USER`、`MAX_CANVAS_BYTES`、`MAX_USER_STORAGE_BYTES`、`AI_IMAGE_MAX_RESPONSE_BYTES`、`AI_VIDEO_MAX_RESPONSE_BYTES`、`MAX_USER_MEDIA_BYTES` 和 `REGISTRATION_RATE_LIMIT`；`MAX_USER_MEDIA_BYTES` 不得低于图片与视频两类单次响应上限，也不要只依赖前端限制。
用户可点击右上角“API 密钥”或侧栏头像进入“账户安全”，修改密码，并分别保存、测试或清除自己的文字、图片、视频 API 密钥。密钥提交后只返回是否已配置，不返回明文；密码修改成功后，其他设备上的旧登录令牌会立即失效。
运营管理会记录中转配置等后台操作，包含操作者与时间；审计记录由数据库禁止更新或删除。

## 对接中转站

复制 `.env.example` 为 `.env`，至少设置两个部署秘密。中转地址与开放模型推荐在管理员登录后的网页“运营管理”中配置；新部署的文字、图片、视频中转地址和模型列表全部为空：

~~~dotenv
JWT_SECRET=使用随机生成的长密钥
ADMIN_SETUP_TOKEN=使用另一个随机生成的长初始化码
SITE_BILLING_ENABLED=0
AI_BASE_URL=
AI_IMAGE_BASE_URL=
AI_VIDEO_BASE_URL=
AI_MODELS=
AI_IMAGE_MODELS=
AI_VIDEO_MODELS=
~~~

文字会优先调用服务器配置地址下的 `/responses`，只有上游明确返回 404/405 才回退 `/chat/completions`；图片生成调用 `/images/generations`，参考图编辑调用 `/images/edits`，视频调用 `/videos` 并按任务状态轮询。图片支持自动、1K 常见方形/横竖比例、2K 1:1/16:9/9:16 和 4K 16:9/9:16 预设；实际是否支持仍由管理员开放的上游模型决定。每次请求都使用当前登录用户在“账户安全”保存的对应类型密钥；三类密钥只在服务端加密保存，不会出现在运营管理、`h` 输出或 API 响应中。管理员在网页“运营管理”填写三类地址，点击“获取上游模型”后重新勾选开放模型；每次重新获取都会替换候选并清空旧勾选。

视频结果默认只允许从 `AI_VIDEO_BASE_URL` 的精确 origin 下载。如果中转站返回独立媒体 CDN，可在 `AI_VIDEO_MEDIA_ORIGINS` 中填写逗号分隔的精确 origin，例如 `https://media.example.com`；不得包含路径、凭据、查询参数或片段。应用会逐跳检查重定向与解析地址，拒绝回环、私网、链路本地和保留地址，并且不会把视频中转 Authorization 发送给这些额外媒体来源。

文字、图片、视频分别使用 `AI_TIMEOUT_MS`、`AI_IMAGE_TIMEOUT_MS` 和 `AI_VIDEO_TIMEOUT_MS`；默认图片超时为 300 秒，反向代理读取超时为 310 秒。对应的 `AI_PENDING_RECOVERY_MS`、`AI_IMAGE_PENDING_RECOVERY_MS`、`AI_VIDEO_PENDING_RECOVERY_MS` 都必须至少比请求超时多 10 秒，默认分别为 180000、360000 和 660000。上游返回图片 URL 时服务端直接透传；只返回 base64 时，服务端保存原始 PNG/JPEG/WebP 字节到 SQLite `media` 表并返回签名 `/api/media/...` URL，浏览器不会再把 2K/4K 结果压缩到 1600px。`AI_IMAGE_MAX_RESPONSE_BYTES` 默认 50 MiB，`AI_VIDEO_MAX_RESPONSE_BYTES` 默认 64 MiB，`MAX_USER_MEDIA_BYTES` 是每位用户的图片/视频媒体总配额，必须不小于两类单次上限，默认 512 MiB。

`JWT_SECRET` 当前不仅签发登录令牌，还派生数据库中三类用户 API 密钥、管理员密码和兼容保留的旧中转密文所需的加密密钥，以及媒体访问签名。当前实现没有密钥轮换迁移机制；恢复数据库或计划轮换时必须继续使用与该数据库对应的原值，不能直接生成新值替换，否则已保存密钥无法解密且已有媒体地址会失效。

## 服务器部署与公网访问

一键脚本会自动探测公网 IPv4，首次部署默认启用公网 IP 加端口，不要求域名或 Nginx。默认地址是 `http://公网IP:3102`；这是未加密的 HTTP，登录密码和 API 密钥不应长期通过该地址传输。部署后可通过 `sudo h` 在“仅公网 IP + 端口”“仅域名 HTTPS”“两者并存”“仅服务器本机”四种访问方式间切换。

### 一键部署（Ubuntu / Debian）

在 Ubuntu/Debian systemd 服务器执行下面一行即可。脚本会安装 Docker/Compose，首次生成生产密钥，部署 `codex/infinite-canvas` 分支，并输出探测到的公网 IPv4 地址：

~~~bash
curl -fsSL https://github.com/bykedie/huabu/raw/refs/heads/codex/infinite-canvas/deploy/install.sh | sudo bash
~~~

另一台 Ubuntu/Debian 服务器在域名已经指向它以后，可直接从 GitHub 拉取当前交付分支并自动配置 Nginx 与 HTTPS；通知邮箱可以留空，不提供时 Certbot 使用无邮箱注册：

~~~bash
curl -fsSL https://github.com/bykedie/huabu/raw/refs/heads/codex/infinite-canvas/deploy/install.sh | sudo bash -s -- --domain api.bkbk.baby
~~~

默认安装目录为 `/opt/moyu-canvas`，数据库使用 Docker 的 `canvas-data` volume，更新前备份写入 `/srv/canvas-backups`。同一命令可以重复执行：脚本保留已有 `.env`、访问方式和数据卷，拒绝脏仓库或非快进更新，检测到新版本时会先创建并校验备份；构建、健康检查或 Nginx 切换失败时会回退代码、环境、应用和已捕获的站点状态。旧部署没有 `MOYU_ACCESS_MODE` 时，会按现有域名与监听地址迁移为 `public`、`domain`、`both` 或 `private`。可用 `--port 8080` 改宿主端口，`--bind 127.0.0.1` 首次部署为仅本机访问；容器内部端口始终是 3102。

安装器会创建 `/usr/local/bin/h`。若该路径已有不属于本项目的命令，脚本会拒绝覆盖。输入 `sudo h` 打开管理面板；`sudo h status` 查看识别到的公网 IPv4、当前访问方式、实际地址和管理员登录信息。按部署方要求，管理员密码除 bcrypt 登录哈希外还以 `JWT_SECRET` 派生密钥进行 AES-256-GCM 加密，仅在服务器 root 运行状态命令时解密显示，应用 API 不会返回；旧管理员需在账户安全中修改一次密码后才能同步。`h` 负责服务启停、安全更新、访问方式、应用端口、商业参数与配额、备份恢复、日志、诊断和管理员初始化码，不再配置文字、图片或视频中转。三类中转地址、上游模型发现与开放模型选择统一在网站“运营管理”完成；三类用户密钥只能由各用户在网站“账户安全”维护。

首次部署不会把管理员初始化码打印到安装日志。需要创建首位管理员时，在服务器执行：

~~~bash
sudo sed -n 's/^ADMIN_SETUP_TOKEN=//p' /opt/moyu-canvas/.env
~~~

首位管理员创建成功后，从 `.env` 删除 `ADMIN_SETUP_TOKEN`，再重跑同一条一键部署命令使容器使用更新后的配置。重复安装和安全更新会保留现有 `.env`、数据库卷与备份。Compose 不再通过 `env_file` 把 `.env` 全量注入应用，而是显式传入 JWT、配额、超时、三类地址/模型等运行配置白名单；旧部署的 `.env` 或兼容数据库列中即使仍保留管理员共享密钥，新运行时和 `h` 也不会读取或复活这些值。确认不再需要旧版本回滚后，再按站点的受控秘密清理流程退役旧值。

### 手动部署

1. 克隆仓库并创建生产配置：

   ~~~bash
   git clone --branch codex/infinite-canvas https://github.com/bykedie/huabu.git
   cd huabu
   cp .env.example .env
   openssl rand -hex 32 # 生成 JWT_SECRET
   openssl rand -hex 32 # 另生成 ADMIN_SETUP_TOKEN
   # 将两个不同的输出写入 .env；三类中转地址与开放模型在网页运营管理中配置
   docker compose up -d --build
   ~~~

2. 如需手动域名代理，设置 `MOYU_ACCESS_MODE=domain` 与 `PUBLIC_BIND=127.0.0.1`；并存时设置 `MOYU_ACCESS_MODE=both` 与 `PUBLIC_BIND=0.0.0.0`。同时填写 `MOYU_DOMAIN` 和 `MOYU_TLS`，再按 `deploy/nginx.conf` 配置反向代理。应用只信任来自回环地址的代理转发头；公网直连提交的伪造转发头不会被信任。

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

容器内应用监听 3102，Compose 通过 PUBLIC_BIND:PUBLIC_PORT 发布到宿主机；公网模式默认是 0.0.0.0:3102。域名模式由 Nginx 代理到当前 PUBLIC_PORT。部署示例的 Nginx 请求体上限为 64 MiB，与后端默认视频上传上限一致。不要把 `.env`、数据库、用户 API 密钥或其他秘密提交到 Git。
Compose 已将应用容器日志设置为单文件 10 MiB、最多保留 3 个文件，避免日志无限增长占满数据库所在磁盘。生产服务器仍应配置磁盘用量和容器健康状态告警。

## 计费兼容层

`SITE_BILLING_ENABLED` 默认是 `0`。当前界面不显示积分余额、兑换码、充值申请、充值记录或管理员充值审核，文字和视频生成也不写站内预占、结算或退款流水；费用由用户自己的中转账户承担。底层整数账本、兑换码、充值订单和幂等处理代码仍保留，未来恢复商业模式时应先补回受控界面和完整验收，再显式把开关改为 `1`。图片生成始终保持零站内积分。

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

测试覆盖生产密钥与计费开关、管理员初始化、账号角色、画布归属、保存读取、三类用户 API 密钥的加密与隔离、三类上游模型发现、Responses 优先与受限回退、默认零站内计费、兼容账本开启模式、服务器中转地址与模型白名单，以及图片零站内扣费。
