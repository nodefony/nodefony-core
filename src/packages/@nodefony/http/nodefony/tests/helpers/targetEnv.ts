/**
 * Mode du serveur CIBLÉ par les suites d'intégration/charge.
 *
 * `describe.skipIf()` de vitest est SYNCHRONE (évalué à la COLLECTE, avant tout
 * `await`) → un test ne peut pas sonder le serveur (async) à ce moment. Le mode
 * transite donc par la variable d'environnement `NF_TEST_ENV` :
 *  - posée explicitement par le lanceur de la batterie prod (priorité), OU
 *  - posée automatiquement par le globalSetup `probeServerEnv` (qui interroge la
 *    route PUBLIQUE `/nodefony/kernel/api/livez` AVANT le fork des workers).
 *
 * Défaut = `development` : les features d'observabilité dev (profiler de phases,
 * trace WS, logging interne du 499) sont actives → les tests qui les vérifient
 * tournent. En `production` ces features sont désactivées (perf) → ces tests
 * se SKIPPENT (sinon faux échecs), sans masquer une vraie régression en dev.
 */
export const TARGET_ENV = process.env.NF_TEST_ENV ?? "development";

/** Vrai quand le serveur testé tourne en production → skipper les tests dev-only. */
export const IS_PROD_TARGET = TARGET_ENV === "production";
