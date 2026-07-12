import {
  Component,
  OnDestroy,
  OnInit,
  VERSION,
  ViewEncapsulation,
  signal,
} from "@angular/core";
import { NODEFONY_LOGO } from "../brand";

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
        <div class="nf-card">
          <h2><%= it.complete ? 3 : 2 %>. WebSocket — MÊME controller que le HTTP</h2>
          <p class="nf-dim">
            <code>HelloController</code> porte la route GET <em>et</em> la route
            WEBSOCKET : un seul pipeline (firewall, audit, logs).
          </p>
          <input #wsIn value="ping" (keydown.enter)="sendWs(wsIn.value)" />
          <button (click)="sendWs(wsIn.value)">Envoyer en WS</button>
          <pre>{{ wsLog().join("\\n") || "(envoie un message)" }}</pre>
        </div>

        <div class="nf-card">
          <h2><%= it.complete ? 4 : 3 %>. ♻️ HMR check</h2>
          <button (click)="count.set(count() + 1)">count is {{ count() }}</button>
          <p class="nf-dim">
            Édite <code>frontend/src/app/app.component.ts</code> — Vite
            recompile à la volée. (Angular re-render le composant : l'état
            peut se réinitialiser.)
          </p>
        </div>

        <p class="nf-dim">
          Console d'administration : <a href="/nodefony">/nodefony</a> (Studio, en dev)
        </p>
      </main>
    </div>
  `,
  styles: [
    `
      app-root { display: block; }
      body { margin: 0; }
      :root { --nf-bg:#f7f9fc; --nf-fg:#1a1f26; --nf-card:#fff; --nf-border:#e2e8f0; --nf-dim:#5b6472; }
      @media (prefers-color-scheme: dark) {
        :root { --nf-bg:#12161c; --nf-fg:#e8ecf1; --nf-card:#1a2028; --nf-border:#2a3340; --nf-dim:#98a2b3; }
      }
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
                   filter:drop-shadow(0 6px 14px rgba(221,0,49,.28));
                   animation:nf-pulse 4s ease-in-out infinite; }
      @keyframes nf-pulse { 0%, 100% { transform:scale(1); } 50% { transform:scale(1.07); } }
      .nf-fwbadge { display:inline-block; margin-top:4px; padding:2px 10px; border-radius:999px;
                    font-size:12.5px; font-weight:600; color:#dd0031;
                    background:rgba(221,0,49,.10); border:1px solid rgba(221,0,49,.30); }
      .nf-hello { margin-left:auto; padding:7px 16px; border-radius:999px; font-weight:700;
                  font-size:15px; color:#2ea043; white-space:nowrap;
                  background:rgba(46,160,67,.12); border:1px solid rgba(46,160,67,.35); }
      a { color:#0a79d6; }
      @media (max-width: 920px) { .nf-split { flex-direction:column; } .nf-hero { padding:32px 24px; } }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  readonly ngVersion = VERSION.full;
  readonly logo = NODEFONY_LOGO;
  data = signal<ApiData | null>(null);
  error = signal<string | null>(null);
  count = signal(0);
  wsLog = signal<string[]>([]);
<% if (it.complete) { %>  authMsg = signal<string | null>(null);
  secureData = signal<SecureData | null>(null);
<% } %>  #ws: WebSocket | null = null;
  stringify = (v: unknown) => JSON.stringify(v, null, 2);

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

    // WS même origine que la page (ws en http, wss en https).
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/api/echo`);
    socket.addEventListener("message", (ev: MessageEvent) => {
      this.wsLog.update((log) => [...log.slice(-4), `← ${String(ev.data)}`]);
    });
    socket.addEventListener("error", () => {
      this.wsLog.update((log) => [...log, "⚠ connexion WS impossible"]);
    });
    this.#ws = socket;
  }

  ngOnDestroy() {
    // HMR/full-reload détruit le composant : fermer une socket encore en
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
  }

  sendWs(msg: string) {
    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(msg);
      this.wsLog.update((log) => [...log.slice(-4), `→ ${msg}`]);
    }
  }
}
