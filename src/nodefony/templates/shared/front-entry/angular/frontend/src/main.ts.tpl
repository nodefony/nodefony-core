import { bootstrapApplication } from "@angular/platform-browser";
import { provideZonelessChangeDetection } from "@angular/core";
<% if (it.complete) { %>// La politique temps réel du framework s'installe comme tout le reste en
// Angular : un FOURNISSEUR d'injection. C'est ici, et ici seulement, que
// l'adresse du serveur est écrite — les composants n'en connaissent aucune, et
// le framework n'en devine aucune : une adresse devinée marche en développement
// et se trompe en production. Le fournisseur ouvre la connexion HORS ZONE.
import { provideNodefony } from "nodefony/angular";
<% } %>import { AppComponent } from "./app/app.component";

// Zoneless (Angular 20+) : pas de zone.js, détection pilotée par signals.
bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
<% if (it.complete) { %>    provideNodefony({ url: "/api/live/realtime" }),
<% } %>  ],
}).catch((err) => console.error(err));
