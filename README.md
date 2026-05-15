# QQ Chat Bot v2

基于 NapCatQQ + Vue3 + 智谱AI 的 QQ 代聊机器人，全浏览器化操作界面。

## 功能

- **一键启动** — 管理员身份运行 `start.cmd`，自动启动 NapCatQQ + 后端服务
- **扫码登录** — 二维码直接展示在浏览器中，无需手动查找文件
- **多对象管理** — 支持私聊和群聊，独立历史记录和角色模板，随时切换
- **三种模式** — 自动回复 / 审核确认 / 手动接管，每个对象独立设置
- **角色模板** — 预设 girlfriend/friend/group 角色，可自定义提示词
- **群聊只读** — 群消息实时展示，不自动回复
- **上下文追踪** — 携带历史记录生成回复，保持对话连贯

## 快速开始

### 环境要求

- Node.js v18+
- Windows（QQ 桌面版需已安装）

### 配置

复制并编辑 `config.json`：

```json
{
  "qq": { "account": "你的QQ号" },
  "ai": {
    "apiKey": "智谱AI API Key",
    "model": "glm-4.5-flash"
  }
}
```

### 运行

右键 `start.cmd` → **以管理员身份运行**，浏览器会自动打开。

首次启动显示二维码，用手机 QQ 扫码登录。

## 项目结构

```
chat-bot/
├── server.js              # Express + WebSocket 服务端
├── napcat-bridge.js       # NapCatQQ WebSocket 封装
├── ai-client.js           # 智谱AI 客户端
├── history-manager.js     # 聊天记录管理
├── target-manager.js      # 聊天对象管理
├── prompt-manager.js      # 角色模板管理
├── start.cmd              # 一键启动脚本
├── gen-loadnapcat.ps1     # NapCat 路径生成
├── napcat/                # NapCatQQ 运行时
├── client/                # Vue3 前端
│   └── src/
│       ├── views/         # ChatView / LoginView
│       ├── components/    # ConfigPanel
│       ├── stores/        # 响应式状态管理
│       └── style.css      # 全局样式
├── data/
│   ├── targets.json       # 聊天对象配置
│   ├── roles/             # 角色模板
│   └── history/           # 聊天记录（不入库）
└── config.json            # API Key 等敏感配置（不入库）
```
