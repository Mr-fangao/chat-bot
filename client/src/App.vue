<script setup>
import { onMounted } from 'vue';
import { store } from './stores/app.js';
import LoginView from './views/LoginView.vue';
import ChatView from './views/ChatView.vue';

onMounted(() => {
  store.connect();
});
</script>

<template>
  <LoginView v-if="!store.online" />
  <ChatView v-else />
</template>
