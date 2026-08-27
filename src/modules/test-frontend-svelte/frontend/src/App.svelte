<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  // Le socle AGNOSTIQUE de `nodefony/client` — le même que les vitrines React,
  // Vue et Angular. Deux concepts : une connexion partagée qui reçoit
  // l'adresse, et un abonnement. Aucune règle de temps réel n'est écrite ici.
  import {
    connectShared,
    observeChannel,
    observeChannelData,
    observeState,
  } from "nodefony/client";
  // Mise en page COMMUNE aux quatre vitrines — même fichier, même charte que la
  // page d'accueil du framework. Seule `--accent` change d'une vitrine à l'autre.
  import "./showcase.css";

  interface ApiData {
    ts: number;
    pid: number;
    env: string;
  }

  /** Le battement du pod — cf `src/modules/test/.../LiveTickerController.ts`. */
  interface Tick {
    n: number;
    ts: number;
    pid: number;
  }

  /** Un message du salon partagé : qui l'a écrit, depuis quelle vitrine. */
  interface Message {
    texte: string;
    front: string;
    ts: number;
    pid: number;
  }

  /** La couleur du framework de vue — le SEUL écart de style entre les quatre. */
  const ACCENT = "#ff3e00";

  /** Le nom de CETTE vitrine — il marque les messages qu'elle envoie au salon. */
  const FRONT = "Svelte";

  /** Les quatre vitrines, pour les comparer d'un clic. */
  const FRONTS = [
    { nom: "React", href: "/react/app" },
    { nom: "Vue", href: "/vue/app" },
    { nom: "Angular", href: "/angular/app" },
    { nom: "Svelte", href: "/svelte/app" },
  ];

  /** L'état de la connexion, dit en français — un écran ne parle pas machine. */
  const ETATS: Record<string, string> = {
    connected: "connecté",
    connecting: "connexion…",
    reconnecting: "reconnexion automatique…",
    disconnected: "coupé",
    error: "erreur",
  };

  let count = $state(0);
  let data = $state<ApiData | null>(null);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  // UNE socket par URL pour toute la page. `connectShared` porte le cycle de
  // connexion (idempotent, rejet avalé, et JAMAIS de `disconnect()` au démontage :
  // la connexion appartient à la PAGE).
  const live = connectShared({ url: "/api/live/realtime" });
  let liveState = $state(live.socket.state);
  let tick = $state<Tick | null>(null);
  let messages = $state<Message[]>([]);
  let texte = $state("");
  let parHttp = $state<string | null>(null);
  let parSocket = $state<string | null>(null);

  const envoyer = (): void => {
    const dit = texte.trim();
    if (!dit) return;
    // Une notification client → serveur : pas de réponse attendue, c'est le
    // serveur qui rediffuse à tous les abonnés du canal.
    live.socket.emit("live:dire", { texte: dit, front: FRONT });
    texte = "";
  };

  /** La MÊME action, appelée par les deux portes, chronométrée des deux côtés. */
  const comparer = async (): Promise<void> => {
    const t0 = performance.now();
    const r = await fetch("/svelte/api/data");
    const json = (await r.json()) as { result?: unknown };
    parHttp = `${Math.round(performance.now() - t0)} ms\n${JSON.stringify(json.result ?? json, null, 2)}`;
    const t1 = performance.now();
    const parLaSocket = await live.socket.request("/svelte/api/data");
    parSocket = `${Math.round(performance.now() - t1)} ms\n${JSON.stringify(parLaSocket, null, 2)}`;
  };

  const duree = (v: string | null): string => v?.split("\n")[0] ?? "";
  const corps = (v: string | null): string =>
    v?.split("\n").slice(1).join("\n") ?? "—";
  // Libérations des observateurs — rendues au démontage (le HMR remonte le composant).
  let offLive: (() => void)[] = [];

  const basculer = (): void => {
    if (liveState === "connected") live.socket.disconnect();
    else void live.socket.connect();
  };

  const heure = (t: Tick): string => new Date(t.ts).toLocaleTimeString();

  const pollApi = async (): Promise<void> => {
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
    pollApi();
    timer = setInterval(pollApi, 1000);
    // Un observateur = un rappel + une libération. L'abonnement serveur est
    // ref-compté et REJOUÉ à chaque reconnexion : le socle s'en charge.
    offLive.push(observeState(live.socket, (state) => (liveState = state)));
    offLive.push(
      observeChannelData<Tick>(live.socket, "live:ticker", (t) => (tick = t)),
    );
    offLive.push(
      observeChannel(live.socket, "live:salon", (m) => {
        messages = [...messages, m as Message].slice(-6);
      }),
    );
    live.start();
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
    // On libère les observateurs (ce qui rend l'abonnement) — la socket PARTAGÉE,
    // elle, reste ouverte pour la page.
    for (const off of offLive) off();
    offLive = [];
  });
</script>

<div style="--accent: {ACCENT}">
  <header class="topbar">
    <a class="brand" href="/">
      <img src="/nodefony-logo.png" alt="" draggable="false" />
      nodefony-core
    </a>
    <nav class="fronts" aria-label="Les quatre vitrines">
      {#each FRONTS as f (f.href)}
        <a href={f.href} aria-current={f.nom === "Svelte" ? "page" : undefined}>
          {f.nom}
        </a>
      {/each}
    </nav>
  </header>

  <main>
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
      <h1>Svelte 5</h1>
      <p class="sub">
        Le même écran, le même socle, quatre frameworks. Servi par
        <strong>@nodefony/frontend</strong> (Vite + HMR) et alimenté par une seule
        socket Nodefony.
      </p>
      <div class="badges">
        <span class="badge badge--accent">Svelte 5 — runes</span>
        <span class="badge">Vite dev server</span>
        {#if data}<span class="badge">env : {data.env}</span>{/if}
      </div>
    </div>

    <section>
      <div class="sec-head">
        <p class="kicker">Temps réel</p>
        <h2>Ce que cette socket change</h2>
        <p>
          Une seule socket pour la page, ouverte par le framework. L'abonnement
          est compté par référence et rejoué à chaque reconnexion : rien de tout
          cela n'est écrit dans la page.
        </p>
      </div>

      <div class="bandeau">
        <p class="live-state">
          <span
            class="dot"
            class:dot--on={liveState === "connected"}
            class:dot--wait={liveState === "connecting" ||
              liveState === "reconnecting"}
          ></span>
          {ETATS[liveState] ?? liveState}
        </p>
        <p class="live-meta">
          {#if tick}
            battement du pod à {heure(tick)} · process {tick.pid}
          {:else}
            en attente du premier battement…
          {/if}
        </p>
        <button class="btn btn--ghost" onclick={basculer}>
          {liveState === "connected" ? "Couper la connexion" : "Rétablir"}
        </button>
      </div>

      <div class="grid">
        <div class="card">
          <h3>👥 Le serveur pousse à TOUS</h3>
          <p style="margin-bottom: 14px">
            Ouvrez cette page dans un second onglet — ou dans une autre vitrine
            — et écrivez : les deux affichent la même chose, en direct. Le
            message ne repasse jamais par une requête HTTP.
          </p>
          <div class="saisie">
            <input
              bind:value={texte}
              onkeydown={(e) => e.key === "Enter" && envoyer()}
              placeholder="Écrivez, puis Entrée…"
              aria-label="Message à diffuser"
            />
            <button class="counter" onclick={envoyer}>Envoyer</button>
          </div>
          <ul class="salon">
            {#if messages.length === 0}
              <li class="vide">Rien encore — écrivez quelque chose.</li>
            {:else}
              {#each messages as m, i (`${m.ts}-${i}`)}
                <li>
                  <span class="qui">{m.front}</span>
                  <span>{m.texte}</span>
                  <span class="quand"
                    >{new Date(m.ts).toLocaleTimeString()}</span
                  >
                </li>
              {/each}
            {/if}
          </ul>
        </div>

        <div class="card">
          <h3>🔀 Une action, deux transports</h3>
          <p style="margin-bottom: 14px">
            <code>GET /svelte/api/data</code> appelé par HTTP, puis par la
            socket. Même route, même session, même sécurité — une seule action
            de contrôleur derrière les deux portes.
          </p>
          <button class="counter" onclick={comparer}>
            Appeler par les deux
          </button>
          <div class="deux" style="margin-top: 14px">
            <div>
              <p class="voie">HTTP <em>{duree(parHttp)}</em></p>
              <pre class="out">{corps(parHttp)}</pre>
            </div>
            <div>
              <p class="voie">Socket <em>{duree(parSocket)}</em></p>
              <pre class="out">{corps(parSocket)}</pre>
            </div>
          </div>
        </div>
      </div>

      <div class="live" style="margin-top: 16px">
        <div>
          <p class="live-why">
            Ces <strong>trois lignes</strong> sont les mêmes dans les quatre
            vitrines. Seule la syntaxe du framework de vue change : la logique
            d'abonnement vit dans <strong>nodefony/client</strong>, jamais dans la
            page.
          </p>
          <p class="hint">
            Le même socle que React consomme à travers ses hooks — ici on
            l'appelle directement.
          </p>
        </div>
        <pre class="code"><code
            >const live = connectShared(&#123; url: "/api/live/realtime" &#125;)

observeState(live.socket, (état) =&gt; liveState = état)
observeChannel(live.socket, "live:salon", (m) =&gt; …)</code
          ></pre>
      </div>
    </section>

    <section>
      <div class="sec-head">
        <p class="kicker">Par comparaison</p>
        <h2>Ce que la page fait quand elle DEMANDE</h2>
        <p>
          À gauche, une requête par seconde : c'est la page qui réclame. À
          droite, le rechargement à chaud, qui garde l'état du composant.
        </p>
      </div>
      <div class="grid">
        <div class="card">
          <h3>🔌 Requête HTTP</h3>
          <code class="route">GET /svelte/api/data — 1×/s</code>
          {#if error}
            <pre class="out out--err">{error}</pre>
          {:else if data}
            <pre class="out">{JSON.stringify(data, null, 2)}</pre>
          {:else}
            <p class="hint">chargement…</p>
          {/if}
        </div>

        <div class="card">
          <h3>♻️ Rechargement à chaud</h3>
          <button class="counter" onclick={() => (count += 1)}>
            {count} clic{count > 1 ? "s" : ""}
          </button>
          <p class="hint">
            Édite <code>frontend/src/App.svelte</code> : Vite recompile et le
            compteur garde sa valeur.
          </p>
        </div>
      </div>
    </section>

    <p class="foot">
      La même page en <a href="/react/app">React</a>,
      <a href="/vue/app">Vue</a>
      et <a href="/angular/app">Angular</a> — ou la
      <a href="/nodefony">console d'administration</a>.
    </p>
  </main>
</div>
