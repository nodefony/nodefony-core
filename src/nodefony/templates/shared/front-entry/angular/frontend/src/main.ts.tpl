import { bootstrapApplication } from "@angular/platform-browser";
import { CSP_NONCE, provideZonelessChangeDetection } from "@angular/core";
// Angular pose les styles de ses composants en `<style>` à l'exécution : sous la
// politique de styles par défaut (`style-src 'nonce-…'`), chacun doit porter le
// nonce que la page annonce (`<meta property="csp-nonce">`), sinon il est bloqué.
import { readCspNonce } from "nodefony/client";
import { AppComponent } from "./app/app.component";

// Zoneless (Angular 20+) : pas de zone.js, détection pilotée par signals.
bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    { provide: CSP_NONCE, useValue: readCspNonce() ?? null },
  ],
}).catch((err: unknown) => console.error(err));
