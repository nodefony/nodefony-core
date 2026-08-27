import { bootstrapApplication } from "@angular/platform-browser";
import { provideZonelessChangeDetection } from "@angular/core";
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
    provideNodefony({ url: "/api/live/realtime" }),
  ],
}).catch((err) => console.error(err));
