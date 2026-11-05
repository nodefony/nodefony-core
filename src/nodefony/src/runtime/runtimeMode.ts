/**
 * Le MODE dans lequel tourne un serveur Nodefony — module FEUILLE, sans aucun
 * import, isomorphe (console d'administration et barre de debug).
 *
 * Une seule règle, lue par deux écrans : la page Runtime de la console et
 * l'onglet Runtime de la barre. Recopiée, elle divergerait en silence.
 */

/** Identifiant stable d'un mode d'exécution. */
export type RuntimeModeId = "development" | "production" | "cluster";

/** Ce qu'un écran affiche du mode d'exécution courant. */
export interface IRuntimeMode {
  readonly id: RuntimeModeId;
  /** Libellé humain : « Développement », « Production », « Cluster ». */
  readonly label: string;
  /** Vite (et son HMR) sert les fronts — vrai en développement seulement. */
  readonly vite: boolean;
  /** Nombre de process qui servent l'application. */
  readonly processes: number;
  /** Une phrase : qui fait tourner l'application. */
  readonly role: string;
}

/**
 * Déduit le mode d'exécution de ce que le serveur expose déjà : un instantané
 * de cluster tranche « cluster » ; sinon l'environnement tranche développement
 * (Vite intégré) ou production (un process figé, cloud-native). Rien n'est
 * deviné au-delà de ces deux faits.
 *
 * @param environment - l'environnement du noyau (`/nodefony/kernel/api/info`).
 * @param clusterInstances - le nombre de workers quand l'instantané de santé
 *   est celui d'un cluster, `null` sinon.
 * @returns le mode, avec son libellé et sa phrase.
 */
export function runtimeMode(
  environment: string,
  clusterInstances: number | null,
): IRuntimeMode {
  if (clusterInstances !== null)
    return {
      id: "cluster",
      label: "Cluster",
      vite: false,
      processes: clusterInstances,
      role: `1 master + ${clusterInstances} worker(s)`,
    };
  return environment === "development"
    ? {
        id: "development",
        label: "Développement",
        vite: true,
        processes: 1,
        role: "process unique (Vite intégré)",
      }
    : {
        id: "production",
        label: "Production",
        vite: false,
        processes: 1,
        role: "process unique (cloud-native, 1 pod)",
      };
}
