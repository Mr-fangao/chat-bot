<script setup>
import { ref, onUnmounted } from 'vue';
import { store } from '../stores/app.js';

const ts = ref(Date.now());
let timer = setInterval(() => { ts.value = Date.now(); }, 3000);
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div class="login-page">
    <div class="logo">🐱</div>
    <h1>QQ Chat Bot</h1>
    <div class="subtitle">智谱 AI · NapCatQQ</div>
    <div v-if="store.qrReady" class="qr-card">
      <img :src="'/api/qrcode?t=' + ts" alt="QR Code" />
    </div>
    <div v-else class="qr-waiting">
      <div class="spinner"></div>
    </div>
    <div class="hint">{{ store.qrReady ? '请使用手机 QQ 扫描二维码' : '等待二维码...' }}</div>
  </div>
</template>
