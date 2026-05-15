import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cors from 'cors';
import open from 'open';

import NapcatBridge from './napcat-bridge.js';
import AIClient from './ai-client.js';
import HistoryManager from './history-manager.js';
import TargetManager from './target-manager.js';
import PromptManager from './prompt-manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3456;
const NAPCAT_CACHE = path.join(__dirname, 'napcat', 'cache');
const QR_FILE = path.join(NAPCAT_CACHE, 'qrcode.png');

// ========== 加载配置 ==========
function loadConfig() {
  const fp = path.join(__dirname, 'config.json');
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

const config = loadConfig();

// ========== 初始化模块 ==========
const targetMgr = new TargetManager();
const promptMgr = new PromptManager();
const historyMgr = new HistoryManager();
const aiClient = new AIClient({ ...config.ai, messageSplitThreshold: config.app.messageSplitThreshold });

// 预加载所有 target 的历史
for (const t of targetMgr.getEnabled()) {
  historyMgr.load(t.id);
}

// ========== Express + HTTP ==========
const app = express();
app.use(cors());
app.use(express.json());

// QR 二维码图片
app.get('/api/qrcode', (req, res) => {
  if (fs.existsSync(QR_FILE)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(QR_FILE).pipe(res);
  } else {
    res.status(404).json({ error: 'qrcode not ready' });
  }
});

// 登录状态
app.get('/api/status', (req, res) => {
  res.json({ online: napcat?.isOnline || false, account: napcat?.account || '' });
});

// 聊天对象 CRUD
app.get('/api/targets', (req, res) => {
  res.json(targetMgr.getAll());
});

app.post('/api/targets', (req, res) => {
  const ok = targetMgr.add(req.body);
  if (ok) { historyMgr.load(req.body.id); res.json({ success: true }); }
  else res.status(400).json({ error: '已存在或参数错误' });
});

app.put('/api/targets/:id', (req, res) => {
  const ok = targetMgr.update(req.params.id, req.body);
  if (ok) res.json({ success: true });
  else res.status(404).json({ error: 'not found' });
});

app.delete('/api/targets/:id', (req, res) => {
  const ok = targetMgr.remove(req.params.id);
  if (ok) res.json({ success: true });
  else res.status(404).json({ error: 'not found' });
});

// 历史记录
app.get('/api/targets/:id/history', (req, res) => {
  const count = parseInt(req.query.count) || 100;
  res.json(historyMgr.getRecent(req.params.id, count));
});

// 切换模式
app.put('/api/targets/:id/mode', (req, res) => {
  const { mode } = req.body;
  if (!['auto', 'review', 'manual'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be auto/review/manual' });
  }
  const ok = targetMgr.update(req.params.id, { mode });
  if (ok) {
    broadcast({ type: 'mode_changed', targetId: req.params.id, mode });
    res.json({ success: true });
  } else res.status(404).json({ error: 'not found' });
});

// 角色模板
app.get('/api/roles', (req, res) => res.json(promptMgr.getAll()));
app.get('/api/roles/:name', (req, res) => {
  const r = promptMgr.get(req.params.name);
  if (r) res.json(r); else res.status(404).json({ error: 'not found' });
});
app.put('/api/roles/:name', (req, res) => {
  const ok = promptMgr.update(req.params.name, req.body);
  if (ok) res.json({ success: true });
  else res.status(404).json({ error: 'not found' });
});

// 手动发送消息
app.post('/api/send', async (req, res) => {
  const { targetId, text, type } = req.body;
  if (!napcat?.isOnline) return res.status(503).json({ error: 'QQ offline' });
  try {
    if (type === 'group') await napcat.sendGroupMsg(targetId, text);
    else await napcat.sendPrivateMsg(targetId, text);
    historyMgr.addMessage(targetId, 'me', text);
    broadcast({ type: 'bot_reply', targetId, content: text, time: new Date().toISOString() });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 生产模式：serve Vue dist；开发模式：proxy 到 Vite
const DIST = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    const fp = path.join(DIST, req.path === '/' ? 'index.html' : req.path);
    if (fs.existsSync(fp)) return res.sendFile(fp);
    res.sendFile(path.join(DIST, 'index.html'));
  });
}

const httpServer = createServer(app);

// ========== WebSocket ==========
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  // 发送当前状态
  ws.send(JSON.stringify({
    type: 'init',
    online: napcat?.isOnline || false,
    targets: targetMgr.getAll(),
    roles: promptMgr.getAll(),
    qrReady: fs.existsSync(QR_FILE)
  }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      handleClientMsg(ws, data);
    } catch (e) {}
  });

  ws.on('close', () => clients.delete(ws));
});

async function handleClientMsg(ws, data) {
  switch (data.type) {
    case 'confirm_reply': {
      const { targetId, approved, reply } = data;
      if (approved && reply) {
        const target = targetMgr.getById(targetId);
        if (napcat?.isOnline) {
          try {
            if (target?.type === 'group') await napcat.sendGroupMsg(targetId, reply);
            else await napcat.sendPrivateMsg(targetId, reply);
            historyMgr.addMessage(targetId, 'me', reply);
            broadcast({ type: 'bot_reply', targetId, content: reply, time: new Date().toISOString() });
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: '发送失败: ' + e.message }));
          }
        }
      }
      break;
    }
    case 'switch_target': {
      const msgs = historyMgr.getRecent(data.targetId, 100);
      ws.send(JSON.stringify({ type: 'history', targetId: data.targetId, messages: msgs }));
      break;
    }
  }
}

// ========== NapCat Bridge ==========
let napcat = null;
let _reviewTimers = {}; // targetId -> { reply, timeout }

async function initNapcat() {
  napcat = new NapcatBridge(config.qq);

  napcat.on('online', () => {
    console.log('[Server] QQ 在线');
    broadcast({ type: 'login_status', online: true, account: napcat.account });
  });

  napcat.on('offline', () => {
    console.log('[Server] QQ 离线');
    broadcast({ type: 'login_status', online: false });
  });

  napcat.on('message', async (msg) => {
    const target = targetMgr.getById(msg.targetId);

    // 如果是未知对象且为私聊，自动添加
    if (!target && msg.type === 'friend') {
      targetMgr.add({ id: msg.targetId, type: 'friend', name: msg.targetId, role: 'friend', mode: 'manual' });
      historyMgr.load(msg.targetId);
    }
    const t = target || targetMgr.getById(msg.targetId);
    if (!t || !t.enabled) return;

    // 群聊只读
    if (t.type === 'group' || (t.role === 'group')) {
      const senderName = msg.senderName || msg.senderId || '';
      historyMgr.addMessage(msg.targetId, senderName, msg.text, msg.time);
      broadcast({ type: 'new_message', targetId: msg.targetId, role: 'group', senderName, content: msg.text, time: msg.time });
      return;
    }

    // 记录消息
    historyMgr.addMessage(msg.targetId, 'her', msg.text, msg.time);
    broadcast({ type: 'new_message', targetId: msg.targetId, role: 'her', content: msg.text, time: msg.time });

    // 根据模式处理
    if (t.mode === 'manual') return;

    // 生成 AI 回复
    const role = promptMgr.get(t.role);
    const context = historyMgr.buildContext(msg.targetId, 300);
    let systemPrompt = role.prompt + '\n\n上下文格式说明："我"是你之前说的话，"对方"是对方说的话。';

    // 负面情绪检测
    if (aiClient.hasNegativeEmotion(msg.text)) {
      systemPrompt += '\n她现在生气了。不要长篇道歉，回一句话表达在意的态度。简短。';
    }

    try {
      const reply = await aiClient.generateReply(systemPrompt, context, msg.text);
      const filtered = aiClient.filterReply(reply);

      if (!filtered) return;

      if (t.mode === 'auto') {
        // 自动发送
        if (napcat?.isOnline) {
          await napcat.sendPrivateMsg(msg.targetId, filtered);
          historyMgr.addMessage(msg.targetId, 'me', filtered);
          broadcast({ type: 'bot_reply', targetId: msg.targetId, content: filtered, time: new Date().toISOString(), mode: 'auto' });
        }
      } else if (t.mode === 'review') {
        // 审核模式：发给前端确认
        broadcast({
          type: 'review_request',
          targetId: msg.targetId,
          original: msg.text,
          reply: filtered,
          time: msg.time
        });
      }
    } catch (e) {
      console.error('[Server] AI 生成失败: ' + e.message);
    }
  });

  try {
    await napcat.connect();
  } catch (e) {
    console.error('[Server] NapCat 连接失败: ' + e.message);
  }
}

// ========== QR 文件监听 ==========
let qrReady = false;
function checkQr() {
  if (!qrReady && fs.existsSync(QR_FILE)) {
    qrReady = true;
    console.log('[Server] 二维码已就绪');
    broadcast({ type: 'qr_ready' });
  }
}
checkQr();
setInterval(checkQr, 2000);

// ========== 启动 ==========
httpServer.listen(PORT, async () => {
  console.log('[Server] 后端已启动: http://localhost:' + PORT);
  await initNapcat();
  // 自动打开浏览器（延迟等前端 ready）
  setTimeout(() => open('http://localhost:' + PORT), 1500);
});

// ========== 优雅退出 ==========
process.on('SIGINT', async () => {
  console.log('\n[Server] 正在退出...');
  if (napcat) await napcat.disconnect();
  for (const t of targetMgr.getAll()) historyMgr.save(t.id);
  process.exit(0);
});
