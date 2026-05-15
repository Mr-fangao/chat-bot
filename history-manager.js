import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = path.join(__dirname, 'data', 'history');

class HistoryManager {
  constructor() {
    this.cache = new Map(); // targetId -> messages[]
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }

  _targetDir(targetId) {
    const dir = path.join(HISTORY_DIR, String(targetId));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  _filePath(targetId) {
    return path.join(this._targetDir(targetId), 'messages.json');
  }

  // ========== 加载/保存 ==========

  load(targetId) {
    if (this.cache.has(targetId)) return this.cache.get(targetId).length;
    const fp = this._filePath(targetId);
    if (fs.existsSync(fp)) {
      try {
        const msgs = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        this.cache.set(targetId, msgs);
        return msgs.length;
      } catch (e) {
        this.cache.set(targetId, []);
        return 0;
      }
    }
    this.cache.set(targetId, []);
    return 0;
  }

  save(targetId) {
    const msgs = this.cache.get(targetId) || [];
    const fp = this._filePath(targetId);
    fs.writeFileSync(fp, JSON.stringify(msgs, null, 2), 'utf-8');
  }

  // ========== 消息操作 ==========

  addMessage(targetId, role, content, time) {
    if (!this.cache.has(targetId)) this.load(targetId);
    const msgs = this.cache.get(targetId);
    const msg = { role, content, time: time || new Date().toISOString() };
    msgs.push(msg);
    this._appendToFile(targetId, msg);
  }

  _appendToFile(targetId, msg) {
    const fp = this._filePath(targetId);
    try {
      if (!fs.existsSync(fp) || fs.statSync(fp).size < 5) {
        fs.writeFileSync(fp, '[\n' + JSON.stringify(msg, null, 2) + '\n]', 'utf-8');
        return;
      }
      const fd = fs.openSync(fp, 'r+');
      const stat = fs.statSync(fp);
      let pos = stat.size - 1;
      const buf = Buffer.alloc(1);
      while (pos > 0) {
        fs.readSync(fd, buf, 0, 1, pos);
        if (buf.toString() === ']') break;
        pos--;
      }
      const prefix = (pos > 2) ? ',\n' : '\n';
      const chunk = prefix + JSON.stringify(msg, null, 2) + '\n]';
      fs.writeSync(fd, chunk, pos);
      fs.closeSync(fd);
    } catch (e) {
      this.save(targetId);
    }
  }

  // ========== 查询 ==========

  getRecent(targetId, count = 10) {
    if (!this.cache.has(targetId)) this.load(targetId);
    const msgs = this.cache.get(targetId);
    return msgs.slice(-count);
  }

  getMessageCount(targetId) {
    if (!this.cache.has(targetId)) this.load(targetId);
    return this.cache.get(targetId).length;
  }

  // ========== 上下文构建 ==========

  buildContext(targetId, count = 300) {
    if (!this.cache.has(targetId)) this.load(targetId);
    const msgs = this.cache.get(targetId);
    const recent = msgs.slice(-count);

    const parts = ['【最近聊天记录（从旧到新）】'];
    const merged = this._mergeConsecutive(recent, 60);
    for (const msg of merged) {
      const label = msg.role === 'me' ? '我' : '对方';
      parts.push(label + ': ' + msg.content);
    }
    return parts.join('\n');
  }

  _mergeConsecutive(messages, maxGapSeconds) {
    if (messages.length === 0) return [];
    const result = [];
    let current = { ...messages[0] };
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const curr = messages[i];
      const gap = (new Date(curr.time) - new Date(prev.time)) / 1000;
      if (curr.role === current.role && gap < maxGapSeconds) {
        current.content += '。' + curr.content;
      } else {
        result.push(current);
        current = { ...curr };
      }
    }
    result.push(current);
    return result;
  }

  // ========== 导入 ==========

  importMessages(targetId, messages) {
    if (!this.cache.has(targetId)) this.load(targetId);
    const msgs = this.cache.get(targetId);
    const existing = new Set(msgs.map(m => m.time + m.content.substring(0, 20)));
    let added = 0;
    for (const m of messages) {
      const key = m.time + m.content.substring(0, 20);
      if (!existing.has(key)) {
        msgs.push(m);
        existing.add(key);
        added++;
      }
    }
    msgs.sort((a, b) => new Date(a.time) - new Date(b.time));
    this.save(targetId);
    return added;
  }

  getMessageCount(targetId) {
    if (!this.cache.has(targetId)) this.load(targetId);
    return this.cache.get(targetId).length;
  }
}

export default HistoryManager;
