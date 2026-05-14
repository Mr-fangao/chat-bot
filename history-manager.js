const fs = require('fs');
const path = require('path');

class HistoryManager {
  /**
   * @param {string} dataDir  - 聊天记录存储目录路径
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.historyFile = path.join(dataDir, 'history.json');
    this.keyInfoFile = path.join(dataDir, 'key-info.json');
    this.importDir = path.join(dataDir, 'import');
    this.messages = [];
    this.keyInfo = {};
    this._ensureDirs();
  }

  // ========== 初始化 ==========

  _ensureDirs() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.importDir)) {
      fs.mkdirSync(this.importDir, { recursive: true });
    }
  }

  // ========== JSON 读写 ==========

  /** 加载已有的 history.json，如果为空则尝试从 import/ 导入 TXT */
  loadHistory(qqAccount) {
    this.qqAccount = qqAccount;
    // 加载 key-info
    if (fs.existsSync(this.keyInfoFile)) {
      try {
        this.keyInfo = JSON.parse(fs.readFileSync(this.keyInfoFile, 'utf-8'));
      } catch (e) {
        console.warn('[History] key-info.json 解析失败，将重新提取');
        this.keyInfo = {};
      }
    }

    // 加载 history.json
    if (fs.existsSync(this.historyFile)) {
      try {
        const raw = fs.readFileSync(this.historyFile, 'utf-8');
        this.messages = JSON.parse(raw);
        if (!Array.isArray(this.messages)) this.messages = [];
        console.log(`[History] 已加载 ${this.messages.length} 条历史记录`);
      } catch (e) {
        console.warn('[History] history.json 解析失败: ' + e.message);
        this.messages = [];
      }
    }

    // 如果 JSON 为空，尝试从 import/ 导入 TXT
    if (this.messages.length === 0) {
      const imported = this._importTxtFromDir();
      if (imported > 0) {
        console.log(`[History] 从 TXT 导入 ${imported} 条记录`);
      }
    }
  }

  /** 保存 messages 到 history.json */
  saveHistory() {
    try {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.historyFile, JSON.stringify(this.messages, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.error('[History] 保存 history.json 失败: ' + e.message);
      return false;
    }
  }

  /** 保存关键信息 */
  saveKeyInfo() {
    try {
      fs.writeFileSync(this.keyInfoFile, JSON.stringify(this.keyInfo, null, 2), 'utf-8');
      return true;
    } catch (e) {
      console.error('[History] 保存 key-info.json 失败: ' + e.message);
      return false;
    }
  }

  // ========== 消息写入 ==========

  /** 追加一条消息 */
  addMessage(role, content, time) {
    const msg = {
      role: role,        // "me" | "her"
      content: content,
      time: time || new Date().toISOString()
    };
    this.messages.push(msg);

    // 自动保存（追加模式，轻量）
    this._appendToFile(msg);
  }

  /** 追加写入文件（避免全量重写大文件） */
  _appendToFile(msg) {
    try {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // 文件不存在或为空数组 → 全量写入
      if (!fs.existsSync(this.historyFile)) {
        fs.writeFileSync(this.historyFile, '[\n' + JSON.stringify(msg, null, 2) + '\n]', 'utf-8');
        return;
      }

      // 已有内容 → 替换结尾的 ] 追加
      const stat = fs.statSync(this.historyFile);
      if (stat.size < 5) {
        fs.writeFileSync(this.historyFile, '[\n' + JSON.stringify(msg, null, 2) + '\n]', 'utf-8');
        return;
      }

      const fd = fs.openSync(this.historyFile, 'r+');
      // 从末尾往前找最后一个 ]
      let pos = stat.size - 1;
      const buf = Buffer.alloc(1);
      while (pos > 0) {
        fs.readSync(fd, buf, 0, 1, pos);
        if (buf.toString() === ']') break;
        pos--;
      }
      // 在 ] 位置写入新内容
      const prefix = (pos > 2) ? ',\n' : '\n';
      const chunk = prefix + JSON.stringify(msg, null, 2) + '\n]';
      fs.writeSync(fd, chunk, pos);
      fs.closeSync(fd);
    } catch (e) {
      // 追加失败则全量写入兜底
      // console.warn('[History] 追加写入失败，尝试全量保存');
      this.saveHistory();
    }
  }

  // ========== TXT 导入 ==========

  /** 扫描 import/ 目录，导入所有 txt 文件 */
  _importTxtFromDir() {
    if (!fs.existsSync(this.importDir)) return 0;

    const files = fs.readdirSync(this.importDir).filter(f => f.endsWith('.txt'));
    let total = 0;
    for (const file of files) {
      const filePath = path.join(this.importDir, file);
      const count = this.importTxt(filePath);
      total += count;
      // 导入后移走（避免重复导入）
      try {
        const doneDir = path.join(this.importDir, '_imported');
        if (!fs.existsSync(doneDir)) fs.mkdirSync(doneDir, { recursive: true });
        fs.renameSync(filePath, path.join(doneDir, file));
      } catch (e) { /* ignore */ }
    }
    if (total > 0) this.saveHistory();
    return total;
  }

  /**
   * 解析 QQ 官方导出的 TXT 聊天记录
   * 格式示例：
   *   2024-01-01 12:00:00 昵称(123456)
   *   消息内容第一行
   *   消息内容第二行
   *
   *   2024-01-01 12:00:30 另一个昵称(987654)
   *   回复内容
   */
  importTxt(filePath) {
    if (!fs.existsSync(filePath)) {
      console.error('[History] TXT 文件不存在: ' + filePath);
      return 0;
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split(/\r?\n/);

    // 时间戳 + 昵称 + QQ号的正则
    const headerRe = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}:\d{2})\s+(.+?)\((\d+)\)\s*$/;

    const imported = [];
    let currentMsg = null;

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(headerRe);

      if (match) {
        // 遇到新消息头 → 保存上一条
        if (currentMsg && currentMsg.content) {
          imported.push(currentMsg);
        }

        const qqNum = match[3];
        const role = (String(qqNum) === String(this.qqAccount)) ? 'me' : 'her';
        currentMsg = {
          role: role,
          content: '',
          time: this._normalizeTime(match[1])
        };
      } else if (currentMsg && trimmed.length > 0) {
        // 消息正文
        // 过滤系统消息
        if (this._isSystemMsg(trimmed)) {
          currentMsg = null;
          continue;
        }
        // 过滤非文本内容提示
        if (this._isNonTextHint(trimmed)) {
          currentMsg = null;
          continue;
        }
        // 追加内容（多条正文用空格连接）
        currentMsg.content = currentMsg.content
          ? currentMsg.content + ' ' + trimmed
          : trimmed;
      } else if (trimmed.length === 0 && currentMsg) {
        // 空行：消息结束
        if (currentMsg.content) {
          imported.push(currentMsg);
        }
        currentMsg = null;
      }
    }

    // 处理最后一条
    if (currentMsg && currentMsg.content) {
      imported.push(currentMsg);
    }

    // 合并到 messages 数组并按时间排序
    this._mergeAndSort(imported);
    console.log(`[History] TXT 导入完成: ${imported.length} 条 (文件: ${path.basename(filePath)})`);
    return imported.length;
  }

  /** 标准化时间格式为 ISO */
  _normalizeTime(timeStr) {
    // "2024-01-01 12:00:00" → "2024-01-01T12:00:00"
    const d = new Date(timeStr.replace(/\//g, '-'));
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  }

  /** 判断是否为系统消息 */
  _isSystemMsg(text) {
    const patterns = [
      /撤回了一条消息/,
      /你撤回了一条消息/,
      /发送了一个/,
      /图片/,
      /\[图片\]/,
      /\[文件\]/,
      /\[语音\]/,
      /\[视频\]/,
      /\[动画表情\]/,
      /\[链接\]/,
      /\[分享\]/,
    ];
    return patterns.some(p => p.test(text));
  }

  /** 判断是否为非文本内容提示 */
  _isNonTextHint(text) {
    // QQ 导出中的 [图片] [文件] 等
    return /^\[.*\]$/.test(text.trim());
  }

  /** 合并导入的消息并按时间排序，去重 */
  _mergeAndSort(newMessages) {
    const existingSet = new Set(
      this.messages.map(m => m.time + m.role + m.content.substring(0, 20))
    );
    for (const msg of newMessages) {
      const key = msg.time + msg.role + msg.content.substring(0, 20);
      if (!existingSet.has(key)) {
        this.messages.push(msg);
        existingSet.add(key);
      }
    }
    this.messages.sort((a, b) => new Date(a.time) - new Date(b.time));
  }

  // ========== 上下文构建 ==========

  /**
   * 构建 AI 请求用的上下文文本（最近 N 条历史 + 关键信息）
   * @param {number} count - 取最近多少条
   * @returns {string}
   */
  buildContext(count = 50) {
    const recent = this.messages.slice(-count);

    const parts = [];

    // 关键信息前缀
    if (Object.keys(this.keyInfo).length > 0) {
      parts.push('【你们之间的重要信息】');
      if (this.keyInfo.anniversary) parts.push('- 纪念日/重要日期: ' + this.keyInfo.anniversary);
      if (this.keyInfo.likes && this.keyInfo.likes.length > 0) parts.push('- 她喜欢: ' + this.keyInfo.likes.join('、'));
      if (this.keyInfo.dislikes && this.keyInfo.dislikes.length > 0) parts.push('- 她不喜欢: ' + this.keyInfo.dislikes.join('、'));
      if (this.keyInfo.importantEvents && this.keyInfo.importantEvents.length > 0) parts.push('- 最近重要的事: ' + this.keyInfo.importantEvents.join('、'));
      if (this.keyInfo.herName) parts.push('- 她的昵称/名字: ' + this.keyInfo.herName);
      parts.push('');
    }

    // 最近聊天记录（合并60秒内同一人的连续消息）
    parts.push('【最近聊天记录（从旧到新）】');
    const merged = this._mergeConsecutive(recent, 60);
    for (const msg of merged) {
      const label = msg.role === 'me' ? '我' : '她';
      parts.push(label + ': ' + msg.content);
    }

    return parts.join('\n');
  }

  /** 合并间隔 < maxGapSeconds 秒的同一人的连续消息 */
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

  // ========== 关键信息提取 ==========

  /** 从历史记录中提取关键信息（基于规则，非 AI） */
  extractKeyInfo() {
    const allText = this.messages
      .filter(m => m.role === 'her')
      .map(m => m.content)
      .join(' ');

    // 纪念日模式：提到"纪念日"、"在一起"、"周年"
    const datePatterns = [
      /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?).*?(纪念日|在一起|认识|开始)/,
      /(纪念日|在一起|认识).*?(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号]?)/,
      /(\d{1,2}月\d{1,2}[日号]).*?(纪念日|在一起)/,
    ];
    for (const pattern of datePatterns) {
      const match = allText.match(pattern);
      if (match && !this.keyInfo.anniversary) {
        this.keyInfo.anniversary = match[1] || match[2];
        break;
      }
    }

    // 喜好模式
    const likePatterns = [
      /我(?:最|很|超|好|可)?喜欢(.{1,10}?)(?:了|呢|哦|啊|，|。|！|$)/g,
      /我(?:最|很|超|好|可)?爱吃(.{1,10}?)(?:了|呢|哦|啊|，|。|！|$)/g,
    ];
    if (!this.keyInfo.likes) {
      const likes = new Set();
      for (const pattern of likePatterns) {
        let m;
        while ((m = pattern.exec(allText)) !== null) {
          const item = m[1].trim();
          if (item.length >= 1 && item.length <= 8 && !/[你我这那他她]/.test(item)) {
            likes.add(item);
          }
        }
      }
      if (likes.size > 0) this.keyInfo.likes = Array.from(likes).slice(0, 10);
    }

    this.saveKeyInfo();
    return this.keyInfo;
  }

  // ========== 查询接口 ==========

  /** 获取最近 N 条消息 */
  getRecent(count = 10) {
    return this.messages.slice(-count);
  }

  /** 获取消息总数 */
  getMessageCount() {
    return this.messages.length;
  }

  /** 导出所有消息为 JSON 字符串 */
  exportAll() {
    return JSON.stringify(this.messages, null, 2);
  }
}

module.exports = HistoryManager;
