import { Component, OnDestroy, OnInit, VERSION, signal } from "@angular/core";

interface ApiData {
  ts: number;
  pid: number;
  env: string;
}

@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <main class="page">
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

        <h1>You did it!</h1>
        <p class="subtitle">
          Angular&nbsp;21 (standalone, zoneless) transpilé par
          <strong>&#64;nodefony/frontend</strong> via Vite + AnalogJS —
          multi-framework aux côtés des bundles React &amp; Vue, même
          superviseur.
        </p>

        <div class="badges">
          <span class="badge badge--ng">Angular v{{ ngVersion }}</span>
          <span class="badge">Vite + AnalogJS</span>
          @if (data(); as d) {
            <span class="badge">env: {{ d.env }}</span>
          }
        </div>
      </div>

      <div class="cards">
        <section class="card">
          <h2>♻️ HMR check</h2>
          <button class="counter" (click)="increment()">
            count is {{ count() }}
          </button>
          <p class="hint">
            Édite <code>frontend/src/app/app.component.ts</code> — Vite
            recompile. (Angular re-render le composant : l'état peut se
            réinitialiser.)
          </p>
        </section>

        <section class="card">
          <h2>🔌 Backend ping</h2>
          <code class="route">GET /angular/api/data</code>
          @if (error(); as e) {
            <pre class="out out--err">{{ e }}</pre>
          } @else if (data(); as d) {
            <pre class="out">{{ stringify(d) }}</pre>
          } @else {
            <p class="hint">loading…</p>
          }
        </section>
      </div>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .page {
        min-height: 100vh;
        margin: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2.5rem;
        padding: 4rem 1.5rem;
        box-sizing: border-box;
        font-family:
          "Inter",
          system-ui,
          -apple-system,
          sans-serif;
        color: #2c2c2c;
        background:
          radial-gradient(
            1200px 600px at 50% -10%,
            rgba(221, 0, 49, 0.14),
            transparent
          ),
          #fbf7f8;
      }
      .hero {
        text-align: center;
        max-width: 640px;
      }
      .logo {
        width: 96px;
        height: auto;
        filter: drop-shadow(0 8px 18px rgba(221, 0, 49, 0.22));
        animation: pulse 4s ease-in-out infinite;
      }
      @keyframes pulse {
        0%,
        100% {
          transform: scale(1);
        }
        50% {
          transform: scale(1.06);
        }
      }
      h1 {
        margin: 1.2rem 0 0.6rem;
        font-size: 2.6rem;
        font-weight: 800;
        background: linear-gradient(120deg, #dd0031, #c3002f);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .subtitle {
        margin: 0 auto;
        font-size: 1.05rem;
        line-height: 1.6;
        color: #5b4b4d;
      }
      .badges {
        margin-top: 1.4rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;
        justify-content: center;
      }
      .badge {
        padding: 0.32rem 0.85rem;
        border-radius: 999px;
        font-size: 0.85rem;
        font-weight: 600;
        background: #f3e3e6;
        color: #c3002f;
        border: 1px solid #ecd2d7;
      }
      .badge--ng {
        background: #dd0031;
        color: #fff;
        border-color: #dd0031;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.25rem;
        width: 100%;
        max-width: 760px;
      }
      .card {
        background: #fff;
        border: 1px solid #efe1e3;
        border-radius: 16px;
        padding: 1.4rem 1.5rem;
        box-shadow: 0 10px 30px rgba(221, 0, 49, 0.06);
      }
      .card h2 {
        margin: 0 0 1rem;
        font-size: 1.15rem;
      }
      .counter {
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        padding: 0.6rem 1.1rem;
        border-radius: 10px;
        border: 1px solid #dd0031;
        background: #dd0031;
        color: #fff;
        transition:
          transform 0.08s ease,
          box-shadow 0.2s ease;
      }
      .counter:hover {
        box-shadow: 0 6px 16px rgba(221, 0, 49, 0.35);
      }
      .counter:active {
        transform: translateY(1px);
      }
      .hint {
        margin: 0.9rem 0 0;
        font-size: 0.9rem;
        color: #7a6b6d;
      }
      .route {
        display: inline-block;
        margin-bottom: 0.6rem;
        font-size: 0.85rem;
        color: #c3002f;
      }
      .out {
        margin: 0;
        padding: 0.8rem 1rem;
        border-radius: 10px;
        background: #1c1117;
        color: #fca5b6;
        font-size: 0.85rem;
        overflow: auto;
      }
      .out--err {
        background: #fef2f2;
        color: #b91c1c;
      }
      code {
        font-family: "JetBrains Mono", ui-monospace, monospace;
        background: rgba(221, 0, 49, 0.08);
        padding: 0.1rem 0.35rem;
        border-radius: 5px;
      }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  readonly ngVersion = VERSION.full;
  readonly count = signal(0);
  readonly data = signal<ApiData | null>(null);
  readonly error = signal<string | null>(null);
  private timer?: ReturnType<typeof setInterval>;

  private async tick(): Promise<void> {
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

  ngOnInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
