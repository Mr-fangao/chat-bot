# QQ 智能代聊机器人

基于 Node.js + icqq + 智谱AI GLM-4.5-Flash 的个人QQ代聊机器人。能够学习你的说话风格，在你忙碌时代替你与女朋友自然聊天。

## 功能特性

- QQ扫码登录，支持登录态缓存
- 只监听指定好友（女朋友）的消息
- 三种运行模式：自动回复 / 手动审核 / 手动接管
- 智谱AI GLM-4.5-Flash 驱动，生成自然对话
- 模仿你的说话风格和语气
- 敏感词过滤、AI身份暴露拦截
- 长消息自动拆分发送
- QQ发送频率控制（防风控）
- 断线自动重连
- 退出时自动保存聊天记录
- 支持导入QQ官方导出的TXT聊天记录
- 关键信息自动提取（纪念日、喜好等）
- 所有数据本地存储，不上传服务器

## 快速开始

### 1. 环境要求

- Node.js v18 或更高版本
- Windows 11（也支持 macOS/Linux）
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) — QQ 无头框架（负责 QQ 登录和消息收发）

### 2. 安装 NapCatQQ

NapCatQQ 是本项目的 QQ 协议层，需要先启动。

**Windows 用户（推荐）**：
1. 下载 [NapCatQQ 最新版](https://github.com/NapNeko/NapCatQQ/releases)
2. 解压后运行 `napcat.exe`
3. 浏览器打开 `http://localhost:6099/webui` 完成扫码登录
4. 在 WebUI 中启用 WebSocket 服务（默认端口 3001）
5. 如设置了 Access Token，记录下 token 值

### 3. 安装依赖

```bash
cd qq-chat-bot
npm install
```

### 4. 配置

```bash
copy config.example.json config.json
```

编辑 `config.json`，填入你的配置：

```json
{
  "qq": {
    "account": 你的QQ号,
    "girlfriendQQ": 女朋友的QQ号,
    "messageDelay": 3000,
    "napcatWsUrl": "ws://localhost:3001",
    "napcatToken": ""
  },
  "ai": {
    "apiKey": "你的智谱AI API Key",
    "baseURL": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "model": "glm-4.5-flash",
    "temperature": 0.7,
    "maxTokens": 500,
    "maxRetries": 3,
    "retryDelay": 2000
  },
  "app": {
    "mode": "review",
    "historyCount": 50,
    "messageSplitThreshold": 80,
    "autoSaveOnExit": true
  }
}
```

**获取智谱AI API Key**：访问 [智谱AI开放平台](https://open.bigmodel.cn/) 注册并获取API Key。

**配置说明**：
- `qq.napcatWsUrl`: NapCatQQ WebSocket 地址，默认 ws://localhost:3001
- `qq.napcatToken`: NapCatQQ 的 Access Token（如无设置则留空）
- `app.mode`: 启动默认模式 `review`=审核模式，`auto`=自动模式，`manual`=手动模式
- `app.historyCount`: 每次AI请求携带的历史消息条数

### 4. 导入历史聊天记录（可选但推荐）

为了让 AI 更好地模仿你的说话风格，建议先导入你和女朋友的历史聊天记录：

1. 在QQ客户端中，打开与女朋友的聊天窗口
2. 点击右上角"..."菜单 → 聊天记录 → 导出消息记录
3. 选择"文本格式(.txt)"，导出
4. 将导出的 .txt 文件放到 `chat-history/import/` 目录下
5. 启动机器人时会自动导入

**QQ导出TXT格式示例**：
```
2024-01-01 12:00:00 你的昵称(123456789)
宝宝在干嘛

2024-01-01 12:00:30 她的昵称(987654321)
在想你呢～
```

### 5. 运行

```bash
npm start
```

启动后，程序会弹出QQ登录二维码，用手机QQ扫码即可登录。

## 控制台命令

| 命令 | 说明 |
|------|------|
| `/auto` | 切换到自动回复模式 |
| `/review` | 切换到手动审核模式（每次生成后需确认） |
| `/manual` | 切换到手动接管模式（AI不回复，只记录） |
| `/send [消息]` | 手动发送消息给女朋友 |
| `/status` | 查看当前运行状态 |
| `/recent` | 显示最近10条聊天记录 |
| `/help` | 显示命令帮助 |
| `/exit` | 安全退出（自动保存聊天记录） |

## 运行模式说明

- **自动模式**：收到消息 → AI生成回复 → 自动发送。适合完全托管。
- **审核模式**（推荐）：收到消息 → AI生成回复 → 显示在控制台 → 你输入y确认或n跳过。适合初期使用，可以先观察AI回复质量。
- **手动模式**：机器人只记录聊天记录，不自动回复。适合你自己聊的时候挂着积累数据。

## 文件结构

```
qq-chat-bot/
├── index.js                # 主程序入口
├── qq-client.js            # QQ客户端模块
├── ai-client.js            # AI客户端模块
├── history-manager.js      # 历史记录管理模块
├── package.json            # 项目依赖
├── config.example.json     # 配置模板
├── config.json             # 实际配置（不提交Git）
├── .gitignore              # Git忽略配置
├── README.md               # 本说明
├── DEVELOPMENT_PLAN.md     # 开发计划
└── chat-history/
    ├── history.json        # 聊天记录（自动保存）
    ├── key-info.json       # 提取的关键信息
    └── import/             # 导入QQ导出的TXT
```

## 安全与隐私

- 所有聊天记录只保存在本地 `chat-history/` 目录
- API Key 只保存在 `config.json`（已在 `.gitignore` 中排除）
- 程序只与QQ服务器和智谱AI服务器通信
- 不会上传任何数据到第三方

## 常见问题

**Q: 登录时提示需要滑块验证？**
A: icqq 会自动弹出浏览器窗口，完成滑块验证后即可。

**Q: 扫码二维码看不到？**
A: 二维码会显示在终端中，请确保终端窗口足够大。

**Q: 消息发送不出或被风控？**
A: 尝试增大 `messageDelay`（如改为5000），或更换 `platform` 参数。

**Q: AI 回复不像我？**
A: 导入更多历史聊天记录，让 AI 有更多样本学习你的风格。

## 技术栈

- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) - QQ 无头框架（代替已失效的 icqq）
- [node-napcat-ts](https://github.com/huankong-team/node-napcat-ts) - NapCatQQ TypeScript SDK
- [智谱AI GLM-4.5-Flash](https://open.bigmodel.cn/) - 大语言模型
- axios - HTTP客户端
- Node.js readline - 控制台交互

## 常见问题

**Q: 为什么不用 icqq？**
A: icqq 已于 2024 年停止维护，QQ 登录协议已变更。现在使用 NapCatQQ + node-napcat-ts 方案。

**Q: 连接不上 NapCatQQ？**
A: 确认 NapCatQQ 已启动，访问 http://localhost:6099/webui 检查状态，确保 WebSocket 已启用。

**Q: 发送消息失败？**
A: 检查 NapCatQQ WebUI 中 QQ 是否在线，尝试增大 `messageDelay` 参数。
