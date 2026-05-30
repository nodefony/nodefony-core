import type { ILogDriver } from "./ILogDriver";

/**
 * Registre des **drivers du Log Backplane** (axe DESTINATION queryable) — résout
 * un nom (`config.log.queryDriver`, env, ou action de contrôle dev-only) vers un
 * `ILogDriver`, SANS aucun `if (name === "elastic") …` en dur.
 *
 * Même philosophie que `backplaneRegistry` (realtime) et `ormRegistry` : les
 * drivers natifs s'enregistrent au boot (`memory` par `Kernel.initializeLog`), un
 * utilisateur peut enregistrer le sien (`registerLogDriver("nats-logs", …)`) puis
 * pointer dessus — aucun changement dans le cœur. Source unique de la résolution.
 *
 * Le **driver actif** détermine où l'on RELIT les logs (`query`). Le sink WRITE
 * texte (LB.W, `Syslog.setLogSink`) et le bus temps réel (`syslog:stream`) sont
 * des axes orthogonaux, pilotés séparément.
 *
 * Sélection à la volée : **dev-only** (action de contrôle Studio). En prod, le
 * driver est figé par config/env (12-factor : le routage des logs relève de
 * l'orchestrateur, pas de l'app — un pod qui change de destination en vol = audit
 * cassé / désync cluster).
 */
const drivers = new Map<string, ILogDriver>();
let active: ILogDriver | null = null;

/**
 * Enregistre (ou remplace) un driver par son nom. Si aucun driver actif n'est
 * encore défini, le premier enregistré devient actif (défaut sain).
 *
 * @param driver - instance `ILogDriver` (porte son propre `name`).
 */
export function registerLogDriver(driver: ILogDriver): void {
  drivers.set(driver.name, driver);
  if (active === null) active = driver;
}

/**
 * Sélectionne le driver actif par nom (relecture des logs).
 *
 * @param name - nom d'un driver enregistré.
 * @returns le driver activé.
 * @throws si le nom est inconnu (jamais activer un driver fantôme silencieusement).
 */
export function setActiveLogDriver(name: string): ILogDriver {
  const driver = drivers.get(name);
  if (!driver) {
    throw new Error(
      `Unknown log driver "${name}". Registered: ${[...drivers.keys()].join(", ") || "(none)"}.`,
    );
  }
  active = driver;
  return driver;
}

/** Driver actif (relecture), ou `null` si aucun n'est encore enregistré/câblé. */
export function getActiveLogDriver(): ILogDriver | null {
  return active;
}

/** Liste des drivers enregistrés (introspection Studio / tests / data-plane). */
export function listLogDrivers(): {
  name: string;
  capabilities: ILogDriver["capabilities"];
}[] {
  return [...drivers.values()].map((d) => ({
    name: d.name,
    capabilities: d.capabilities,
  }));
}

/**
 * Réinitialise le registre (tests uniquement — isole l'état module-level entre
 * cas). Hors tests, le registre vit pour la durée du process.
 */
export function _resetLogDriverRegistry(): void {
  drivers.clear();
  active = null;
}
