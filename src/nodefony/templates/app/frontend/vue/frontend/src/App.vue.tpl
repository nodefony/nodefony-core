<script setup lang="ts">
import { onMounted, onUnmounted, ref, version as vueVersion } from "vue";
<% if (it.complete) { %>// FAÇADE temps réel isomorphe du framework — reconnexion, re-subscribe, état :
// gérés par le client. Aucun `new WebSocket` à la main. Subpath
// `nodefony/client` : la porte client explicite, résolue à l'identique par
// Vite, Node et le typecheck.
import {
  connectShared,
  observeState,
  observeChannelData,
} from "nodefony/client";
<% } %>import { NODEFONY_LOGO } from "./brand";
// Mise en page et palette de la démonstration — feuille PARTAGÉE par les trois
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

const data = ref<ApiData | null>(null);
const error = ref<string | null>(null);
const count = ref(0);
<% if (it.complete) { %>
/** Un message du canal `live:events` (cf `nodefony/controllers/LiveController.ts`). */
interface Evenement {
  texte: string;
  ts: number;
  pid: number;
}

// UNE socket par URL pour toute la page — URL RELATIVE, résolue contre la page
// (https → wss automatique). `connectShared` porte le cycle de connexion : il
// est le MÊME pour les quatre fronts et pour la console d'administration.
const live = connectShared({ url: "/api/live/realtime" });
const liveState = ref(live.socket.state);
const dernier = ref<Evenement | null>(null);
const pingMs = ref<number | null>(null);
// Disposers des listeners locaux — rendus au démontage (HMR remonte le composant).
let offLive: (() => void)[] = [];
<% } else { %>const wsInput = ref("ping");
const wsLog = ref<string[]>([]);
let ws: WebSocket | null = null;
<% } %>
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
<% if (it.complete) { %>
  // Un observateur = un rappel + une libération. L'abonnement serveur est
  // ref-compté et REJOUÉ à chaque (re)connexion, `start()` est idempotent, et
  // rien ne coupe la socket au démontage : elle appartient à la PAGE. Ces règles
  // vivent dans `nodefony/client`, pas ici — c'est ce qui les garde identiques
  // en React, Vue, Angular et Svelte.
  offLive.push(observeState(live.socket, (state) => (liveState.value = state)));
  offLive.push(
    observeChannelData<Evenement>(
      live.socket,
      "live:events",
      (e) => (dernier.value = e),
    ),
  );
  live.start();
<% } else { %>
  // WS même origine que la page (ws en http, wss en https).
  // ⚠ Echo BRUT = démo du pipeline HTTP/WS partagé, pas un modèle : pour du WS
  // métier, génère la bonne couche (`nodefony create controller <nom> --kind
  // realtime`) et consomme-la par la FAÇADE client (`RealtimeClient`) au lieu
  // d'un `new WebSocket` à la main.
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${location.host}/api/echo`);
  socket.addEventListener("message", (ev) => {
    wsLog.value = [...wsLog.value.slice(-4), `← ${String(ev.data)}`];
  });
  socket.addEventListener("error", () => {
    wsLog.value = [...wsLog.value, "⚠ connexion WS impossible"];
  });
  ws = socket;
<% } %>});

onUnmounted(() => {
<% if (it.complete) { %>  // HMR remonte le composant : on libère les observateurs, ce qui rend aussi
  // l'abonnement — la socket PARTAGÉE, elle, reste ouverte pour la page.
  for (const off of offLive) off();
  offLive = [];
<% } else { %>  // HMR remonte le composant : fermer une socket encore en CONNECTING lève un
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
<% } %>});

<% if (it.complete) { %>const doPing = async () => {
  const t0 = performance.now();
  await live.socket.request("live:ping", {});
  pingMs.value = Math.round(performance.now() - t0);
};

// Ce que CETTE page envoie, TOUTES les pages abonnées le reçoivent : ouvrir un
// second onglet et cliquer suffit à le voir. C'est ce partage qui fait l'intérêt
// d'une socket — pas un battement qui parlerait pour ne rien dire.
const doDire = () =>
  live.socket.emit("live:dire", {
    texte: `bonjour de la page (${Date.now() % 1000})`,
  });
<% } else { %>const sendWs = () => {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(wsInput.value);
    wsLog.value = [...wsLog.value.slice(-4), `→ ${wsInput.value}`];
  }
};
<% } %>
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
<% if (it.complete) { %>      <div class="nf-card">
        <h2>3. Temps réel — la socket Nodefony</h2>
        <p class="nf-dim">
          <code>LiveController</code> (<code>--kind realtime</code>) publie le
          canal <code>live:events</code> quand il se passe quelque chose —
          jamais sur une horloge ; la page le consomme par la façade
          <code>RealtimeClient</code> — zéro <code>WebSocket</code> à la main.
          Ouvrez un second onglet pour voir arriver ce que celui-ci envoie.
        </p>
        <p>
          état : <strong>{{ liveState }}</strong>
          <template v-if="dernier"> · reçu <strong>{{ dernier.texte }}</strong> (pid {{ dernier.pid }})</template>
        </p>
        <button @click="doPing">RPC live:ping</button>
        <button @click="doDire">envoyer sur le canal</button>
        <span v-if="pingMs !== null" class="nf-dim"> pong en {{ pingMs }} ms</span>
      </div>
<% } else { %>      <div class="nf-card">
        <h2>2. WebSocket — MÊME controller que le HTTP</h2>
        <p class="nf-dim">
          <code>HelloController</code> porte la route GET <em>et</em> la route
          WEBSOCKET : un seul pipeline (firewall, audit, logs).
        </p>
        <input
          v-model="wsInput"
          @keydown.enter="sendWs"
          aria-label="message à envoyer"
        />
        <button @click="sendWs">Envoyer en WS</button>
        <pre>{{ wsLog.join("\n") || "(envoie un message)" }}</pre>
      </div>
<% } %>

      <div class="nf-card">
        <h2><%= it.complete ? 4 : 3 %>. ♻️ HMR check — état Vue préservé</h2>
        <button @click="count++">count is {{ count }}</button>
        <p class="nf-dim">
          Édite le <code>&lt;template&gt;</code> de <code>frontend/src/App.vue</code> —
          Vite recompile à la volée, la page se met à jour <em>sans recharger</em>
          et le compteur est conservé.
        </p>
      </div>

<% if (it.complete) { %>      <p class="nf-dim">
        Console d'administration : <a href="/nodefony">/nodefony</a> (Studio, en dev)
      </p>
<% } %>    </main>
  </div>
</template>
