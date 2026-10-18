<script setup lang="ts">
import { onMounted, onUnmounted, ref, version as vueVersion } from "vue";
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
} from "nodefony/vue";
import { loginPagePath } from "nodefony/client";
<% } %>import { NODEFONY_LOGO } from "./brand";
// Lecture VÉRIFIÉE des réponses de l'API (voir `api.ts`) : jamais une conversion.
import {
  readApiData,
<% if (it.complete) { %>  readSecureData,
  type SecureData,
<% } %>  type ApiData,
} from "./api";
// Mise en page et palette de la démonstration — feuille PARTAGÉE par les trois
// vitrines ; `accent.css` n'y ajoute que la couleur du framework.
import "./showcase.css";
import "./accent.css";

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
<% if (it.complete) { %>const notice = ref<string | null>(null);
// La session vit dans un cookie HttpOnly que la page ne lit pas : la LIAISON
// du framework la reprend (`me()`) et en tient l'état — c'est la pastille de
// la carte 2. Se connecter se fait sur la page du framework (`/login`), qui
// ramène ici.
const { state: login, flow } = useNodefonyLogin();
const loginHref = loginPagePath(location.pathname + location.search);
const secureData = ref<SecureData | null>(null);
<% } %>
// Rappelé après login/logout : la zone firewall `main` (^/api) résout
// l'identité par requête → `who` change sans recharger la page.
const refreshHello = () =>
  fetch("/api/hello")
    .then((r) => r.json())
    .then((j: unknown) => {
      const d = readApiData(j); // Nodefony wrappe `{ result }`
      if (d === null) throw new Error("réponse inattendue de /api/hello");
      data.value = d;
<% if (it.complete) { %>      // Connecté → la route PROTÉGÉE prend le relais (zone `secure`,
      // ^/api/secure : sans session le firewall répond 401 avant le controller).
      if (d.who && d.who !== "anonyme") {
        fetch("/api/secure/hello", { credentials: "same-origin" })
          .then((r) => (r.ok ? r.json() : null))
          // Le corps d'un `then` REND une valeur : un bloc muet est signalé par
          // le lint (`promise/always-return`) — dans l'application générée, donc
          // chez l'utilisateur, dont la passe naît rouge.
          .then((s: unknown) => (secureData.value = s ? readSecureData(s) : null))
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
<% } %>
onMounted(() => {
  refreshHello();
<% if (it.complete) { %>  // Reprend la session ouverte, ici ou au retour de la page de connexion.
  void flow.me();

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
          firewall répond 401). « Se connecter » mène à la page de connexion du
          framework, qui te ramène ici (<code>?from=</code>) : le compte
          <code>admin</code> a pour mot de passe <code><%= it.devAdminPassword %></code> en
          développement, et celui de <code>NF_ADMIN_PASSWORD</code> en production —
          où il est EXIGÉ, car une application ne naît jamais en ligne avec un
          secret connu. Alors la carte 1 bascule sur
          <code>GET /api/secure/hello</code> → « Bonjour admin ». La pastille
          vient de <code>useNodefonyLogin</code> (<code>nodefony/vue</code>).
        </p>
        <template v-if="login.step === 'authenticated' && login.user">
          <span class="nf-session" data-open>connecté — <strong>{{ login.user.identifier }}</strong></span>
          <button @click="doLogout">Se déconnecter</button>
        </template>
        <template v-else>
          <span class="nf-session">anonyme</span>
          <a class="nf-action" :href="loginHref">Se connecter</a>
        </template>
        <p v-if="notice" class="nf-dim" role="status">{{ notice }}</p>
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
