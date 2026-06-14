import { setOrmHealthProvider, setOrmRichProvider } from "nodefony";
import type { IKernel, IAdminRegistry } from "nodefony";
import {
  registerOrmAdminApi,
  buildConnectionHealth,
  buildOrmFlow,
} from "./OrmAdminApi";
import { buildOrmLeanHealth } from "./buildOrmLeanHealth";
import { ormRegistry } from "./OrmRegistry";

/**
 * Branche le « plan d'administration » ORM dans le kernel — montage **idempotent**
 * appelé par CHAQUE driver à son `onKernelBoot`. Factorise la dette C5 : le bloc
 * était jusqu'ici recopié à l'identique dans chaque module driver (Drizzle,
 * Mongoose), donc voué à diverger ; il vit désormais à un seul endroit.
 *
 * Trois branchements, tous **GLOBAUX** (ils itèrent `ormRegistry`) → couvrent
 * TOUS les ORM enregistrés, peu importe le driver appelant ; idempotents
 * (« dernier gagne ») → sûr d'être invoqué par N drivers :
 *  1. `registerOrmAdminApi` (si un broker admin est présent) — monte les routes
 *     data plane `/nodefony/orm/api/*` ;
 *  2. `setOrmHealthProvider` — santé ORM lean dans la sonde cluster (par worker) ;
 *  3. `setOrmRichProvider` — diagnostic riche (connexion + flux) pour le drill Studio.
 *
 * Les seams `setOrm*Provider` matérialisent l'inversion de dépendance : le core
 * expose la prise, orm-core fournit l'implémentation agnostique
 * (0 dépendance `framework` → `orm-core`).
 *
 * @param kernel - kernel courant (`this.kernel` du module driver), ou nullish.
 */
export function wireOrmAdminPlane(kernel: IKernel | null | undefined): void {
  const broker = kernel?.container?.get("adminBroker") as
    | IAdminRegistry
    | undefined;
  if (broker) {
    registerOrmAdminApi(broker);
  }
  setOrmHealthProvider(buildOrmLeanHealth);
  setOrmRichProvider(async () => ({
    health: await buildConnectionHealth(),
    flow: buildOrmFlow(),
  }));
  // Les ORM se créent/connectent aux hooks `onReady` des SERVICES, donc APRÈS ce
  // `onKernelBoot` : le registre est encore vide ici. On diffère le report à
  // `onServersReady` (registre peuplé, avant `onPostReady`) → lu par le récap.
  kernel?.once?.("onServersReady", () => reportOrmBootLines(kernel));
}

/**
 * Pousse dans le BootReporter une ligne par ORM enregistré (« nom → driver
 * (cible) ») pour que la phase de boot « Services & ORM » RACONTE les connexions
 * mises en place, au lieu d'une phase muette. Idempotent : reconstruit la liste
 * complète depuis le registre et REMPLACE (sûr d'être appelé par N drivers).
 *
 * `describeConnection()` ne révèle JAMAIS de credential (redaction côté adapter).
 * Le libellé « Services & ORM » doit matcher une phase du `BootReporter` (core).
 *
 * @param kernel - kernel courant (`this.kernel` du module driver), ou nullish.
 */
export function reportOrmBootLines(kernel: IKernel | null | undefined): void {
  if (!kernel) {
    return;
  }
  const lines: string[] = [];
  for (const name of ormRegistry.list()) {
    try {
      const orm = ormRegistry.get(name);
      // describeConnection est optionnel dans IOrm (sonde data plane) → guard.
      const info = orm.describeConnection?.();
      if (!info) {
        continue;
      }
      const target = info.target ? ` ${info.target}` : "";
      const state = orm.isConnected() ? "" : " (non connecté)";
      lines.push(`${name} → ${info.driver}${target}${state}`);
    } catch {
      /* adapter pas prêt / registre incohérent → on saute cette entrée */
    }
  }
  kernel.setBootLines("Services & ORM", lines);
}

/**
 * Détermine si la sonde de flux ORM (`queryFlowMonitor`) doit être active :
 * **OFF en production** (coût nul sur le hot path des requêtes), **ON sinon**
 * (observabilité dev / Supervision). Override explicite par la variable
 * d'environnement `NODEFONY_ORM_FLOW` (`1`/`true` = forcer ON).
 *
 * Factorise le calcul recopié à l'identique dans chaque `*Service.onBoot` (le
 * pendant « flux » de {@link wireOrmAdminPlane}, gardé distinct car il s'exécute
 * dans le Service, pas le Module, et porte une responsabilité différente).
 *
 * @param kernel - kernel courant (pour lire l'environnement d'exécution).
 * @returns `true` si la sonde de flux doit être activée.
 */
export function resolveOrmFlowEnabled(
  kernel: IKernel | null | undefined,
): boolean {
  const flag = process.env.NODEFONY_ORM_FLOW;
  return flag !== undefined
    ? flag === "1" || flag === "true"
    : kernel?.environment !== "production";
}
