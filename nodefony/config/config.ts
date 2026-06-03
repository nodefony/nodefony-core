/**
 * NODEFONY FRAMEWORK — Configuration KERNEL de l'application (INDEX).
 *
 * Ce fichier ASSEMBLE la config de l'app à partir des domaines découpés à côté :
 *   - `./app`      → identité, locale, templating, ORM, packaging
 *   - `./servers`  → domaine d'écoute, filtrage Host, serveurs HTTP/HTTPS/WS/WSS, devServer
 *   - `./log`      → observabilité (Syslog + log backplane), via `./env`
 *   - `./cluster/cluster.config` → topologie / nombre de workers (cloud-native)
 *   - `./modules`  → manifeste ordonné des modules chargés
 *   - `./modules/<m>-config` → surcharges des configs DEFAULT de chaque module
 *
 * SURCHARGE PAR ENVIRONNEMENT :
 *   Les valeurs des domaines sont des DEFAULTS. Pour différencier
 *   `development` / `production` / un environnement de déploiement (`staging`…),
 *   créer des fichiers `config.production.ts` / `config.staging.ts` à côté de
 *   celui-ci, ou utiliser des getters lazy. NE JAMAIS déréférencer le kernel
 *   (`Nodefony.getKernel()`) au top-level d'un de ces fichiers (crash à l'import).
 */
import http from "./modules/http-config";
import sequelize from "./modules/sequelize-config";
// import mongoose from "./modules/mongoose-config"; // décommenter avec @nodefony/mongoose (index.ts)
import cluster from "./cluster/cluster.config";
import security from "./modules/security-config";
import modules from "./modules";
import { watch, locale, App, templating, orm, packageManager } from "./app";
import {
  domain,
  domainAlias,
  domainCheck,
  servers,
  devServer,
} from "./servers";
import { log } from "./log";

const config = {
  // Manifeste des modules de l'app (liste ordonnée + policy + gating), résolu et
  // chargé par le Kernel à `onPreRegister`. Seule source de vérité du chargement
  // (remplace le décorateur `@modules`). Cf `project_module_loading_architecture`.
  modules,

  // ── Application (cf ./app) ──
  watch,
  locale,
  App,
  templating,
  orm,
  packageManager,

  // ── Réseau (cf ./servers) ──
  domain,
  domainAlias,
  domainCheck,
  servers,
  devServer,

  // ── Topologie / cluster (cf ./cluster/cluster.config) ──
  // Override runtime : CLI `--workers` > env `NODEFONY_WORKERS` > ce fichier.
  // `development` est TOUJOURS mono-process (Vite exige 1 maître).
  cluster,

  // ── Observabilité (cf ./log + ./env) ──
  log,

  /*
   *   OVERRIDES MODULES — surcharge des configs DEFAULT de chaque module.
   *   Les fichiers `./modules/<module>-config.ts` portent les valeurs
   *   spécifiques à cette app. La fusion est récursive (deep merge).
   *
   *   Pour surcharger une option d'un module :
   *     1. Modifier directement `./modules/<module>-config.ts`
   *     2. OU étendre ici en spread :
   *        "module-http": { ...http, formidable: { uploadDir: "/var/upload" } }
   */
  "module-http": http,
  "module-sequelize": sequelize,
  // "module-mongoose" retiré : @nodefony/mongoose n'est pas chargé (cf ./modules).
  // Décommenter ICI ET dans ./modules pour réactiver mongoose.
  // "module-mongoose": mongoose,
  "module-security": security,
  // Backplane realtime = driver `cluster` (IPC intra-pod, master relay) par DÉFAUT :
  // ZÉRO dépendance externe. Mono-process → hub local (factory → null) ; cluster
  // (`--workers N`) → fan-out IPC entre workers du même pod. Redis (`driver:"redis"`
  // + REDIS_PASSWORD) = OPT-IN pour le fan-out CROSS-pod multi-host (Phase 16).
  // Pourquoi pas redis par défaut : exiger Redis faisait planter le boot cluster en
  // storm NOAUTH (RedisService lazy → 0 connexion tant que personne ne demande un
  // client ; avec driver redis, le backplane en demandait un → storm si Redis KO).
  "module-realtime": { backplane: { driver: "cluster" } },
};

export default config;
