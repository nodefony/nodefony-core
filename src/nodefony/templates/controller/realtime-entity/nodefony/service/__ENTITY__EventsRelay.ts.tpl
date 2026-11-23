import { Service, Module, injectable, runOnceAtStartup } from "nodefony";
import { getRealtimeHub } from "@nodefony/realtime";
import type { <%= it.entityPascal %>Row } from "../entity/<%= it.entityPascal %>";
import {
  get<%= it.entityPascal %>Service,
  type <%= it.entityPascal %>Service,
} from "./<%= it.entityPascal %>Service";

/** Le canal des écritures de `<%= it.entityPascal %>` — un seul nom, lu par le controller et par le relais. */
export const <%= it.channelConst %> = "<%= it.channel %>";

/** Ce que reçoit un abonné de `<%= it.channel %>`. */
export type <%= it.entityPascal %>Event =
  | { type: "created"; item: <%= it.entityPascal %>Row }
  | { type: "updated"; item: <%= it.entityPascal %>Row }
  | { type: "deleted"; criteria: unknown; count: number };

/**
 * Branche les événements de `service` sur le canal `<%= it.channel %>`.
 *
 * `AbstractCrudService` émet `onCreated`, `onUpdated` et `onDeleted` APRÈS chaque
 * écriture réussie : on les traduit en messages, sans relire la base. Le hub
 * publie vers les abonnés de ce processus, et vers les autres pods si le canal est
 * diffusable (`@RealtimeBroadcast` sur le controller) ; sans abonné ni bus, une
 * publication coûte une recherche dans une table.
 *
 * @param service - le service dont on relaie les écritures.
 * @returns de quoi débrancher les trois écouteurs.
 */
export function relay<%= it.entityPascal %>Events(service: <%= it.entityPascal %>Service): () => void {
  const hub = getRealtimeHub();
  const created = (item: <%= it.entityPascal %>Row): void => {
    hub.publish(<%= it.channelConst %>, { type: "created", item });
  };
  const updated = (item: <%= it.entityPascal %>Row): void => {
    hub.publish(<%= it.channelConst %>, { type: "updated", item });
  };
  const deleted = (criteria: unknown, count: number): void => {
    hub.publish(<%= it.channelConst %>, { type: "deleted", criteria, count });
  };
  service.on("onCreated", created);
  service.on("onUpdated", updated);
  service.on("onDeleted", deleted);
  return () => {
    service.removeListener("onCreated", created);
    service.removeListener("onUpdated", updated);
    service.removeListener("onDeleted", deleted);
  };
}

/**
 * Relaie les écritures de `<%= it.entityPascal %>` vers la socket — dans CHAQUE
 * processus qui sert du trafic.
 *
 * Généré avec `<%= it.nameClass %>` par
 * `nodefony create controller <%= it.pascal %> --kind realtime --entity <%= it.entityPascal %>`,
 * et déclaré dans `@services([…])` de l'`index.ts` : sans cette déclaration, le
 * relais n'est jamais construit et le canal reste muet.
 *
 * Pourquoi au démarrage et pas au premier abonné : l'écriture arrive sur un pod,
 * l'abonné attend peut-être sur un autre. Un relais branché seulement là où
 * quelqu'un écoute perdrait toutes les écritures faites ailleurs.
 *
 * `runOnceAtStartup(…, { allWorkers: true })` : après le démarrage (le connecteur
 * ORM est ouvert), dans chaque worker de la grappe, et jamais dans une commande
 * CLI (`orm:migrate`, `inspect`) — qui ne sert aucun abonné.
 */
@injectable()
class <%= it.relayClass %> extends Service {
  readonly module: Module;

  constructor(module: Module) {
    super(
      "<%= it.entityCamel %>EventsRelay",
      module.container ?? undefined,
      module.notificationsCenter,
    );
    this.module = module;
  }

  async init(): Promise<this> {
    runOnceAtStartup(
      this,
      () => {
        const stop = relay<%= it.entityPascal %>Events(get<%= it.entityPascal %>Service());
        // Au nom du module (sa criticité), jamais un écouteur anonyme.
        this.module.hookKernel("onTerminate", stop);
      },
      { allWorkers: true },
    );
    return this;
  }
}

export default <%= it.relayClass %>;
