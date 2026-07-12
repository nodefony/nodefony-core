<script setup lang="ts">
import { onMounted, onUnmounted, ref, version as vueVersion } from "vue";
import { NODEFONY_LOGO } from "./brand";

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

const data = ref<ApiData | null>(null);
const error = ref<string | null>(null);
const count = ref(0);
const wsInput = ref("ping");
const wsLog = ref<string[]>([]);
let ws: WebSocket | null = null;
<% if (it.complete) { %>const username = ref("admin");
const password = ref("admin");
const authMsg = ref<string | null>(null);
const secureData = ref<SecureData | null>(null);
<% } %>
// Rappelé après login/logout : la zone firewall `main` (^/api) résout
// l'identité par requête → `who` change sans recharger la page.
const refreshHello = () =>
  fetch("/api/hello")
    .then((r) => r.json())
    .then((j) => {
      const d = (j.result ?? j) as ApiData; // Nodefony wrappe `{ result }`
      data.value = d;
<% if (it.complete) { %>      // Connecté → la route PROTÉGÉE prend le relais (zone `secure`,
      // ^/api/secure : sans session le firewall répond 401 avant le controller).
      if (d.who && d.who !== "anonyme") {
        fetch("/api/secure/hello", { credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => {
            secureData.value = s ? ((s.result ?? s) as SecureData) : null;
          })
          .catch(() => {
            secureData.value = null;
          });
      } else {
        secureData.value = null;
      }
<% } %>    })
    .catch((e) => {
      error.value = e instanceof Error ? e.message : String(e);
    });
<% if (it.complete) { %>
// Flux session BFF du framework (cookie opaque HttpOnly — le front ne voit
// jamais de token) : mêmes endpoints que le login de la console /nodefony.
const doLogin = async () => {
  authMsg.value = null;
  const r = await fetch("/nodefony/security/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ username: username.value, password: password.value }),
  });
  const j = (await r.json()) as {
    result?: { user?: { username?: string } };
    user?: { username?: string };
  };
  if (!r.ok) {
    authMsg.value = "identifiants invalides";
    return;
  }
  const u = j.result?.user ?? j.user;
  authMsg.value = `session ouverte — ${u?.username ?? username.value}`;
  refreshHello();
};

const doLogout = async () => {
  await fetch("/nodefony/security/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  authMsg.value = "session fermée";
  refreshHello();
};
<% } %>
onMounted(() => {
  refreshHello();

  // WS même origine que la page (ws en http, wss en https).
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${location.host}/api/echo`);
  socket.addEventListener("message", (ev) => {
    wsLog.value = [...wsLog.value.slice(-4), `← ${String(ev.data)}`];
  });
  socket.addEventListener("error", () => {
    wsLog.value = [...wsLog.value, "⚠ connexion WS impossible"];
  });
  ws = socket;
});

onUnmounted(() => {
  // HMR remonte le composant : fermer une socket encore en CONNECTING lève un
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
});

const sendWs = () => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(wsInput.value);
    wsLog.value = [...wsLog.value.slice(-4), `→ ${wsInput.value}`];
  }
};
</script>

<template>
  <div class="nf-split">
    <!-- ── Panneau de marque (même design que le login Studio) ─────────── -->
    <aside class="nf-hero">
      <div class="nf-glow" aria-hidden="true"></div>
      <div style="display: flex; gap: 14px; align-items: center; position: relative">
        <img :src="NODEFONY_LOGO" alt="Nodefony" height="42" draggable="false" />
        <span style="font-weight: 700; font-size: 26px"><%= it.appName %></span>
      </div>

      <div style="max-width: 480px; position: relative">
        <h1>Le temps réel, nativement.</h1>
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
        <!-- Logo officiel Vue — SVG inline (aucun asset externe). -->
        <svg
          class="nf-fwlogo"
          viewBox="0 0 256 221"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Vue"
        >
          <path d="M204.8 0H256L128 220.8 0 0h97.92L128 51.2 157.44 0z" fill="#41B883" />
          <path d="m0 0 128 220.8L256 0h-51.2L128 132.48 50.56 0z" fill="#41B883" />
          <path d="M50.56 0 128 133.12 204.8 0h-47.36L128 51.2 97.92 0z" fill="#35495E" />
        </svg>
        <div>
          <h1>Votre app est en ligne.</h1>
          <span class="nf-fwbadge">Vue v{{ vueVersion }} · Vite HMR</span>
        </div>
<% if (it.complete) { %>        <!-- Réponse de la route PROTÉGÉE — visible uniquement session ouverte. -->
        <span v-if="secureData" class="nf-hello">👋 {{ secureData.message }}</span>
<% } %>      </header>
      <p class="nf-dim">
        <%= it.complete ? "Quatre" : "Trois" %> preuves interactives — édite <code>frontend/src/App.vue</code>,
        Vite recompile la page à la volée.
      </p>

      <div class="nf-card">
<% if (it.complete) { %>        <h2>1. Backend HTTP — <code>GET {{ secureData ? "/api/secure/hello" : "/api/hello" }}</code></h2>
<% } else { %>        <h2>1. Backend HTTP — <code>GET /api/hello</code></h2>
<% } %>        <pre v-if="error" style="color: crimson">{{ error }}</pre>
        <pre v-else-if="data">{{ JSON.stringify(<%= it.complete ? "secureData ?? data" : "data" %>, null, 2) }}</pre>
        <p v-else>loading…</p>
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
        <template v-if="data?.who && data.who !== 'anonyme'">
          <span style="margin-right: 8px">connecté — <strong>{{ data.who }}</strong></span>
          <button @click="doLogout">Se déconnecter</button>
        </template>
        <template v-else>
          <input v-model="username" autocomplete="username" aria-label="utilisateur" />
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            aria-label="mot de passe"
            @keydown.enter="doLogin"
          />
          <button @click="doLogin">Se connecter</button>
        </template>
        <p v-if="authMsg" class="nf-dim">{{ authMsg }}</p>
      </div>
<% } %>
      <div class="nf-card">
        <h2><%= it.complete ? 3 : 2 %>. WebSocket — MÊME controller que le HTTP</h2>
        <p class="nf-dim">
          <code>HelloController</code> porte la route GET <em>et</em> la route
          WEBSOCKET : un seul pipeline (firewall, audit, logs).
        </p>
        <input v-model="wsInput" @keydown.enter="sendWs" />
        <button @click="sendWs">Envoyer en WS</button>
        <pre>{{ wsLog.join("\n") || "(envoie un message)" }}</pre>
      </div>

      <div class="nf-card">
        <h2><%= it.complete ? 4 : 3 %>. ♻️ HMR check — état Vue préservé</h2>
        <button @click="count++">count is {{ count }}</button>
        <p class="nf-dim">
          Édite le <code>&lt;template&gt;</code> de <code>frontend/src/App.vue</code> —
          Vite recompile à la volée, la page se met à jour <em>sans recharger</em>
          et le compteur est conservé.
        </p>
      </div>

      <p class="nf-dim">
        Console d'administration : <a href="/nodefony">/nodefony</a> (Studio, en dev)
      </p>
    </main>
  </div>
</template>

<style>
:root { --nf-bg:#f7f9fc; --nf-fg:#1a1f26; --nf-card:#fff; --nf-border:#e2e8f0; --nf-dim:#5b6472; }
@media (prefers-color-scheme: dark) {
  :root { --nf-bg:#12161c; --nf-fg:#e8ecf1; --nf-card:#1a2028; --nf-border:#2a3340; --nf-dim:#98a2b3; }
}
body { margin:0; }
.nf-split { display:flex; min-height:100vh; font-family:system-ui, sans-serif;
            background:var(--nf-bg); color:var(--nf-fg); }
.nf-hero { flex:1.05; position:relative; overflow:hidden; color:#fff;
           display:flex; flex-direction:column; justify-content:space-between;
           padding:48px; box-sizing:border-box;
           background:linear-gradient(140deg,#022c4e 0%,#004d8c 45%,#0067ba 100%); }
.nf-glow { position:absolute; inset:0; pointer-events:none;
           background:radial-gradient(circle at 26% 16%, rgba(255,255,255,.16), transparent 46%),
                      radial-gradient(circle at 88% 92%, rgba(255,255,255,.08), transparent 42%); }
.nf-hero h1 { font-size:clamp(30px,3.4vw,42px); font-weight:800; line-height:1.12; margin:0; }
.nf-hero .nf-sub { font-size:18px; color:rgba(255,255,255,.82); margin:10px 0 0; }
.nf-feature { display:flex; gap:14px; align-items:flex-start; margin-top:22px; }
.nf-ficon { width:42px; height:42px; border-radius:10px; flex:none; display:grid; place-items:center;
            background:rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.18); }
.nf-ficon svg { width:22px; height:22px; fill:#fff; stroke:#fff; }
.nf-fdesc { font-size:14px; color:rgba(255,255,255,.78); }
.nf-main { flex:1; padding:48px 40px; box-sizing:border-box; overflow-y:auto; }
.nf-card { background:var(--nf-card); border:1px solid var(--nf-border); border-radius:10px;
           padding:20px; margin-bottom:18px; }
.nf-card h2 { margin:0 0 10px; font-size:17px; }
.nf-card pre { background:rgba(127,127,127,.08); padding:10px; border-radius:6px; overflow-x:auto; }
.nf-card input { padding:7px 10px; border-radius:6px; border:1px solid var(--nf-border);
                 background:var(--nf-bg); color:var(--nf-fg); margin-right:6px; }
.nf-card button { padding:7px 14px; border-radius:6px; border:none; cursor:pointer;
                  background:#0067ba; color:#fff; font-weight:600; }
.nf-card button:hover { background:#0a79d6; }
.nf-dim { color:var(--nf-dim); font-size:14px; }
.nf-fwhead { display:flex; align-items:center; gap:16px; margin-bottom:8px; }
.nf-fwhead h1 { margin:0; }
.nf-fwlogo { width:52px; height:auto; flex:none;
             filter:drop-shadow(0 6px 14px rgba(66,184,131,.35));
             animation:nf-float 4s ease-in-out infinite; }
@keyframes nf-float { 0%, 100% { transform:translateY(0); } 50% { transform:translateY(-6px); } }
.nf-fwbadge { display:inline-block; margin-top:4px; padding:2px 10px; border-radius:999px;
              font-size:12.5px; font-weight:600; color:#41b883;
              background:rgba(66,184,131,.14); border:1px solid rgba(66,184,131,.35); }
.nf-hello { margin-left:auto; padding:7px 16px; border-radius:999px; font-weight:700;
            font-size:15px; color:#2ea043; white-space:nowrap;
            background:rgba(46,160,67,.12); border:1px solid rgba(46,160,67,.35); }
a { color:#0a79d6; }
@media (max-width: 920px) { .nf-split { flex-direction:column; } .nf-hero { padding:32px 24px; } }
</style>
