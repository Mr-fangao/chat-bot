import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const TARGETS_FILE = path.join(DATA_DIR, 'targets.json');

const DEFAULT_TARGETS = [
  {
    id: '1059552213',
    type: 'friend',
    name: '宝宝',
    role: 'girlfriend',
    mode: 'review',
    enabled: true
  }
];

class TargetManager {
  constructor() {
    this.targets = [];
    this._ensureDir();
    this.load();
  }

  _ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const rolesDir = path.join(DATA_DIR, 'roles');
    if (!fs.existsSync(rolesDir)) fs.mkdirSync(rolesDir, { recursive: true });
    const historyDir = path.join(DATA_DIR, 'history');
    if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  }

  load() {
    if (fs.existsSync(TARGETS_FILE)) {
      try {
        this.targets = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf-8'));
      } catch (e) {
        this.targets = [...DEFAULT_TARGETS];
      }
    } else {
      this.targets = [...DEFAULT_TARGETS];
      this.save();
    }
  }

  save() {
    fs.writeFileSync(TARGETS_FILE, JSON.stringify(this.targets, null, 2), 'utf-8');
  }

  getAll() { return this.targets; }

  getEnabled() { return this.targets.filter(t => t.enabled); }

  getById(id) { return this.targets.find(t => t.id === id); }

  getByType(type) { return this.targets.filter(t => t.type === type); }

  add(target) {
    if (this.targets.find(t => t.id === target.id)) return false;
    this.targets.push({
      id: target.id,
      type: target.type || 'friend',
      name: target.name || target.id,
      role: target.role || (target.type === 'group' ? 'group' : 'friend'),
      mode: target.mode || 'manual',
      enabled: true
    });
    this.save();
    return true;
  }

  update(id, fields) {
    const t = this.getById(id);
    if (!t) return false;
    Object.assign(t, fields);
    this.save();
    return true;
  }

  remove(id) {
    const idx = this.targets.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.targets.splice(idx, 1);
    this.save();
    return true;
  }
}

export default TargetManager;
