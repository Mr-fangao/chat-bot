import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROLES_DIR = path.join(__dirname, 'data', 'roles');

const DEFAULT_ROLES = {
  girlfriend: {
    name: 'girlfriend',
    label: '女朋友',
    prompt: `你现在扮演我本人回复我女朋友消息。

上下文里的"我"=你之前说过的话，"对方"=女朋友说的话。每轮对话前务必先读上下文，理解当前话题是什么、双方在聊什么、谁说了什么，再根据上下文生成回复。

规则：
1. 回复极短，10-30字，像真人微信
2. 禁用一切 emoji
3. 别说教别长篇大论，别舔狗别道歉三连
4. 说话直接自然口语化
5. 根据上下文追踪话题，搞清楚主语和指代关系，别张冠李戴
6. 不知道就蒙一个合理的，别一直问
7. 绝对禁止暴露 AI 身份`,
    maxLength: 30,
    noEmoji: true,
    temperature: 0.7
  },
  friend: {
    name: 'friend',
    label: '普通朋友',
    prompt: `你现在扮演我本人回复一个朋友的消息。

上下文里的"我"=你之前说过的话，"对方"=朋友说的话。每轮对话前先读上下文，理解当前话题再回复。

规则：
1. 回复简短自然，10-30字，像平时聊天
2. 禁用 emoji
3. 语气随意轻松，像跟熟人说话
4. 根据上下文跟踪话题，别搞混
5. 不知道就说不知道，别编
6. 绝对禁止暴露 AI 身份`,
    maxLength: 30,
    noEmoji: true,
    temperature: 0.7
  },
  group: {
    name: 'group',
    label: '群聊监控',
    prompt: '',
    maxLength: 0,
    noEmoji: true,
    temperature: 0.7,
    readonly: true
  }
};

class PromptManager {
  constructor() {
    this.roles = {};
    this._ensureDir();
    this.load();
  }

  _ensureDir() {
    if (!fs.existsSync(ROLES_DIR)) fs.mkdirSync(ROLES_DIR, { recursive: true });
  }

  load() {
    const files = fs.readdirSync(ROLES_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      this.roles = { ...DEFAULT_ROLES };
      this._saveAll();
      return;
    }
    for (const file of files) {
      try {
        const role = JSON.parse(fs.readFileSync(path.join(ROLES_DIR, file), 'utf-8'));
        this.roles[role.name] = role;
      } catch (e) {
        console.warn('[Prompt] 加载角色失败: ' + file);
      }
    }
  }

  _saveAll() {
    for (const [name, role] of Object.entries(this.roles)) {
      fs.writeFileSync(path.join(ROLES_DIR, name + '.json'), JSON.stringify(role, null, 2), 'utf-8');
    }
  }

  getAll() { return Object.values(this.roles); }

  get(name) { return this.roles[name] || this.roles.friend; }

  update(name, fields) {
    if (!this.roles[name]) return false;
    Object.assign(this.roles[name], fields);
    fs.writeFileSync(path.join(ROLES_DIR, name + '.json'), JSON.stringify(this.roles[name], null, 2), 'utf-8');
    return true;
  }
}

export default PromptManager;
