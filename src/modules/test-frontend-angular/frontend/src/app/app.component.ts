import { Component, OnDestroy, OnInit, VERSION, signal } from "@angular/core";
// Le socle AGNOSTIQUE de `nodefony/client` — le même que les vitrines React,
// Vue et Svelte. Deux concepts : une connexion partagée qui reçoit l'adresse,
// et un abonnement. Aucune règle de temps réel n'est écrite ici.
import {
  connectShared,
  observeChannel,
  observeChannelData,
  observeState,
} from "nodefony/client";
// Mise en page COMMUNE aux quatre vitrines — même fichier, même charte que la
// page d'accueil du framework. Seule `--accent` change d'une vitrine à l'autre.
import "../showcase.css";

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
const ACCENT = "#dd0031";

/** Le nom de CETTE vitrine — il marque les messages qu'elle envoie au salon. */
const FRONT = "Angular";

/** Les quatre vitrines, pour les comparer d'un clic. */
const FRONTS = [
  { nom: "React", href: "/react/app" },
  { nom: "Vue", href: "/vue/app" },
  { nom: "Angular", href: "/angular/app" },
  { nom: "Svelte", href: "/svelte/app" },
];

// UNE socket par URL pour toute la page. `connectShared` porte le cycle de
// connexion (idempotent, rejet avalé, et JAMAIS de `disconnect()` au démontage :
// la connexion appartient à la PAGE).
const live = connectShared({ url: "/api/live/realtime" });

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
              [attr.aria-current]="f.nom === 'Angular' ? 'page' : null"
              >{{ f.nom }}</a
            >
          }
        </nav>
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
          <h1>Angular 21</h1>
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
        </div>

        <section>
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
              {{ etatFr() }}
            </p>
            <p class="live-meta">
              @if (tick(); as t) {
                battement du pod à {{ heure(t) }} · process {{ t.pid }}
              } @else {
                en attente du premier battement…
              }
            </p>
            <button class="btn btn--ghost" (click)="basculer()">
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
                  [value]="texte()"
                  (input)="texte.set($any($event.target).value)"
                  (keydown.enter)="envoyer()"
                  placeholder="Écrivez, puis Entrée…"
                  aria-label="Message à diffuser"
                />
                <button class="counter" (click)="envoyer()">Envoyer</button>
              </div>
              <ul class="salon">
                @if (messages().length === 0) {
                  <li class="vide">Rien encore — écrivez quelque chose.</li>
                } @else {
                  @for (m of messages(); track m.ts) {
                    <li>
                      <span class="qui">{{ m.front }}</span>
                      <span>{{ m.texte }}</span>
                      <span class="quand">{{ heureDe(m.ts) }}</span>
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
                    HTTP <em>{{ duree(parHttp()) }}</em>
                  </p>
                  <pre class="out">{{ corps(parHttp()) }}</pre>
                </div>
                <div>
                  <p class="voie">
                    Socket <em>{{ duree(parSocket()) }}</em>
                  </p>
                  <pre class="out">{{ corps(parSocket()) }}</pre>
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
            <pre class="code"><code>{{ extrait }}</code></pre>
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
                Édite <code>frontend/src/app/app.component.ts</code> : Vite
                recompile et le compteur garde sa valeur.
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
  readonly fronts = FRONTS;
  readonly count = signal(0);
  readonly data = signal<ApiData | null>(null);
  readonly error = signal<string | null>(null);
  readonly liveState = signal(live.socket.state);
  readonly tick = signal<Tick | null>(null);
  readonly messages = signal<Message[]>([]);
  readonly texte = signal("");
  readonly parHttp = signal<string | null>(null);
  readonly parSocket = signal<string | null>(null);
  /** L'extrait montré à l'écran — le code que CETTE page exécute vraiment. */
  readonly extrait = `const live = connectShared({ url: "/api/live/realtime" })

observeState(live.socket, (état) => this.liveState.set(état))
observeChannel(live.socket, "live:salon", (m) => …)`;
  private timer?: ReturnType<typeof setInterval>;
  /** Libérations des observateurs — rendues au ngOnDestroy. */
  #offLive: (() => void)[] = [];

  private async pollApi(): Promise<void> {
    try {
      const r = await fetch("/angular/api/data");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Nodefony wraps payload : `{ result: {...} }` selon le HttpKernel.
      const json = (await r.json()) as { result?: ApiData } & ApiData;
      this.data.set((json.result ?? json) as ApiData);
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  increment(): void {
    this.count.update((c) => c + 1);
  }

  stringify(d: ApiData): string {
    return JSON.stringify(d, null, 2);
  }

  /** L'état de la connexion, dit en français — un écran ne parle pas machine. */
  etatFr(): string {
    const fr: Record<string, string> = {
      connected: "connecté",
      connecting: "connexion…",
      reconnecting: "reconnexion automatique…",
      disconnected: "coupé",
      error: "erreur",
    };
    return fr[this.liveState()] ?? this.liveState();
  }

  heure(t: Tick): string {
    return new Date(t.ts).toLocaleTimeString();
  }

  envoyer(): void {
    const dit = this.texte().trim();
    if (!dit) return;
    // Une notification client → serveur : pas de réponse attendue, c'est le
    // serveur qui rediffuse à tous les abonnés du canal.
    live.socket.emit("live:dire", { texte: dit, front: FRONT });
    this.texte.set("");
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
    const parLaSocket = await live.socket.request("/angular/api/data");
    this.parSocket.set(
      `${Math.round(performance.now() - t1)} ms\n${JSON.stringify(parLaSocket, null, 2)}`,
    );
  }

  duree(v: string | null): string {
    return v?.split("\n")[0] ?? "";
  }

  corps(v: string | null): string {
    return v?.split("\n").slice(1).join("\n") ?? "—";
  }

  heureDe(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  basculer(): void {
    if (this.liveState() === "connected") live.socket.disconnect();
    else void live.socket.connect();
  }

  ngOnInit(): void {
    void this.pollApi();
    this.timer = setInterval(() => void this.pollApi(), 1000);
    // Un observateur = un rappel + une libération. L'abonnement serveur est
    // ref-compté et REJOUÉ à chaque reconnexion : le socle s'en charge.
    this.#offLive.push(
      observeState(live.socket, (state) => this.liveState.set(state)),
    );
    this.#offLive.push(
      observeChannelData<Tick>(live.socket, "live:ticker", (t) =>
        this.tick.set(t),
      ),
    );
    this.#offLive.push(
      observeChannel(live.socket, "live:salon", (m) =>
        this.messages.update((liste) => [...liste, m as Message].slice(-6)),
      ),
    );
    live.start();
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    // On libère les observateurs (ce qui rend l'abonnement) — la socket PARTAGÉE,
    // elle, reste ouverte pour la page.
    for (const off of this.#offLive) off();
    this.#offLive = [];
  }
}
