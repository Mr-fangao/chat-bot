import { NCWebsocket } from 'node-napcat-ts';
import EventEmitter from 'events';

class NapcatBridge extends EventEmitter {
  constructor(config) {
    super();
    this.account = config.account;
    this.napcatWsUrl = config.napcatWsUrl || 'ws://localhost:3001';
    this.nc = null;
    this.isOnline = false;
    this.selfName = String(config.account);
  }

  async connect() {
    this.nc = new NCWebsocket({
      baseUrl: this.napcatWsUrl,
      accessToken: '',
      reconnection: { enable: true, attempts: 10, delay: 5000 },
    });

    this.nc.on('message.private', (ctx) => {
      const userId = String(ctx.user_id);
      if (userId === this.account) return;
      const text = this._extractText(ctx);
      this.emit('message', {
        targetId: userId,
        type: 'friend',
        text,
        time: new Date().toISOString(),
        raw: ctx
      });
    });

    this.nc.on('message.group', (ctx) => {
      const groupId = String(ctx.group_id);
      const userId = String(ctx.user_id);
      const text = this._extractText(ctx);
      const senderName = ctx.sender?.card || ctx.sender?.nickname || userId;
      this.emit('message', {
        targetId: groupId,
        type: 'group',
        text,
        time: new Date().toISOString(),
        senderId: userId,
        senderName,
        raw: ctx
      });
    });

    this.nc.on('socket.close', () => {
      this.isOnline = false;
      this.emit('offline');
    });

    this.nc.on('socket.open', async () => {
      this.isOnline = true;
      try {
        const info = await this.nc.get_login_info();
        this.account = String(info.data?.user_id || this.account);
        this.selfName = info.data?.nickname || this.account;
      } catch (e) {}
      this.emit('online');
    });

    this.nc.on('socket.error', (err) => {
      console.warn('[NapCat] 连接错误: ' + (err?.errors?.[0]?.code || err?.message || err));
      if (!this.isOnline) this.emit('connect_error', err);
    });

    console.log('[NapCat] 正在连接 ' + this.napcatWsUrl + '...');
    await this.nc.connect();
    console.log('[NapCat] 已连接');
  }

  _extractText(ctx) {
    const segments = ctx.message || [];
    const parts = [];
    for (const seg of segments) {
      if (seg.type === 'text') parts.push(seg.data?.text || '');
    }
    return parts.join('').trim();
  }

  async sendPrivateMsg(userId, text) {
    return this.nc.send_private_msg({ user_id: userId, message: text });
  }

  async sendGroupMsg(groupId, text) {
    return this.nc.send_group_msg({ group_id: groupId, message: text });
  }

  async getFriendName(userId) {
    try {
      const r = await this.nc.get_stranger_info(Number(userId));
      return r.data?.nickname || userId;
    } catch (e) {
      return userId;
    }
  }

  async getGroupName(groupId) {
    try {
      const r = await this.nc.get_group_info(Number(groupId));
      return r.data?.group_name || groupId;
    } catch (e) {
      return groupId;
    }
  }

  async disconnect() {
    this.isOnline = false;
    try { await this.nc.disconnect(); } catch (e) {}
  }
}

export default NapcatBridge;
