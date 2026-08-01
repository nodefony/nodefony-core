# MEMORY.md — @nodefony/devkit

> Internals pour une IA en cours de session. Ultra-concis, zéro prose, zéro
> date : ce fichier décrit la vérité COURANTE du code — l'historique est dans
> `git log`. Mettre à jour = éditer la section concernée EN PLACE.

## Purpose

Carte de visite d'une application (qui répond, ce qui est chargé, où lire, quoi
lancer) et les portes qui la servent. Module `policy: "dev"` — absent en prod.

## Core Components

| Symbole              | Fichier                                 | Rôle                                                        |
| -------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `DevkitModule`       | `index.ts`                              | `@services` + `@controllers` + `addCommand(CardCommand)`    |
| `buildCard`          | `nodefony/src/card.ts`                  | PURE — état injecté → `IDevkitCard`, zéro accès kernel      |
| `DevkitService`      | `nodefony/service/DevkitService.ts`     | `getCard()` — dérive du Kernel, clé conteneur `devkit`      |
| `DevkitController`   | `nodefony/controllers/DevkitController` | `GET /nodefony/devkit/api/card` — mince, délègue            |
| `CardCommand`        | `nodefony/command/CardCommand.ts`       | `nodefony devkit:card [-j]`, `onReady`, `format()` statique |
| `devkitConfigSchema` | `nodefony/config/config.ts`             | `{ enabled }` — source unique des défauts                   |
| `defineDevkitConfig` | `nodefony/config/defineModuleConfig.ts` | parse + freeze au boot                                      |
| `DevkitError`        | `nodefony/src/errors/DevkitError.ts`    | erreurs typées du module                                    |

## Config

- `enabled: boolean = true` — interrupteur.
- Surcharge par l'app : `use("@nodefony/devkit", { … })` · par l'environnement :
  `NF__DEVKIT__<CHEMIN>`.
- Défauts matérialisés par `devkitConfigSchema.parse({})` — ne jamais les retaper.

## Behaviors

- `onKernelRegister` valide la config et réassigne `this.options` AVANT que les
  `@services` ne soient instanciés (`onBoot`).
- `getCard()` ne CACHE rien : recalcul à chaque appel (route de dev appelée à la
  main — un cache mentirait au premier module ajouté).
- Portes conditionnelles : `/nodefony` si le module `studio` est chargé ;
  `/nodefony/documentation/api/tree` si `documentation` l'est. La condition porte
  sur les modules RÉELLEMENT chargés, pas sur le manifeste.
- Deux versions distinctes : `kernel.version` = celle de l'APP,
  `Nodefony.version` = celle du FRAMEWORK.

## Gotchas

- **La commande n'existe pas hors développement** : `policy: "dev"` ⇒ module non
  chargé ⇒ `nodefony devkit:card` rend « unknown command ». Depuis un shell sans
  variable : `NODE_ENV=development npx nodefony devkit:card`.
- **La route est derrière le pare-feu** dans toute app portant
  `@nodefony/security` (préfixe `/nodefony` = zone admin) → 401 sans session.
  C'est voulu ; la porte utilisable par un agent est la CLI.
- **Aucune garde `@IsGranted`** sur le controller : l'ajouter imposerait
  `@nodefony/security` à toute app qui installe le devkit, y compris celles sans
  firewall. C'est la `policy` qui protège, pas un rôle.
- Une porte de plus se branche sur `buildCard` (exporté), jamais sur le service :
  la brique pure est le point de réutilisation.
- La clé de CONTENEUR (`super("devkit", …)`) n'est pas le nom de la CLASSE :
  `container.get("devkit")`.
