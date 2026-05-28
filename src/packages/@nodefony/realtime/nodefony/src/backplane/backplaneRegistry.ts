import type { Module } from "nodefony";
import type { IBackplane } from "../../interfaces/IBackplane.js";
import type { IRealtimeConfig } from "../../config/defineRealtimeConfig.js";

/**
 * Registre de **drivers backplane** — résout `config.backplane.driver` (une
 * chaîne) vers une fabrique d'`IBackplane`, SANS que le code de wiring connaisse
 * le moindre nom de driver en dur.
 *
 * Pourquoi : `IBackplane` est pluggable par contrat. Sélectionner le driver avec
 * une chaîne de `if (driver === "redis") … else if (driver === "kafka") …` dans
 * le Module trahit cette promesse (couplage aux noms, fermé à l'extension). Le
 * registre rend la sélection **ouverte** : les drivers natifs s'enregistrent au
 * chargement du module, et un utilisateur peut enregistrer le sien
 * (`registerBackplaneDriver("nats", …)`) puis poser `driver: "nats"` en config —
 * aucun changement dans le cœur. Single source of truth de la résolution driver.
 */

/**
 * Contexte passé à une fabrique de backplane : tout ce dont un driver peut avoir
 * besoin pour se construire (accès kernel/container/log via le Module, identité
 * du pair, rôle dans la topologie, config validée). Une fabrique ne démarre PAS
 * le backplane (`start()` est appelé par le wiring) — elle le **construit** ou
 * renvoie `null` (driver inactif dans ce contexte, ex. loopback / cluster hors
 * worker → le hub reste local).
 */
export interface IBackplaneFactoryContext {
  /** Module realtime — accès `container`/`kernel`/`log`. */
  readonly module: Module;
  /** Identité stable de ce pair (process/pod). Ex. `String(process.pid)`. */
  readonly originId: string;
  /** Rôle du process dans la topologie de lancement. */
  readonly role: "MASTER" | "WORKER" | "MONO";
  /** Config realtime validée + gelée. */
  readonly config: IRealtimeConfig;
}

/**
 * Fabrique d'un backplane pour un driver donné. Retourne l'instance à brancher,
 * ou `null` si le driver est inactif dans ce contexte (mono-process, mauvais
 * rôle, infra absente — le wiring laisse alors le hub local). Peut être async
 * (ex. lecture d'un service dont l'init est asynchrone).
 */
export type BackplaneFactory = (
  ctx: IBackplaneFactoryContext,
) => IBackplane | null | Promise<IBackplane | null>;

const drivers = new Map<string, BackplaneFactory>();

/**
 * Enregistre (ou remplace) la fabrique d'un driver backplane. Appelé par les
 * drivers natifs au chargement du module, et par l'utilisateur pour ses drivers
 * custom (NATS, Pulsar, RabbitMQ…).
 */
export function registerBackplaneDriver(
  name: string,
  factory: BackplaneFactory,
): void {
  drivers.set(name, factory);
}

/** Fabrique d'un driver par nom, ou `undefined` si inconnu. */
export function getBackplaneDriver(name: string): BackplaneFactory | undefined {
  return drivers.get(name);
}

/** Noms des drivers enregistrés (introspection / Studio / tests). */
export function listBackplaneDrivers(): string[] {
  return [...drivers.keys()];
}
