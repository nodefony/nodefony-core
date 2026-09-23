import type { IAdminBroker } from "@nodefony/framework";
import type { IAdminRequest } from "nodefony";

/**
 * Appelle un endpoint admin (`<namespace>/<path>`) via le broker — Studio reste
 * GÉNÉRIQUE (aucune dépendance directe au module producteur : orm-core,
 * framework…). `null` si le producteur ou l'endpoint est absent.
 *
 * `broker` en paramètre, jamais `this` : l'appelant peut être un provider de
 * canal PARTAGÉ (hub), qui doit capturer le broker (singleton long-lived) à sa
 * création — la connexion créatrice peut fermer alors que le provider survit.
 * Partagé par le temps réel et par le formulaire « Créer » : une seule façon
 * d'interroger un autre module.
 *
 * @param broker - broker admin (`container.get("adminBroker")`).
 * @param namespace - espace du module producteur (`orm`, `http`…).
 * @param path - chemin de l'endpoint dans cet espace (`orms`, `connection/health`…).
 * @returns la réponse de l'endpoint, ou `null` s'il n'existe pas.
 */
export async function fetchAdminEndpoint(
  broker: IAdminBroker | null | undefined,
  namespace: string,
  path: string,
): Promise<unknown> {
  const producer = broker?.list().find((p) => p.adminNamespace === namespace);
  const ep = producer?.adminEndpoints().find((e) => e.path === path);
  if (!ep) return null;
  return ep.handler({
    params: {},
    query: {},
    body: null,
    user: null,
    roles: [],
  } as IAdminRequest);
}
