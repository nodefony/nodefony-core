<script setup lang="ts">
import { onMounted, ref } from "vue";

interface ApiData {
  hello: string;
  pid: number;
}

// `/api` est proxifié vers Nodefony par `apiProxyPaths` (cf registerEntry) —
// sans lui, Vite répondrait son SPA-fallback HTML au lieu du JSON.
const data = ref<ApiData | null>(null);
const error = ref<string | null>(null);
onMounted(async () => {
  try {
    const r = await fetch("/api/hello");
    const j = (await r.json()) as { result?: ApiData } & ApiData;
    data.value = (j.result ?? j) as ApiData; // Nodefony wrappe `{ result }`
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>
<template>
  <main style="font-family: system-ui; padding: 24px">
    <h1><%= it.appName %></h1>
    <p>Vue 3 + Vite (HMR) servi par Nodefony — édite ce fichier et regarde.</p>
    <pre v-if="error" style="color: crimson">{{ error }}</pre>
    <pre v-else-if="data">{{ JSON.stringify(data, null, 2) }}</pre>
    <p v-else>loading…</p>
  </main>
</template>
