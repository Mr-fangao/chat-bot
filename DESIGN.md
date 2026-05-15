# QQ 代聊机器人 v2 — 设计概要

## 技术栈

- **后端**: Node.js + Express + WebSocket
- **前端**: Vue 3 + Vite
- **QQ 协议**: NapCatQQ (OneBot v11)
- **AI**: 智谱 GLM-4.5-Flash

## 架构图

```
┌─────────────┐     ┌──────────────────────────────────┐     ┌────────────┐
│   Vue3 前端  │◄───►│   Express 后端 (port 3456)        │◄───►│  NapCatQQ  │
│   (浏览器)   │ WS  │   - REST API                     │ WS  │  (3001)    │
│             │      │   - 静态文件服务                   │      │            │
│             │      │   - QR 图片代理                   │      │            │
│             │      │   - AI 调用                       │      │            │
│             │      │   - 历史管理                      │      │            │
│             │      │   - 提示词管理                    │      │            │
└─────────────┘      └──────────────────────────────────┘      └────────────┘
```

## 目录结构

```
chat-bot/
├── server.js              # 后端入口 (Express + WS)
├── napcat-bridge.js       # NapCat OneBot v11 连接
├── ai-client.js           # AI API (同现在)
├── history-manager.js     # 多对象历史管理
├── prompt-manager.js      # 角色提示词模板
├── target-manager.js      # 聊天对象配置管理
├── client/                # Vue3 前端
│   ├── index.html
│   ├── vite.config.js
│   └── src/
│       ├── App.vue
│       ├── views/
│       │   ├── LoginView.vue    # 登录 + 二维码
│       │   └── ChatView.vue     # 主聊天界面
│       ├── components/
│       │   ├── Sidebar.vue      # 聊天对象列表
│       │   ├── ChatWindow.vue   # 消息展示
│       │   ├── QrCode.vue       # 二维码显示
│       │   └── ConfigPanel.vue  # 配置面板
│       └── stores/
│           └── app.js           # 全局状态
├── data/
│   ├── targets.json       # 聊天对象配置
│   ├── roles/              # 角色模板
│   │   ├── girlfriend.json
│   │   ├── friend.json
│   │   └── group.json
│   └── history/            # 按对象存储
│       ├── 1059552213/
│       │   └── messages.json
│       └── 854943530/
│           └── messages.json
├── config.json             # 全局配置
├── start.cmd               # 一键启动
└── package.json
```

## 核心数据模型

### targets.json — 聊天对象配置
```json
[
  {
    "id": "1059552213",
    "type": "friend",
    "name": "宝宝",
    "role": "girlfriend",
    "mode": "auto",
    "enabled": true
  },
  {
    "id": "854943530",
    "type": "group",
    "name": "Cesium深入浅出",
    "role": "group",
    "mode": "manual"
  }
]
```

### roles/*.json — 角色提示词模板
```json
{
  "name": "girlfriend",
  "label": "女朋友",
  "prompt": "你现在扮演...",
  "rules": {
    "maxLength": 30,
    "noEmoji": true
  }
}
```

## 启动流程

1. 用户运行 `start.cmd`
2. 后端启动 → 启动 NapCatQQ 子进程
3. Express 服务监听 3456 端口
4. 后端监听 `napcat/cache/qrcode.png` 变化
5. 前端打开 → 显示二维码 → 用户扫码登录
6. 登录成功 → 进入聊天界面
7. 后端连接 NapCat WebSocket → 开始监听消息

## 页面设计

### 登录页
- 居中显示二维码（轮询刷新）
- 状态文字："请使用手机QQ扫描二维码登录"

### 聊天页
- **左侧栏**：聊天对象列表
  - 私聊好友（头像/昵称/角色标签/模式标识）
  - 监听的群聊（灰显，仅监控）
  - 点击切换当前对象
- **右侧**：聊天窗口
  - 顶部：当前对象名称 + 模式切换按钮
  - 中部：消息列表（实时滚动）
  - 底部：手动输入框 + 发送按钮
- **底部状态**：在线状态 / 最后消息时间

### 配置入口
- 设置按钮 → ConfigPanel
- 管理聊天对象（增删改）
- 编辑角色提示词

## API 设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/qrcode` | GET | 返回当前二维码图片 |
| `/api/status` | GET | QQ 登录状态 |
| `/api/targets` | GET/POST | 聊天对象列表/新增 |
| `/api/targets/:id` | PUT/DELETE | 编辑/删除对象 |
| `/api/targets/:id/history` | GET | 获取历史记录 |
| `/api/targets/:id/mode` | PUT | 切换模式 (auto/review/manual) |
| `/api/roles` | GET | 获取角色模板列表 |
| `/api/roles/:name` | GET/PUT | 获取/编辑角色模板 |
| `/ws` | WebSocket | 实时推送消息和状态 |

## WebSocket 消息格式

**服务端 → 客户端：**
```json
{"type":"qr_ready","path":"..."}
{"type":"login_status","online":true}
{"type":"new_message","targetId":"1059552213","role":"her","content":"...","time":"..."}
{"type":"bot_reply","targetId":"1059552213","content":"...","mode":"auto"}
```

**客户端 → 服务端：**
```json
{"type":"switch_target","targetId":"1059552213"}
{"type":"change_mode","targetId":"1059552213","mode":"review"}
{"type":"send_message","targetId":"1059552213","content":"..."}
{"type":"confirm_reply","targetId":"1059552213","approved":true}
```

## 待确认

1. ~~群聊是否回复~~ → 只读监控
2. ~~提示词管理方式~~ → 预设角色模板
3. ~~二维码来源~~ → napcat/cache/qrcode.png
4. 启动 NapCat 是用子进程还是独立启动？——建议子进程，start.cmd 一键全搞定
