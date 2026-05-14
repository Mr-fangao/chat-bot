const { createClient } = require('icqq');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class QQClient extends EventEmitter {
  /**
   * @param {object} config - qq 配置段
   */
  constructor(config) {
    super();
    this.account = config.account;
    this.girlfriendQQ = config.girlfriendQQ;
    this.platform = config.platform || 5;
    this.messageDelay = config.messageDelay || 3000;

    this.client = null;
    this.isOnline = false;
    this._sendQueue = [];
    this._lastSendTime = 0;
    this._sendTimer = null;
    this._reconnectCount = 0;
    this._maxReconnect = 5;
    this._reconnectTimer = null;

    // 数据目录（用于存储登录态缓存）
    this.dataDir = path.join(process.cwd(), 'data');
  }

  // ========== 登录 ==========

  /**
   * 创建 QQ 客户端并登录
   * @returns {Promise<void>}
   */
  async login() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.client = createClient({
      account: this.account,
      platform: this.platform,         // 5 = iPad
      data_dir: this.dataDir,          // 登录态缓存目录
      log_level: 'warn',               // 减少 icqq 内部日志输出
    });

    // 注册内部事件
    this._bindEvents();

    // 尝试登录
    try {
      console.log('[QQ] 正在登录...');
      await this._doLogin();
    } catch (err) {
      console.error('[QQ] 登录失败: ' + err.message);
      this.emit('login_failed', err);
    }
  }

  /** 执行登录（扫码优先） */
  async _doLogin() {
    // 监听二维码事件（扫码方式）
    const qrPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('登录超时（120秒），请重试'));
      }, 120000);

      this._qrResolver = (qrData) => {
        clearTimeout(timeout);
        resolve(qrData);
      };

      this._qrRejecter = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    });

    // 调用 icqq 的 login 方法
    // icqq 会先尝试缓存的 token，失败则触发滑块/二维码事件
    try {
      await this.client.login();
      // login() 可能直接在 token 有效时返回
    } catch (e) {
      // token 无效时会抛异常，走事件处理
    }

    // 等待登录结果
    try {
      await qrPromise;
    } catch (err) {
      throw err;
    }
  }

  /** 绑定 icqq 内部事件 */
  _bindEvents() {
    // 扫码登录 — 二维码
    this.client.on('system.login.qrcode', ({ image }) => {
      console.log('\n[QQ] 请使用手机QQ扫描以下二维码登录：');
      // image 是二维码的 base64 数据，可以直接用某些终端显示
      // 这里我们输出提示让用户用 icqq 内置的终端二维码功能
      // icqq 通常会自动将二维码输出到终端
      if (this._qrResolver) {
        this._qrResolver({ type: 'qrcode', image });
        this._qrResolver = null;
        this._qrRejecter = null;
      }
    });

    // 滑块验证码
    this.client.on('system.login.slider', ({ url }) => {
      console.log('\n[QQ] 需要完成滑块验证，请在浏览器中打开以下链接：');
      console.log('    ' + url);
      console.log('[QQ] 完成后按回车继续...');
      if (this._qrRejecter) {
        this._qrRejecter(new Error('需要手动完成滑块验证'));
        this._qrResolver = null;
        this._qrRejecter = null;
      }
    });

    // 设备锁验证
    this.client.on('system.login.device', () => {
      console.log('[QQ] 需要验证设备锁，请查看手机QQ并确认登录');
      if (this._qrResolver) {
        this._qrResolver({ type: 'device' });
        this._qrResolver = null;
        this._qrRejecter = null;
      }
    });

    // 登录成功
    this.client.on('system.online', () => {
      this.isOnline = true;
      this._reconnectCount = 0;
      console.log('[QQ] 登录成功！');
      this._startSendTimer();
      this.emit('online');
    });

    // 登录错误
    this.client.on('system.login.error', ({ code, message }) => {
      console.error('[QQ] 登录错误: [' + code + '] ' + message);
      if (this._qrRejecter) {
        this._qrRejecter(new Error(message));
        this._qrResolver = null;
        this._qrRejecter = null;
      }
    });

    // 连接断开
    this.client.on('system.offline', () => {
      this.isOnline = false;
      console.warn('[QQ] 连接断开');
      this.emit('offline');
      this._tryReconnect();
    });

    // 收到消息
    this.client.on('message', (event) => {
      this._handleMessage(event);
    });
  }

  // ========== 消息处理 ==========

  _handleMessage(event) {
    // 只处理私聊消息
    if (event.message_type !== 'private') return;

    // 只处理指定好友的消息
    if (String(event.user_id) !== String(this.girlfriendQQ)) return;

    // 过滤自己的消息（防止回环）
    if (String(event.user_id) === String(event.self_id)) return;

    // 提取文本内容
    const text = this._extractText(event);

    if (text.length === 0) {
      // 非文本消息（图片/语音/文件）仅记录不回复
      console.log('[QQ] 收到非文本消息，已记录但不回复');
      this.emit('non_text_message', {
        time: new Date().toISOString(),
        raw: event,
      });
      return;
    }

    // 触发消息事件
    this.emit('message', {
      text: text,
      time: new Date().toISOString(),
      raw: event,
    });
  }

  /** 从 icqq 消息中提取纯文本 */
  _extractText(event) {
    // icqq 的 message 是一个消息段数组
    const segments = event.message || [];
    const textParts = [];

    for (const seg of segments) {
      if (seg.type === 'text') {
        textParts.push(seg.text);
      } else if (seg.type === 'face') {
        // QQ 表情，保留为 [CQ:face,id=xxx] 格式
        textParts.push('[CQ:face,id=' + seg.id + ']');
      } else if (seg.type === 'image') {
        // 图片消息跳过文本，但记录
        textParts.push('[图片]');
      }
      // 其他类型（at、reply、json、xml 等）忽略
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
      // 还没到时间，等待
      return;
    }

    if (this._sendQueue.length === 0) return;
    if (!this.isOnline) {
      // 清除队列中所有等待的消息
      while (this._sendQueue.length > 0) {
        const item = this._sendQueue.shift();
        item.reject(new Error('QQ 未在线'));
      }
      return;
    }

    const item = this._sendQueue.shift();
    this._lastSendTime = Date.now();

    this.client.sendPrivateMsg(Number(this.girlfriendQQ), item.text)
      .then(() => {
        item.resolve();
        // 继续处理下一条（如果有的话）
        if (this._sendQueue.length > 0) {
          setTimeout(() => this._processSendQueue(), this.messageDelay);
        }
      })
      .catch((err) => {
        console.error('[QQ] 发送消息失败: ' + err.message);
        // 发送失败不阻塞后续消息
        item.reject(err);
        if (this._sendQueue.length > 0) {
          setTimeout(() => this._processSendQueue(), 1000);
        }
      });
  }

  _startSendTimer() {
    // 定期检查发送队列
    if (this._sendTimer) clearInterval(this._sendTimer);
    this._sendTimer = setInterval(() => this._processSendQueue(), 500);
  }

  // ========== 重连 ==========

  _tryReconnect() {
    if (this._reconnectCount >= this._maxReconnect) {
      console.error('[QQ] 重连失败已达到最大次数 (' + this._maxReconnect + ')，请手动重启程序');
      this.emit('reconnect_failed');
      return;
    }

    this._reconnectCount++;
    const delay = 5000; // 每次重连间隔5秒
    console.log(`[QQ] ${delay / 1000}秒后尝试重连 (${this._reconnectCount}/${this._maxReconnect})...`);

    this._reconnectTimer = setTimeout(async () => {
      try {
        await this.client.login();
        // 事件 system.online 会被触发
      } catch (err) {
        console.error('[QQ] 重连失败: ' + err.message);
        this._tryReconnect();
      }
    }, delay);
  }

  // ========== 好友信息 ==========

  /** 获取指定好友的昵称 */
  async getFriendName(qq) {
    try {
      const info = await this.client.getStrangerInfo(Number(qq));
      return info?.nickname || String(qq);
    } catch (e) {
      return String(qq);
    }
  }

  /** 获取自己的昵称 */
  getSelfName() {
    return this.client?.nickname || String(this.account);
  }

  // ========== 关闭 ==========

  /** 安全关闭连接 */
  async shutdown() {
    this.isOnline = false;

    if (this._sendTimer) {
      clearInterval(this._sendTimer);
      this._sendTimer = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // 清空发送队列
    while (this._sendQueue.length > 0) {
      const item = this._sendQueue.shift();
      item.reject(new Error('程序退出'));
    }

    if (this.client) {
      try {
        await this.client.logout();
      } catch (e) {
        // ignore
      }
      this.client = null;
    }
  }
}

module.exports = QQClient;
