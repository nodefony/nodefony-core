<script setup lang="ts">
import { onMounted, onUnmounted, ref, version as vueVersion } from "vue";

interface ApiData {
  ts: number;
  pid: number;
  env: string;
}

const count = ref(0);
const data = ref<ApiData | null>(null);
const error = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

const tick = async (): Promise<void> => {
  try {
    const r = await fetch("/vue/api/data");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // Nodefony wraps payload : `{ result: {...} }` selon le HttpKernel.
    const json = (await r.json()) as { result?: ApiData } & ApiData;
    data.value = (json.result ?? json) as ApiData;
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
};

onMounted(() => {
  tick();
  timer = setInterval(tick, 1000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <main class="page">
    <div class="hero">
      <svg
        class="logo"
        viewBox="0 0 256 221"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M204.8 0H256L128 220.8 0 0h97.92L128 51.2 157.44 0z"
          fill="#41B883"
        />
        <path
          d="m0 0 128 220.8L256 0h-51.2L128 132.48 50.56 0z"
          fill="#41B883"
        />
        <path
          d="M50.56 0 128 133.12 204.8 0h-47.36L128 51.2 97.92 0z"
          fill="#35495E"
        />
      </svg>

      <h1>You did it!</h1>
      <p class="subtitle">
        Vue&nbsp;3 transpilé par <strong>@nodefony/frontend</strong> via Vite —
        multi-framework aux côtés des bundles React, même superviseur.
      </p>

      <div class="badges">
        <span class="badge badge--vue">Vue v{{ vueVersion }}</span>
        <span class="badge">Vite&nbsp;dev&nbsp;server</span>
        <span class="badge" v-if="data">env: {{ data.env }}</span>
      </div>
    </div>

    <div class="cards">
      <section class="card">
        <h2>♻️ HMR check</h2>
        <button class="counter" @click="count++">count is {{ count }}</button>
        <p class="hint">
          Édite <code>frontend/src/App.vue</code> — Vite recompile, l'état du
          compteur est conservé.
        </p>
      </section>

      <section class="card">
        <h2>🔌 Backend ping</h2>
        <code class="route">GET /vue/api/data</code>
        <pre v-if="error" class="out out--err">{{ error }}</pre>
        <pre v-else-if="data" class="out">{{
          JSON.stringify(data, null, 2)
        }}</pre>
        <p v-else class="hint">loading…</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2.5rem;
  padding: 4rem 1.5rem;
  box-sizing: border-box;
  font-family:
    "Inter",
    system-ui,
    -apple-system,
    sans-serif;
  color: #2c3e50;
  background:
    radial-gradient(
      1200px 600px at 50% -10%,
      rgba(66, 184, 131, 0.18),
      transparent
    ),
    #f7f9f8;
}
.hero {
  text-align: center;
  max-width: 640px;
}
.logo {
  width: 96px;
  height: auto;
  filter: drop-shadow(0 8px 18px rgba(53, 73, 94, 0.18));
  animation: float 4s ease-in-out infinite;
}
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}
h1 {
  margin: 1.2rem 0 0.6rem;
  font-size: 2.6rem;
  font-weight: 800;
  background: linear-gradient(120deg, #41b883, #35495e);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.subtitle {
  margin: 0 auto;
  font-size: 1.05rem;
  line-height: 1.6;
  color: #4b5b6b;
}
.badges {
  margin-top: 1.4rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: center;
}
.badge {
  padding: 0.32rem 0.85rem;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 600;
  background: #e8eef0;
  color: #35495e;
  border: 1px solid #d6e0e2;
}
.badge--vue {
  background: #41b883;
  color: #fff;
  border-color: #41b883;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 1.25rem;
  width: 100%;
  max-width: 760px;
}
.card {
  background: #fff;
  border: 1px solid #e6ecec;
  border-radius: 16px;
  padding: 1.4rem 1.5rem;
  box-shadow: 0 10px 30px rgba(53, 73, 94, 0.06);
}
.card h2 {
  margin: 0 0 1rem;
  font-size: 1.15rem;
}
.counter {
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  padding: 0.6rem 1.1rem;
  border-radius: 10px;
  border: 1px solid #41b883;
  background: #41b883;
  color: #fff;
  transition:
    transform 0.08s ease,
    box-shadow 0.2s ease;
}
.counter:hover {
  box-shadow: 0 6px 16px rgba(66, 184, 131, 0.35);
}
.counter:active {
  transform: translateY(1px);
}
.hint {
  margin: 0.9rem 0 0;
  font-size: 0.9rem;
  color: #6b7a89;
}
.route {
  display: inline-block;
  margin-bottom: 0.6rem;
  font-size: 0.85rem;
  color: #35495e;
}
.out {
  margin: 0;
  padding: 0.8rem 1rem;
  border-radius: 10px;
  background: #0f172a;
  color: #a7f3d0;
  font-size: 0.85rem;
  overflow: auto;
}
.out--err {
  background: #fef2f2;
  color: #b91c1c;
}
code {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  background: rgba(53, 73, 94, 0.08);
  padding: 0.1rem 0.35rem;
  border-radius: 5px;
}
</style>
