import type { IModuleManifest } from "nodefony";

/**
 * Manifeste des modules de l'application.
 *
 * Source de vérité du chargement de modules — lue par le Kernel via
 * `config.modules`, qui la résout (policy + `when` + environnement) puis charge
 * les modules en série à `onPreRegister`. Remplace l'ancien décorateur
 * `@modules([...])` d'`index.ts`. Cf mémoire IA `project_module_loading_architecture`.
 *
 * ⚠️ L'ORDRE de ce tableau = ordre (priorité) de chargement. Il porte des
 * invariants réels — NE PAS réordonner à la légère :
 *   - `@nodefony/realtime` APRÈS `@nodefony/framework` (AdminBroker mountAll).
 *   - `@nodefony/frontend` AVANT ses consumers (mediasoup, test-frontend-*).
 *   - `@nodefony/documentation` AVANT `@nodefony/studio` (front Studio consomme
 *     `/nodefony/documentation/api/*`).
 *
 * Policies : `mandatory` (socle, jamais gaté) · `optional` (défaut, gaté par
 * `when`) · `dev` (chargé hors production uniquement). En ESM un module importé
 * n'est jamais déchargé → le seul gain mémoire est de NE PAS le charger (gating).
 */
const modules: IModuleManifest = [
  // ── ORM — chargés au boot. Le gating par driver (`when: c => c.orm?.driver
  //    === "drizzle"`) arrivera avec le virage ORM ; pour l'instant on préserve
  //    le comportement existant (les deux adapters montent).
  "@nodefony/sequelize",
  "@nodefony/drizzle",

  // ── Socle serveur — toujours présent (web + routing + sécurité).
  { name: "@nodefony/http", policy: "mandatory" },
  { name: "@nodefony/framework", policy: "mandatory" },

  // Realtime APRÈS framework (s'y greffe via AdminBroker avant mountAll).
  "@nodefony/realtime",

  // Sécurité applicative (P6) — requise dès qu'on sert du trafic.
  { name: "@nodefony/security", policy: "mandatory" },

  // ── Démo / tests d'intégration — hors production.
  { name: "@nodefony/test", policy: "dev" },

  // Frontend AVANT ses consumers.
  "@nodefony/frontend",
  { name: "@nodefony/test-frontend-react", policy: "dev" },
  { name: "@nodefony/test-frontend-vue", policy: "dev" },
  { name: "@nodefony/test-frontend-angular", policy: "dev" },
  { name: "@nodefony/mediasoup", policy: "dev" },

  // ── Doc transverse AVANT Studio.
  "@nodefony/documentation",

  // Studio admin — toujours présent (console d'administration du framework).
  { name: "@nodefony/studio", policy: "mandatory" },

  // ── Accès Redis générique — requis UNIQUEMENT pour le backplane realtime
  //    `redis` (fan-out cross-pod). Avec le défaut IPC (intra-pod) il est inutile.
  //    Décommenter + REDIS_PASSWORD pour le fan-out cross-pod (Phase 16).
  // { name: "@nodefony/redis", when: (c) => c.realtime?.backplane === "redis" },
];

export default modules;
