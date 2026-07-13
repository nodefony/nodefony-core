<script setup lang="ts">
import { ref, version as vueVersion } from "vue";

/**
 * Page « <%= it.kebab %> » — squelette VOLONTAIREMENT minimal : c'est TA page,
 * pas une vitrine. Le compteur prouve le HMR (édite le template : Vite
 * recompile à la volée sans recharger). Les appels backend passent par
 * `fetch("/api/…")` (proxifiés vers Nodefony en dev, cf `apiProxyPaths`).
 */
const count = ref(0);
</script>

<template>
  <main style="font-family: system-ui, sans-serif; padding: 32px">
    <h1><%= it.kebab %></h1>
    <p>Vue v{{ vueVersion }} servi par Nodefony via Vite — entry « <%= it.kebab %> ».</p>
    <button @click="count++">count is {{ count }}</button>
    <p style="color: #666; font-size: 14px">
      Édite <code>frontend/src/App.vue</code> — HMR sans recharger, compteur
      conservé.
    </p>
  </main>
</template>
