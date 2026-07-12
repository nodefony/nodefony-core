import { Component, OnInit, signal } from "@angular/core";

interface ApiData {
  hello: string;
  pid: number;
}

/**
 * Composant racine standalone (zoneless). `/api` est proxifié vers Nodefony
 * par `apiProxyPaths` (cf registerEntry) — sans lui, Vite répondrait son
 * SPA-fallback HTML au lieu du JSON.
 */
@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <main style="font-family: system-ui; padding: 24px">
      <h1><%= it.appName %></h1>
      <p>Angular (standalone, zoneless) + Vite servi par Nodefony.</p>
      @if (error(); as e) {
        <pre style="color:crimson">{{ e }}</pre>
      } @else if (data(); as d) {
        <pre>{{ stringify(d) }}</pre>
      } @else {
        <p>loading…</p>
      }
    </main>
  `,
})
export class AppComponent implements OnInit {
  data = signal<ApiData | null>(null);
  error = signal<string | null>(null);
  stringify = (v: unknown) => JSON.stringify(v, null, 2);
  async ngOnInit() {
    try {
      const r = await fetch("/api/hello");
      const j = (await r.json()) as { result?: ApiData } & ApiData;
      this.data.set((j.result ?? j) as ApiData); // Nodefony wrappe `{ result }`
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
}
