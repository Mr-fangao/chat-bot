const fs = require('fs');
const path = require('path');
const readline = require('readline');

const QQClient = require('./qq-client');
const AIClient = require('./ai-client');
const HistoryManager = require('./history-manager');

// ========== 控制台颜色常量 ==========
const C = {
  BLUE:   '\x1b[36m',
  GREEN:  '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED:    '\x1b[31m',
  MAGENTA:'\x1b[35m',
  BOLD:   '\x1b[1m',
  RESET:  '\x1b[0m',
};

// ========== 全局状态 ==========
const state = {
  mode: 'review',        // auto | review | manual
  startTime: Date.now(),
  messageCount: { sent: 0, received: 0 },
  running: true,
  awaitingReview: null,  // 审核模式下的待确认消息 { text, reply }
};

let config = null;
let qqClient = null;
let aiClient = null;
let historyMgr = null;
let rl = null;

// ========== 主函数 ==========

async function main() {
  console.clear();
  console.log(C.BOLD + C.MAGENTA + 'QQ 智能代聊机器人 v1.0.0' + C.RESET);
  console.log(C.YELLOW + '正在初始化...' + C.RESET);

  // 1. 加载配置
  if (!loadConfig()) {
    process.exit(1);
  }

  // 2. 初始化历史记录管理
  historyMgr = new HistoryManager(path.join(__dirname, 'chat-history'));
  historyMgr.loadHistory(config.qq.account);
  historyMgr.extractKeyInfo();

  // 3. 初始化 AI 客户端
  aiClient = new AIClient({
    ...config.ai,
    messageSplitThreshold: config.app.messageSplitThreshold,
  });

  // 4. 初始化 QQ 客户端
  qqClient = new QQClient(config.qq);

  // 5. 启动控制台界面
  initConsole();

  // 6. 绑定 QQ 事件
  qqClient.on('online', async () => {
    state.running = true;
    const herName = await qqClient.getFriendName(config.qq.girlfriendQQ);
    printPanel(herName);
  });

  qqClient.on('offline', () => {
    console.log(C.RED + '[!] QQ 已离线' + C.RESET);
  });

  qqClient.on('reconnect_failed', () => {
    console.log(C.RED + '[!] 重连失败，请手动重启程序' + C.RESET);
  });

  qqClient.on('message', async (msg) => {
    state.messageCount.received++;
    printReceived(msg.text);

    // 记录消息
    historyMgr.addMessage('her', msg.text, msg.time);

    // 根据模式处理
    switch (state.mode) {
      case 'auto':
        await handleAutoMode(msg.text);
        break;
      case 'review':
        await handleReviewMode(msg.text);
        break;
      case 'manual':
        printSystem('手动接管模式 - 消息已记录，不会自动回复');
        break;
    }
  });

  qqClient.on('non_text_message', (msg) => {
    printSystem('收到非文本消息（图片/语音/文件），已记录');
    historyMgr.addMessage('her', '[非文本消息]', msg.time);
  });

  // 7. 登录 QQ
  try {
    await qqClient.login();
  } catch (err) {
    console.error(C.RED + '[!] 启动失败: ' + err.message + C.RESET);
    process.exit(1);
  }
}

// ========== 配置加载 ==========

function loadConfig() {
  const configPath = path.join(__dirname, 'config.json');

  if (!fs.existsSync(configPath)) {
    console.error(C.RED + '[!] 找不到 config.json' + C.RESET);
    console.error('    请复制 config.example.json 为 config.json 并填入你的配置');
    return false;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch (e) {
    console.error(C.RED + '[!] config.json 解析失败: ' + e.message + C.RESET);
    return false;
  }

  // 校验必填字段
  const errors = [];
  if (!config.qq?.account || config.qq.account === 123456789) {
    errors.push('qq.account 未正确配置');
  }
  if (!config.qq?.girlfriendQQ || config.qq.girlfriendQQ === 987654321) {
    errors.push('qq.girlfriendQQ 未正确配置');
  }
  if (!config.ai?.apiKey || config.ai.apiKey.includes('你的智谱AI')) {
    errors.push('ai.apiKey 未正确配置');
  }

  if (errors.length > 0) {
    console.error(C.RED + '[!] 配置错误:' + C.RESET);
    errors.forEach(e => console.error('    - ' + e));
    return false;
  }

  // 设置默认值
  config.qq.messageDelay = config.qq.messageDelay || 3000;
  config.qq.napcatWsUrl = config.qq.napcatWsUrl || 'ws://localhost:3001';
  config.qq.napcatToken = config.qq.napcatToken || '';
  config.ai.model = config.ai.model || 'glm-4.5-flash';
  config.ai.temperature = config.ai.temperature ?? 0.7;
  config.ai.maxTokens = config.ai.maxTokens || 500;
  config.ai.maxRetries = config.ai.maxRetries || 3;
  config.ai.retryDelay = config.ai.retryDelay || 2000;
  config.ai.baseURL = config.ai.baseURL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  config.app.mode = config.app.mode || 'review';
  config.app.historyCount = config.app.historyCount || 50;
  config.app.messageSplitThreshold = config.app.messageSplitThreshold || 80;

  state.mode = config.app.mode;
  return true;
}

// ========== 控制台界面 ==========

function initConsole() {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  });

  // 监听用户输入
  process.stdin.on('data', (data) => {
    const input = data.toString().trim();

    if (input.startsWith('/')) {
      handleCommand(input);
    } else if (state.mode === 'review' && state.awaitingReview) {
      // 审核模式：等待 y/n
      handleReviewInput(input);
    }
  });

  // 监听 Ctrl+C
  process.on('SIGINT', async () => {
    printSystem('\n正在安全退出...');
    await gracefulShutdown();
  });

  // 监听进程退出
  process.on('exit', () => {
    // 同步保存已在 gracefulShutdown 中完成
  });
}

/** 打印启动状态面板 */
function printPanel(herName) {
  const myName = qqClient.getSelfName() || String(config.qq.account);
  const modeName = { auto: '自动回复', review: '手动审核', manual: '手动接管' }[state.mode];

  console.log('\n' + C.BOLD + '╔══════════════════════════════════════╗' + C.RESET);
  console.log(C.BOLD + '║   QQ 智能代聊机器人 v1.0.0          ║' + C.RESET);
  console.log(C.BOLD + '║──────────────────────────────────────║' + C.RESET);
  console.log(C.BOLD + '║' + C.RESET + '   当前模式: ' + C.YELLOW + modeName + C.RESET + '               ' + C.BOLD + '║' + C.RESET);
  console.log(C.BOLD + '║' + C.RESET + '   监控对象: ' + C.GREEN + herName + C.RESET + ' (' + config.qq.girlfriendQQ + ')' + '   '.repeat(3) + C.BOLD + '║' + C.RESET);
  console.log(C.BOLD + '║' + C.RESET + '   我的账号: ' + myName + ' (' + config.qq.account + ')' + '   '.repeat(2) + C.BOLD + '║' + C.RESET);
  console.log(C.BOLD + '║' + C.RESET + '   历史记录: 已加载 ' + historyMgr.getMessageCount() + ' 条' + '          '.repeat(2) + C.BOLD + '║' + C.RESET);
  console.log(C.BOLD + '║──────────────────────────────────────║' + C.RESET);
  console.log(C.BOLD + '║' + C.RESET + '   输入 /help 查看可用命令           ' + C.BOLD + '║' + C.RESET);
  console.log(C.BOLD + '╚══════════════════════════════════════╝' + C.RESET + '\n');
}

// ========== 三种运行模式 ==========

/** 自动模式：收到消息 → 生成回复 → 自动发送 */
async function handleAutoMode(text) {
  printSystem('自动模式 - 正在生成回复...');

  const reply = await generateReply(text);
  if (!reply) return;

  await sendReply(reply);
}

/** 手动审核模式：收到消息 → 生成回复 → 等用户确认 → 发送或丢弃 */
async function handleReviewMode(text) {
  printSystem('审核模式 - 正在生成回复...');

  const reply = await generateReply(text);
  if (!reply) return;

  // 显示待确认的回复
  state.awaitingReview = { original: text, reply: reply };
  console.log(C.BOLD + '\n--- 待确认回复 ---' + C.RESET);
  console.log(C.BLUE + '她: ' + text + C.RESET);
  console.log(C.GREEN + 'AI 建议: ' + reply + C.RESET);
  console.log(C.YELLOW + '发送? (y=发送 / n=跳过 / 60秒超时自动跳过)' + C.RESET);

  // 启动60秒超时计时器
  state._reviewTimeout = setTimeout(() => {
    if (state.awaitingReview) {
      printSystem('审核超时，自动跳过该回复');
      state.awaitingReview = null;
    }
  }, 60000);
}

/** 审核输入处理 */
async function handleReviewInput(input) {
  const lower = input.toLowerCase();

  if (state._reviewTimeout) {
    clearTimeout(state._reviewTimeout);
    state._reviewTimeout = null;
  }

  const review = state.awaitingReview;
  state.awaitingReview = null;

  if (lower === 'y' || lower === 'yes') {
    printSystem('已确认发送');
    await sendReply(review.reply);
  } else if (lower === 'n' || lower === 'no') {
    printSystem('已跳过');
  } else {
    printSystem('无效输入，已跳过（输入 y 发送，n 跳过）');
  }
}

// ========== 命令处理 ==========

function handleCommand(input) {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/help':
      printHelp();
      break;

    case '/auto':
      state.mode = 'auto';
      state.awaitingReview = null;
      clearReviewTimeout();
      printSystem('已切换到 ' + C.GREEN + '自动模式' + C.RESET + '（收到消息后自动回复）');
      break;

    case '/review':
      state.mode = 'review';
      clearReviewTimeout();
      printSystem('已切换到 ' + C.YELLOW + '手动审核模式' + C.RESET + '（生成回复后等确认再发送）');
      break;

    case '/manual':
      state.mode = 'manual';
      state.awaitingReview = null;
      clearReviewTimeout();
      printSystem('已切换到 ' + C.BLUE + '手动接管模式' + C.RESET + '（机器人只记录不回复）');
      break;

    case '/send':
      if (parts.length < 2) {
        printSystem('用法: /send [消息内容]');
      } else {
        const msgText = parts.slice(1).join(' ');
        sendReply(msgText);
      }
      break;

    case '/status':
      printStatus();
      break;

    case '/recent':
      printRecent();
      break;

    case '/exit':
    case '/quit':
      printSystem('正在安全退出...');
      gracefulShutdown();
      break;

    default:
      printSystem('未知命令: ' + cmd + '，输入 /help 查看可用命令');
  }
}

function clearReviewTimeout() {
  if (state._reviewTimeout) {
    clearTimeout(state._reviewTimeout);
    state._reviewTimeout = null;
  }
}

// ========== AI 回复生成流程 ==========

async function generateReply(text) {
  try {
    // 构建上下文
    const context = historyMgr.buildContext(config.app.historyCount);

    // 检测负面情绪
    let negativePrompt = '';
    if (aiClient.hasNegativeEmotion(text)) {
      printSystem(C.RED + '检测到负面情绪，优先安慰' + C.RESET);
      negativePrompt = aiClient.buildNegativePrompt(text);
    }

    // 调用 AI
    let rawReply = await aiClient.generateReply(
      context + (negativePrompt ? '\n' + negativePrompt : ''),
      text
    );

    // 过滤后处理
    let filteredReply = aiClient.filterReply(rawReply);

    // 如果过滤返回 null（敏感词），重新生成
    let retryCount = 0;
    while (filteredReply === null && retryCount < 3) {
      retryCount++;
      printSystem('回复被过滤，正在重新生成... (' + retryCount + '/3)');
      rawReply = await aiClient.generateReply(context, text);
      filteredReply = aiClient.filterReply(rawReply);
    }

    if (filteredReply === null) {
      printSystem(C.RED + '多次生成均被过滤，跳过该消息' + C.RESET);
      return null;
    }

    return filteredReply;
  } catch (err) {
    console.error(C.RED + '[!] 生成回复异常: ' + err.message + C.RESET);
    return null;
  }
}

/** 发送回复（含拆分和记录） */
async function sendReply(text) {
  if (!text || text.trim().length === 0) return;

  // 拆分为多条（如果超过阈值）
  const chunks = aiClient.splitLongMessage(text);

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;

    try {
      await qqClient.sendMessage(chunk);
      state.messageCount.sent++;
      printSent(chunk);

      // 记录历史
      historyMgr.addMessage('me', chunk, new Date().toISOString());

      // 多条消息之间等待3秒
      if (chunks.length > 1 && chunks.indexOf(chunk) < chunks.length - 1) {
        await sleep(config.qq.messageDelay);
      }
    } catch (err) {
      console.error(C.RED + '[!] 发送失败: ' + err.message + C.RESET);
    }
  }
}

// ========== 控制台输出格式化 ==========

function printReceived(text) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(C.BLUE + `[${time}] 💬 她: ${text}` + C.RESET);
}

function printSent(text) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(C.GREEN + `[${time}] 📤 我: ${text}` + C.RESET);
}

function printSystem(msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(C.YELLOW + `[${time}] ⚡ ${msg}` + C.RESET);
}

function printHelp() {
  console.log(C.BOLD + '\n可用命令:' + C.RESET);
  console.log('  /auto     - 切换到自动回复模式');
  console.log('  /review   - 切换到手动审核模式（默认）');
  console.log('  /manual   - 切换到手动接管模式');
  console.log('  /send xx  - 手动发送消息给女朋友');
  console.log('  /status   - 查看当前运行状态');
  console.log('  /recent   - 显示最近10条聊天记录');
  console.log('  /help     - 显示此帮助');
  console.log('  /exit     - 安全退出程序');
  console.log('');
}

function printStatus() {
  const modeName = { auto: '自动回复', review: '手动审核', manual: '手动接管' }[state.mode];
  const uptime = Math.floor((Date.now() - state.startTime) / 1000 / 60);
  const herName = qqClient.getSelfName ? qqClient.getSelfName() : '?';

  console.log(C.BOLD + '\n══════ 运行状态 ══════' + C.RESET);
  console.log('  运行模式: ' + C.YELLOW + modeName + C.RESET);
  console.log('  在线时长: ' + uptime + ' 分钟');
  console.log('  收到消息: ' + state.messageCount.received + ' 条');
  console.log('  发送消息: ' + state.messageCount.sent + ' 条');
  console.log('  历史总计: ' + historyMgr.getMessageCount() + ' 条');
  console.log('  目标好友: ' + config.qq.girlfriendQQ);
  console.log('');
}

function printRecent() {
  const recent = historyMgr.getRecent(10);
  if (recent.length === 0) {
    printSystem('暂无聊天记录');
    return;
  }
  console.log(C.BOLD + '\n══════ 最近10条聊天记录 ══════' + C.RESET);
  for (const msg of recent) {
    const label = msg.role === 'me' ? '我' : '她';
    const color = msg.role === 'me' ? C.GREEN : C.BLUE;
    const time = new Date(msg.time).toLocaleString('zh-CN', { hour12: false });
    console.log(color + `[${time}] ${label}: ${msg.content}` + C.RESET);
  }
  console.log('');
}

// ========== 安全退出 ==========

async function gracefulShutdown() {
  state.running = false;
  clearReviewTimeout();

  printSystem('正在保存聊天记录...');

  // 保存历史
  const saved = historyMgr.saveHistory();
  if (saved) {
    printSystem('聊天记录已保存 (' + historyMgr.getMessageCount() + ' 条)');
  } else {
    console.error(C.RED + '[!] 聊天记录保存失败' + C.RESET);
  }

  // 更新关键信息
  historyMgr.extractKeyInfo();
  historyMgr.saveKeyInfo();

  // 关闭 QQ
  if (qqClient) {
    try {
      await qqClient.shutdown();
    } catch (e) { /* ignore */ }
  }

  // 关闭控制台
  if (rl) {
    rl.close();
  }

  // 运行统计
  const uptime = Math.floor((Date.now() - state.startTime) / 1000 / 60);
  console.log(C.BOLD + '\n══════ 本次运行统计 ══════' + C.RESET);
  console.log('  在线时长: ' + uptime + ' 分钟');
  console.log('  收发消息: ' + state.messageCount.received + ' 收 / ' + state.messageCount.sent + ' 发');
  console.log('  再见！\n');

  process.exit(0);
}

// ========== 工具函数 ==========

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== 启动 ==========

main().catch((err) => {
  console.error(C.RED + '[!] 未捕获的异常: ' + err.message + C.RESET);
  console.error(err.stack);
  process.exit(1);
});
