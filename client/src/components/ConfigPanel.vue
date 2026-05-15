<script setup>
import { ref, computed } from 'vue';
import { store } from '../stores/app.js';

const emit = defineEmits(['close']);

const tab = ref('targets');
const editRole = ref(null);
const newTarget = ref({ id: '', name: '', type: 'friend', role: 'friend' });

async function addTarget() {
  if (!newTarget.value.id) return;
  await store.api('/api/targets', {
    method: 'POST',
    body: JSON.stringify(newTarget.value)
  });
  store.targets = await store.api('/api/targets');
  newTarget.value = { id: '', name: '', type: 'friend', role: 'friend' };
}

async function removeTarget(id) {
  if (!confirm('确定删除?')) return;
  await store.api('/api/targets/' + id, { method: 'DELETE' });
  store.targets = await store.api('/api/targets');
  if (store.activeTargetId === id) {
    store.activeTargetId = store.targets[0]?.id || '';
  }
}

async function saveRole() {
  if (!editRole.value) return;
  await store.api('/api/roles/' + editRole.value.name, {
    method: 'PUT',
    body: JSON.stringify(editRole.value)
  });
  store.roles = await store.api('/api/roles');
  editRole.value = null;
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="config-panel">
      <h2>配置</h2>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn" :class="tab==='targets'?'btn-primary':'btn-secondary'" @click="tab='targets'">聊天对象</button>
        <button class="btn" :class="tab==='roles'?'btn-primary':'btn-secondary'" @click="tab='roles'">角色模板</button>
      </div>

      <!-- 聊天对象管理 -->
      <div v-if="tab === 'targets'">
        <div v-for="t in store.targets" :key="t.id" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #2a2a4a">
          <div>
            <span style="font-size:14px">{{ t.name }}</span>
            <span style="font-size:11px;color:#888;margin-left:8px">{{ t.id }} {{ t.type }} {{ t.role }}</span>
          </div>
          <button class="btn btn-secondary" @click="removeTarget(t.id)" style="font-size:11px;padding:4px 8px">删除</button>
        </div>

        <div class="add-target" style="margin-top:12px">
          <input v-model="newTarget.id" placeholder="QQ号/群号" />
          <input v-model="newTarget.name" placeholder="显示名称" />
          <select v-model="newTarget.type">
            <option value="friend">私聊</option>
            <option value="group">群聊</option>
          </select>
          <select v-model="newTarget.role">
            <option v-for="r in store.roles" :key="r.name" :value="r.name">{{ r.label }}</option>
          </select>
          <div class="btn-row"><button class="btn" @click="addTarget">添加</button></div>
        </div>
      </div>

      <!-- 角色模板管理 -->
      <div v-if="tab === 'roles'">
        <div v-if="!editRole">
          <div v-for="r in store.roles" :key="r.name" style="padding:8px 0;border-bottom:1px solid #2a2a4a;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:14px;font-weight:600">{{ r.label }} ({{ r.name }})</span>
            <button class="btn btn-secondary" @click="editRole = { ...r }">编辑</button>
          </div>
        </div>
        <div v-else>
          <div class="field">
            <label>角色名</label>
            <input v-model="editRole.label" />
          </div>
          <div class="field">
            <label>最大回复长度</label>
            <input v-model.number="editRole.maxLength" type="number" />
          </div>
          <div class="field">
            <label>提示词</label>
            <textarea v-model="editRole.prompt"></textarea>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" @click="saveRole">保存</button>
            <button class="btn btn-secondary" @click="editRole = null">取消</button>
          </div>
        </div>
      </div>

      <div class="btn-row" style="margin-top:16px">
        <button class="btn btn-secondary" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>
