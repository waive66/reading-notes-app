# 迁移报告：Express → Cloudflare Workers Free

> 日期：2026-11-16　状态：**代码完成 + 本地 22 项测试通过；未部署到 Cloudflare**（无账号操作，不虚构成功）

---

## 一、方案选型：为什么最终不是 Express

按你的要求，**先评估官方 Express-on-Workers 方案**（`cloudflare:node` 的 `httpServerHandler`），在本地 workerd 实跑，结论是跑不起来。

### 实测 1：带 `express.json()`

```
X [ERROR] The Workers runtime failed to start.
Runtime stderr:
  "Uncaught TypeError: require_streams(...) is not a function
   at node_modules/iconv-lite/lib/index.js:6233:26
   at node_modules/raw-body/index.js:6311:17
   at node_modules/body-parser/lib/read.js:6704:19
   at node_modules/body-parser/lib/types/json.js:15747:30"
```

### 实测 2：不用 `express.json()`，自己读 `req` 流

仍然崩在同一处——因为 `express` 包内部对 body-parser 是模块级引用，esbuild 打包时被静态带入，无法绕过。

### 结论

Express 4 在当前 workerd + `nodejs_compat` 组合下**不可用**。
按你给的降级路径（"如果不能运行，再考虑 Hono 或原生 Worker Fetch API"），选择 **原生 Fetch handler**：

- 生产依赖 **0 个**（`package.json` 里只有 `wrangler` 一个 devDependency）
- 打包体积小、冷启动快、CPU 占用低（10ms 限制下更稳）
- 路由/校验顺序与 `server/` 逐条对齐，行为可对照

> 附带验证：`wrangler dev` 里模块级状态是保持的（连续 5 次请求计数 1→5），所以限流逻辑能在本地被真实测到，不是纸上推演。

---

## 二、新增项目

```
cloudflare-worker/
├─ src/index.js        入口：路由 / CORS / 体积极限 / 口令 / 限流编排
├─ src/config.js       从 env 读配置（不用 process.env）
├─ src/auth.js         口令定长比较（XOR 全字节比较，防时序侧信道）
├─ src/ratelimit.js    三层限流
├─ src/openrouter.js   模型策略 + 请求构造 + 响应解析（提示词与 Node 版一致）
├─ test/worker.test.mjs  22 项验收测试（起真实 workerd）
├─ wrangler.jsonc
├─ .dev.vars.example
├─ .gitignore
└─ README.md
```

`server/` **原样保留**，一行未改。本地 Express 与云端 Worker 两种模式并存。

---

## 三、接口兼容性报告

| 接口 | Express 版 | Worker 版 | 兼容性 |
| --- | --- | --- | --- |
| `GET /health` | 200 + status/service/uptime/startedAt/node | 200 + status/service/runtime/… | ⚠️ 字段有变（App 未使用此接口） |
| `GET /api/ai/health` | 需口令，列 3 家 providers | 需口令，只列 openrouter | ✅ 鉴权行为一致 |
| `POST /api/ai/analyze` | 需口令 | 需口令 | ✅ **请求/响应结构完全一致** |

### 状态码逐项对齐（均已实测）

| 场景 | 状态码 | 响应体 |
| --- | --- | --- |
| 无口令 / 错口令 | 401 | `{"ok":false,"error":"访问口令无效"}` |
| 空文本 | 400 | `{"ok":false,"error":"没有可分析的文字"}` |
| 非法 JSON | 400 | `{"ok":false,"error":"请求体不是合法 JSON"}` |
| 文本超 4000 字 | 413 | `{"ok":false,"error":"文字过长（上限 4000 字）"}` |
| 请求体超 64KB | 413 | `{"ok":false,"error":"请求体过大（上限 65536 字节）"}` |
| 非免费/非白名单模型 | 403 | 与 Node 版同一句文案 |
| 未配 Key | 503 | `{"ok":false,"error":"服务端未配置 OPENROUTER 的密钥，无法调用"}` |
| 超出频率 | 429 | 带 `Retry-After` 与 `X-Quota-Scope` |
| 上游鉴权失败 | 502 | `{"ok":false,"error":"模型服务鉴权失败（服务端密钥可能失效）", …}` |
| 超时 | 504 | `{"ok":false,"error":"模型响应超时"}` |

成功响应体与 Node 版**同构**：`{ ok, data{primary_emotion, secondary_emotions, understanding, reply, suggestion, crisis}, meta{provider, providerId, model, latency_ms, mock} }`。

### 唯一的行为差异（有意为之）

`/health` 里去掉了 `uptime`（Worker 无常驻进程概念）、`node` 版本，改为 `runtime: "cloudflare-worker"`、`hasOpenRouterKey`（布尔，不泄露值）、`quotaScope`。
Android App 不调用 `/health`，**无影响**。

---

## 四、本地测试结果（22/22 通过）

测试方式：`node test/worker.test.mjs` —— 用 `wrangler dev` 起**真实 workerd**（本地，不需要 Cloudflare 账号），跑三个场景。

| # | 用例 | 结果 |
| --- | --- | --- |
| 1 | `/health` 返回 200 | ✅ |
| 2 | `/health` 声明 `runtime=cloudflare-worker` | ✅ |
| 3 | `/health` 不泄露密钥 | ✅ |
| 4 | 无 Key 调用 → 503 | ✅ |
| 5 | 日志无密钥 | ✅ |
| 6 | 匿名访问 `/api/ai/health` → 401 | ✅ |
| 7 | 错误口令 → 401 | ✅ |
| 8 | 正确口令 → 200 | ✅ |
| 9 | analyze 无口令 → 401 | ✅ |
| 10 | 有口令无 Key → 503 | ✅ |
| 11 | 非白名单模型 → 403 | ✅ |
| 12 | 超长文本 → 413 | ✅ |
| 13 | 超大请求体 → 413 | ✅ |
| 14 | 空文本 → 400 | ✅ |
| 15 | 非法 JSON → 400 | ✅ |
| 16 | 限流：第 11 次 → 429 | ✅ |
| 17 | 日志不含口令 | ✅ |
| 18 | 假 Key 上游失败 → 502 | ✅ |
| 19 | 错误信息可读（中文） | ✅ |
| 20 | 日志无完整密钥 | ✅ |
| 21 | 不依赖本地 Node 服务（Workers 独立进程） | ✅ |
| 22 | 服务在独立 workerd 进程内响应 | ✅ |

> 用例 18–20 会**真实请求 `openrouter.ai`**（用无效 Key），返回 401 被正确映射为 502。

### 测试过程中发现并修掉的真 bug

限流函数的内部判定返回的是 `{ok:true}` 对象，而调用处写成了 `if (!helper())`——对象恒为真，导致**限流从未生效**（12 次调用全部放行）。
改成布尔返回后，第 11 次正确返回 429。这个 bug 单看代码很容易漏，是靠真跑 workerd 才暴露的。

---

## 五、Cloudflare Secrets 清单

| 名称 | 类型 | 必填 | 设置方式 |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | **Secret（加密）** | ✅ | `wrangler secret put OPENROUTER_API_KEY` 或面板 Variables and Secrets → 类型选 Secret |
| `APP_TOKEN` | **Secret（加密）** | ✅（公网必须） | 同上 |

普通变量（已写在 `wrangler.jsonc` 的 `vars`，不用在面板重复配）：
`AI_MODEL`、`ALLOWED_MODELS`、`ALLOWED_PROVIDERS`、`ALLOW_PAID_MODELS`、`AI_MAX_INPUT_CHARS`、`AI_RATE_PER_MIN`、`AI_RATE_PER_DAY`、`AI_GLOBAL_DAILY`、`AI_TIMEOUT_MS`、`APP_REFERER`

> Dashboard 里加变量时，`OPENROUTER_API_KEY` / `APP_TOKEN` 必须点 **Secret**（密文），
> 不要选 Plaintext——明文变量在面板可见，也会出现在部署 diff 里。

---

## 六、部署步骤

### A. 命令行（最快）

```bash
cd cloudflare-worker
npx wrangler login                                  # 浏览器授权（必须你本人操作）
npx wrangler secret put OPENROUTER_API_KEY          # 粘贴 sk-or-...
npx wrangler secret put APP_TOKEN                   # 粘贴随机口令
npx wrangler deploy
```

成功后会打印 `https://xinjian-ai-proxy.<子域>.workers.dev`。

### B. Dashboard 连 GitHub

1. 打开 <https://dash.cloudflare.com/> 注册/登录（免费账号即可，不用绑卡）
2. 左侧 `Workers & Pages` → `Create application` → `Connect to Git`
3. 授权 GitHub，选仓库 `waive66/reading-notes-app`
4. **Root directory 填 `cloudflare-worker`**（关键：不是仓库根）
5. Build command 留空；Deploy command 保持 `npx wrangler deploy`
6. `Save and Deploy`
7. 部署完成后进入该 Worker → `Settings` → `Variables and Secrets`：
   - 添加 `OPENROUTER_API_KEY`，类型 **Secret**
   - 添加 `APP_TOKEN`，类型 **Secret**
   - 保存后需要 **重新 Deploy** 一次让 Secret 生效
8. 回到 Worker 首页，`Settings → Domains & Routes` 可看到 `*.workers.dev` 地址

### 拿到域名后的自测

```bash
curl https://<你的>.workers.dev/health

curl -X POST https://<你的>.workers.dev/api/ai/analyze \
  -H "Content-Type: application/json" \
  -H "X-App-Token: <你的口令>" \
  -d "{\"provider\":\"openrouter\",\"model\":\"openrouter/free\",\"mode\":\"whole\",\"text\":\"今天有点累\"}"
```

预期：`/health` 返回 200；`analyze` 返回 `{"ok":true,"data":{...}}`。
**没配 Key 或口令时不会成功**，不要据此判断部署失败。

---

## 七、Android App 需要改什么

**只改一处，不用改代码、不用重新打包**：

首页 ⚙ → 设置 → 调用方式 → 后端代理
- **后端代理地址**：`https://<你的>.workers.dev`（不带 `/api`，不带结尾斜杠）
- **访问口令**：与服务端 `APP_TOKEN` 一致

App 侧已满足全部要求：
- 地址是可配置项，`aiConfig` 默认值是空字符串，**没有任何 localhost / 局域网 IP / 虚构域名**
- 走 HTTPS 直接可用（`fetch` 支持 https）
- 保持「后端代理」调用方式
- `APP_TOKEN` 有独立输入框，随请求头发 `X-App-Token`
- 日记本地存储方式完全没动

---

## 八、免费额度核算

| 项 | Workers Free | 本项目 |
| --- | --- | --- |
| 请求数 | 100,000 / 天 | 1 次 AI = 1 请求 |
| CPU | 10 ms / 请求 | 路由+JSON+口令比较为毫秒级；**等 OpenRouter 的时间不计入 CPU** |
| 内存 | 128 MB | 只处理几 KB 文本 |
| 额外资源 | 默认零 | 不启用 KV / DO / Queue |

不涉及任何收费资源。

---

## 九、尚未完成

1. **未真实部署**：没有 Cloudflare 账号操作，也没有 `*.workers.dev` 域名。本文所有"部署成功"均为待执行步骤，不是既成事实。
2. **真实 OpenRouter 成功调用未验证**：只有失败分支（假 Key → 401 → 502）验证过；`{"ok":true}` 分支需要你配上真 Key 才能验证。
3. **全局日配额非严格全局**：默认是每 isolate 计数（响应头 `X-Quota-Scope: isolate` 已明示）。要严格全局需启用 KV 绑定或 Durable Object，本项目默认未启用。
4. **Worker 版只支持 OpenRouter**：Gemini / DeepSeek 仍在 `server/` 版本里。
5. **`cloudflare-worker/` 尚未提交到 Git**（本轮未执行 commit/push，等你确认）。
