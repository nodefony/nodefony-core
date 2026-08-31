<script setup lang="ts">
import { onMounted, onUnmounted, ref, version as vueVersion } from "vue";
// Les composables de `nodefony/vue` — de MINCES enveloppes sur le socle
// agnostique que consomment aussi React, Angular et Svelte. Aucune règle de
// temps réel n'est écrite ici, et il n'y a plus rien à libérer à la main : la
// portée du composant rend chaque abonnement à sa mort. L'adresse du serveur
// est écrite UNE fois, dans `main.ts`, où le plugin s'installe.
import {
  useNodefony,
  useNodefonyChannel,
  useNodefonySnapshot,
  useNodefonyState,
} from "nodefony/vue";
// Mise en page COMMUNE aux quatre vitrines — même fichier, même charte que la
// page d'accueil du framework. Seule `--accent` change d'une vitrine à l'autre.
import "./showcase.css";

interface ApiData {
  ts: number;
  pid: number;
  env: string;
}

/** Un message du salon partagé : qui l'a écrit, depuis quelle vitrine. */
interface Message {
  texte: string;
  front: string;
  ts: number;
  pid: number;
}

/** La couleur du framework de vue — le SEUL écart de style entre les quatre. */
const ACCENT = "#41b883";
// Le logo est servi par le SERVEUR (`public/` du dépôt), pas empaqueté par
// Vite. Écrit en `src="/…"` littéral, le compilateur SFC de Vue le prend pour
// un asset du bundle et tente de le RÉSOUDRE — le build de production échoue
// alors sur un fichier qui n'a jamais eu à exister ici (les trois autres
// vitrines laissent la chaîne telle quelle, d'où un échec qui ne frappait que
// Vue). Une liaison porte l'URL jusqu'au navigateur sans transformation.
const LOGO = "/nodefony-logo.png";

/** Le nom de CETTE vitrine — il marque les messages qu'elle envoie au salon. */
const FRONT = "Vue";

/**
 * Combien de rechargements À CHAUD depuis le dernier chargement complet.
 *
 * `import.meta.hot.data` est la mémoire que Vite fait survivre au remplacement
 * d'un module — et à lui seul. Le module étant ré-exécuté à chaque mise à jour,
 * il suffit de compter ses exécutions : un chargement complet repart de zéro,
 * une mise à jour à chaud incrémente. Aucun écouteur à poser, donc aucun à
 * retirer.
 *
 * Sans ce chiffre, la carte échouait EN SILENCE : si Vite tombait en
 * rechargement complet, le compteur de clics repartait à zéro et personne ne
 * pouvait dire si la démonstration avait marché ou raté.
 */
/**
 * La barre de debug s'auto-injecte en développement et expose ce handle — c'est
 * la même poignée que la console d'administration emploie. On ne la remonte pas,
 * on la pilote : `DebugBarHandle` (cf `nodefony/debugbar`).
 */
type Debugbar = { isVisible(): boolean; toggle(): void } | undefined;
const debugbar = (): Debugbar =>
  (globalThis as { __NODEFONY_DEBUGBAR__?: Debugbar }).__NODEFONY_DEBUGBAR__;

const hot = (import.meta as { hot?: { data: Record<string, unknown> } }).hot;
if (hot) hot.data.majs = ((hot.data.majs as number) ?? 0) + 1;
const MAJS_A_CHAUD = hot ? ((hot.data.majs as number) ?? 1) - 1 : 0;

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

const count = ref(0);

const cliquer = (): void => {
  count.value += 1;
  // Le clic voyage : les autres vitrines l'apprennent par le serveur.
  live.emit("live:dire", {
    texte: `clic n°${count.value}`,
    front: FRONT,
  });
};
const data = ref<ApiData | null>(null);
const error = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

// La socket de la page — fournie par le plugin, partagée par tous ceux qui la
// demandent. Le cycle de connexion ne se pilote pas ici : il appartient à la
// PAGE, et le plugin l'a déjà lancé.
const live = useNodefony();
// L'état, l'instantané et le salon : trois composables, zéro libération à
// écrire. Chacun rend son abonnement quand le composant meurt.
const liveState = useNodefonyState();
const vue = useNodefonySnapshot();
const messages = ref<Message[]>([]);
useNodefonyChannel("live:salon", (m) => {
  messages.value = [...messages.value, m as Message].slice(-6);
});
const texte = ref("");
const parHttp = ref<string | null>(null);
const parSocket = ref<string | null>(null);
const barreVisible = ref(debugbar()?.isVisible() ?? false);

const basculerBarre = (): void => {
  debugbar()?.toggle();
  barreVisible.value = debugbar()?.isVisible() ?? false;
};

const envoyer = (): void => {
  const dit = texte.value.trim();
  if (!dit) return;
  // Une notification client → serveur : pas de réponse attendue, c'est le
  // serveur qui rediffuse à tous les abonnés du canal.
  live.emit("live:dire", { texte: dit, front: FRONT });
  texte.value = "";
};

/** La MÊME action, appelée par les deux portes, chronométrée des deux côtés. */
const comparer = async (): Promise<void> => {
  const t0 = performance.now();
  const r = await fetch("/vue/api/data");
  const json = (await r.json()) as { result?: unknown };
  parHttp.value = `${Math.round(performance.now() - t0)} ms\n${JSON.stringify(json.result ?? json, null, 2)}`;
  const t1 = performance.now();
  const parLaSocket = await live.request("/vue/api/data");
  parSocket.value = `${Math.round(performance.now() - t1)} ms\n${JSON.stringify(parLaSocket, null, 2)}`;
};

/** La dernière trame, dite pour un humain — « — » tant qu'il n'y en a aucune. */
const derniereDe = (v: SocketSnapshot | null): string =>
  v?.lastFrame.at
    ? `${v.lastFrame.method ?? "?"} à ${new Date(v.lastFrame.at).toLocaleTimeString()}`
    : "—";

const duree = (v: string | null): string => v?.split("\n")[0] ?? "";
const corps = (v: string | null): string =>
  v?.split("\n").slice(1).join("\n") ?? "—";
const basculer = (): void => {
  if (liveState.value === "connected") live.disconnect();
  else void live.connect();
};

const pollApi = async (): Promise<void> => {
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

// Il ne reste ici que ce qui n'est PAS du temps réel : le sondage HTTP, avec
// son horloge à poser et à retirer. La comparaison est le propos de la page —
// trois abonnements temps réel n'ont plus une seule ligne de cycle de vie,
// quand une seule horloge HTTP en demande deux.
onMounted(() => {
  pollApi();
  timer = setInterval(pollApi, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div :style="{ '--accent': ACCENT }">
    <header class="topbar">
      <a class="brand" href="/">
        <img :src="LOGO" alt="" draggable="false" />
        nodefony-core
      </a>
      <nav class="fronts" aria-label="Les quatre vitrines">
        <a
          v-for="f in FRONTS"
          :key="f.href"
          :href="f.href"
          :aria-current="f.nom === 'Vue' ? 'page' : undefined"
        >
          {{ f.nom }}
        </a>
      </nav>
      <div class="outils">
        <span class="sonde-hote" tabindex="0">
          <span class="sonde">
            <span
              class="dot"
              :class="{
                'dot--on': liveState === 'connected',
                'dot--wait':
                  liveState === 'connecting' || liveState === 'reconnecting',
              }"
            />
            {{ ETATS[liveState] ?? liveState }}
            <b>{{ vue?.frames ?? 0 }}</b> trames
          </span>
          <div class="sonde-detail" role="status">
            <dl>
              <dt>Adresse</dt>
              <dd>{{ vue?.url ?? "—" }}</dd>
              <dt>État</dt>
              <dd>{{ ETATS[liveState] ?? liveState }}</dd>
              <dt>Canaux</dt>
              <dd>
                {{ vue?.channels.join(", ") || "aucun" }}
              </dd>
              <dt>Trames reçues</dt>
              <dd>{{ vue?.frames ?? 0 }}</dd>
              <dt>Dernière</dt>
              <dd>{{ derniereDe(vue) }}</dd>
            </dl>
            <p class="rien">
              Tout cela vient du client lui-même : afficher ce panneau ne
              provoque aucune trame.
            </p>
          </div>
        </span>
        <button
          class="bascule"
          :aria-pressed="barreVisible"
          @click="basculerBarre"
        >
          Barre de debug
        </button>
      </div>
    </header>

    <main>
      <div class="hero">
        <svg
          class="logo"
          viewBox="0 0 256 221"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M204.8 0H256L128 220.8 0 0h97.92L128 51.2 157.44 0z"
            fill="#41b883"
          />
          <path
            d="m0 0 128 220.8L256 0h-51.2L128 132.48 50.56 0z"
            fill="#41b883"
          />
          <path
            d="M50.56 0 128 133.12 204.8 0h-47.36L128 51.2 97.92 0z"
            fill="#35495e"
          />
        </svg>
        <h1>Vue 3</h1>
        <p class="sub">
          Le même écran, le même socle, quatre frameworks. Servi par
          <strong>@nodefony/frontend</strong> (Vite + HMR) et alimenté par une
          seule socket Nodefony.
        </p>
        <div class="badges">
          <span class="badge badge--accent">Vue v{{ vueVersion }}</span>
          <span class="badge">Vite dev server</span>
          <span class="badge" v-if="data">env : {{ data.env }}</span>
        </div>
      </div>

      <section>
        <div class="sec-head">
          <p class="kicker">Temps réel</p>
          <h2>Ce que cette socket change</h2>
          <p>
            Une seule socket pour la page, ouverte par le framework.
            L'abonnement est compté par référence et rejoué à chaque reconnexion
            : rien de tout cela n'est écrit dans la page.
          </p>
        </div>

        <div class="bandeau">
          <p class="live-state">
            <span
              class="dot"
              :class="{
                'dot--on': liveState === 'connected',
                'dot--wait':
                  liveState === 'connecting' || liveState === 'reconnecting',
              }"
            />
            {{ ETATS[liveState] ?? liveState }}
          </p>
          <p class="live-meta">
            <template v-if="vue?.lastFrame.at">
              dernière trame : {{ derniereDe(vue) }}
            </template>
            <template v-else>
              aucune trame — le serveur se tait tant qu'il n'a rien à dire
            </template>
          </p>
          <button class="btn btn--ghost" @click="basculer">
            {{ liveState === "connected" ? "Couper la connexion" : "Rétablir" }}
          </button>
        </div>

        <div class="grid">
          <div class="card">
            <h3>👥 Le serveur pousse à TOUS</h3>
            <p style="margin-bottom: 14px">
              Ouvrez cette page dans un second onglet — ou dans une autre
              vitrine — et écrivez : les deux affichent la même chose, en
              direct. Le message ne repasse jamais par une requête HTTP.
            </p>
            <div class="saisie">
              <input
                v-model="texte"
                @keydown.enter="envoyer"
                placeholder="Écrivez, puis Entrée…"
                aria-label="Message à diffuser"
              />
              <button class="counter" @click="envoyer">Envoyer</button>
            </div>
            <ul class="salon">
              <li v-if="messages.length === 0" class="vide">
                Rien encore — écrivez quelque chose.
              </li>
              <li v-for="(m, i) in messages" :key="`${m.ts}-${i}`">
                <span class="qui">{{ m.front }}</span>
                <span>{{ m.texte }}</span>
                <span class="quand">{{
                  new Date(m.ts).toLocaleTimeString()
                }}</span>
              </li>
            </ul>
          </div>

          <div class="card">
            <h3>🔀 Une action, deux transports</h3>
            <p style="margin-bottom: 14px">
              <code>GET /vue/api/data</code> appelé par HTTP, puis par la
              socket. Même route, même session, même sécurité — une seule action
              de contrôleur derrière les deux portes.
            </p>
            <button class="counter" @click="comparer">
              Appeler par les deux
            </button>
            <div class="deux" style="margin-top: 14px">
              <div>
                <p class="voie">
                  HTTP <em>{{ duree(parHttp) }}</em>
                </p>
                <pre class="out">{{ corps(parHttp) }}</pre>
              </div>
              <div>
                <p class="voie">
                  Socket <em>{{ duree(parSocket) }}</em>
                </p>
                <pre class="out">{{ corps(parSocket) }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div class="live" style="margin-top: 16px">
          <div>
            <p class="live-why">
              Ces <strong>trois lignes</strong> sont les mêmes dans les quatre
              vitrines. Seule la syntaxe du framework de vue change : la logique
              d'abonnement vit dans <strong>nodefony/client</strong>, jamais
              dans la page.
            </p>
            <p class="hint">
              Ici, des <strong>composables</strong> — de minces enveloppes sur
              ce socle, comme les hooks de React. Aucune libération à écrire :
              la portée du composant rend l'abonnement à sa mort.
            </p>
          </div>
          <pre class="code"><code>// main.ts — l'adresse, une seule fois
app.use(nodefonyVue, { url: "/api/live/realtime" })

const liveState = useNodefonyState()
useNodefonyChannel("live:salon", (m) =&gt; …)</code></pre>
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
            <code class="route">GET /vue/api/data — 1×/s</code>
            <pre v-if="error" class="out out--err">{{ error }}</pre>
            <pre v-else-if="data" class="out">{{
              JSON.stringify(data, null, 2)
            }}</pre>
            <p v-else class="hint">chargement…</p>
          </div>

          <div class="card">
            <h3>♻️ Rechargement à chaud</h3>
            <button class="counter" @click="cliquer">
              {{ count }} clic{{ count > 1 ? "s" : "" }}
            </button>
            <p class="hint">
              {{ MAJS_A_CHAUD }} rechargement{{ MAJS_A_CHAUD > 1 ? "s" : "" }} à
              chaud depuis le dernier chargement complet — l'état ci-dessus y a
              survécu.
            </p>
            <p class="hint">
              Édite <code>frontend/src/App.vue</code> : Vite recompile, le
              compteur ne repart PAS à zéro. S'il y retombe, c'est un
              rechargement complet, pas un rechargement à chaud.
            </p>
          </div>
        </div>
      </section>

      <p class="foot">
        La même page en <a href="/react/app">React</a>,
        <a href="/angular/app">Angular</a> et <a href="/svelte/app">Svelte</a> —
        ou la <a href="/nodefony">console d'administration</a>.
      </p>
    </main>
  </div>
</template>
