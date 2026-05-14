# QQ智能代聊机器人 — 开发计划

> 基于产品文档 v2，从底层框架到最终交付的完整实施路线。

---

## 一、总体架构设计

### 1.1 架构模式：事件驱动 + 模块化单体

```
┌──────────────────────────────────────────────────┐
│                    index.js                       │
│            (启动入口 / 模式控制 / 生命周期)         │
├──────────┬──────────┬───────────┬────────────────┤
│ qq-client│ai-client │ history   │  console-ui    │
│   .js    │  .js     │ -manager  │   (内嵌)       │
│          │          │   .js     │                │
├──────────┴──────────┴───────────┴────────────────┤
│              data layer (JSON files)              │
│    config.json  /  history.json  /  key-info.json │
└──────────────────────────────────────────────────┘
```

- **index.js** 是大脑，持有运行模式状态，协调各模块
- **qq-client.js** 封装 icqq，暴露事件接口，上层不直接触碰 icqq API
- **ai-client.js** 封装智谱 AI HTTP 调用，对上层只暴露 `generateReply(context)` 
- **history-manager.js** 纯数据层，负责 JSON 读写、TXT 解析、上下文构建
- **console-ui.js**（合并到 index.js）处理 readline 命令解析和彩色输出

### 1.2 为什么选单体而非微服务

| 考量 | 结论 |
|------|------|
| 只有一个用户 | 无需多租户 |
| 单进程即可满足延迟 | 无并发压力 |
| 部署复杂度 | 单体零部署，`node index.js` 即可 |
| 未来扩展 | 如需 Web UI，届时拆出 API 层 |

---

## 二、模块详细设计

### 2.1 index.js — 主控模块

**职责**：生命周期管理、模式状态机、命令解析、模块装配

```
状态机：
  ┌─── auto ──→ review ──→ manual ──┐
  │           ←          ←           │
  └──────────────────────────────────┘
          (任意状态可切换到任意状态)
```

**核心数据结构**：
```js
state = {
  mode: 'review',          // auto | review | manual
  startTime: Date.now(),
  messageCount: { sent: 0, received: 0 },
  running: true
}
```

**命令处理流程**：
```
用户输入 → 判断是否以 / 开头
  → 是 → 匹配命令表 → 执行对应操作
  → 否 → 忽略（普通文本不是命令）
```

**关键逻辑——审核模式**：
```
收到消息 → 调用 ai-client 生成回复 → 打印到控制台
  → 启动60秒倒计时
  → 用户输入 y → 发送
  → 用户输入 n → 丢弃
  → 60秒超时 → 自动丢弃
```

### 2.2 qq-client.js — QQ 客户端模块

**职责**：登录、消息收发、重连、心跳

```
对外接口：
  createClient(config)     → 返回 client 实例
  client.login()           → Promise<登录结果>
  client.sendMsg(qq, text) → Promise<void>
  client.on('message', callback)
  client.on('disconnect', callback)
  client.shutdown()        → 安全关闭连接
```

**登录策略**：
```
1. 尝试加载本地 token（data/qq-token.json）
2. token 有效 → 直接恢复登录
3. token 无效/不存在 → 根据配置选择：
   a. 扫码模式：监听 SystemLoginEvent，控制台输出二维码
   b. 密码模式：调用 login(password)，处理滑块验证
4. 登录成功 → 保存 token 到本地
5. 登录失败 → 提示用户重试（最多3次）
```

**消息过滤链**（按顺序）：
```
原始消息 →
  1. 过滤非 private 类型（群聊、系统通知直接丢弃）
  2. 过滤非 girlfriendQQ 的好友消息
  3. 过滤自己的消息（避免回环）
  4. 提取文本内容（图片/文件/语音消息记录但不回复）
  5. 触发 'message' 事件，payload = { text, time, rawMessage }
```

**发送限速**：
```
sendQueue = []
lastSendTime = 0

sendMsg(qq, text):
  now = Date.now()
  if now - lastSendTime < messageDelay:
    入队等待
  else:
    立即发送，更新 lastSendTime

定时器每500ms检查队列，满足间隔则出队发送
```

### 2.3 ai-client.js — AI 客户端模块

**职责**：封装智谱 AI HTTP 调用、重试、回复后处理

```
对外接口：
  generateReply(history, newMessage) → Promise<string>
  filterReply(text)                 → string
  splitLongMessage(text)           → string[]
```

**请求构建**：
```js
// POST https://open.bigmodel.cn/api/paas/v4/chat/completions
{
  model: 'glm-4.5-flash',
  temperature: 0.7,
  max_tokens: 500,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },       // 产品文档 4.3.2 的完整提示词
    { role: 'user', content: buildContextPrompt() },   // 关键信息 + 最近50条历史
    { role: 'user', content: '她刚才说：' + newMessage }
  ]
}
```

**重试策略**：
```
发送请求 →
  ├─ 成功(200) → 提取 content → filterReply → 返回
  ├─ 超时(30s) → 重试(最多3次，间隔2s) →
  │     ├─ 全部失败 → 返回兜底回复
  │     └─ 成功 → 同上
  └─ 4xx 错误 → 打印错误，返回兜底回复（不重试）
```

**兜底回复池**（5条，随机选择）：
```
- "稍等一下，我这边有点事"
- "刚才没看到消息"  
- "在呢，刚在忙"
- "来啦来啦"
- "嗯嗯，你说"
```

**回复过滤链**（filterReply）：
```
AI 返回的原始文本 →
  1. 检测 AI 暴露关键词 → 命中则替换/删除
  2. 检测敏感词 → 命中则返回 null（触发重试）
  3. 去除首尾引号和多余标点
  4. 转义 QQ 表情 [CQ:face,id=xxx] 格式
  5. 返回干净的回复文本
```

**消息拆分**（splitLongMessage）：
```
if 中文字符数 <= 80: 直接返回 [text]
else:
  按 。！？~ 等句子边界切分
  每段不超过80字
  返回 string[]
```

### 2.4 history-manager.js — 历史记录模块

**职责**：JSON 读写、TXT 解析、上下文构建、关键信息提取

```
对外接口：
  loadHistory()          → { messages[], keyInfo }
  saveMessage(role, text, time)
  importTxt(filePath)    → number (导入条数)
  buildContext(count)    → string (用于AI请求的上下文文本)
  extractKeyInfo()       → object
  getRecent(n)           → messages[]
```

**JSON 存储结构**（chat-history/history.json）：
```json
[
  { "role": "me",    "content": "宝宝在干嘛",     "time": "2024-01-01T10:00:00" },
  { "role": "her",   "content": "在想你呢～",     "time": "2024-01-01T10:00:30" },
  { "role": "me",    "content": "我也想你哈哈",   "time": "2024-01-01T10:01:00" }
]
```

**TXT 解析状态机**：
```
逐行读取 TXT →
  IDLE: 遇到 "YYYY-MM-DD HH:MM:SS 昵称(QQ号)" → 进入 READING
  READING: 累积消息文本行，遇到空行或下一条时间戳 → 存入数组，回到 IDLE
```

**上下文构建**（buildContext）：
```
取最近 N 条消息 →
  格式化为：
  "我: xxx\n她: yyy\n我: zzz\n..."
  → 返回拼接后的字符串，附加 key-info.json 中的关键信息前缀
```

**关键信息提取**（extractKeyInfo）：
```
规则匹配（非AI，本地轻量）：
  - 日期模式：\d{4}[-/年]\d{1,2}[-/月]\d{1,2}[日号] → 可能是纪念日/生日
  - 喜欢/想 模式：我喜欢XXX / 我想去XXX / 我爱吃XXX
  - 时间间隔模式：在一起X天 / X周年

结果存入 key-info.json：
{ "anniversary": "2024-03-15", "likes": ["奶茶", "看电影"], ... }
```

### 2.5 控制台 UI（嵌入 index.js）

**彩色输出方案**：使用 ANSI 转义码（Windows Terminal 原生支持，无需第三方库）

```
颜色常量：
  BLUE   = \x1b[36m   (收到消息)
  GREEN  = \x1b[32m   (发出的消息)
  YELLOW = \x1b[33m   (系统提示)
  RED    = \x1b[31m   (错误)
  RESET  = \x1b[0m
```

**启动面板示例**：
```
╔══════════════════════════════════════╗
║   QQ 智能代聊机器人 v1.0.0          ║
║   当前模式: 手动审核 (review)        ║
║   监控对象: 宝宝 (QQ: 987654321)     ║
║   我的账号: 123456789               ║
║   历史记录: 已加载 2345 条           ║
║──────────────────────────────────────║
║   输入 /help 查看可用命令            ║
╚══════════════════════════════════════╝
```

---

## 三、数据流设计

### 3.1 主消息回路

```
QQ服务器 ──消息──→ icqq ──事件──→ qq-client.js
                                       │
                              'message' 事件
                                       │
                                       ↓
                                  index.js
                                 (模式判断)
                                       │
                    ┌──────────────────┼──────────────────┐
                    ↓                  ↓                  ↓
               auto 模式          review 模式        manual 模式
                    │                  │                  │
                    ↓                  ↓                  │
              ai-client           ai-client               │
              .generateReply()    .generateReply()        │
                    │                  │                  │
                    ↓                  ↓                  │
              filterReply()      打印到控制台              │
                    │            等用户 y/n               │
                    ↓             确认发送?               │
              qq-client                │                  │
              .sendMsg()         y → sendMsg()            │
                    │            n → 丢弃                 │
                    ↓                                     │
              history-manager                             │
              .saveMessage() ←────────────────────────────┘
```

### 3.2 启动数据流

```
启动 index.js
  → 加载 config.json (校验必填字段)
  → history-manager.loadHistory()
      → 读取 chat-history/history.json
      → 检查 chat-history/import/ 有无 TXT → 导入
  → history-manager.extractKeyInfo()
      → 写入 key-info.json
  → qq-client.createClient(config)
      → 尝试加载 token → 恢复登录或扫码
  → 登录成功 → 显示状态面板 → 进入消息循环
```

### 3.3 退出数据流

```
触发退出 (/exit /quit Ctrl+C)
  → 设置 state.running = false
  → history-manager.saveMessage() 保存会话中未保存的消息
  → history-manager.extractKeyInfo() 更新关键信息
  → qq-client.shutdown() 关闭 QQ 连接
  → 打印运行统计
  → process.exit(0)
```

---

## 四、开发阶段与里程碑

### Phase 1：骨架搭建（目标：能启动、能加载配置）

| 任务 | 产出 | 预估 |
|------|------|------|
| 初始化 npm 项目 | package.json | 5min |
| 创建 config.json 模板 | config.example.json | 5min |
| 实现 index.js 骨架 | 启动 → 加载配置 → 打印面板 → 等待命令 | 30min |
| 实现 console-ui 命令框架 | 解析 /xxx 命令，/status /help | 20min |
| 创建 .gitignore | 排除 config.json / node_modules | 5min |

**里程碑 M1**：`node index.js` 能启动，显示状态面板，响应 `/status` `/help` `/exit`。

### Phase 2：历史记录模块（目标：能读、能写、能导入TXT）

| 任务 | 产出 | 预估 |
|------|------|------|
| 实现 history-manager.js 基础读写 | loadHistory / saveMessage | 30min |
| 实现 TXT 解析器 | importTxt（状态机解析QQ导出格式） | 40min |
| 实现上下文构建 | buildContext(count) | 15min |
| 实现关键信息提取 | extractKeyInfo + key-info.json | 20min |
| 实现消息合并逻辑 | 60秒内同人消息合并 | 15min |

**里程碑 M2**：能将 QQ 导出的 .txt 聊天记录正确解析为 JSON，能构建上下文文本。

### Phase 3：QQ 客户端模块（目标：能登录、能收发消息）

| 任务 | 产出 | 预估 |
|------|------|------|
| icqq 依赖安装与基础连接 | 登录流程跑通 | 30min |
| 实现扫码登录 | 控制台输出二维码 | 20min |
| 实现登录态缓存 | token 保存与恢复 | 20min |
| 实现消息过滤 | 只处理 girlfriendQQ 的私聊 | 20min |
| 实现消息发送与限速 | 3秒间隔队列 | 25min |
| 实现断线重连 | 5次重试 + 指数退避 | 20min |

**里程碑 M3**：能登录 QQ，能收到指定好友消息，能发送回复（手动命令方式）。

### Phase 4：AI 客户端模块（目标：能生成回复、能过滤）

| 任务 | 产出 | 预估 |
|------|------|------|
| 实现智谱AI HTTP调用 | axios + OpenAI兼容格式 | 25min |
| 实现系统提示词注入 | 内嵌产品文档 4.3.2 | 10min |
| 实现重试与兜底 | 3次重试 + 兜底回复池 | 20min |
| 实现回复过滤链 | AI暴露词/敏感词/标点处理 | 25min |
| 实现消息拆分 | 80字阈值句子边界拆分 | 20min |
| 实现负面情绪检测 | 关键词匹配优先处理 | 15min |

**里程碑 M4**：能根据上下文生成符合风格的回复，有过滤和兜底。

### Phase 5：模式集成（目标：三种模式全部跑通）

| 任务 | 产出 | 预估 |
|------|------|------|
| 实现 auto 模式 | 消息 → AI → 自动发送 | 20min |
| 实现 review 模式 | 消息 → AI → 等确认 → 发送/丢弃 | 30min |
| 实现 manual 模式 | 消息 → 仅记录，不回复 | 15min |
| 实现模式切换 | /auto /review /manual 实时切换 | 15min |
| 实现 /send 命令 | 手动发送消息 | 15min |
| 实现 /recent 命令 | 显示最近N条 | 10min |

**里程碑 M5**：三种模式全部可用，控制台命令完整。

### Phase 6：稳定化与收尾（目标：生产可用）

| 任务 | 产出 | 预估 |
|------|------|------|
| 全链路异常处理补全 | 每个模块的 try-catch 和降级 | 30min |
| 退出保存逻辑完善 | Ctrl+C / /exit 的完整保存流程 | 20min |
| 日志与调试开关 | 可选的 debug 模式 | 15min |
| README 编写 | 安装步骤 / 配置说明 / TXT 导入方法 | 20min |
| 端到端测试 | 用真实QQ号跑通完整流程 | 30min |

**里程碑 M6**：交付物完整，产品文档验收标准全部通过。

---

## 五、依赖管理（package.json 设计）

```json
{
  "name": "qq-chat-bot",
  "version": "1.0.0",
  "description": "QQ智能代聊机器人 - 基于icqq和智谱AI",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "debug": "node index.js --debug"
  },
  "dependencies": {
    "icqq": "^0.5.0",
    "axios": "^1.7.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

> 注意：icqq 版本号需要运行时 `npm view icqq versions` 确认最新稳定版。

---

## 六、技术风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| icqq 被腾讯封禁协议 | 中 | 高 | 锁定具体版本；多准备2个 platform 参数备选 |
| 智谱AI API 不稳定 | 低 | 中 | 已有重试+兜底回复机制 |
| QQ 风控导致消息发不出 | 中 | 中 | 3秒间隔 + 人工审核模式兜底 |
| TXT 格式因QQ版本不一致 | 低 | 低 | 解析器做宽松匹配，支持多种格式变体 |
| token 过期需重新扫码 | 高 | 低 | 已设计自动降级到扫码流程 |

---

## 七、文件产出清单（交付物）

```
qq-chat-bot/
├── index.js                  # 主程序 (~300行)
├── qq-client.js              # QQ客户端 (~200行)
├── ai-client.js              # AI客户端 (~150行)
├── history-manager.js        # 历史管理 (~200行)
├── package.json              # 依赖配置
├── config.example.json       # 配置模板（含注释）
├── .gitignore                # 排除敏感文件
├── README.md                 # 使用说明
├── DEVELOPMENT_PLAN.md       # 本文档
└── chat-history/             # 运行时生成
    ├── history.json
    ├── key-info.json
    └── import/               # 放置QQ导出的TXT
```

---

## 八、开发顺序图（关键路径）

```
Phase 1 (1h)     ████
Phase 2 (2h)           ████████
Phase 3 (2h)                 ████████
Phase 4 (2h)                       ████████
Phase 5 (2h)                             ████████
Phase 6 (2h)                                   ████████

总预估：~11小时（含测试）
依赖关系：Phase 2/3/4 可并行开发（模块独立），Phase 5 必须串行（依赖3和4）
```

---

*计划制定日期：2026-05-14*
*基于产品文档 v2（已修订版）*
