import { bootstrapApplication } from "@angular/platform-browser";
import { CSP_NONCE, provideZonelessChangeDetection } from "@angular/core";
// Angular pose les styles de ses composants en `<style>` à l'exécution : sous
// `style-src 'nonce-…'` (ADR-0024 §C2), chacun porte le nonce de la page.
import { readCspNonce } from "nodefony/client";
// La liaison Angular du client temps réel — `nodefony/angular`. La politique
// s'écrit ICI, dans les providers : c'est là qu'une application Angular pose ce
// dont ses composants disposent. Le fournisseur ouvre la connexion HORS ZONE.
import { provideNodefony } from "nodefony/angular";
import { AppComponent } from "./app/app.component";

// Zoneless (Angular 20+) : pas de zone.js, la détection de changement est
// pilotée par les signals → bundle plus léger, pas de polyfill.
bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    { provide: CSP_NONCE, useValue: readCspNonce() ?? null },
    provideNodefony({ url: "/api/live/realtime" }),
  ],
}).catch((err: unknown) => console.error(err));
