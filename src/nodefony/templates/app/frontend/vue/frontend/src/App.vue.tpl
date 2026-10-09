<script setup lang="ts">
import { <% if (it.complete) { %>computed, <% } %>onMounted, onUnmounted, ref, version as vueVersion } from "vue";
<% if (it.complete) { %>// FAÇADE temps réel isomorphe du framework — reconnexion, re-subscribe, état :
// gérés par le client. Aucun `new WebSocket` à la main. Subpath `nodefony/vue` :
// les COMPOSABLES du framework, de minces enveloppes sur le socle agnostique
// que React, Angular et Svelte consomment aussi. Le plugin s'installe dans
// `main.ts` — c'est là, et là seulement, que l'adresse du serveur est écrite.
import {
  useNodefony,
  useNodefonyChannelData,
  useNodefonyLogin,
  useNodefonyState,
  type NodefonyLoginState,
  type NodefonyLoginError,
  type LoginErrorKind,
} from "nodefony/vue";
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
interface LiveEvent {
  text: string;
  ts: number;
  pid: number;
}

// La socket de la page, fournie par le plugin — UNE seule pour tout le monde.
// Les deux composables ci-dessous s'abonnent au montage et RENDENT l'abonnement
// au démontage, sans une ligne à écrire : c'est la portée du composant qui
// libère. L'abonnement serveur est ref-compté et rejoué à chaque reconnexion.
const live = useNodefony();
const liveState = useNodefonyState();
const last = useNodefonyChannelData<LiveEvent>("live:events");
const pingMs = ref<number | null>(null);
<% } else { %>const wsInput = ref("ping");
const wsLog = ref<string[]>([]);
let ws: WebSocket | null = null;
<% } %>
<% if (it.complete) { %>const username = ref("admin");
const password = ref("nodefony-dev-42");
const mfaCode = ref("");
const notice = ref<string | null>(null);
// Le déroulé de connexion du FRAMEWORK : étapes, second facteur (TOTP),
// blocage après trop d'essais, fournisseurs (Keycloak…), passkey. Aucun
// `fetch` vers les routes de session n'est écrit à la main.
const { state: login, flow } = useNodefonyLogin();
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
          // Le corps d'un `then` REND une valeur : un bloc muet est signalé par
          // le lint (`promise/always-return`) — dans l'application générée, donc
          // chez l'utilisateur, dont la passe naît rouge.
          .then((s) => (secureData.value = s ? ((s.result ?? s) as SecureData) : null))
          .catch(() => (secureData.value = null));
      } else {
        secureData.value = null;
      }
<% } %>      // Un `then` REND une valeur — sinon le lint de l'application
      // GÉNÉRÉE la refuse (`promise/always-return`), et sa passe naît rouge.
      return d;
    })
    .catch((e) => {
      error.value = e instanceof Error ? e.message : String(e);
    });
<% if (it.complete) { %>
// Session BFF du framework (cookie opaque HttpOnly — le front ne voit
// jamais de token) : le même déroulé que la console /nodefony.
const afterLogin = (next: NodefonyLoginState) => {
  if (next.step !== "authenticated") return;
  mfaCode.value = "";
  notice.value = null;
  refreshHello();
};
const doLogin = async () => afterLogin(await flow.login(username.value, password.value));
const doMfa = async () => afterLogin(await flow.submitMfaCode(mfaCode.value));
const doPasskey = async () => afterLogin(await flow.loginWithPasskey());

const doLogout = async () => {
  // Une session ouverte chez un fournisseur (Keycloak…) se ferme AUSSI chez
  // lui : le serveur rend son adresse de déconnexion, qu'il faut suivre.
  const providerLogout = await flow.logout();
  if (providerLogout !== null) {
    location.assign(providerLogout);
    return;
  }
  notice.value = "session fermée";
  refreshHello();
};

/** Le texte de chaque sorte d'échec — une entrée par sorte, exigée par le type. */
const LOGIN_ERRORS: Record<LoginErrorKind, (error: NodefonyLoginError) => string> = {
  credentials: (e) => e.message || "identifiants invalides",
  throttled: (e) =>
    `trop d'essais — réessaie dans ${Math.max(1, Math.ceil(((e.retryAt ?? 0) - Date.now()) / 1000))} s`,
  network: () => "serveur injoignable",
  server: (e) => `échec : ${e.message || String(e.status)}`,
  cancelled: () => "passkey annulée",
  unsupported: () => "passkey non prise en charge par ce navigateur",
};

/**
 * Ce que l'écran dit du déroulé. Les RÈGLES vivent dans le framework ; le
 * TEXTE est à l'application. Un refus d'identifiants relaie le message
 * uniforme du serveur : le préciser dirait à un inconnu si le compte existe.
 */
const loginMessage = computed((): string | null => {
  const state = login.value;
  const err = state.error;
  if (err === null) {
    return state.step === "authenticated" && state.user
      ? `session ouverte — ${state.user.username}`
      : notice.value;
  }
  return LOGIN_ERRORS[err.kind](err);
});
<% } %>
onMounted(() => {
  refreshHello();
<% if (it.complete) { %>  // Les boutons des fournisseurs (Keycloak, Google…) : c'est le serveur qui
  // dit lesquels sont configurés.
  void flow.loadProviders();

  // Rien à brancher ici pour le temps réel : les composables l'ont fait au
  // `setup`, et le défont à la mort du composant. Ce qui reste dans ce hook
  // n'est que du HTTP.
<% } else { %>
  // WS même origine que la page (ws en http, wss en https).
  // ⚠ Echo BRUT = démo du pipeline HTTP/WS partagé, pas un modèle : pour du WS
  // métier, génère la bonne couche (`nodefony create controller <nom> --kind
  // realtime`) et consomme-la par la FAÇADE client (`NodefonySocket`) au lieu
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
<% if (it.complete) { %>  // Rien à libérer : le rechargement à chaud remonte le composant, et sa portée
  // a déjà rendu les abonnements. La socket PARTAGÉE, elle, reste ouverte pour
  // la page — la couper ici trancherait les requêtes en vol des autres.
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
  await live.request("live:ping", {});
  pingMs.value = Math.round(performance.now() - t0);
};

// Ce que CETTE page envoie, TOUTES les pages abonnées le reçoivent : ouvrir un
// second onglet et cliquer suffit à le voir. C'est ce partage qui fait l'intérêt
// d'une socket — pas un battement qui parlerait pour ne rien dire.
const doSay = () =>
  live.emit("live:say", {
    text: `bonjour de la page (${Date.now() % 1000})`,
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
          Nodefony 10 · licence Apache 2.0
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
          firewall répond 401). Connecte-toi : le compte <code>admin</code> a
          pour mot de passe <code>nodefony-dev-42</code> en développement, et celui de
          <code>NF_ADMIN_PASSWORD</code> en production — où il est EXIGÉ, car une
          application ne naît jamais en ligne avec un secret connu. Alors la
          carte 1 bascule sur
          <code>GET /api/secure/hello</code> → « Bonjour admin ».
        </p>
        <template v-if="data?.who && data.who !== 'anonyme'">
          <span style="margin-right: 8px">connecté — <strong>{{ data.who }}</strong></span>
          <button @click="doLogout">Se déconnecter</button>
        </template>
        <template v-else-if="login.step === 'mfa'">
          <input
            v-model="mfaCode"
            inputmode="numeric"
            autocomplete="one-time-code"
            aria-label="code à usage unique"
            autofocus
            @keydown.enter="doMfa"
          />
          <button :disabled="login.pending" @click="doMfa">Valider le code</button>
          <button @click="flow.back()">Annuler</button>
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
          <button :disabled="login.pending" @click="doLogin">Se connecter</button>
          <button v-if="login.passkeyAvailable" :disabled="login.pending" @click="doPasskey">
            Passkey
          </button>
          <button v-for="p in login.providers ?? []" :key="p.name" @click="flow.startProvider(p.name)">
            {{ p.label }}
          </button>
        </template>
        <p v-if="loginMessage" class="nf-dim" role="status">{{ loginMessage }}</p>
      </div>
<% } %>
<% if (it.complete) { %>      <div class="nf-card">
        <h2>3. Temps réel — la socket Nodefony</h2>
        <p class="nf-dim">
          <code>LiveController</code> (<code>--kind realtime</code>) publie le
          canal <code>live:events</code> quand il se passe quelque chose —
          jamais sur une horloge ; la page le consomme par la façade
          <code>NodefonySocket</code> — zéro <code>WebSocket</code> à la main.
          Ouvrez un second onglet pour voir arriver ce que celui-ci envoie.
        </p>
        <p>
          état : <strong>{{ liveState }}</strong>
          <template v-if="last"> · reçu <strong>{{ last.text }}</strong> (pid {{ last.pid }})</template>
        </p>
        <button @click="doPing">RPC live:ping</button>
        <button @click="doSay">envoyer sur le canal</button>
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
