# 心笺 AI 代理 · Cloudflare Workers 版

用 **Cloudflare Workers Free** 跑 AI 代理，替代原来的 Node.js / Express 服务。
接口与 `server/` 版本保持一致，Android App 只改「后端地址」即可切换，不用改代码。

---

## 为什么不是 Express（实测结论）

按你的要求先评估了官方 Express-on-Workers 方案（`cloudflare:node` 的 `httpServerHandler`）。
**实测在 workerd 里无法启动**，两种写法都崩在同一处：

```
Uncaught TypeError: require_streams(...) is not a function
  at node_modules/iconv-lite/lib/index.js
  at node_modules/raw-body/index.js
  at node_modules/body-parser/lib/read.js
  at node_modules/body-parser/lib/types/json.js
```

- 变体 1：`app.use(express.json())` → 崩
- 变体 2：**完全不用** `express.json()`，自己读 `req` 流 → 仍然崩
  （因为 `express` 包内部对 body-parser 是模块级引用，esbuild 打包时被静态带入）

结论：Express 4 在这套 workerd + nodejs_compat 组合下不可用。
按你给的降级路径，改用**原生 Fetch handler**，零运行时依赖（生产依赖为 0）。

> 附：`wrangler dev` 的模块级状态是**保持**的（实测连续 5 次请求计数 1→5），
> 所以限流逻辑在本地可以被真实测到。

---

## 目录

```
cloudflare-worker/
├─ src/
│  ├─ index.js       入口：路由、CORS、体积极限、口令、限流编排
│  ├─ config.js      从 Worker env 读配置（不是 process.env）
│  ├─ auth.js        口令定长比较（防时序侧信道）
│  ├─ ratelimit.js   三层限流（绑定 / KV / 进程内）
│  └─ openrouter.js  模型策略、请求构造、响应解析
├─ test/worker.test.mjs   22 项验收测试（起真实 workerd 跑）
├─ wrangler.jsonc
├─ .dev.vars.example
└─ .gitignore
```

---

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/health` | 公开 | 只返回状态、运行时、限额与 `hasOpenRouterKey` 布尔值 |
| GET | `/api/ai/health` | 需 `APP_TOKEN` | 自检：服务商可用性、默认模型、限额、`quotaScope` |
| POST | `/api/ai/analyze` | 需 `APP_TOKEN` | 情绪分析，返回结构与原版一致 |

请求：

```json
{ "provider": "openrouter", "model": "openrouter/free", "mode": "whole", "text": "今天有点累" }
```

响应（成功）：

```json
{ "ok": true, "data": { "primary_emotion": "...", "secondary_emotions": [], "understanding": "...", "reply": "...", "suggestion": "...", "crisis": false }, "meta": { "provider": "proxy", "providerId": "openrouter", "model": "...", "latency_ms": 1234, "mock": false } }
```

错误码：`400` 空文本/非法 JSON，`401` 口令错误，`403` 模型不在白名单，`413` 文本或请求体过大，`429` 限流，`502` 上游失败，`503` 未配置密钥，`504` 超时。

---

## 本地开发

```bash
cd cloudflare-worker
npm install
cp .dev.vars.example .dev.vars      # 填 APP_TOKEN / OPENROUTER_API_KEY
npx wrangler dev                    # http://127.0.0.1:8787
node test/worker.test.mjs           # 22 项验收测试
```

`.dev.vars` 已被 `.gitignore` 忽略，不会提交。

---

## 部署

### 方式一：命令行（推荐，最快）

```bash
cd cloudflare-worker
npx wrangler login
npx wrangler secret put OPENROUTER_API_KEY     # 粘贴 Key
npx wrangler secret put APP_TOKEN              # 粘贴口令
npx wrangler deploy
```

部署成功会打印 `https://xinjian-ai-proxy.<你的子域>.workers.dev`。

### 方式二：Dashboard 连 GitHub

1. 仓库已包含 `cloudflare-worker/` 目录
2. Cloudflare Dashboard → `Workers & Pages` → `Create` → `Connect to Git` → 选仓库
3. **Root directory 填 `cloudflare-worker`**（不是仓库根）
4. Build command 留空（本项目无构建步骤），Deploy command 保持 `npx wrangler deploy`
5. 部署后进 `Settings → Variables and Secrets`：
   - `OPENROUTER_API_KEY` → **类型选 Secret（加密）**
   - `APP_TOKEN` → **类型选 Secret（加密）**
6. 普通变量已在 `wrangler.jsonc` 的 `vars` 里声明，不需要在面板重复添加

> ⚠️ 一定要用 **Secret**，不要用 Plaintext/Text 变量——后者在面板里可见，也会出现在部署 diff 里。

### 需要的 Secret

| 名称 | 必填 | 说明 |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | ✅ | 只在 Worker 环境里，不进代码、不进 Git |
| `APP_TOKEN` | ✅（公网必填） | App 访问口令，生成：`openssl rand -hex 24` |

---

## 限流与配额（诚实说明）

| 层级 | 实现 | 准确度 |
| --- | --- | --- |
| 每客户端每分钟 / 每天 | 进程内计数 | **单个 isolate 内准确**；多 isolate 会各算各的 |
| 全站每日 | 进程内（默认）或 KV（可选绑定） | 进程内=每 isolate 各算；KV=跨 isolate 但**最终一致，可能少算** |
| `RATE_LIMITER` 绑定 | Cloudflare Rate Limiting | 若绑定则生效，失败时自动降级到进程内 |

响应头 `X-Quota-Scope` 与 `/health` 里的 `quotaScope` 会明示当前作用域
（`isolate` / `kv-approximate` / `binding+isolate`），**不会把进程内计数说成全局准确值**。

如果需要严格全局配额，正确做法是 Durable Object（本项目未默认启用，避免依赖不确定的免费额度）。
对单人使用的日记 App，`isolate` 级限流 + `AI_GLOBAL_DAILY` 已经够用。

---

## 免费额度核算

| 项 | 免费额度 | 本项目占用 |
| --- | --- | --- |
| 请求数 | 100,000 / 天 | 每次 AI 分析 1 次；日常用远低于此 |
| CPU 时间 | 10 ms / 请求 | 路由 + JSON 解析 + 口令比较，实测在毫秒级；**等待 OpenRouter 的时间不计入 CPU** |
| 内存 | 128 MB | 只处理几 KB 文本 |
| 持久化 | 默认不用 | KV 仅为可选 |

不依赖任何收费资源。

---

## 与 Express 版的差异

| 项 | Express 版（server/） | Worker 版 |
| --- | --- | --- |
| 运行时 | Node 20 | workerd |
| `/health` 字段 | status/service/uptime/startedAt/node | status/service/runtime/hasOpenRouterKey/authRequired/allowPaidModels/limits/quotaScope |
| `/api/ai/health` | 含 providers 三家 | 只列 openrouter（Worker 版仅实现 OpenRouter） |
| 其他接口 | 同 | 同（状态码、错误文案、成功结构一致） |

App 只依赖 `POST /api/ai/analyze` 的请求/响应结构，**未受影响**。

---

## 未完成 / 限制

1. Worker 版只实现 **OpenRouter**；Gemini / DeepSeek 仍需用 `server/` 版本。
2. 未做真实云端部署（无 Cloudflare 账号操作），仅本地 workerd 全量测试。
3. 真实 OpenRouter 成功调用未验证（只有失败分支用假 Key 验证过）。
4. 全局日配额默认是每 isolate 计数，非严格全局。

---

## 部署根目录（Cloudflare 连接 Git 时必须填对）

Cloudflare Workers Builds 的 **Root directory 必须填 `cloudflare-worker`**。
填 `/`（仓库根）会找不到 `wrangler.jsonc`，构建虽然显示绿色，但部署的是空的占位 Worker。

正确配置：

| 项 | 值 |
| --- | --- |
| Root directory | `cloudflare-worker` |
| Build command | 留空（None） |
| Deploy command | `npx wrangler deploy` |

本地已验证：`npx wrangler deploy --dry-run` → `Total Upload: 17.59 KiB / gzip: 5.87 KiB`。
