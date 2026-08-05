<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  interface ApiData {
    ts: number;
    pid: number;
    env: string;
  }

  let count = $state(0);
  let data = $state<ApiData | null>(null);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    try {
      const r = await fetch("/svelte/api/data");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Nodefony wraps payload : `{ result: {...} }` selon le HttpKernel.
      const json = (await r.json()) as { result?: ApiData } & ApiData;
      data = (json.result ?? json) as ApiData;
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  };

  onMount(() => {
    tick();
    timer = setInterval(tick, 1000);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<main class="page">
  <div class="hero">
    <svg class="logo" viewBox="0 0 107 128" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M94.157 22.819c-10.4-14.885-30.94-19.297-45.792-9.835L22.282 29.608A29.92 29.92 0 0 0 8.764 49.65a31.5 31.5 0 0 0 3.108 20.231 30 30 0 0 0-4.477 11.183 31.9 31.9 0 0 0 5.448 24.116c10.402 14.887 30.942 19.297 45.791 9.835l26.083-16.624A29.92 29.92 0 0 0 98.235 78.35a31.53 31.53 0 0 0-3.105-20.232 30 30 0 0 0 4.474-11.182 31.88 31.88 0 0 0-5.447-24.116"
        fill="#ff3e00"
      />
      <path
        d="M45.817 106.582a20.72 20.72 0 0 1-22.237-8.243 19.17 19.17 0 0 1-3.277-14.503 18 18 0 0 1 .624-2.435l.49-1.498 1.337.981a33.6 33.6 0 0 0 10.203 5.098l.97.294-.09.968a5.85 5.85 0 0 0 1.052 3.878 6.24 6.24 0 0 0 6.695 2.485 5.8 5.8 0 0 0 1.603-.704L69.27 76.28a5.43 5.43 0 0 0 2.45-3.631 5.8 5.8 0 0 0-.987-4.371 6.24 6.24 0 0 0-6.698-2.487 5.7 5.7 0 0 0-1.6.704l-9.953 6.345a19 19 0 0 1-5.296 2.326 20.72 20.72 0 0 1-22.237-8.243 19.17 19.17 0 0 1-3.277-14.502 17.99 17.99 0 0 1 8.13-12.052l26.081-16.623a19 19 0 0 1 5.3-2.329 20.72 20.72 0 0 1 22.237 8.243 19.17 19.17 0 0 1 3.277 14.503 18 18 0 0 1-.624 2.435l-.49 1.498-1.337-.98a33.6 33.6 0 0 0-10.203-5.1l-.97-.294.09-.968a5.86 5.86 0 0 0-1.052-3.878 6.24 6.24 0 0 0-6.696-2.485 5.8 5.8 0 0 0-1.602.704L37.725 51.72a5.42 5.42 0 0 0-2.449 3.63 5.79 5.79 0 0 0 .986 4.372 6.24 6.24 0 0 0 6.698 2.486 5.8 5.8 0 0 0 1.602-.704l9.952-6.342a19 19 0 0 1 5.295-2.328 20.72 20.72 0 0 1 22.237 8.242 19.17 19.17 0 0 1 3.277 14.503 18 18 0 0 1-8.13 12.053l-26.081 16.622a19 19 0 0 1-5.3 2.328"
        fill="#fff"
      />
    </svg>

    <h1>You did it!</h1>
    <p class="subtitle">
      Svelte&nbsp;5 transpilé par <strong>@nodefony/frontend</strong> via Vite —
      multi-framework aux côtés des bundles React et Vue, même superviseur.
    </p>

    <div class="badges">
      <span class="badge badge--svelte">Svelte 5 (runes)</span>
      <span class="badge">Vite&nbsp;dev&nbsp;server</span>
      {#if data}<span class="badge">env: {data.env}</span>{/if}
    </div>
  </div>

  <div class="cards">
    <section class="card">
      <h2>♻️ HMR check</h2>
      <button class="counter" onclick={() => count++}>count is {count}</button>
      <p class="hint">
        Édite <code>frontend/src/App.svelte</code> — Vite recompile, l'état du
        compteur est conservé.
      </p>
    </section>

    <section class="card">
      <h2>🔌 Backend ping</h2>
      <code class="route">GET /svelte/api/data</code>
      {#if error}
        <pre class="out out--err">{error}</pre>
      {:else if data}
        <pre class="out">{JSON.stringify(data, null, 2)}</pre>
      {:else}
        <p class="hint">loading…</p>
      {/if}
    </section>
  </div>
</main>

<style>
  .page {
    min-height: 100vh;
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2.5rem;
    padding: 4rem 1.5rem;
    box-sizing: border-box;
    font-family: "Inter", system-ui, -apple-system, sans-serif;
    color: #2c1810;
    background:
      radial-gradient(1200px 600px at 50% -10%, rgba(255, 62, 0, 0.14), transparent),
      #faf8f7;
  }
  .hero {
    text-align: center;
    max-width: 640px;
  }
  .logo {
    width: 84px;
    height: auto;
    filter: drop-shadow(0 8px 18px rgba(255, 62, 0, 0.25));
    animation: float 4s ease-in-out infinite;
  }
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
  h1 {
    margin: 1.2rem 0 0.6rem;
    font-size: 2.6rem;
    font-weight: 800;
    background: linear-gradient(120deg, #ff3e00, #40b3ff);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .subtitle {
    margin: 0 auto;
    font-size: 1.05rem;
    line-height: 1.6;
    color: #6b4b3e;
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
    background: #f2e8e4;
    color: #7a3016;
    border: 1px solid #ecd9d1;
  }
  .badge--svelte {
    background: #ff3e00;
    color: #fff;
    border-color: #ff3e00;
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
    border: 1px solid #f0e4df;
    border-radius: 16px;
    padding: 1.4rem 1.5rem;
    box-shadow: 0 10px 30px rgba(122, 48, 22, 0.06);
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
    border: 1px solid #ff3e00;
    background: #ff3e00;
    color: #fff;
    transition: transform 0.08s ease, box-shadow 0.2s ease;
  }
  .counter:hover {
    box-shadow: 0 6px 16px rgba(255, 62, 0, 0.35);
  }
  .counter:active {
    transform: translateY(1px);
  }
  .hint {
    margin: 0.9rem 0 0;
    font-size: 0.9rem;
    color: #8a6a5c;
  }
  .route {
    display: inline-block;
    margin-bottom: 0.6rem;
    font-size: 0.85rem;
    color: #7a3016;
  }
  .out {
    margin: 0;
    padding: 0.8rem 1rem;
    border-radius: 10px;
    background: #1c1210;
    color: #ffb59e;
    font-size: 0.85rem;
    overflow: auto;
  }
  .out--err {
    background: #fef2f2;
    color: #b91c1c;
  }
  code {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    background: rgba(122, 48, 22, 0.08);
    padding: 0.1rem 0.35rem;
    border-radius: 5px;
  }
</style>
