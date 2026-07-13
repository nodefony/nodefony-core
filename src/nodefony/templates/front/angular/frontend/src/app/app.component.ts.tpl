import { Component, VERSION, signal } from "@angular/core";

/**
 * Page « <%= it.kebab %> » — squelette VOLONTAIREMENT minimal : c'est TA page,
 * pas une vitrine. Le compteur prouve la recompilation Vite (AnalogJS). Les
 * appels backend passent par `fetch("/api/…")` (proxifiés vers Nodefony en
 * dev, cf `apiProxyPaths` du registerEntry).
 */
@Component({
  selector: "app-root",
  standalone: true,
  template: `
    <main style="font-family: system-ui, sans-serif; padding: 32px">
      <h1><%= it.kebab %></h1>
      <p>
        Angular v{{ ngVersion }} servi par Nodefony via Vite + AnalogJS —
        entry « <%= it.kebab %> ».
      </p>
      <button (click)="count.set(count() + 1)">count is {{ count() }}</button>
      <p style="color: #666; font-size: 14px">
        Édite <code>frontend/src/app/app.component.ts</code> — Vite recompile
        à la volée.
      </p>
    </main>
  `,
})
export class AppComponent {
  readonly ngVersion = VERSION.full;
  count = signal(0);
}
