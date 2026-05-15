import { reactive } from 'vue';

export const store = reactive({
  // 连接状态
  ws: null,
  online: false,
  qrReady: false,
  account: '',

  // 数据
  targets: [],
  roles: [],
  activeTargetId: '',
  messages: {},       // targetId -> messages[]

  // 审核
  reviewQueue: {},    // targetId -> { original, reply, time }

  // 连接 WebSocket
  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(protocol + '//' + location.host + '/ws');
    this.ws = ws;

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this._handle(data);
      } catch (err) {}
    };

    ws.onclose = () => {
      this.online = false;
      setTimeout(() => this.connect(), 3000);
    };
  },

  _handle(data) {
    switch (data.type) {
      case 'init':
        this.online = data.online;
        this.qrReady = data.qrReady;
        this.targets = data.targets;
        this.roles = data.roles;
        if (data.targets.length > 0 && !this.activeTargetId) {
          this.activeTargetId = data.targets[0].id;
        }
        break;

      case 'login_status':
        this.online = data.online;
        this.account = data.account || '';
        break;

      case 'qr_ready':
        this.qrReady = true;
        break;

      case 'new_message': {
        const msgs = this.messages[data.targetId] || [];
        msgs.push({ role: data.role, content: data.content, time: data.time, senderName: data.senderName || '' });
        this.messages[data.targetId] = msgs;
        break;
      }

      case 'bot_reply': {
        const msgs = this.messages[data.targetId] || [];
        msgs.push({ role: 'me', content: data.content, time: data.time });
        this.messages[data.targetId] = msgs;
        delete this.reviewQueue[data.targetId];
        break;
      }

      case 'review_request':
        this.reviewQueue[data.targetId] = {
          original: data.original,
          reply: data.reply,
          time: data.time
        };
        break;

      case 'mode_changed': {
        const t = this.targets.find(t => t.id === data.targetId);
        if (t) t.mode = data.mode;
        break;
      }

      case 'history':
        this.messages[data.targetId] = data.messages;
        break;

      case 'error':
        alert(data.message);
        break;
    }
  },

  // 切换对象
  switchTarget(targetId) {
    this.activeTargetId = targetId;
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'switch_target', targetId }));
    }
  },

  // 获取当前对象的模式
  getMode(targetId) {
    const t = this.targets.find(t => t.id === targetId);
    return t?.mode || 'manual';
  },

  // 获取当前对象的角色
  getRole(targetId) {
    const t = this.targets.find(t => t.id === targetId);
    return t?.role || 'friend';
  },

  // 发送确认
  confirmReply(targetId, approved, reply) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'confirm_reply', targetId, approved, reply }));
    }
    delete this.reviewQueue[targetId];
  },

  // 请求 API
  async api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    return res.json();
  }
});
