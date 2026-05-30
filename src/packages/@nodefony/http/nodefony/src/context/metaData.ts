import type { Data, MetaData } from "../../service/http-kernel.js";

/**
 * Forme structurelle minimale d'une route nécessaire pour bâtir l'enveloppe
 * `nodefony.route`. Découplée de la classe `Route` de `@nodefony/framework`
 * (pas d'import, pas de cycle, pas de fuite d'instance partagée).
 */
export interface IMetaDataRouteSource {
  name: string;
  path?: string;
}

/**
 * Contexte structurel minimal nécessaire pour assembler `Context.metaData`.
 * Volontairement découplé de `Context` (typage par forme, comme
 * `IParamArgContext`) → {@link buildMetaData} est une fonction pure, testable en
 * unit avec une fausse source, sans démarrer de serveur. Le vrai `Context`
 * satisfait cette forme.
 */
export interface IMetaDataSource {
  kernel?: {
    projectName?: string;
    version?: string;
    environment?: MetaData["environment"];
    debug?: MetaData["debug"];
  } | null;
  request?: { url?: URL } | null;
  scheme: MetaData["scheme"];
  requestId: string;
  resolver?: {
    route: IMetaDataRouteSource | null;
    getMatchedParams(): Record<string, unknown>;
  } | null;
}

/**
 * Assemble l'enveloppe `metaData` d'une requête EN PLACE (builder monomorphe) :
 * met à jour les champs de `target.nodefony` dans un ordre fixe → V8 garde une
 * hidden class stable et inline les écritures. Remplace l'ancien
 * `extend(true, …)` qui deep-clonait/dispatchait à chaque réponse JSON et chaque
 * frame WS — inutile ici puisque `target` est l'objet metaData per-requête
 * (jamais partagé).
 *
 * `route` est un **snapshot per-requête** `{ name, path, variablesMap }` : on ne
 * diffuse jamais l'instance `Route` partagée (statique), dont les variables
 * matchées seraient écrasées par toute requête/connexion concurrente (bleed).
 *
 * `override` (ex. frame WS `{ nodefony: { websocket } }`) est fusionné *shallow*
 * dans l'enveloppe : le seul cas réel est l'ajout d'un sous-objet `nodefony`
 * peu profond — pas besoin du deep-merge récursif générique. Toute clé top-level
 * hors `nodefony` est préservée telle quelle.
 *
 * @param target - objet metaData per-requête à muter (et retourner)
 * @param src - source structurelle (le `Context` réel, ou un faux en test)
 * @param override - overrides optionnels de l'appelant
 * @returns le même `target`, muté
 */
export function buildMetaData(
  target: Data,
  src: IMetaDataSource,
  override?: Record<string, unknown>,
): Data {
  const nf = target.nodefony;
  nf.name = src.kernel?.projectName;
  nf.version = src.kernel?.version;
  nf.url = src.request?.url;
  nf.environment = src.kernel?.environment;
  nf.debug = src.kernel?.debug;
  nf.scheme = src.scheme;
  nf.requestId = src.requestId;
  const r = src.resolver;
  nf.route =
    r && r.route
      ? {
          name: r.route.name,
          path: r.route.path,
          variablesMap: r.getMatchedParams(),
        }
      : undefined;
  if (override) {
    const ovr = override.nodefony as Partial<MetaData> | undefined;
    if (ovr) {
      Object.assign(nf, ovr);
    }
    for (const k in override) {
      if (k !== "nodefony") {
        (target as unknown as Record<string, unknown>)[k] = override[k];
      }
    }
  }
  return target;
}
