- **Le geste concret avec `nodefony/angular`** — la liaison Angular
  du paquet `nodefony`, résolue à l'identique par Vite, Node et le typecheck.
  La politique s'installe comme tout le reste en Angular : un FOURNISSEUR
  d'injection, posé une seule fois au démarrage. Les fonctions d'injection
  rendent des `Signal`, et libèrent l'abonnement avec le contexte :

```ts
// frontend/src/main.ts — ce que l'entrée générée fait déjà
import { bootstrapApplication } from "@angular/platform-browser";
import { provideNodefony } from "nodefony/angular";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, {
  providers: [provideNodefony({ url: "/api/live/realtime" })],
});
```

```ts
// dans un composant : un signal, lu `last()` dans le gabarit
import { Component } from "@angular/core";
import { injectNodefonyChannelData } from "nodefony/angular";

@Component({ selector: "app-live", template: `<p>{{ last()?.message }}</p>` })
export class LiveComponent {
  last = injectNodefonyChannelData<{ message: string }>("live:events");
}
```

Les autres fonctions (`injectNodefony`, `injectNodefonyState`,
`injectNodefonyIdentity`, `injectNodefonyChannel`) et la connexion hors zone :
`node_modules/nodefony/docs/angular-services.md`.
