# AGENTS.md — @nodefony/devkit

> Instructions agent de CE module. Standard AGENTS.md : **le fichier le plus
> proche gagne** — quand tu travailles dans ce dossier, il prime sur celui de
> l'app. Vérité COURANTE, jamais un journal : pas de dates, pas de TODO ni
> d'historique (ça vit dans `git log`) ; un fait périmé se CORRIGE.

## Rôle

Outillage de développement d'une application Nodefony : carte de visite, portes
de découverte, et le CONTENU des skills d'agent distribués par npm.

## Composants

- `index.ts` — `DevkitModule extends Module`, nom kernel `devkit`. Valide sa config à `onKernelRegister`.
- `DevkitService` — `@injectable`, nom `devkit`. Se récupère par `container.get("devkit")`.
- `nodefony/config/config.ts` — schéma Zod = **source unique des défauts**. `defineModuleConfig.ts` = builder pur (valide et gèle, ne retape jamais une valeur).
- `skills/<nom>/SKILL.md` — les skills d'agent, publiés tels quels (`files`).
  Du CONTENU : ni import, ni build, ni enregistrement. Ils sont posés chez
  l'utilisateur en POINTEURS par `nodefony ai:sync` (verbe porté par le CŒUR) et
  par `nodefony create app` à la création.

## Config

| Clé       | Type      | Défaut |
| --------- | --------- | ------ |
| `enabled` | `boolean` | `true` |

Chargement : `use("@nodefony/devkit", {}, { policy: "dev" })` dans le
`nodefony.config.ts` de l'app. Config invalide → boot FATAL, champ nommé.

## Décisions figées

- **La logique vit dans le service**, pas dans les controllers : un controller
  traduit du HTTP/WS, un service est réutilisable (CLI, job, autre module).
- **Jamais `Nodefony.getKernel()` au top-level** d'un fichier chargé à l'import :
  le module deviendrait impossible à importer — donc à tester — sans serveur.
- Workspace npm (`src/packages/@nodefony/devkit/` dans ce dépôt) : le Kernel
  charge le module PAR SON NOM → il doit rester résolvable (symlink npm
  workspaces).
- **Un skill s'édite ICI et part par `npm update`** — jamais recopié dans une
  application : une recette copiée décrit six mois plus tard un framework qui a
  changé, et rien ne casse, donc personne ne le voit. Ses chemins de lecture
  visent `node_modules/…`, jamais `src/packages/…` (inexistant chez
  l'utilisateur).
- **Le container DI est PROTOTYPAL** : un service posé ici est visible du
  kernel ENTIER et de chaque scope de requête (chaîne de prototypes, zéro
  copie par requête) ; ce qu'un scope `set()` meurt avec sa requête. Ni cache
  de services maison, ni singleton maison — `container.get("<nom>")` EST le
  mécanisme. Réf : `node_modules/nodefony/docs/service.md`.
- **Isomorphisme** : pour tout code NAVIGATEUR de ce module, le client temps
  réel et les types du protocole s'importent du cœur (`nodefony`,
  `nodefony/client`, `nodefony/react`) — jamais un client WS à la main, jamais
  un type dupliqué front/back. Réf : `node_modules/nodefony/docs/client.md`.
- **WS métier = socket Nodefony** : `nodefony create controller <nom>
--kind realtime --module devkit` (canaux + actions RPC + policies) —
  l'echo WS brut des exemples est une démo du pipeline, pas un modèle.

## Interdits sans accord

- Modifier `rolldown.config.ts` / `tsconfig.json`.
- Ajouter une dépendance npm runtime sans en peser le coût.
- Allouer par requête ce qui ne sert qu'à une minorité de requêtes (préférer
  `null` + init au premier usage), ou attacher un listener sans prévoir son retrait.

## Gotchas

- Ne pas redéclarer `options` dans le service (la classe `Service` l'assigne via `super()`).
- Ajouter un controller/front : `nodefony create controller|front <nom> --module devkit` (câble l'`index.ts` seul).
- Ajouter une commande CLI : `nodefony create command <action> --module @nodefony/devkit` → `nodefony devkit:<action>` (le préfixe est ajouté seul, le `this.addCommand(…)` aussi).
- Ajouter un service : `nodefony create service <Nom> --module @nodefony/devkit` (câble le `@services([…])` seul). Un service Nodefony est `@injectable()` + `extends Service` — une classe à méthodes `static` compile mais reste invisible au conteneur.
- Build : `rolldown` → `dist/index.js` (chargé par le Kernel). En dev, le superviseur rebuild tout seul.

## Gates avant commit

```bash
npm run typecheck && npm test && npm run build
```
