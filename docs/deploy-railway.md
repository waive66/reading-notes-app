# Railway 云部署准备报告

> 日期：2026-11-16　目标：电脑关机后 App 仍能调用 AI
> 结论：**代码侧已完成改造并通过本地测试；尚未部署**（未创建 Railway 项目、未获域名，未虚拟成功）

---

## 一、后端检查结果

### 1.1 目录与真实结构

```
reading-notes-app/
├─ railway.json          ← Railway 配置（构建/启动/健康检查）
├─ nixpacks.toml         ← Nixpacks 构建步骤
├─ .nvmrc                ← 新增，锁定 Node 20
├─ .gitignore
└─ server/
   ├─ index.js           ← 服务入口
   ├─ database.js        ← Postgres 连接（可选，客户端未用）
   ├─ package.json       ← start: node index.js
   ├─ package-lock.json
   ├─ .env.example       ← 只有变量名，无真实值
   ├─ routes/
   │  ├─ ai.js           ← ★ AI 代理（OpenRouter / Gemini / DeepSeek）
   │  ├─ auth.js         ← 未使用（数据库接口）
   │  ├─ books.js        ← 未使用
   │  └─ notes.js        ← 未使用
   ├─ uploads/           ← 未使用
   └─ reading_notes.db   ← SQLite 残留（已被 .gitignore 排除）
```

### 1.2 启动方式（实际）

| 项 | 值 |
| --- | --- |
| 运行目录 | 仓库根的 `server/` |
| 启动命令 | `node index.js` |
| 生产依赖 | express、cors（**AI 代理只用这两个**） |
| 未使用依赖 | pg、bcryptjs、jsonwebtoken、multer、uuid（属数据库接口，未挂载时不加载） |
| Node 版本 | 本地 v24；云端锁定 **20**（`.nvmrc`） |
| 监听 | `app.listen(PORT, '0.0.0.0')`，`PORT = process.env.PORT \|\| 3001` |

### 1.3 检查中发现并修复的问题

| # | 问题 | 严重度 | 处理 |
| --- | --- | --- | --- |
| 1 | **`/api/ai/analyze` 完全无鉴权**，拿到 URL 就能刷额度 | 🔴 高 | 新增 `APP_TOKEN` 口令校验（`X-App-Token` / `Bearer`），`timingSafeEqual` 比较 |
| 2 | `/api/ai/health` 匿名可探测服务端配置 | 🟠 中 | 改为需要口令；顶层 `/health` 保持公开但只返回 status/uptime/node |
| 3 | 全局限流只有「每 IP」，没有全站总量上限 | 🟠 中 | 新增 `AI_GLOBAL_DAILY`（默认 300/天） |
| 4 | 没有模型白名单 | 🟠 中 | 新增 `ALLOWED_MODELS` / `ALLOWED_PROVIDERS` |
| 5 | 请求体上限 10MB 对所有路由生效 | 🟡 低 | `/api/ai` 单独限制 64KB，其余 2MB |
| 6 | 数据库接口在无 `DATABASE_URL` 时仍挂载，云端持续报错 | 🟡 低 | 改为按 `DATABASE_URL` 条件挂载 |
| 7 | 无全局错误处理，异常可能返回堆栈 | 🟡 低 | 加兜底中间件，只返回「服务器内部错误」 |
| 8 | 无优雅退出，Railway 重部署时会硬断 | 🟡 低 | 监听 SIGTERM/SIGINT 后 `server.close()` |
| 9 | `nixpacks.toml` 写死 `nodejs_latest`，构建不可复现 | 🟡 低 | 改为 `.nvmrc` 锁定 Node 20 |
| 10 | `npm install` 不稳定 | 🟡 低 | 改 `npm ci --omit=dev`（lock 已校验与 package.json 一致） |
| 11 | `app.set('trust proxy')` 缺失，反代后拿不到真实 IP，限流会误判 | 🟠 中 | 已加 |

### 1.4 密钥现状（重要更正）

- **项目里不存在 `.env`**（`server/.env` 和根目录 `.env` 都没有），只有 `server/.env.example`。
- **Git 历史 3 个提交中，从未提交过 `.env`，也没有任何 `sk-or-` / `AIza` 痕迹**（已用 `git log --all -p` 全量扫描）。
- `.gitignore` 已覆盖 `.env`、`.env.*`、`*.db`、`node_modules/`、`client/dist/` 等，并保留 `!.env.example`。

> 所以你**不需要**撤销提交或轮换历史密钥——目前根本没有密钥进过仓库。

---

## 二、修改过的文件

### 后端
```
server/index.js         重写：trust proxy、按路由限体积、条件挂载 DB、兜底错误、优雅退出、启动日志
server/routes/ai.js     重写：APP_TOKEN 鉴权、全局限流、模型白名单、限流前置、health 加锁、日志脱敏
server/package.json     新增 engines.node>=18、description、main
server/.env.example     重写：补齐 APP_TOKEN / ALLOWED_MODELS / AI_GLOBAL_DAILY 等
```

### 部署配置
```
railway.json            healthcheckTimeout=100、restartPolicyType=ON_FAILURE + 重试次数
nixpacks.toml           去掉 nodejs_latest/python3，改 npm ci --omit=dev
.nvmrc                  新增，Node 20
.gitignore              加固：.env.*、**/node_modules、build/.gradle、日志
```

### 客户端
```
client/src/ai/aiConfig.js   新增 appToken 字段
client/src/ai/aiClient.js   代理请求带 X-App-Token；401 给出明确文案
client/src/pages/Settings.jsx  代理模式下新增「访问口令」输入框
```

### 产物
```
心笺-v2.2.apk            已重新构建（3.1 MB，含访问口令支持）
```

---

## 三、Railway 环境变量

| 变量 | 必填 | 作用 | 示例 |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter 密钥，只在服务端 | `sk-or-v1-…` |
| `APP_TOKEN` | ✅（公网必须） | App 访问口令；不设则任何人可刷额度 | 32 位随机串 |
| `AI_MODEL` | 可选 | 默认模型 | `openrouter/free` |
| `ALLOWED_MODELS` | 可选 | 模型白名单（逗号分隔），留空按免费规则判断 | `openrouter/free` |
| `ALLOWED_PROVIDERS` | 可选 | 允许的服务商，默认只有 openrouter | `openrouter` |
| `ALLOW_PAID_MODELS` | 可选 | 是否允许收费模型，**默认 false** | `false` |
| `AI_MAX_INPUT_CHARS` | 可选 | 单次文本上限 | `4000` |
| `AI_RATE_PER_MIN` | 可选 | 每 IP 每分钟 | `10` |
| `AI_RATE_PER_DAY` | 可选 | 每 IP 每天 | `200` |
| `AI_GLOBAL_DAILY` | 可选 | 全站每日总量（防刷爆） | `300` |
| `AI_TIMEOUT_MS` | 可选 | 上游超时 | `25000` |
| `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` | 可选 | 启用其他服务商才需要 | — |
| `DATABASE_URL` | 可选 | 不填则跳过数据库接口（AI 不受影响） | — |

> `PORT` 由 Railway 自动注入，代码已用 `process.env.PORT`，**不要手动设成 3001**。

---

## 四、Railway 配置结论

| 项 | 值 | 说明 |
| --- | --- | --- |
| **Root Directory** | **留空（仓库根目录）** | `server/` 是子目录，配置和 `.nvmrc` 都在根 |
| Build Command | 不需要手填（Nixpacks 按 `nixpacks.toml`） | 实际执行 `cd server && npm ci --omit=dev` |
| Start Command | `cd server && node index.js` | 写在 `railway.json`，控制台留空即可 |
| Healthcheck Path | `/health` | 返回 200 + 极简 JSON |
| 端口 | `process.env.PORT` | 自动适配 |

> ⚠️ 如果你把 Root Directory 设成 `/server`，上面的 `cd server` 就会失败。**两个方案二选一**：
> - 方案 A（推荐）：Root Directory 留空，配置保持在仓库根；
> - 方案 B：Root Directory 填 `server`。仓库里**已经备好** `server/railway.json`、`server/nixpacks.toml`、`server/.nvmrc`（命令为 `npm ci --omit=dev` 与 `node index.js`，不带 `cd server`），直接选它即可。
>
> 两套配置都已写好且互相独立，**不要混用**：Root 留空走根目录那套，Root=server 走 server/ 那套。

---

## 五、GitHub 上传前需要排除的文件

`.gitignore` 已经覆盖，提交前再确认这几类**没有**被 `git add`：

```
.env                 / server/.env        ← 真实密钥
*.db                 （reading_notes.db）
node_modules/        **/node_modules/
client/dist/  client/dist-temp/
android/  build/  .gradle/
server/uploads/*      （保留 .gitkeep）
*.log
```

自检命令：
```bash
git status --short
git ls-files | findstr /i ".env"      # 应只出现 .env.example
```

---

## 六、Railway 控制台操作步骤

1. **推代码到 GitHub**
   ```bash
   cd D:\心得笔记开发过程\reading-notes-app
   git add .
   git commit -m "prepare server for railway"
   git push
   ```
   私有仓库即可。

2. **创建项目**
   Railway → `New Project` → `Deploy from GitHub repo` → 选该仓库。

3. **确认根目录**
   Service → `Settings` → `Root Directory` **留空**。

4. **填环境变量**
   Service → `Variables` → `Raw Editor` 粘贴：
   ```
   OPENROUTER_API_KEY=sk-or-v1-你的key
   APP_TOKEN=用下面命令生成的口令
   AI_MODEL=openrouter/free
   ```

5. **生成公网域名**
   `Settings` → `Networking` → `Generate Domain`
   得到形如 `https://xxxx.up.railway.app`（**把这两个值记下来，后面填到 App**）。

6. **验证部署**
   浏览器打开 `https://xxxx.up.railway.app/health`，应返回：
   ```json
   {"status":"ok","service":"xinjian-server","uptime":123,...}
   ```
   再验证鉴权：
   ```bash
   curl -X POST https://xxxx.up.railway.app/api/ai/analyze ^
     -H "Content-Type: application/json" ^
     -H "X-App-Token: 你的口令" ^
     -d "{\"provider\":\"openrouter\",\"model\":\"openrouter/free\",\"mode\":\"whole\",\"text\":\"今天有点累\"}"
   ```
   期望返回 `{"ok":true,"data":{...}}`。**没有 Key 或口令时不要期待成功。**

7. **（可选）限制额度**
   Railway 免费额度有限，建议在 OpenRouter 侧给 Key 设 **Custom amount 小额上限**，双保险。

---

## 七、App 端需要改的位置

部署拿到域名后，只需在 App 里改**一处**（不用改代码、不用重新打包）：

**首页 ⚙ → 设置 → 调用方式 → 后端代理**
- 后端代理地址：`https://xxxx.up.railway.app`（**不要带 `/api`**）
- 访问口令：与服务端 `APP_TOKEN` 一致

填完后回到日记页，AI 卡片顶部会显示「当前：后端代理 · OpenRouter」。

> 本地开发模式不受影响：地址留空 → 自动 Mock；填 `http://192.168.x.x:3001` → 连本地代理（需把 `APP_TOKEN` 也填上，或在本地不设 `APP_TOKEN`）。
> 目前代码里**没有任何硬编码的 localhost / 局域网 IP / 虚构域名**，默认值是空字符串。

---

## 八、本地测试结果（16/16 通过）

测试脚本：`docs/test-backend.mjs`（`node docs/test-backend.mjs`）

| 用例 | 期望 | 实际 |
| --- | --- | --- |
| `GET /health` | 200 | ✅ 200 |
| 顶层 `/health` 不泄露内部配置 | 仅 status/service/uptime/node | ✅ |
| 匿名访问 `/api/ai/health` | 401 | ✅ 401 |
| 带口令访问 `/api/ai/health` | 200 且 authRequired=true | ✅ |
| 无口令调用 analyze | 401 | ✅ 401 |
| 错误口令 | 401 | ✅ 401 |
| 口令正确但无 Key | 503 | ✅ 503 |
| 收费模型 | 403 | ✅ 403 |
| 超长文本（5000 字） | 413 | ✅ 413 |
| 空文本 | 400 | ✅ 400 |
| 非法 provider | 400 | ✅ 400 |
| 连续 12 次调用 | 第 11 次起 429 | ✅ 前 10 次 503，后 3 次 429 |
| 日志中出现口令/密钥 | 无 | ✅ 无 |
| 数据库不可用时启动 | 正常启动 | ✅ 已跳过并打印提示 |

**未测试**：真实 OpenRouter 调用（没有 Key）。所以「配好 Key 后能否真的返回结果」这一条**尚未验证**，需要你拿到 Key 后自行跑一次 `curl`。

---

## 九、尚未完成 / 风险

1. **未部署**：没有 Railway 账号操作，也没有域名；不做「已部署成功」的表述。
2. **真实调用未验证**：无 Key，`/api/ai/analyze` 只走到 503 分支。
3. **`.env` 不存在**：本地调试需自行 `cp server/.env.example server/.env` 并填值。
4. **CORS 全开**：`cors()` 允许任意来源。对 WebView 影响不大（origin 为 `file://`），但若日后上 Web 版建议收紧。
5. **限流是内存态**：Railway 重启/多实例会重置计数；单实例够用，多实例需换 Redis。
6. **免费模型随时可能下架**：`openrouter/free` 若失效，需在 `AI_MODEL` 换成具体 `:free` 模型。
7. **数据库接口未启用**：`server/routes/{auth,books,notes}.js` 仍是旧代码，未做云化适配（本项目客户端不用）。
