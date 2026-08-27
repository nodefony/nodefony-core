import {
  Component,
  OnDestroy,
  OnInit,
  VERSION,
  ViewEncapsulation,
  signal,
} from "@angular/core";
<% if (it.complete) { %>// FAÇADE temps réel isomorphe du framework — reconnexion, re-subscribe, état :
// gérés par le client. Aucun `new WebSocket` à la main. Subpath
// `nodefony/client` : la porte client explicite, résolue à l'identique par
// Vite, Node et le typecheck.
import {
  connectShared,
  observeState,
  observeChannelData,
} from "nodefony/client";
<% } %>import { NODEFONY_LOGO } from "../brand";
// Mise en page et palette de la démonstration — feuille PARTAGÉE par les trois
// vitrines ; `accent.css` n'y ajoute que la couleur du framework.
import "../showcase.css";
import "../accent.css";

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

/** Un tick du canal `live:ticker` (cf `nodefony/controllers/LiveController.ts`). */
interface Tick {
  n: number;
  ts: number;
  pid: number;
}

// UNE socket par URL pour toute la page — URL RELATIVE, résolue contre la page
// (https → wss automatique). `connectShared` porte le cycle de connexion : il
// est le MÊME pour les quatre fronts et pour la console d'administration.
const live = connectShared({ url: "/api/live/realtime" });
<% } %>
/**
 * Page d'accueil de l'app — vitrine AUTONOME (zéro dépendance UI) :
 *  - panneau de marque (même design que le login de Studio : dégradé, glow,
 *    logo, slogan, 3 piliers du framework) ;
 *  - preuves INTERACTIVES : fetch HTTP, echo WebSocket live sur le MÊME
 *    controller (le différenciateur Nodefony), compteur HMR.
 * Composant racine standalone (zoneless). `/api` est proxifié vers Nodefony
 * par `apiProxyPaths` (cf registerEntry) — sans lui, Vite répondrait son
 * SPA-fallback HTML au lieu du JSON.
 */
@Component({
  selector: "app-root",
  standalone: true,
  // Composant racine de la vitrine : styles volontairement GLOBAUX
  // (variables :root + body{margin:0} inatteignables en encapsulation émulée).
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="nf-split">
      <!-- ── Panneau de marque (même design que le login Studio) ─────────── -->
      <aside class="nf-hero">
        <div class="nf-glow" aria-hidden="true"></div>
        <div style="display:flex; gap:14px; align-items:center; position:relative">
          <img [src]="logo" alt="Nodefony" height="42" draggable="false" />
          <span style="font-weight:700; font-size:26px"><%= it.appName %></span>
        </div>

        <div style="max-width:480px; position:relative">
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
              <div style="font-weight:600">Temps réel natif</div>
              <div class="nf-fdesc">HTTP et WebSocket, co-citoyens dans le même contexte.</div>
            </div>
          </div>
          <div class="nf-feature">
            <div class="nf-ficon">
              <!-- pulse (activity) -->
              <svg viewBox="0 0 24 24"><path d="M3 12h4l2.5-7 5 14 2.5-7h4" fill="none" stroke-width="2" /></svg>
            </div>
            <div>
              <div style="font-weight:600">Observabilité totale</div>
              <div class="nf-fdesc">Métriques, logs et traces — en direct.</div>
            </div>
          </div>
          <div class="nf-feature">
            <div class="nf-ficon">
              <!-- bouclier -->
              <svg viewBox="0 0 24 24"><path d="M12 2 5 5v6c0 5 3.5 8.5 7 11 3.5-2.5 7-6 7-11V5l-7-3z" /></svg>
            </div>
            <div>
              <div style="font-weight:600">Zero Trust</div>
              <div class="nf-fdesc">Sécurité par défaut, vos données protégées.</div>
            </div>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; position:relative">
          <span style="font-size:12px; color:rgba(255,255,255,.65)">
            Nodefony 10 · licence CeCILL-B
          </span>
          <a
            href="https://github.com/nodefony/nodefony-core"
            target="_blank"
            rel="noreferrer noopener"
            style="font-size:12px; color:rgba(255,255,255,.7)"
          >
            GitHub
          </a>
        </div>
      </aside>

      <!-- ── Preuves interactives — TON app tourne ────────────────────────── -->
      <main class="nf-main">
        <header class="nf-fwhead">
          <!-- Logo officiel Angular — SVG inline (aucun asset externe). -->
          <svg
            class="nf-fwlogo"
            viewBox="0 0 250 250"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Angular"
          >
            <polygon points="125,30 31.9,63.2 46.1,186.3 125,230 203.9,186.3 218.1,63.2" fill="#dd0031" />
            <polygon points="125,30 125,52.2 125,153.4 125,230 203.9,186.3 218.1,63.2" fill="#c3002f" />
            <path d="M125,52.1 66.8,182.6 88.5,182.6 100.2,153.4 149.6,153.4 161.3,182.6 183,182.6 Z M142,135.4 108,135.4 125,94.5 Z" fill="#fff" fill-rule="evenodd" />
          </svg>
          <div>
            <h1>Votre app est en ligne.</h1>
            <span class="nf-fwbadge">Angular v{{ ngVersion }} · Vite + AnalogJS</span>
          </div>
<% if (it.complete) { %>          <!-- Réponse de la route PROTÉGÉE — visible uniquement session ouverte. -->
          @if (secureData(); as s) {
            <span class="nf-hello">👋 {{ s.message }}</span>
          }
<% } %>        </header>
        <p class="nf-dim">
          <%= it.complete ? "Quatre" : "Trois" %> preuves interactives — édite
          <code>frontend/src/app/app.component.ts</code>, Vite recompile à la volée.
        </p>

        <div class="nf-card">
<% if (it.complete) { %>          <h2>1. Backend HTTP — <code>GET {{ secureData() ? "/api/secure/hello" : "/api/hello" }}</code></h2>
<% } else { %>          <h2>1. Backend HTTP — <code>GET /api/hello</code></h2>
<% } %>          @if (error(); as e) {
            <pre style="color:crimson">{{ e }}</pre>
          } @else if (data(); as d) {
            <pre>{{ stringify(<%= it.complete ? "secureData() ?? d" : "d" %>) }}</pre>
          } @else {
            <p>loading…</p>
          }
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
          @if (data()?.who && data()?.who !== "anonyme") {
            <span style="margin-right:8px">connecté — <strong>{{ data()?.who }}</strong></span>
            <button (click)="doLogout()">Se déconnecter</button>
          } @else {
            <input #user value="admin" autocomplete="username" aria-label="utilisateur" />
            <input
              #pass
              type="password"
              value="admin"
              autocomplete="current-password"
              aria-label="mot de passe"
              (keydown.enter)="doLogin(user.value, pass.value)"
            />
            <button (click)="doLogin(user.value, pass.value)">Se connecter</button>
          }
          @if (authMsg(); as m) {
            <p class="nf-dim">{{ m }}</p>
          }
        </div>
<% } %>
<% if (it.complete) { %>        <div class="nf-card">
          <h2>3. Temps réel — la socket Nodefony</h2>
          <p class="nf-dim">
            <code>LiveController</code> (<code>--kind realtime</code>) publie le
            canal <code>live:ticker</code> (1 tick/s tant qu'un client est
            abonné) ; la page le consomme par la façade
            <code>RealtimeClient</code> — zéro <code>WebSocket</code> à la main.
          </p>
          <p>
            état : <strong>{{ liveState() }}</strong>
            @if (tick(); as t) {
              <span> · tick <strong>#{{ t.n }}</strong> (pid {{ t.pid }})</span>
            }
          </p>
          <button (click)="doPing()">RPC live:ping</button>
          @if (pingMs(); as ms) {
            <span class="nf-dim"> pong en {{ ms }} ms</span>
          }
        </div>
<% } else { %>        <div class="nf-card">
          <h2>2. WebSocket — MÊME controller que le HTTP</h2>
          <p class="nf-dim">
            <code>HelloController</code> porte la route GET <em>et</em> la route
            WEBSOCKET : un seul pipeline (firewall, audit, logs).
          </p>
          <input
            #wsIn
            value="ping"
            (keydown.enter)="sendWs(wsIn.value)"
            aria-label="message à envoyer"
          />
          <button (click)="sendWs(wsIn.value)">Envoyer en WS</button>
          <pre>{{ wsLog().join("\\n") || "(envoie un message)" }}</pre>
        </div>
<% } %>

        <div class="nf-card">
          <h2><%= it.complete ? 4 : 3 %>. ♻️ HMR check</h2>
          <button (click)="count.set(count() + 1)">count is {{ count() }}</button>
          <p class="nf-dim">
            Édite <code>frontend/src/app/app.component.ts</code> — Vite
            recompile à la volée. (Angular re-render le composant : l'état
            peut se réinitialiser.)
          </p>
        </div>

<% if (it.complete) { %>        <p class="nf-dim">
          Console d'administration : <a href="/nodefony">/nodefony</a> (Studio, en dev)
        </p>
<% } %>      </main>
    </div>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  readonly ngVersion = VERSION.full;
  readonly logo = NODEFONY_LOGO;
  data = signal<ApiData | null>(null);
  error = signal<string | null>(null);
  count = signal(0);
<% if (it.complete) { %>  authMsg = signal<string | null>(null);
  secureData = signal<SecureData | null>(null);
  liveState = signal(live.socket.state);
  tick = signal<Tick | null>(null);
  pingMs = signal<number | null>(null);
  // Disposers des listeners locaux — rendus au ngOnDestroy (HMR détruit le composant).
  #offLive: (() => void)[] = [];
<% } else { %>  wsLog = signal<string[]>([]);
  #ws: WebSocket | null = null;
<% } %>  stringify = (v: unknown) => JSON.stringify(v, null, 2);

  // Rappelé après login/logout : la zone firewall `main` (^/api) résout
  // l'identité par requête → `who` change sans recharger la page.
  refreshHello() {
    fetch("/api/hello")
      .then((r) => r.json())
      .then((j: { result?: ApiData } & ApiData) => {
        const d = (j.result ?? j) as ApiData; // Nodefony wrappe `{ result }`
        this.data.set(d);
<% if (it.complete) { %>        // Connecté → la route PROTÉGÉE prend le relais (zone `secure`,
        // ^/api/secure : sans session le firewall répond 401 avant le controller).
        if (d.who && d.who !== "anonyme") {
          fetch("/api/secure/hello", { credentials: "same-origin" })
            .then((r) => (r.ok ? r.json() : null))
            .then((s: ({ result?: SecureData } & SecureData) | null) => {
              this.secureData.set(s ? ((s.result ?? s) as SecureData) : null);
            })
            .catch(() => this.secureData.set(null));
        } else {
          this.secureData.set(null);
        }
<% } %>      })
      .catch((e: unknown) => {
        this.error.set(e instanceof Error ? e.message : String(e));
      });
  }
<% if (it.complete) { %>
  // Flux session BFF du framework (cookie opaque HttpOnly — le front ne voit
  // jamais de token) : mêmes endpoints que le login de la console /nodefony.
  async doLogin(username: string, password: string) {
    this.authMsg.set(null);
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
      this.authMsg.set("identifiants invalides");
      return;
    }
    const u = j.result?.user ?? j.user;
    this.authMsg.set(`session ouverte — ${u?.username ?? username}`);
    this.refreshHello();
  }

  async doLogout() {
    await fetch("/nodefony/security/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    this.authMsg.set("session fermée");
    this.refreshHello();
  }
<% } %>
  ngOnInit() {
    this.refreshHello();
<% if (it.complete) { %>
    // Un observateur = un rappel + une libération. L'abonnement serveur est
    // ref-compté et REJOUÉ à chaque (re)connexion, `start()` est idempotent, et
    // rien ne coupe la socket au ngOnDestroy : elle appartient à la PAGE. Ces
    // règles vivent dans `nodefony/client`, pas ici — c'est ce qui les garde
    // identiques en React, Vue, Angular et Svelte.
    this.#offLive.push(
      observeState(live.socket, (state) => this.liveState.set(state)),
    );
    this.#offLive.push(
      observeChannelData<Tick>(live.socket, "live:ticker", (t) =>
        this.tick.set(t),
      ),
    );
    live.start();
<% } else { %>
    // WS même origine que la page (ws en http, wss en https).
    // ⚠ Echo BRUT = démo du pipeline HTTP/WS partagé, pas un modèle : pour du
    // WS métier, génère la bonne couche (`nodefony create controller <nom>
    // --kind realtime`) et consomme-la par la FAÇADE client (`RealtimeClient`)
    // au lieu d'un `new WebSocket` à la main.
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/echo`);
    socket.addEventListener("message", (ev: MessageEvent) => {
      this.wsLog.update((log) => [...log.slice(-4), `← ${String(ev.data)}`]);
    });
    socket.addEventListener("error", () => {
      this.wsLog.update((log) => [...log, "⚠ connexion WS impossible"]);
    });
    this.#ws = socket;
<% } %>  }

  ngOnDestroy() {
<% if (it.complete) { %>    // HMR/full-reload détruit le composant : on libère les observateurs, ce
    // qui rend aussi l'abonnement — la socket PARTAGÉE reste ouverte.
    for (const off of this.#offLive) off();
    this.#offLive = [];
<% } else { %>    // HMR/full-reload détruit le composant : fermer une socket encore en
    // CONNECTING lève un warning navigateur (« closed before the connection
    // is established ») — on attend l'open pour fermer proprement.
    const socket = this.#ws;
    this.#ws = null;
    if (!socket) return;
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.addEventListener("open", () => socket.close());
    } else {
      socket.close();
    }
<% } %>  }
<% if (it.complete) { %>
  async doPing() {
    const t0 = performance.now();
    await live.socket.request("live:ping", {});
    this.pingMs.set(Math.round(performance.now() - t0));
  }
<% } else { %>
  sendWs(msg: string) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(msg);
      this.wsLog.update((log) => [...log.slice(-4), `→ ${msg}`]);
    }
  }
<% } %>}
