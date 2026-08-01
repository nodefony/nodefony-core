# MEMORY.md — @nodefony/devkit

> Internals pour une IA en cours de session. Ultra-concis, zéro prose, zéro
> date : ce fichier décrit la vérité COURANTE du code — l'historique est dans
> `git log`. Mettre à jour = éditer la section concernée EN PLACE.

## Purpose

Porte **HTTP** de la carte de visite d'une application (qui répond, ce qui est
chargé, où lire, quoi lancer). Module `policy: "dev"` — absent en prod. La porte
CLI de la même carte vit au CŒUR (`nodefony card`), parce qu'elle doit répondre
sans ce module.

## Core Components

| Symbole              | Fichier                                 | Rôle                                                 |
| -------------------- | --------------------------------------- | ---------------------------------------------------- |
| `DevkitModule`       | `index.ts`                              | `@services` + `@controllers` — AUCUNE commande CLI   |
| `buildCard`          | `nodefony/src/card.ts`                  | ré-export du cœur (`nodefony` → `cli/cardReport.ts`) |
| `DevkitService`      | `nodefony/service/DevkitService.ts`     | `getCard()` — dérive du Kernel, `source: "runtime"`  |
| `DevkitController`   | `nodefony/controllers/DevkitController` | `GET /nodefony/devkit/api/card` — mince, délègue     |
| `devkitConfigSchema` | `nodefony/config/config.ts`             | `{ enabled }` — source unique des défauts            |
| `defineDevkitConfig` | `nodefony/config/defineModuleConfig.ts` | parse + freeze au boot                               |
| `DevkitError`        | `nodefony/src/errors/DevkitError.ts`    | erreurs typées du module                             |

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

- **La CLI ne passe PAS par ce module** : `nodefony card` (alias `devkit:card`)
  est un fast-path standalone du cœur (`CliKernel.start`), 0 boot. Motif : porté
  ici, il n'existait pas hors développement (`policy: "dev"` ⇒ « unknown
  command ») et le Kernel refusait de démarrer sur une app non construite — les
  deux situations où l'on cherche justement la carte.
- **Cette porte-ci est la SEULE qui connaisse les modules CHARGÉS**
  (`source: "runtime"`). La CLI répond à froid : modules INSTALLÉS, et elle le
  dit.
- **La route est derrière le pare-feu** dans toute app portant
  `@nodefony/security` (préfixe `/nodefony` = zone admin) → 401 sans session.
  C'est voulu ; la porte utilisable par un agent est la CLI (`nodefony card`).
- **Aucune garde `@IsGranted`** sur le controller : l'ajouter imposerait
  `@nodefony/security` à toute app qui installe le devkit, y compris celles sans
  firewall. C'est la `policy` qui protège, pas un rôle.
- Une porte de plus se branche sur `buildCard` (dans le cœur, exporté par
  `nodefony`), jamais sur le service : la brique pure est le point de
  réutilisation.
- La clé de CONTENEUR (`super("devkit", …)`) n'est pas le nom de la CLASSE :
  `container.get("devkit")`.
