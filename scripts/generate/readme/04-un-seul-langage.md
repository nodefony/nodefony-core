## Un seul langage, du serveur au navigateur

Le client n'est pas une bibliothèque à part, publiée séparément et rattrapée à chaque version : il
est **dans le même paquet que le serveur**, et il partage ses types. Le contrat d'un canal, la forme
d'un message, la hiérarchie des rôles — on les écrit une fois, et les deux côtés en dépendent :

```typescript
import { NodefonySocket } from "nodefony/client";

const socket = NodefonySocket.shared({ url: "wss://localhost:5152" });

await socket.subscribe("chat:room"); // canaux
socket.on("chat:room", (message) => render(message));

const modules = await socket.get("/nodefony/kernel/api/modules"); // appel de service
```

Les mêmes sous-chemins servent le reste : `nodefony/react` pour les hooks, `nodefony/roles` pour
évaluer une autorisation dans l'interface **avec la règle exacte du serveur** — un bouton caché parce
que le rôle manque est caché par la même logique que celle qui refusera l'appel.

> **Pourquoi TypeScript, et pas un portage vers un langage plus rapide ?** Parce que l'isomorphisme
> se paierait exactement là. Réécrire le cœur ailleurs ferait gagner des microsecondes et perdre la
> seule chose qu'un framework fullstack peut vraiment offrir : un contrat unique, vérifié par le
> compilateur, du contrôleur jusqu'au composant. Ce qui coûte cher dans une application temps réel,
> ce n'est pas le langage — c'est la frontière entre deux mondes qui doivent se redire la même chose
> et finissent par diverger. Nodefony supprime la frontière plutôt que d'optimiser le passage.
