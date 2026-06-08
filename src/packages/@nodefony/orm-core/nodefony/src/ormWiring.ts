import { setOrmHealthProvider, setOrmRichProvider } from "nodefony";
import type { Kernel, IAdminRegistry } from "nodefony";
import {
  registerOrmAdminApi,
  buildConnectionHealth,
  buildOrmFlow,
} from "./OrmAdminApi";
import { buildOrmLeanHealth } from "./buildOrmLeanHealth";

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
export function wireOrmAdminPlane(kernel: Kernel | null | undefined): void {
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
  kernel: Kernel | null | undefined,
): boolean {
  const flag = process.env.NODEFONY_ORM_FLOW;
  return flag !== undefined
    ? flag === "1" || flag === "true"
    : kernel?.environment !== "production";
}
