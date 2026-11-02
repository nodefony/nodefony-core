import type { IAdminApi } from "nodefony";
import {
  sharedSupervisionRecorder,
  type SupervisionRecorder,
} from "../realtime/supervisionHistory";

/**
 * Producteur du plan d'administration de Studio — `/nodefony/studio/api/*`
 * servi par le broker du framework, et donc par ses DEUX transports : le REST
 * (octets sous la convention `$bytes` quand un codec binaire est actif, #618
 * D9) et le pont `api.request` de la socket (octets natifs en CBOR).
 *
 * Passer par le broker plutôt que par une route du `StudioController` n'est
 * pas une commodité : c'est lui qui porte la règle de rendu des octets sur le
 * REST. Une route de contrôleur la recopierait, ou rendrait `{"0":…}`.
 *
 * @param recorder - fournisseur de l'enregistreur ; le défaut le crée et le
 *   démarre au premier appel (première visite de la Supervision, D4).
 * @returns le producteur, à enregistrer auprès du service `adminBroker`.
 */
export function createStudioAdminApi(
  recorder: () => SupervisionRecorder = sharedSupervisionRecorder,
): IAdminApi {
  return {
    adminNamespace: "studio",
    adminDescriptor: () => ({
      label: "Studio",
      icon: "layout-dashboard",
      order: 900,
      role: "ROLE_SUPERVISOR",
    }),
    adminEndpoints: () => [
      {
        path: "supervision/history",
        method: "GET",
        // Même garde que l'instantané `/studio/api/stats` : la supervision
        // appartient à l'exploitant ; ROLE_NODEFONY_ADMIN l'a par hiérarchie.
        role: "ROLE_SUPERVISOR",
        summary:
          "Historique de la supervision (dix minutes, séries en tableaux typés)",
        handler: () => recorder().snapshot(),
      },
    ],
  };
}
