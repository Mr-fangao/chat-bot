import axios from 'axios';

// ========== AI 身份暴露关键词 ==========
const AI_EXPOSURE_KEYWORDS = [
  'AI', 'ai', '人工智能', '机器人', '语言模型', '模型', '大模型',
  '虚拟', '算法', '机器学习', '深度学习', '神经网络',
  '作为AI', '作为人工智能', '我是AI', '我是一个AI',
  '根据历史记录', '根据聊天记录', '基于数据分析',
  'OpenAI', 'ChatGPT', 'GPT', 'Claude', 'Gemini',
  '系统提示', 'prompt', '上下文', 'token',
];

// ========== 敏感词列表 ==========
const SENSITIVE_WORDS = [
  // 政治
  '习近平', '习大大', '总书记', '共产党', '中共',
  '台独', '藏独', '疆独', '港独', '法轮功',
  // 色情
  '裸', '性爱', '做爱', '上床', '约炮',
  // 违法
  '毒品', '枪支', '赌博', '诈骗',
];

// ========== 兜底回复池 ==========
const FALLBACK_REPLIES = [
  '在呢',
  '刚没看到',
  '来啦',
  '嗯你说',
  '忙呢',
];

// ========== 负面情绪关键词 ==========
const NEGATIVE_EMOTION_KEYWORDS = ['哭了', '难受', '分手', '伤心', '难过', '生气', '不理你', '烦', '委屈'];

class AIClient {
  /**
   * @param {object} config - ai 配置段
   */
  constructor(config) {
    this.baseURL = config.baseURL;
    this.apiKey = config.apiKey;
    this.model = config.model || 'glm-4.5-flash';
    this.temperature = config.temperature || 0.7;
    this.maxTokens = config.maxTokens || 4096;
    this.noThinking = config.noThinking !== undefined ? config.noThinking : true;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 2000;
    this.splitThreshold = config.messageSplitThreshold || 80;
  }

  // ========== 核心接口 ==========

  /**
   * 生成 AI 回复
   * @param {string} context    - 历史聊天上下文文本
   * @param {string} newMessage - 对方刚发的消息
   * @returns {Promise<string>} - 生成的回复
   */
  async generateReply(systemPrompt, context, newMessage) {
    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    if (context && context.trim()) {
      messages.push({ role: 'user', content: context });
    }

    messages.push({ role: 'user', content: '她刚才说：' + newMessage });

    // 整体硬超时 45 秒，防止任何情况下的卡死
    const hardTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('AI 请求超时 (45s)')), 45000)
    );

    const doRequest = async () => {
      let lastError = null;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        console.log('[AI] 请求中... (attempt ' + (attempt + 1) + '/' + (this.maxRetries + 1) + ')');
        const startTime = Date.now();
        const response = await axios.post(
          this.baseURL,
          {
            model: this.model,
            temperature: this.temperature,
            max_tokens: this.maxTokens,
            messages: messages,
            ...(this.noThinking ? { thinking: { type: 'disabled' } } : {}),
          },
          {
            headers: {
              'Authorization': 'Bearer ' + this.apiKey,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );
        console.log('[AI] 响应耗时: ' + (Date.now() - startTime) + 'ms');

        const content = response.data?.choices?.[0]?.message?.content;
        if (!content || content.trim().length === 0) {
          throw new Error('AI 返回空内容');
        }

        return content.trim();
      } catch (err) {
        lastError = err;
        // 4xx 错误不重试（API Key 问题等）
        if (err.response && err.response.status >= 400 && err.response.status < 500) {
          console.error('[AI] API 请求失败 (4xx): ' + err.message);
          break;
        }
        if (attempt < this.maxRetries) {
          console.warn(`[AI] 请求失败，${this.retryDelay / 1000}秒后重试 (${attempt + 1}/${this.maxRetries})`);
          await this._sleep(this.retryDelay);
        }
      }
    }

      // 所有重试失败 → 兜底
      console.error('[AI] 重试耗尽: ' + (lastError ? (lastError.code || lastError.message) : 'unknown'));
      return this._getFallback();
    };

    try {
      return await Promise.race([doRequest(), hardTimeout]);
    } catch (err) {
      console.error('[AI] 硬超时触发: ' + err.message);
      return this._getFallback();
    }
  }

  // ========== 回复后处理 ==========

  /**
   * 过滤 AI 回复中的敏感内容和 AI 暴露痕迹
   * @param {string} text - AI 原始回复
   * @returns {string|null} - 过滤后的文本，null 表示需要重新生成
   */
  filterReply(text) {
    if (!text || text.trim().length === 0) return null;

    let result = text;

    // 1. 检测 AI 暴露关键词
    for (const kw of AI_EXPOSURE_KEYWORDS) {
      if (result.includes(kw)) {
        // 尝试删除包含关键词的句子
        result = result.replace(new RegExp(`[^。！？~]*${this._escapeRegExp(kw)}[^。！？~]*[。！？~]?`, 'g'), '');
      }
    }

    // 2. 检测敏感词
    for (const kw of SENSITIVE_WORDS) {
      if (result.includes(kw)) {
        console.warn('[AI] 回复包含敏感词: ' + kw + '，需重新生成');
        return null; // 返回 null 触发重新生成
      }
    }

    // 3. 去除首尾引号和多余标点
    result = result.replace(/^["'""']/, '').replace(/["'""']$/, '');
    result = result.replace(/^[，。！？~、]/, '').replace(/[，。！？~、]$/, '');
    result = result.trim();

    if (result.length === 0) return null;

    return result;
  }

  // ========== 消息拆分 ==========

  /**
   * 按句子边界拆分长消息
   * @param {string} text - 待拆分的消息
   * @param {number} threshold - 拆分字符阈值 (默认80)
   * @returns {string[]}
   */
  splitLongMessage(text, threshold) {
    const limit = threshold || this.splitThreshold;
    // 计算中文字符数（中文每个字算1，英文单词整体算）
    const charCount = this._countChineseChars(text);
    if (charCount <= limit) return [text];

    // 按句子边界拆分
    const sentences = text.split(/(?<=[。！？~])\s*/);
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;

      if (this._countChineseChars(current + trimmed) <= limit) {
        current += (current ? '' : '') + trimmed;
      } else {
        if (current) chunks.push(current.trim());
        // 单句超过阈值，强制按字符拆
        if (this._countChineseChars(trimmed) > limit) {
          const subChunks = this._forceSplit(trimmed, limit);
          for (const sc of subChunks) {
            chunks.push(sc);
          }
          current = '';
        } else {
          current = trimmed;
        }
      }
    }
    if (current.trim()) chunks.push(current.trim());

    return chunks.length > 0 ? chunks : [text];
  }

  /** 强制按字符数拆分（无句子边界时） */
  _forceSplit(text, limit) {
    const result = [];
    let i = 0;
    while (i < text.length) {
      result.push(text.substring(i, i + limit));
      i += limit;
    }
    return result;
  }

  // ========== 情绪检测 ==========

  /** 检测对方消息是否包含强烈负面情绪 */
  hasNegativeEmotion(message) {
    return NEGATIVE_EMOTION_KEYWORDS.some(kw => message.includes(kw));
  }

  /** 为负面情绪消息构建增强提示 */
  buildNegativePrompt(message) {
    return `注意：她现在生气了（"${message}"）。不要长篇道歉，回一句话表达你在意但别舔。简短。`;
  }

  // ========== 工具方法 ==========

  _getFallback() {
    const idx = Math.floor(Math.random() * FALLBACK_REPLIES.length);
    return FALLBACK_REPLIES[idx];
  }

  _countChineseChars(text) {
    // 中文字符 + 中文标点算1，英文单词算1，空格不计
    const chinese = (text.match(/[一-鿿　-〿＀-￯]/g) || []).length;
    const words = (text.match(/[a-zA-Z0-9]+/g) || []).length;
    return chinese + words;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export default AIClient;
