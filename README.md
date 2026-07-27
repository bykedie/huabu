# 墨屿画布

一个可自行部署的中文无限画布。用户可以在画布里创建便签、文本、图片和 AI 对话节点，拖拽、连线、缩放并自动保存。站点内置积分账本、兑换码、人工充值审核和 OpenAI-compatible 中转站代理。

## 已实现

- 邮箱注册/登录；生产环境使用一次性初始化码创建首位管理员
- 每个用户独立的多画布空间，支持节点拖拽、连线、缩放、小地图和自动保存
- 便签、文本、图片地址、AI 对话四种节点
- 服务端代理 OpenAI-compatible /v1/chat/completions，中转密钥不会进入浏览器
- AI 请求先预占积分，成功后按 usage 结算并退回差额，失败全额退回
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

前端地址为 http://localhost:5173，API 默认为 http://localhost:3000/api/health。开发环境下 Vite 会把 /api 代理到后端。

开发环境未配置 `ADMIN_SETUP_TOKEN` 时，第一个账号会获得管理员权限。生产环境必须配置初始化码，站长首次注册时填写该值；管理员创建成功后可从 `.env` 删除 `ADMIN_SETUP_TOKEN` 并重启。点击右上角齿轮可生成兑换码、审核充值申请并查看中转站配置状态。

生产示例默认 `WELCOME_POINTS=0`。站点尚未接入邮箱验证时不建议赠送注册积分，否则用户可通过批量注册重复领取。

## 对接中转站

复制 .env.example 为 .env，至少设置：

~~~dotenv
JWT_SECRET=使用随机生成的长密钥
ADMIN_SETUP_TOKEN=使用另一个随机生成的长初始化码
AI_BASE_URL=https://你的中转域名/v1
AI_API_KEY=你的中转密钥
AI_MODELS=gpt-4o-mini
~~~

应用会向 AI_BASE_URL/chat/completions 发送非流式请求，协议兼容常见 OpenAI 中转站。AI_MODELS 是服务端模型白名单，多个模型用英文逗号分隔；当前界面使用列表中的第一个模型。修改积分单价后重启应用生效。

## 服务器与域名部署

服务器需安装 Docker Engine、Docker Compose、Nginx，并将域名 A/AAAA 记录指向服务器。

1. 克隆仓库并创建生产配置：

   ~~~bash
   git clone --branch codex/infinite-canvas https://github.com/bykedie/huabu.git
   cd huabu
   cp .env.example .env
   openssl rand -hex 32 # 生成 JWT_SECRET
   openssl rand -hex 32 # 另生成 ADMIN_SETUP_TOKEN
   # 将两个不同的输出写入 .env，并填写中转站配置
   docker compose up -d --build
   ~~~

2. 将 deploy/nginx.conf 复制到服务器的 Nginx 站点目录，把 canvas.example.com 改成真实域名，然后启用配置：

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

应用端口只绑定 127.0.0.1:3000，公网通过 Nginx 和 HTTPS 访问。不要把 .env、数据库或中转密钥提交到 Git。

## 积分与充值

积分为整数。AI 调用根据输入和输出 token 分别计价；请求开始时按最大输出预占，成功后根据中转站返回的 usage 结算。若中转站不返回 usage，系统使用保守估算，避免免费超额调用。进程异常退出后，启动时会把遗留的未结算预占记录标记失败并全额退回。

当前充值方式是可用的人工审核流程：在 `.env` 的 `TOPUP_INSTRUCTIONS` 填写微信、支付宝或其他收款方式和备注要求；用户可看到预计积分、提交唯一付款交易单号并跟踪待审核/已到账/已驳回状态，重复交易单号会被拒绝，管理员确认实际收款后点击通过，积分只会到账一次。真正的微信支付或支付宝自动收款还需要商户号、证书和回调域名；拿到这些资料后应新增支付订单签名与异步回调，不要在前端直接处理支付密钥。

## 数据备份

数据库保存在 Compose 管理的 `canvas-data` volume。Compose 会强制容器使用 `/app/data/app.db`，避免 `.env` 将数据库写到临时容器层。更新版本不会删除该 volume。备份前短暂停止应用以获得一致快照：

~~~bash
mkdir -p backups
backup="backups/canvas-$(date +%F-%H%M)"
docker compose stop app
docker compose cp -a app:/app/data "$backup"
docker compose start app
~~~

这条命令直接从当前 Compose 项目的 `app` 容器复制数据，不依赖可能变化的 volume 名称。恢复前先按上面步骤另做一份当前数据备份，然后执行：

~~~bash
set -euo pipefail
backup_dir="$PWD/备份目录"
test -s "$backup_dir/app.db"
docker compose run --rm --no-deps -v "$backup_dir:/backup:ro" app sh -c \
  'cp -a /backup /tmp/restore-check && node server/check-db.js /tmp/restore-check/app.db'
docker compose stop app
docker compose run --rm --no-deps app sh -c 'rm -f /app/data/app.db /app/data/app.db-wal /app/data/app.db-shm'
docker compose cp -a "$backup_dir/." app:/app/data
docker compose run --rm --no-deps app node server/check-db.js /app/data/app.db
docker compose start app
~~~

当前部署只支持一个应用副本共享这份 SQLite 数据库；不要将 `app` 横向扩容为多个副本。

## 验证

~~~bash
npm ci
npm test
npm run build
npm audit --audit-level=low
~~~

测试覆盖生产密钥与计费配置、管理员初始化、账号角色、画布归属、保存读取、兑换码防重复、充值审批幂等，以及 AI 失败和异常重启后的积分完整退回。
