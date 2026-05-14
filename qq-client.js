const { NCWebsocket, Structs } = require('node-napcat-ts');
const EventEmitter = require('events');

class QQClient extends EventEmitter {
  /**
   * @param {object} config - qq 配置段
   */
  constructor(config) {
    super();
    this.account = config.account;
    this.girlfriendQQ = config.girlfriendQQ;
    this.messageDelay = config.messageDelay || 3000;

    // NapCatQQ 连接配置
    this.napcatWsUrl = config.napcatWsUrl || 'ws://localhost:3001';
    this.napcatToken = config.napcatToken || '';

    this.nc = null;
    this.isOnline = false;
    this.selfName = String(config.account);
    this._sendQueue = [];
    this._lastSendTime = 0;
    this._sendTimer = null;
    this._reconnectAttempts = 0;
    this._maxReconnect = 10;

    // 创建 NCWebsocket 实例
    this.nc = new NCWebsocket({
      baseUrl: this.napcatWsUrl,
      accessToken: this.napcatToken,
      reconnection: {
        enable: true,
        attempts: this._maxReconnect,
        delay: 5000,
      },
    });
  }

  // ========== 登录 / 连接 ==========

  /**
   * 连接到 NapCatQQ 服务
   * NapCatQQ 本身需要先启动并完成 QQ 登录
   * 启动后访问 http://localhost:6099/webui 完成扫码登录
   * 本程序通过 WebSocket 连接到已登录的 NapCatQQ 实例
   */
  async login() {
    // 绑定 OneBot v11 事件
    this._bindEvents();

    console.log('[QQ] 正在连接 NapCatQQ (' + this.napcatWsUrl + ')...');

    try {
      await this.nc.connect();

      // 获取登录信息
      try {
        const loginInfo = await this.nc.get_login_info();
        this.selfName = loginInfo.data?.nickname || String(this.account);
        this.account = String(loginInfo.data?.user_id || this.account);
      } catch (e) {
        console.warn('[QQ] 获取登录信息失败: ' + e.message);
      }

      this.isOnline = true;
      this._reconnectAttempts = 0;
      console.log('[QQ] 已连接到 NapCatQQ，当前账号: ' + this.selfName);
      this._startSendTimer();
      this.emit('online');
    } catch (err) {
      console.error('[QQ] 连接 NapCatQQ 失败: ' + err.message);
      console.error('[QQ] 请确保:');
      console.error('    1. NapCatQQ 已启动并成功登录 QQ');
      console.error('    2. WebSocket 端口正确 (当前: ' + this.napcatWsUrl + ')');
      console.error('    3. 访问 http://localhost:6099/webui 检查 NapCatQQ 状态');
      this.emit('login_failed', err);
    }
  }

  /** 绑定 OneBot v11 消息事件 */
  _bindEvents() {
    // 收到私聊消息（OneBot v11: message.private）
    this.nc.on('message.private', (ctx) => {
      this._handleMessage(ctx);
    });

    // WebSocket 连接关闭
    this.nc.on('socket.close', (err) => {
      this.isOnline = false;
      console.warn('[QQ] WebSocket 连接断开');
      this.emit('offline');
      // node-napcat-ts 内置重连机制，这里只做通知
    });

    // WebSocket 重连成功
    this.nc.on('socket.open', async () => {
      console.log('[QQ] WebSocket 已重连');
      try {
        const loginInfo = await this.nc.get_login_info();
        this.isOnline = true;
        this.selfName = loginInfo.data?.nickname || this.selfName;
        this._startSendTimer();
        this.emit('online');
      } catch (e) {
        // 可能还没完全恢复
      }
    });

    // 连接错误
    this.nc.on('socket.error', (err) => {
      console.error('[QQ] WebSocket 错误: ' + (err.message || err));
    });
  }

  // ========== 消息处理 ==========

  _handleMessage(ctx) {
    // OneBot v11: ctx 包含 message_id, user_id, message, raw_message, sender 等
    const userId = String(ctx.user_id);

    // 只处理指定好友的消息
    if (userId !== String(this.girlfriendQQ)) return;

    // 过滤自己的消息（防止回环）
    if (userId === this.account) return;

    // 提取文本内容
    const text = this._extractText(ctx);

    if (text.length === 0) {
      // 非文本消息（图片/语音/文件）仅记录不回复
      console.log('[QQ] 收到非文本消息，已记录但不回复');
      this.emit('non_text_message', {
        time: new Date().toISOString(),
        raw: ctx,
      });
      return;
    }

    // 触发消息事件
    this.emit('message', {
      text: text,
      time: new Date().toISOString(),
      raw: ctx,
    });
  }

  /** 从 OneBot v11 消息中提取纯文本 */
  _extractText(ctx) {
    // OneBot v11 的 message 是消息段数组: [{type, data}, ...]
    const segments = ctx.message || [];
    const textParts = [];

    for (const seg of segments) {
      if (seg.type === 'text') {
        textParts.push(seg.data?.text || '');
      } else if (seg.type === 'face') {
        textParts.push('[CQ:face,id=' + (seg.data?.id || '0') + ']');
      } else if (seg.type === 'image') {
        textParts.push('[图片]');
      } else if (seg.type === 'record') {
        textParts.push('[语音]');
      } else if (seg.type === 'video') {
        textParts.push('[视频]');
      } else if (seg.type === 'file') {
        textParts.push('[文件]');
      }
      // 其他类型（at、reply、json、xml 等）忽略文本提取
    }

    return textParts.join('').trim();
  }

  // ========== 消息发送 ==========

  /**
   * 发送私聊消息（带限速队列）
   * @param {string} text - 消息文本
   * @returns {Promise<void>}
   */
  sendMessage(text) {
    return new Promise((resolve, reject) => {
      this._sendQueue.push({ text, resolve, reject });
      this._processSendQueue();
    });
  }

  _processSendQueue() {
    const now = Date.now();
    const elapsed = now - this._lastSendTime;

    if (elapsed < this.messageDelay) {
      return;
    }

    if (this._sendQueue.length === 0) return;

    if (!this.isOnline) {
      while (this._sendQueue.length > 0) {
        const item = this._sendQueue.shift();
        item.reject(new Error('QQ 未在线'));
      }
      return;
    }

    const item = this._sendQueue.shift();
    this._lastSendTime = Date.now();

    // node-napcat-ts send_private_msg: (user_id, message, auto_escape?)
    // message 可以用 string 或消息段数组
    this.nc.send_private_msg(Number(this.girlfriendQQ), item.text)
      .then(() => {
        item.resolve();
        if (this._sendQueue.length > 0) {
          setTimeout(() => this._processSendQueue(), this.messageDelay);
        }
      })
      .catch((err) => {
        console.error('[QQ] 发送消息失败: ' + err.message);
        item.reject(err);
        if (this._sendQueue.length > 0) {
          setTimeout(() => this._processSendQueue(), 1000);
        }
      });
  }

  _startSendTimer() {
    if (this._sendTimer) clearInterval(this._sendTimer);
    this._sendTimer = setInterval(() => this._processSendQueue(), 500);
  }

  // ========== 好友信息 ==========

  /** 获取指定好友的昵称 */
  async getFriendName(qq) {
    try {
      const result = await this.nc.get_stranger_info(Number(qq));
      return result.data?.nickname || String(qq);
    } catch (e) {
      return String(qq);
    }
  }

  /** 获取自己的昵称 */
  getSelfName() {
    return this.selfName;
  }

  // ========== 关闭 ==========

  /** 安全关闭连接 */
  async shutdown() {
    this.isOnline = false;

    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = null;
    }

    while (this._sendQueue.length > 0) {
      const item = this._sendQueue.shift();
      item.reject(new Error('程序退出'));
    }

    if (this.nc) {
      try {
        await this.nc.disconnect();
      } catch (e) {
        // ignore
      }
    }
  }
}

module.exports = QQClient;
