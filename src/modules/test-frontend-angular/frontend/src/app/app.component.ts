import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  VERSION,
  computed,
  inject,
  signal,
} from "@angular/core";
import {
  describeSocket,
  installErrorCapture,
  installRequestIdProvider,
  installSyslogUplink,
  Syslog,
  withRequestId,
} from "nodefony/client";
// La liaison Angular de `nodefony/angular` — le pendant exact des hooks React
// et des composables Vue. Des fonctions d'injection qui rendent des signals :
// l'abonnement est libéré à la destruction du composant, sans un `ngOnDestroy`
// à écrire. Aucune règle de temps réel n'est écrite ici — elles vivent toutes
// dans le socle `nodefony/client`, que cette liaison enveloppe.
//
// Aucun décorateur Angular n'est publié par `nodefony` : une bibliothèque qui
// en publie doit être bâtie par `ng-packagr`. La forme fonctionnelle est celle
// qu'Angular emploie pour lui-même (`provideHttpClient`, `takeUntilDestroyed`).
import {
  injectNodefony,
  injectNodefonyChannel,
  injectNodefonySnapshot,
  injectNodefonySse,
  injectNodefonyState,
} from "nodefony/angular";
// Mise en page COMMUNE aux quatre vitrines — même fichier, même charte que la
// page d'accueil du framework. Seule `--accent` change d'une vitrine à l'autre.
import "../showcase.css";

interface ApiData {
  ts: number;
  pid: number;
  env: string;
}

/** Un message du salon partagé : qui l'a écrit, depuis quelle vitrine. */
interface Message {
  text: string;
  front: string;
  ts: number;
  pid: number;
}

/** Une ligne du journal du serveur, telle que le flux SSE la pousse. */
interface LogLine {
  id: number;
  time: number;
  severity: string;
  msgid: string;
  text: string;
  requestId?: string | undefined;
  dropped?: number | undefined;
}

/**
 * Le flux SSE du journal du serveur — sous `/nodefony/<ns>/api/`, donc dans la
 * zone d'administration : une session de la console est exigée.
 */
const JOURNAL = "/nodefony/test/api/syslog";

/** Lit une ligne poussée par le serveur ; tout ce qui n'en a pas la forme est ignoré. */
function lineOf(data: string): LogLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r: Record<string, unknown> = { ...raw };
  if (typeof r.id !== "number" || typeof r.text !== "string") return null;
  return {
    id: r.id,
    time: typeof r.time === "number" ? r.time : Date.now(),
    severity: typeof r.severity === "string" ? r.severity : "INFO",
    msgid: typeof r.msgid === "string" ? r.msgid : "",
    text: r.text,
    requestId: typeof r.requestId === "string" ? r.requestId : undefined,
    dropped: typeof r.dropped === "number" ? r.dropped : undefined,
  };
}

/** L'état d'un flux, dit pour un humain — `readyState` et `error` du socle. */
function fluxLabel(listening: boolean, readyState: number, error: boolean) {
  if (!listening) return { text: "écoute arrêtée", dot: "dot" };
  if (readyState === 1) return { text: "à l'écoute", dot: "dot dot--on" };
  if (readyState === 0)
    return {
      text: error ? "reconnexion automatique…" : "connexion…",
      dot: "dot dot--wait",
    };
  return { text: error ? "refusé par le serveur" : "fermé", dot: "dot" };
}

/** La couleur du framework de vue — le SEUL écart de style entre les quatre. */
const ACCENT = "#dd0031";

/** Le nom de CETTE vitrine — il marque les messages qu'elle envoie au salon. */
const FRONT = "Angular";

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
// Compteur conservé entre deux rechargements : absent au premier.
if (hot) hot.data.majs = ((hot.data.majs as number | undefined) ?? 0) + 1;
const MAJS_A_CHAUD = hot ? ((hot.data.majs as number | undefined) ?? 1) - 1 : 0;

/** Les quatre vitrines, pour les comparer d'un clic. */
const FRONTS = [
  { name: "React", href: "/react/app" },
  { name: "Vue", href: "/vue/app" },
  { name: "Angular", href: "/angular/app" },
  { name: "Svelte", href: "/svelte/app" },
];

@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <div [style.--accent]="accent">
      <header class="topbar">
        <a class="brand" href="/">
          <img src="/nodefony-logo.png" alt="" draggable="false" />
          nodefony-core
        </a>
        <nav class="fronts" aria-label="Les quatre vitrines">
          @for (f of fronts; track f.href) {
            <a
              [href]="f.href"
              [attr.aria-current]="f.name === 'Angular' ? 'page' : null"
              >{{ f.name }}</a
            >
          }
        </nav>
        <div class="outils">
          <span class="sonde-hote" tabindex="0">
            <span class="sonde">
              <span
                class="dot"
                [class.dot--on]="liveState() === 'connected'"
                [class.dot--wait]="
                  liveState() === 'connecting' || liveState() === 'reconnecting'
                "
              ></span>
              {{ stateLabel() }}
              <b>{{ vue()?.frames ?? 0 }}</b> trames
            </span>
            <div class="sonde-detail" role="status">
              <dl>
                <dt>Adresse</dt>
                <dd>{{ vue()?.url ?? "—" }}</dd>
                <dt>État</dt>
                <dd>{{ stateLabel() }}</dd>
                <dt>Canaux</dt>
                <dd>{{ channels() }}</dd>
                <dt>Trames reçues</dt>
                <dd>{{ vue()?.frames ?? 0 }}</dd>
                <dt>Dernière</dt>
                <dd>{{ lastFrom() }}</dd>
              </dl>
              <p class="rien">
                Tout cela vient du client lui-même : afficher ce panneau ne
                provoque aucune trame.
              </p>
            </div>
          </span>
          <button
            class="bascule"
            [attr.aria-pressed]="barVisible()"
            (click)="toggleBar()"
          >
            Barre de debug
          </button>
        </div>
      </header>

      <main>
        <div class="hero">
          <svg
            class="logo"
            viewBox="0 0 250 250"
            xmlns="http://www.w3.org/2000/svg"
          >
            <polygon
              points="125,30 31.9,63.2 46.1,186.3 125,230 203.9,186.3 218.1,63.2"
              fill="#dd0031"
            />
            <polygon
              points="125,30 125,52.2 125,153.4 125,230 203.9,186.3 218.1,63.2"
              fill="#c3002f"
            />
            <path
              d="M125,52.1 66.8,182.6 88.5,182.6 100.2,153.4 149.6,153.4 161.3,182.6 183,182.6 Z M142,135.4 108,135.4 125,94.5 Z"
              fill="#fff"
              fill-rule="evenodd"
            />
          </svg>
          <h1>Angular 22</h1>
          <p class="sub">
            Le même écran, le même socle, quatre frameworks. Servi par
            <strong>&#64;nodefony/frontend</strong> (Vite + HMR) et alimenté par
            une seule socket Nodefony.
          </p>
          <div class="badges">
            <span class="badge badge--accent">Angular v{{ ngVersion }}</span>
            <span class="badge">Vite dev server</span>
            @if (data(); as d) {
              <span class="badge">env : {{ d.env }}</span>
            }
          </div>
          <nav class="sommaire" aria-label="Sur cette page">
            <a href="#temps-reel">Temps réel</a>
            <a href="#comparaison">Par comparaison</a>
            <a href="#journal">Journal SSE</a>
            <a href="#client">Le client</a>
            <a href="#observabilite">Observabilité</a>
          </nav>
        </div>

        <section id="temps-reel">
          <div class="sec-head">
            <p class="kicker">Temps réel</p>
            <h2>Ce que cette socket change</h2>
            <p>
              Une seule socket pour la page, ouverte par le framework.
              L'abonnement est compté par référence et rejoué à chaque
              reconnexion : rien de tout cela n'est écrit dans la page.
            </p>
          </div>

          <div class="bandeau">
            <p class="live-state">
              <span
                class="dot"
                [class.dot--on]="liveState() === 'connected'"
                [class.dot--wait]="
                  liveState() === 'connecting' || liveState() === 'reconnecting'
                "
              ></span>
              {{ stateLabel() }}
            </p>
            <p class="live-meta">
              @if (vue()?.lastFrame?.at) {
                dernière trame : {{ lastFrom() }}
              } @else {
                aucune trame — le serveur se tait tant qu'il n'a rien à dire
              }
            </p>
            <button class="btn btn--ghost" (click)="toggle()">
              {{
                liveState() === "connected" ? "Couper la connexion" : "Rétablir"
              }}
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
                  [value]="text()"
                  (input)="text.set($any($event.target).value)"
                  (keydown.enter)="send()"
                  placeholder="Écrivez, puis Entrée…"
                  aria-label="Message à diffuser"
                />
                <button class="counter" (click)="send()">Envoyer</button>
              </div>
              <ul class="salon">
                @if (messages().length === 0) {
                  <li class="vide">Rien encore — écrivez quelque chose.</li>
                } @else {
                  @for (m of messages(); track m.ts) {
                    <li>
                      <span class="qui">{{ m.front }}</span>
                      <span>{{ m.text }}</span>
                      <span class="quand">{{ timeOf(m.ts) }}</span>
                    </li>
                  }
                }
              </ul>
            </div>

            <div class="card">
              <h3>🔀 Une action, deux transports</h3>
              <p style="margin-bottom: 14px">
                <code>GET /angular/api/data</code> appelé par HTTP, puis par la
                socket. Même route, même session, même sécurité — une seule
                action de contrôleur derrière les deux portes.
              </p>
              <button class="counter" (click)="comparer()">
                Appeler par les deux
              </button>
              <div class="deux" style="margin-top: 14px">
                <div>
                  <p class="voie">
                    HTTP <em>{{ duration(parHttp()) }}</em>
                  </p>
                  <pre class="out">{{ body(parHttp()) }}</pre>
                </div>
                <div>
                  <p class="voie">
                    Socket <em>{{ duration(parSocket()) }}</em>
                  </p>
                  <pre class="out">{{ body(parSocket()) }}</pre>
                </div>
              </div>
            </div>
          </div>

          <div class="live" style="margin-top: 16px">
            <div>
              <p class="live-why">
                Ces <strong>trois lignes</strong> sont les mêmes dans les quatre
                vitrines. Seule la syntaxe du framework de vue change : la
                logique d'abonnement vit dans <strong>nodefony/client</strong>,
                jamais dans la page.
              </p>
              <p class="hint">
                Le même socle que React consomme à travers ses hooks — ici on
                l'appelle directement.
              </p>
            </div>
            <pre class="code"><code>{{ excerpt }}</code></pre>
          </div>
        </section>

        <section id="comparaison">
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
              <code class="route">GET /angular/api/data — 1×/s</code>
              @if (error(); as e) {
                <pre class="out out--err">{{ e }}</pre>
              } @else if (data(); as d) {
                <pre class="out">{{ stringify(d) }}</pre>
              } @else {
                <p class="hint">chargement…</p>
              }
            </div>

            <div class="card">
              <h3>♻️ Rechargement à chaud</h3>
              <button class="counter" (click)="increment()">
                {{ count() }} clic{{ count() > 1 ? "s" : "" }}
              </button>
              <p class="hint">
                {{ majsAChaud }} rechargement{{ majsAChaud > 1 ? "s" : "" }} à
                chaud depuis le dernier chargement complet — l'état ci-dessus y
                a survécu.
              </p>
              <p class="hint">
                Édite <code>frontend/src/app/app.component.ts</code> : Vite
                recompile, le compteur ne repart PAS à zéro. S'il y retombe,
                c'est un rechargement complet, pas un rechargement à chaud.
              </p>
            </div>
          </div>
        </section>

        <section id="journal">
          <div class="sec-head">
            <p class="kicker">Flux SSE</p>
            <h2>Journal du serveur en direct</h2>
            <p>
              Le serveur parle, la page écoute — sur une réponse HTTP ordinaire
              qui ne se termine pas. Chaque ligne porte un identifiant : coupé
              puis rétabli, le flux reprend là où il s'était arrêté.
            </p>
          </div>

          <div class="bandeau">
            <p class="live-state">
              <span [class]="streamStatus().dot"></span>
              {{ streamStatus().text }}
            </p>
            <p class="live-meta">
              {{ lines().length }} ligne{{ lines().length > 1 ? "s" : "" }} —
              les douze dernières
            </p>
            <button class="btn btn--ghost" (click)="toggleListening()">
              {{ listening() ? "Arrêter l'écoute" : "Écouter" }}
            </button>
          </div>

          @if (refused()) {
            <p class="refus" role="status">
              Le serveur a refusé le flux : le journal d'exploitation est
              réservé à l'administration.
              <a href="/nodefony/login">Connectez-vous à la console</a> dans ce
              navigateur, puis revenez ici.
            </p>
          }

          <ol class="journal">
            @for (l of lines(); track l.id) {
              <li>
                <time>{{ timeOf(l.time) }}</time>
                <span [class]="'sev sev--' + l.severity.toLowerCase()">{{
                  l.severity
                }}</span>
                <span class="msgid">{{ l.msgid }}</span>
                <span class="txt"
                  >{{ l.text
                  }}{{ l.dropped ? " (+" + l.dropped + " perdues)" : "" }}</span
                >
                @if (l.requestId) {
                  <code class="rid">{{ l.requestId.slice(0, 8) }}</code>
                }
              </li>
            } @empty {
              <li class="vide">Rien encore — le serveur n'a rien dit.</li>
            }
          </ol>

          <div class="grid" style="margin-top: 16px">
            <div class="card">
              <h3>📡 WebSocket ou SSE ?</h3>
              <table class="versus">
                <thead>
                  <tr>
                    <th scope="col">Critère</th>
                    <th scope="col">WebSocket</th>
                    <th scope="col">SSE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Sens</th>
                    <td>les deux</td>
                    <td>serveur → page</td>
                  </tr>
                  <tr>
                    <th scope="row">Transport</th>
                    <td>protocole à part</td>
                    <td>réponse HTTP ordinaire</td>
                  </tr>
                  <tr>
                    <th scope="row">Reprise</th>
                    <td>rejoue les abonnements</td>
                    <td>Last-Event-ID, rien de perdu</td>
                  </tr>
                  <tr>
                    <th scope="row">Ici</th>
                    <td>le salon, le pont d'API</td>
                    <td>le journal du serveur</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="card">
              <h3>🧩 Un appel, fermé tout seul</h3>
              <pre class="code"><code>{{ sseExcerpt }}</code></pre>
              <p class="hint">
                Détruire le composant ferme le flux : aucune requête ne reste
                ouverte derrière une page quittée. Les mêmes trois lignes en
                React, Vue et Svelte.
              </p>
            </div>
          </div>
        </section>

        <section id="client">
          <div class="sec-head">
            <p class="kicker">Diagnostic</p>
            <h2>Le client vu de l'intérieur</h2>
            <p>
              Ce que la socket sait d'elle-même, sans rien demander au serveur.
              Le même tableau s'affiche dans la console du navigateur ; ici,
              chaque ligne dit ce qu'elle garantit.
            </p>
          </div>
          <div class="card">
            <dl class="fiche">
              @for (r of rows(); track r.label) {
                <div>
                  <dt>{{ r.label }}</dt>
                  <dd>
                    <span class="val">{{ r.value }}</span>
                    <span class="pourquoi">{{ r.hint }}</span>
                  </dd>
                </div>
              }
            </dl>
            <p class="hint">
              Dans la console (F12) : le badge <code>◆ nodefony client</code>,
              son groupe replié, puis <code>nodefony.socket</code>,
              <code>nodefony.sockets()</code> et
              <code>nodefony.identity()</code>. En production, rien de tout cela
              n'est posé.
            </p>
          </div>
        </section>

        <section id="observabilite">
          <div class="sec-head">
            <p class="kicker">Observabilité</p>
            <h2>Ce qui casse ici se lit là-bas</h2>
            <p>
              Une erreur survenue dans ce navigateur rejoint le journal du
              serveur, à côté de la ligne de la requête qui l'a provoquée. Trois
              appels dans l'application, rien de plus.
            </p>
          </div>
          <div class="grid">
            <div class="card">
              <h3>💥 Provoquer un incident</h3>
              <p class="hint">
                Le clic lit un champ absent d'une réponse : une TypeError,
                journalisée avec le requestId de cette requête, puis poussée au
                serveur par la socket.
              </p>
              <button class="counter" (click)="triggerIncident()">
                Provoquer un incident
              </button>
              @if (said(); as message) {
                <p class="hint" role="status">{{ message }}</p>
              }
              <p class="hint">
                La remontée exige une session : le canal n'accepte pas les
                connexions anonymes. Connectez-vous à la console
                d'administration dans ce navigateur, puis rechargez — l'entrée
                apparaît dans le journal en direct ci-dessus (VITRINE), avec le
                même requestId. Socket : {{ stateLabel() }}.
              </p>
            </div>
            <div class="card">
              <h3>🧩 Trois appels</h3>
              <pre class="code"><code>{{ incidentsExcerpt }}</code></pre>
              <p class="hint">
                Les erreurs que personne ne rattrape y passent aussi : la
                capture est posée pour toute la page, et retirée au démontage.
              </p>
            </div>
          </div>
        </section>

        <p class="foot">
          La même page en <a href="/react/app">React</a>,
          <a href="/vue/app">Vue</a> et <a href="/svelte/app">Svelte</a> — ou la
          <a href="/nodefony">console d'administration</a>.
        </p>
      </main>
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  readonly ngVersion = VERSION.full;
  readonly accent = ACCENT;
  readonly majsAChaud = MAJS_A_CHAUD;
  readonly fronts = FRONTS;
  readonly count = signal(0);
  readonly data = signal<ApiData | null>(null);
  readonly error = signal<string | null>(null);
  /**
   * La socket elle-même — pour ce qu'on lui DIT (`emit`, `request`) et le
   * bouton de coupure. La politique d'adresse est dans `main.ts` : un composant
   * ne devine jamais l'hôte auquel il parle.
   */
  private readonly nodefony = injectNodefony();
  readonly liveState = injectNodefonyState();
  readonly messages = signal<Message[]>([]);
  readonly text = signal("");
  readonly parHttp = signal<string | null>(null);
  readonly parSocket = signal<string | null>(null);
  readonly vue = injectNodefonySnapshot();
  readonly barVisible = signal(debugbar()?.isVisible() ?? false);
  /** L'extrait montré à l'écran — le code que CETTE page exécute vraiment. */
  readonly excerpt = `provideNodefony({ url: "/api/live/realtime" })  // main.ts

readonly liveState = injectNodefonyState()
injectNodefonyChannel("live:salon", (m) => …)`;
  private timer?: ReturnType<typeof setInterval>;

  // Le journal du serveur, par un flux SSE. L'adresse est une fonction qui lit
  // un signal : le flux la SUIT — `null` suspend l'écoute — et la destruction
  // du composant le ferme. Ouvert hors zone par la liaison.
  readonly listening = signal(true);
  readonly lines = signal<LogLine[]>([]);
  readonly flux = injectNodefonySse(() => (this.listening() ? JOURNAL : null), {
    events: ["log"],
    onEvent: (e) => {
      const line = lineOf(e.data);
      if (!line) return;
      // Une reprise rejoue la fin du tampon : on n'ajoute que le neuf.
      this.lines.update((l) => {
        const last = l.at(-1);
        return last && line.id <= last.id ? l : [...l, line].slice(-12);
      });
    },
  });
  readonly streamStatus = computed(() =>
    fluxLabel(this.listening(), this.flux().readyState, this.flux().error),
  );
  readonly refused = computed(
    () => this.listening() && this.flux().readyState === 2 && this.flux().error,
  );
  /** Ce que le client sait de SA socket — les mêmes lignes que la console. */
  readonly rows = computed(() => {
    const v = this.vue();
    return v ? describeSocket(v) : [];
  });
  readonly sseExcerpt = `const flux = injectNodefonySse(JOURNAL, {
  events: ["log"],
  onEvent: (e) => …,
})`;

  // Les incidents de CETTE page remontent au serveur — trois appels, posés
  // dans le constructeur (contexte d'injection), retirés par `DestroyRef`.
  private readonly journal = new Syslog({ moduleName: "vitrine-angular" });
  readonly said = signal<string | null>(null);
  readonly incidentsExcerpt = `installRequestIdProvider()
installErrorCapture({ syslog })
installSyslogUplink({ syslog, publisher: socket })`;

  /**
   * Provoque une erreur DANS le traitement d'une réponse — le chemin où le
   * `requestId` est réellement connu, et le seul qui prouve la corrélation.
   */
  async triggerIncident(): Promise<void> {
    const response = await fetch(`/${FRONT.toLowerCase()}/api/data`);
    const requestId = response.headers.get("x-request-id") ?? undefined;
    withRequestId(requestId, () => {
      try {
        // Une faute ordinaire : on lit un champ que la réponse ne porte pas.
        const expected: { absent?: { value: string } } = {};
        // Faute VOULUE : la vitrine montre une TypeError remontée au journal ;
        // un `?.` la ferait disparaître.
        // oxlint-disable-next-line typescript/no-non-null-assertion
        this.said.set(expected.absent!.value);
      } catch (e) {
        this.journal.log(
          e instanceof Error ? e.message : String(e),
          3,
          "VITRINE",
          "clic sur « provoquer un incident »",
        );
        this.said.set(
          requestId
            ? `Incident journalisé et poussé au serveur, corrélé à la requête ${requestId.slice(0, 8)}…`
            : "Incident journalisé et poussé au serveur (aucun requestId sur cette réponse).",
        );
      }
    });
  }

  toggleListening(): void {
    this.listening.update((v) => !v);
  }

  /**
   * L'abonnement se prend ICI, et nulle part ailleurs : un constructeur est un
   * contexte d'injection, donc `DestroyRef` y est atteignable — la liaison rend
   * l'abonnement au serveur à la destruction du composant, sans une ligne de
   * `ngOnDestroy`. C'est tout l'écart avec le socle appelé en direct, où la
   * libération était à tenir à la main.
   */
  constructor() {
    installRequestIdProvider();
    const stopCapture = installErrorCapture({ syslog: this.journal });
    const stopUplink = installSyslogUplink({
      syslog: this.journal,
      publisher: this.nodefony,
    });
    inject(DestroyRef).onDestroy(() => {
      stopUplink();
      stopCapture();
    });
    injectNodefonyChannel("live:salon", (m) =>
      this.messages.update((list) => [...list, m as Message].slice(-6)),
    );
  }

  private async pollApi(): Promise<void> {
    try {
      const r = await fetch("/angular/api/data");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Nodefony wraps payload : `{ result: {...} }` selon le HttpKernel.
      const json = (await r.json()) as { result?: ApiData } & ApiData;
      this.data.set(json.result ?? json);
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  increment(): void {
    this.count.update((c) => c + 1);
    // Le clic voyage : les autres vitrines l'apprennent par le serveur.
    this.nodefony.emit("live:say", {
      text: `clic n°${this.count()}`,
      front: FRONT,
    });
  }

  stringify(d: ApiData): string {
    return JSON.stringify(d, null, 2);
  }

  /** L'état de la connexion, dit en français — un écran ne parle pas machine. */
  stateLabel(): string {
    const fr: Record<string, string> = {
      connected: "connecté",
      connecting: "connexion…",
      reconnecting: "reconnexion automatique…",
      disconnected: "coupé",
      error: "erreur",
    };
    return fr[this.liveState()] ?? this.liveState();
  }

  channels(): string {
    return this.vue()?.channels.join(", ") || "aucun";
  }

  /** La dernière trame, dite pour un humain — « — » tant qu'il n'y en a aucune. */
  lastFrom(): string {
    const v = this.vue();
    return v?.lastFrame.at
      ? `${v.lastFrame.method ?? "?"} à ${new Date(v.lastFrame.at).toLocaleTimeString()}`
      : "—";
  }

  send(): void {
    const said = this.text().trim();
    if (!said) return;
    // Une notification client → serveur : pas de réponse attendue, c'est le
    // serveur qui rediffuse à tous les abonnés du canal.
    this.nodefony.emit("live:say", { text: said, front: FRONT });
    this.text.set("");
  }

  /** La MÊME action, appelée par les deux portes, chronométrée des deux côtés. */
  async comparer(): Promise<void> {
    const t0 = performance.now();
    const r = await fetch("/angular/api/data");
    const json = (await r.json()) as { result?: unknown };
    this.parHttp.set(
      `${Math.round(performance.now() - t0)} ms\n${JSON.stringify(json.result ?? json, null, 2)}`,
    );
    const t1 = performance.now();
    const parLaSocket = await this.nodefony.request("/angular/api/data");
    this.parSocket.set(
      `${Math.round(performance.now() - t1)} ms\n${JSON.stringify(parLaSocket, null, 2)}`,
    );
  }

  duration(v: string | null): string {
    return v?.split("\n")[0] ?? "";
  }

  body(v: string | null): string {
    return v?.split("\n").slice(1).join("\n") ?? "—";
  }

  timeOf(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  toggleBar(): void {
    debugbar()?.toggle();
    this.barVisible.set(debugbar()?.isVisible() ?? false);
  }

  toggle(): void {
    if (this.liveState() === "connected") this.nodefony.disconnect();
    else this.nodefony.connect().catch(() => {}); // l'échec se lit dans l'état
  }

  ngOnInit(): void {
    // Il ne reste ici que ce que la PAGE possède vraiment : son sondage HTTP.
    // Le temps réel — connexion, abonnement, ré-abonnement à la reconnexion,
    // libération — appartient à la liaison et aux providers.
    void this.pollApi();
    this.timer = setInterval(() => void this.pollApi(), 1000);
  }

  ngOnDestroy(): void {
    // Une seule chose à rendre : l'horloge du sondage HTTP. Les abonnements
    // temps réel sont rendus par `DestroyRef`, et la socket PARTAGÉE reste
    // ouverte pour la page — la couper trancherait les requêtes en vol des
    // autres consommateurs.
    if (this.timer) clearInterval(this.timer);
  }
}
