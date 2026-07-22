import type { ILogDriver, IPduLike } from "./ILogDriver";
import type { ITransport } from "../../types/ITransport";

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
 * texte (LB.W, `Syslog.setLogSink`) et le bus temps réel (`nodefony:syslog`) sont
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

/**
 * Récupère un driver ENREGISTRÉ par son nom SANS l'activer — pour le sonder
 * (`probe`) ou l'introspecter avant un switch. `undefined` si non enregistré.
 */
export function getLogDriver(name: string): ILogDriver | undefined {
  return drivers.get(name);
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

// ── Registre de FABRIQUES (name → factory) ─────────────────────────────────────
// Le cœur de la résolution config-driven : le Kernel ne construit JAMAIS un driver
// par son nom (`if (name === "loki")` = anti-pattern). Chaque driver natif enregistre
// une fabrique qui sait se construire à partir d'un contexte (config + env + chemins),
// y compris brancher son transport d'ÉCRITURE (write↔read cohérents). Un userland fait
// pareil : `registerLogDriverFactory("nats", …)` puis `queryDriver: "nats"`. Même
// philosophie que `backplaneRegistry` (realtime) / `ormRegistry`.

/**
 * Sous-ensemble de `config.log` lu par les fabriques — évite une dépendance des
 * drivers au type complet du Kernel (qui, lui, importe les drivers).
 */
export interface ILogConfigLike {
  queryFile?: { path?: string; maxScanBytes?: number };
  loki?: {
    url: string;
    labels?: Record<string, string>;
    tenantId?: string;
    batchSize?: number;
    flushIntervalMs?: number;
    maxQueue?: number;
    maxScanLines?: number;
  };
  opensearch?: {
    url: string;
    index?: string;
    username?: string;
    password?: string;
    batchSize?: number;
    flushIntervalMs?: number;
    maxQueue?: number;
    maxHits?: number;
  };
}

/** Contexte passé à une fabrique de driver (tout ce qu'il faut pour se construire). */
export interface ILogDriverContext {
  /** Config `log` de l'app (sous-ensemble lu par les fabriques). */
  logCfg: ILogConfigLike | undefined;
  /** Environnement courant (`development` | `production` | …). */
  environment: string;
  /** Répertoire ABSOLU des fichiers de log. */
  logDir: string;
  /** PID du process courant (nom de fichier par worker). */
  pid: number;
  /** Fournit le ring buffer courant à la demande (driver `memory`, lazy). */
  getRingStack: () => IPduLike[];
}

/**
 * Ce qu'une fabrique retourne : le driver de RELECTURE + (optionnel) le transport
 * d'ÉCRITURE à brancher. `writeKey` déduplique le transport quand plusieurs drivers
 * partagent la même destination d'écriture (ex. `file` ↔ `cluster-file` = même JSONL).
 */
export interface ILogDriverMount {
  driver: ILogDriver;
  transport?: ITransport;
  writeKey?: string;
}

/** Fabrique d'un driver. Retourne `null` si la config est insuffisante (ex. URL absente). */
export type ILogDriverFactory = (
  ctx: ILogDriverContext,
) => ILogDriverMount | null;

const factories = new Map<string, ILogDriverFactory>();

/**
 * Enregistre (ou remplace) la fabrique d'un driver par son nom.
 *
 * @param name - nom du driver (`"loki"`, `"opensearch"`, ou custom userland).
 * @param factory - construit le driver + son transport à partir du contexte.
 */
export function registerLogDriverFactory(
  name: string,
  factory: ILogDriverFactory,
): void {
  factories.set(name, factory);
}

/** Récupère la fabrique d'un driver, ou `undefined` si non enregistrée. */
export function getLogDriverFactory(
  name: string,
): ILogDriverFactory | undefined {
  return factories.get(name);
}

/** Liste les noms de drivers ayant une fabrique (introspection Studio / CLI). */
export function listLogDriverFactories(): string[] {
  return [...factories.keys()];
}

/**
 * Réinitialise le registre (tests uniquement — isole l'état module-level entre
 * cas). Hors tests, le registre vit pour la durée du process. Les FABRIQUES ne sont
 * PAS effacées (elles sont enregistrées 1× au boot, idempotent).
 */
export function _resetLogDriverRegistry(): void {
  drivers.clear();
  active = null;
}
