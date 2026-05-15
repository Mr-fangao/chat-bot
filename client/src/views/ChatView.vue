<script setup>
import { ref, computed, nextTick, watch } from 'vue';
import { store } from '../stores/app.js';
import ConfigPanel from '../components/ConfigPanel.vue';

const showConfig = ref(false);
const msgContainer = ref(null);
const inputText = ref('');

const activeTarget = computed(() =>
  store.targets.find(t => t.id === store.activeTargetId)
);

const activeMessages = computed(() =>
  store.messages[store.activeTargetId] || []
);

// 带时间分隔符的消息列表
const messagesWithDividers = computed(() => {
  const list = [];
  let lastTime = 0;
  const gap = 5 * 60 * 1000; // 5分钟以上显示时间分隔
  for (const m of activeMessages.value) {
    const t = new Date(m.time).getTime();
    if (list.length === 0 || t - lastTime > gap) {
      list.push({ type: 'divider', time: m.time });
    }
    lastTime = t;
    list.push({ type: 'message', ...m });
  }
  return list;
});

const activeReview = computed(() =>
  store.reviewQueue[store.activeTargetId] || null
);

function switchTarget(id) {
  store.switchTarget(id);
}

function changeMode(mode) {
  if (!store.activeTargetId) return;
  store.api('/api/targets/' + store.activeTargetId + '/mode', {
    method: 'PUT',
    body: JSON.stringify({ mode })
  });
  const t = store.targets.find(t => t.id === store.activeTargetId);
  if (t) t.mode = mode;
}

function sendManual() {
  const text = inputText.value.trim();
  if (!text || !store.activeTargetId) return;
  store.api('/api/send', {
    method: 'POST',
    body: JSON.stringify({
      targetId: store.activeTargetId,
      text,
      type: activeTarget.value?.type || 'friend'
    })
  });
  inputText.value = '';
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendManual();
  }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return '今天';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

watch(activeMessages, () => {
  nextTick(() => {
    if (msgContainer.value) {
      msgContainer.value.scrollTop = msgContainer.value.scrollHeight;
    }
  });
}, { deep: true });
</script>

<template>
  <div class="chat-layout">
    <!-- ====== 侧边栏 ====== -->
    <div class="sidebar">
      <div class="sidebar-header">
        <span class="title">聊天</span>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="status-dot" :class="{ offline: !store.online }" :title="store.online ? '在线' : '离线'"></div>
          <button class="btn-icon" @click="showConfig = !showConfig" title="设置">&#9881;</button>
        </div>
      </div>

      <div class="target-list">
        <div
          v-for="t in store.targets"
          :key="t.id"
          class="target-item"
          :class="{ active: t.id === store.activeTargetId }"
          @click="switchTarget(t.id)"
        >
          <div class="avatar" :class="t.type === 'group' ? 'avatar-group' : 'avatar-friend'">
            {{ t.name[0] }}
          </div>
          <div class="info">
            <div class="top-row">
              <span class="name">{{ t.name }}</span>
            </div>
            <div class="preview">
              <span :class="'badge badge-' + (t.type === 'group' ? 'group' : t.mode)">
                {{ t.type === 'group' ? '群' : t.mode === 'auto' ? '自动' : t.mode === 'review' ? '审核' : '手动' }}
              </span>
              {{ t.type === 'group' ? '只读' : t.role === 'girlfriend' ? '女朋友' : t.role === 'friend' ? '朋友' : t.role }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ====== 聊天窗口 ====== -->
    <div class="chat-window" v-if="activeTarget">
      <div class="chat-header">
        <div class="left">
          <span class="name">{{ activeTarget.name }}</span>
          <span class="sub">{{ activeTarget.id }}</span>
          <span v-if="activeTarget.type === 'group'" class="badge badge-group" style="font-size:11px">群聊·只读</span>
        </div>
        <div class="mode-group" v-if="activeTarget.type !== 'group'">
          <button class="mode-btn" :class="{ on: activeTarget.mode === 'auto' }"
            @click="changeMode('auto')">自动</button>
          <button class="mode-btn" :class="{ on: activeTarget.mode === 'review' }"
            @click="changeMode('review')">审核</button>
          <button class="mode-btn" :class="{ on: activeTarget.mode === 'manual' }"
            @click="changeMode('manual')">手动</button>
        </div>
      </div>

      <div class="msg-list" ref="msgContainer">
        <template v-for="(item, i) in messagesWithDividers" :key="i">
          <div v-if="item.type === 'divider'" class="time-divider">
            <span>{{ formatDate(item.time) }} {{ formatTime(item.time) }}</span>
          </div>
          <div v-else class="msg-row" :class="item.role">
            <div class="msg-content">
              <div class="msg-sender" v-if="item.role === 'group'">{{ item.senderName }}</div>
              <div class="msg-bubble" :class="{ 'group-msg': item.role === 'group' }">{{ item.content }}</div>
              <div class="msg-time">{{ formatTime(item.time) }}</div>
            </div>
          </div>
        </template>
      </div>

      <!-- 审核栏 -->
      <div class="review-bar" v-if="activeReview">
        <span class="label">待审核</span>
        <span class="original">{{ activeReview.original }}</span>
        <span class="arrow">→</span>
        <span class="reply">{{ activeReview.reply }}</span>
        <button class="btn btn-yes" @click="store.confirmReply(store.activeTargetId, true, activeReview.reply)">发送</button>
        <button class="btn btn-no" @click="store.confirmReply(store.activeTargetId, false)">跳过</button>
      </div>

      <!-- 输入栏 -->
      <div class="input-bar" v-if="activeTarget.type !== 'group'">
        <input v-model="inputText" placeholder="输入消息，Enter 发送..." @keydown="onKeydown" />
        <button class="btn-send" @click="sendManual">发送</button>
      </div>
    </div>

    <!-- 空状态 -->
    <div class="empty-chat" v-else>
      <div class="icon">💬</div>
      <div class="text">选择左侧聊天对象开始</div>
    </div>

    <!-- 配置面板 -->
    <ConfigPanel v-if="showConfig" @close="showConfig = false" />
  </div>
</template>
