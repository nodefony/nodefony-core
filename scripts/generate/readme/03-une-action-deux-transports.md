## Une action, deux transports

Ce contrôleur est celui que `nodefony create controller` produit. La première action répond en REST ;
la seconde est un point d'entrée WebSocket. Même classe, même session, mêmes règles d'accès :

```typescript
import {
  route,
  controller,
  Controller,
  CurrentUser,
} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

@controller("/api/blog")
class BlogController extends Controller {
  constructor(context: ContextType) {
    super("blog", context);
  }

  @route("blog-index", { path: "", method: "GET" })
  async index(@CurrentUser() user?: { identifier?: string }) {
    return this.renderJson({
      hello: "blog",
      who: user?.identifier ?? "anonyme",
    });
  }

  // Même classe, même décorateur : seul le transport déclaré change.
  @route("blog-echo", {
    path: "/echo",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async echo(message: string | Buffer | null) {
    if (!message) return this.renderJson({ handshake: true });
    return this.renderJson({ echo: message.toString() });
  }
}
```

<details>
<summary><b>Ce que ça implique sous le capot</b> — pourquoi ce n'est pas du sucre syntaxique</summary>

- La pseudo-méthode `WEBSOCKET` est traitée comme un verbe HTTP ordinaire : **une seule table de
  routes** pour les deux transports, un seul résolveur de contrôleur.
- Le WebSocket ouvre **la même bulle `AsyncLocalStorage`** que le HTTP et la propage à chaque
  message : l'identifiant de requête et l'utilisateur restent stables du handshake à la fermeture.
- Conséquence directe : une règle d'autorisation protège une action **quel que soit le transport**,
  et une session ouverte en HTTP est celle que voit la socket. Pas de passerelle, pas de seconde
  pile d'authentification, pas de logique dupliquée.
- C'est aussi ce qui fait du **streaming** — d'un fichier, d'un événement, d'un modèle de langage —
  un cas d'usage naturel plutôt qu'un montage : un générateur asynchrone branché sur un canal, dans
  le même contexte de sécurité que le reste de l'application.

</details>
