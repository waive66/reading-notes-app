const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./database');
const aiRoutes = require('./routes/ai');

const app = express();
const PORT = process.env.PORT || 3001;
const STARTED_AT = new Date().toISOString();

// Railway / 反向代理后面，才能拿到真实客户端 IP（限流依赖它）
app.set('trust proxy', 1);

app.use(cors());

// AI 接口单独用更小的体积上限：日记文本只是文字，不该有 10MB
app.use('/api/ai', express.json({ limit: '64kb' }));
app.use('/api/ai', aiRoutes);

// 其余接口（数据库相关）保留大一点的体积，但也不再是 10MB
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 健康检查：Railway healthcheck 用。不依赖数据库、不输出任何密钥
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'xinjian-server',
    uptime: Math.round(process.uptime()),
    startedAt: STARTED_AT,
    node: process.version
  });
});

// 数据库相关接口只在配置了 DATABASE_URL 时挂载，避免云端一直报错刷屏
const hasDb = !!process.env.DATABASE_URL;
if (hasDb) {
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/books', require('./routes/books'));
  app.use('/api/notes', require('./routes/notes'));
  initDb()
    .then(() => console.log('[db] ready'))
    .catch((err) => console.warn('[db] unavailable:', err.message));
} else {
  console.log('[db] DATABASE_URL 未配置，跳过数据库相关接口（AI 代理不受影响）');
}

// 兜底错误处理：不回传堆栈，避免泄露内部信息
app.use((err, req, res, next) => {
  console.error('[error]', err && err.name);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: '服务器内部错误' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[start] listening on 0.0.0.0:${PORT}`);
  console.log(`[start] health: /health  |  ai: /api/ai/analyze`);
  console.log(`[start] openrouter key configured: ${!!process.env.OPENROUTER_API_KEY}`);
  console.log(`[start] app token required: ${!!process.env.APP_TOKEN}`);
});

// 容器优雅退出（Railway 重新部署时会发 SIGTERM）
['SIGTERM', 'SIGINT'].forEach((sig) => {
  process.on(sig, () => {
    console.log(`[stop] ${sig} received, closing...`);
    server.close(() => process.exit(0));
  });
});
