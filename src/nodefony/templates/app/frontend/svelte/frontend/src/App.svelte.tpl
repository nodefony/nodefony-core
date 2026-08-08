<script lang="ts">
  import { onMount, onDestroy } from "svelte";
<% if (it.complete) { %>  // FAÇADE temps réel isomorphe du framework — reconnexion, re-subscribe, état :
  // gérés par le client. Aucun `new WebSocket` à la main. Subpath
  // `nodefony/client` : la porte client explicite, résolue à l'identique par
  // Vite, Node et le typecheck.
  import { RealtimeClient } from "nodefony/client";
<% } %>  import { NODEFONY_LOGO } from "./brand";
  // Mise en page et palette de la démonstration — feuille PARTAGÉE par les
  // vitrines ; `accent.css` n'y ajoute que la couleur du framework.
  import "./showcase.css";
  import "./accent.css";

  interface ApiData {
    hello: string;
    pid: number;
    /** Identité résolue par la zone firewall `main` (^/api) — « anonyme » sinon. */
    who?: string;
  }
<% if (it.complete) { %>
  /** Réponse de la route PROTÉGÉE /api/secure/hello (zone `secure`, 401 sans session). */
  interface SecureData {
    message: string;
    zone: string;
    pid: number;
  }
<% } %>
  /**
   * Page d'accueil de l'app — vitrine AUTONOME (zéro dépendance UI) :
   *  - panneau de marque (même design que le login de Studio : dégradé, glow,
   *    logo, slogan, 3 piliers du framework) ;
   *  - preuves INTERACTIVES : fetch HTTP, echo WebSocket live sur le MÊME
   *    controller (le différenciateur Nodefony), compteur HMR.
   * Édite ce fichier : Vite recompile à la volée.
   */

  let data = $state<ApiData | null>(null);
  let error = $state<string | null>(null);
  let count = $state(0);
<% if (it.complete) { %>
  /** Un tick du canal `live:ticker` (cf `nodefony/controllers/LiveController.ts`). */
  interface Tick {
    n: number;
    ts: number;
    pid: number;
  }

  // UNE socket par URL pour toute la page (`.shared`) — URL RELATIVE, résolue
  // contre la page (https → wss automatique). La même façade que Studio.
  const live = RealtimeClient.shared({ url: "/api/live/realtime" });
  let liveState = $state(live.state);
  let tick = $state<Tick | null>(null);
  let pingMs = $state<number | null>(null);
  // Disposers des listeners locaux — rendus au démontage (HMR remonte le composant).
  let offLive: (() => void)[] = [];
<% } else { %>  let wsInput = $state("ping");
  let wsLog = $state<string[]>([]);
  let ws: WebSocket | null = null;
<% } %>
<% if (it.complete) { %>  let username = $state("admin");
  let password = $state("admin");
  let authMsg = $state<string | null>(null);
  let secureData = $state<SecureData | null>(null);
<% } %>
  // Rappelé après login/logout : la zone firewall `main` (^/api) résout
  // l'identité par requête → `who` change sans recharger la page.
  const refreshHello = () =>
    fetch("/api/hello")
      .then((r) => r.json())
      .then((j) => {
        const d = (j.result ?? j) as ApiData; // Nodefony wrappe `{ result }`
        data = d;
<% if (it.complete) { %>        // Connecté → la route PROTÉGÉE prend le relais (zone `secure`,
        // ^/api/secure : sans session le firewall répond 401 avant le controller).
        if (d.who && d.who !== "anonyme") {
          fetch("/api/secure/hello", { credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : null))
            .then((s) => {
              secureData = s ? ((s.result ?? s) as SecureData) : null;
            })
            .catch(() => {
              secureData = null;
            });
        } else {
          secureData = null;
        }
<% } %>      })
      .catch((e) => {
        error = e instanceof Error ? e.message : String(e);
      });
<% if (it.complete) { %>
  // Flux session BFF du framework (cookie opaque HttpOnly — le front ne voit
  // jamais de token) : mêmes endpoints que le login de la console /nodefony.
  const doLogin = async () => {
    authMsg = null;
    const r = await fetch("/nodefony/security/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    });
    const j = (await r.json()) as {
      result?: { user?: { username?: string } };
      user?: { username?: string };
    };
    if (!r.ok) {
      authMsg = "identifiants invalides";
      return;
    }
    const u = j.result?.user ?? j.user;
    authMsg = `session ouverte — ${u?.username ?? username}`;
    refreshHello();
  };

  const doLogout = async () => {
    await fetch("/nodefony/security/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    authMsg = "session fermée";
    refreshHello();
  };
<% } %>
  onMount(() => {
    refreshHello();
<% if (it.complete) { %>
    // Abonnement par la façade : `on()` rend un disposer ; `subscribe()` est
    // ref-compté et REJOUÉ à chaque (re)connexion ; `connect()` est idempotent.
    // Pas de `disconnect()` au démontage — la connexion appartient à la PAGE.
    offLive.push(
      live.on("__state__", () => {
        liveState = live.state;
      }),
    );
    offLive.push(
      live.on("live:ticker", (msg) => {
        tick = msg as Tick;
      }),
    );
    live.subscribe("live:ticker");
    live.connect().catch(() => {
      /* la carte affiche l'état (`error`) — la reconnexion est automatique */
    });
<% } else { %>
    // WS même origine que la page (ws en http, wss en https).
    // ⚠ Echo BRUT = démo du pipeline HTTP/WS partagé, pas un modèle : pour du WS
    // métier, génère la bonne couche (`nodefony create controller <nom> --kind
    // realtime`) et consomme-la par la FAÇADE client (`RealtimeClient`) au lieu
    // d'un `new WebSocket` à la main.
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/echo`);
    socket.addEventListener("message", (ev) => {
      wsLog = [...wsLog.slice(-4), `← ${String(ev.data)}`];
    });
    socket.addEventListener("error", () => {
      wsLog = [...wsLog, "⚠ connexion WS impossible"];
    });
    ws = socket;
<% } %>  });

  onDestroy(() => {
<% if (it.complete) { %>    // HMR remonte le composant : on rend les listeners + l'abonnement — la
    // socket PARTAGÉE (`.shared`), elle, reste ouverte pour la page.
    for (const off of offLive) off();
    offLive = [];
    live.unsubscribe("live:ticker");
<% } else { %>    // HMR remonte le composant : fermer une socket encore en CONNECTING lève un
    // warning navigateur (« closed before the connection is established ») —
    // on attend l'open pour fermer proprement.
    const socket = ws;
    ws = null;
    if (!socket) return;
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.addEventListener("open", () => socket.close());
    } else {
      socket.close();
    }
<% } %>  });

<% if (it.complete) { %>  const doPing = async () => {
    const t0 = performance.now();
    await live.request("live:ping", {});
    pingMs = Math.round(performance.now() - t0);
  };
<% } else { %>  const sendWs = () => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(wsInput);
      wsLog = [...wsLog.slice(-4), `→ ${wsInput}`];
    }
  };
<% } %>
</script>

<div class="nf-split">
  <!-- ── Panneau de marque (même design que le login Studio) ─────────── -->
  <aside class="nf-hero">
    <div class="nf-glow" aria-hidden="true"></div>
    <div style="display: flex; gap: 14px; align-items: center; position: relative">
      <img src={NODEFONY_LOGO} alt="Nodefony" height="42" draggable="false" />
      <span style="font-weight: 700; font-size: 26px"><%= it.appName %></span>
    </div>

    <div style="max-width: 480px; position: relative">
      <h2>Le temps réel, nativement.</h2>
      <p class="nf-sub">
        Observez, comprenez et contrôlez chaque sous-système de Nodefony —
        en direct.
      </p>
      <div class="nf-feature">
        <div class="nf-ficon">
          <!-- éclair (bolt) -->
          <svg viewBox="0 0 24 24"><path d="M13 2 4.5 12.5H11L9.5 22 18 11.5h-6.5L13 2z" /></svg>
        </div>
        <div>
          <div style="font-weight: 600">Temps réel natif</div>
          <div class="nf-fdesc">HTTP et WebSocket, co-citoyens dans le même contexte.</div>
        </div>
      </div>
      <div class="nf-feature">
        <div class="nf-ficon">
          <!-- pulse (activity) -->
          <svg viewBox="0 0 24 24"><path d="M3 12h4l2.5-7 5 14 2.5-7h4" fill="none" stroke-width="2" /></svg>
        </div>
        <div>
          <div style="font-weight: 600">Observabilité totale</div>
          <div class="nf-fdesc">Métriques, logs et traces — en direct.</div>
        </div>
      </div>
      <div class="nf-feature">
        <div class="nf-ficon">
          <!-- bouclier -->
          <svg viewBox="0 0 24 24"><path d="M12 2 5 5v6c0 5 3.5 8.5 7 11 3.5-2.5 7-6 7-11V5l-7-3z" /></svg>
        </div>
        <div>
          <div style="font-weight: 600">Zero Trust</div>
          <div class="nf-fdesc">Sécurité par défaut, vos données protégées.</div>
        </div>
      </div>
    </div>

    <div style="display: flex; justify-content: space-between; position: relative">
      <span style="font-size: 12px; color: rgba(255, 255, 255, 0.65)">
        Nodefony 10 · licence CeCILL-B
      </span>
      <a
        href="https://github.com/nodefony/nodefony-core"
        target="_blank"
        rel="noreferrer noopener"
        style="font-size: 12px; color: rgba(255, 255, 255, 0.7)"
      >
        GitHub
      </a>
    </div>
  </aside>

  <!-- ── Preuves interactives — TON app tourne ────────────────────────── -->
  <main class="nf-main">
    <header class="nf-fwhead">
      <!-- Logo officiel Svelte — SVG inline (aucun asset externe). -->
      <svg
        class="nf-fwlogo"
        viewBox="0 0 107 128"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Svelte"
      >
        <path
          d="M94.157 22.819c-10.4-14.885-30.94-19.297-45.792-9.835L22.282 29.608A29.92 29.92 0 0 0 8.764 49.65a31.5 31.5 0 0 0 3.108 20.231 30 30 0 0 0-4.477 11.183 31.9 31.9 0 0 0 5.448 24.116c10.402 14.887 30.942 19.297 45.791 9.835l26.083-16.624A29.92 29.92 0 0 0 98.235 78.35a31.53 31.53 0 0 0-3.105-20.232 30 30 0 0 0 4.474-11.182 31.88 31.88 0 0 0-5.447-24.116"
          fill="#ff3e00"
        />
        <path
          d="M45.817 106.582a20.72 20.72 0 0 1-22.237-8.243 19.17 19.17 0 0 1-3.277-14.503 18 18 0 0 1 .624-2.435l.49-1.498 1.337.981a33.6 33.6 0 0 0 10.203 5.098l.97.294-.09.968a5.85 5.85 0 0 0 1.052 3.878 6.24 6.24 0 0 0 6.695 2.485 5.8 5.8 0 0 0 1.603-.704L69.27 76.28a5.43 5.43 0 0 0 2.45-3.631 5.8 5.8 0 0 0-.987-4.371 6.24 6.24 0 0 0-6.698-2.487 5.7 5.7 0 0 0-1.6.704l-9.953 6.345a19 19 0 0 1-5.296 2.326 20.72 20.72 0 0 1-22.237-8.243 19.17 19.17 0 0 1-3.277-14.502 17.99 17.99 0 0 1 8.13-12.052l26.081-16.623a19 19 0 0 1 5.3-2.329 20.72 20.72 0 0 1 22.237 8.243 19.17 19.17 0 0 1 3.277 14.503 18 18 0 0 1-.624 2.435l-.49 1.498-1.337-.98a33.6 33.6 0 0 0-10.203-5.1l-.97-.294.09-.968a5.86 5.86 0 0 0-1.052-3.878 6.24 6.24 0 0 0-6.696-2.485 5.8 5.8 0 0 0-1.602.704L37.725 51.72a5.42 5.42 0 0 0-2.449 3.63 5.79 5.79 0 0 0 .986 4.372 6.24 6.24 0 0 0 6.698 2.486 5.8 5.8 0 0 0 1.602-.704l9.952-6.342a19 19 0 0 1 5.295-2.328 20.72 20.72 0 0 1 22.237 8.242 19.17 19.17 0 0 1 3.277 14.503 18 18 0 0 1-8.13 12.053l-26.081 16.622a19 19 0 0 1-5.3 2.328"
          fill="#fff"
        />
      </svg>
      <div>
        <h1>Votre app est en ligne.</h1>
        <span class="nf-fwbadge">Svelte 5 · Vite HMR</span>
      </div>
<% if (it.complete) { %>      <!-- Réponse de la route PROTÉGÉE — visible uniquement session ouverte. -->
      {#if secureData}<span class="nf-hello">👋 {secureData.message}</span>{/if}
<% } %>    </header>
    <p class="nf-dim">
      <%= it.complete ? "Quatre" : "Trois" %> preuves interactives — édite <code>frontend/src/App.svelte</code>,
      Vite recompile la page à la volée.
    </p>

    <div class="nf-card">
<% if (it.complete) { %>      <h2>1. Backend HTTP — <code>GET {secureData ? "/api/secure/hello" : "/api/hello"}</code></h2>
<% } else { %>      <h2>1. Backend HTTP — <code>GET /api/hello</code></h2>
<% } %>      {#if error}
        <pre style="color: crimson">{error}</pre>
      {:else if data}
        <pre>{JSON.stringify(<%= it.complete ? "secureData ?? data" : "data" %>, null, 2)}</pre>
      {:else}
        <p>loading…</p>
      {/if}
    </div>
<% if (it.complete) { %>
    <div class="nf-card">
      <h2>2. Firewall — l'identité vit dans la zone <code>^/api</code></h2>
      <p class="nf-dim">
        Deux zones dans <code>nodefony.config.ts</code> : <code>main</code>
        (<code>^/api</code>, session → anonymous, jamais bloquante) et
        <code>secure</code> (<code>^/api/secure</code>, session SEULE —
        pattern plus spécifique, il gagne le match ; sans session le
        firewall répond 401). Connecte-toi (compte dev seedé
        <code>admin / admin</code>) : la carte 1 bascule sur
        <code>GET /api/secure/hello</code> → « Bonjour admin ».
      </p>
      {#if data?.who && data.who !== "anonyme"}
        <span style="margin-right: 8px">connecté — <strong>{data.who}</strong></span>
        <button onclick={doLogout}>Se déconnecter</button>
      {:else}
        <input bind:value={username} autocomplete="username" aria-label="utilisateur" />
        <input
          bind:value={password}
          type="password"
          autocomplete="current-password"
          aria-label="mot de passe"
          onkeydown={(e) => e.key === "Enter" && doLogin()}
        />
        <button onclick={doLogin}>Se connecter</button>
      {/if}
      {#if authMsg}<p class="nf-dim">{authMsg}</p>{/if}
    </div>
<% } %>
<% if (it.complete) { %>    <div class="nf-card">
      <h2>3. Temps réel — la socket Nodefony</h2>
      <p class="nf-dim">
        <code>LiveController</code> (<code>--kind realtime</code>) publie le
        canal <code>live:ticker</code> (1 tick/s tant qu'un client est
        abonné) ; la page le consomme par la façade
        <code>RealtimeClient</code> — zéro <code>WebSocket</code> à la main.
      </p>
      <p>
        état : <strong>{liveState}</strong>
        {#if tick} · tick <strong>#{tick.n}</strong> (pid {tick.pid}){/if}
      </p>
      <button onclick={doPing}>RPC live:ping</button>
      {#if pingMs !== null}<span class="nf-dim"> pong en {pingMs} ms</span>{/if}
    </div>
<% } else { %>    <div class="nf-card">
      <h2>2. WebSocket — MÊME controller que le HTTP</h2>
      <p class="nf-dim">
        <code>HelloController</code> porte la route GET <em>et</em> la route
        WEBSOCKET : un seul pipeline (firewall, audit, logs).
      </p>
      <input
        bind:value={wsInput}
        onkeydown={(e) => e.key === "Enter" && sendWs()}
        aria-label="message à envoyer"
      />
      <button onclick={sendWs}>Envoyer en WS</button>
      <pre>{wsLog.join("\n") || "(envoie un message)"}</pre>
    </div>
<% } %>
    <div class="nf-card">
      <h2><%= it.complete ? 4 : 3 %>. ♻️ HMR check — remplacement à chaud</h2>
      <button onclick={() => count++}>count is {count}</button>
      <p class="nf-dim">
        Édite le markup de <code>frontend/src/App.svelte</code> —
        Vite recompile à la volée, la page se met à jour <em>sans recharger</em>
        (l'état local repart à zéro : comportement svelte-hmr par défaut).
      </p>
    </div>

<% if (it.complete) { %>    <p class="nf-dim">
      Console d'administration : <a href="/nodefony">/nodefony</a> (Studio, en dev)
    </p>
<% } %>  </main>
</div>
