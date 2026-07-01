/**
 * Détection de l'environnement d'orchestration (pod Kubernetes).
 *
 * Utilité : un driver de VUE local (logs `memory`/`file`/`cluster-file`, hub
 * realtime `cluster`) ne couvre QUE le process/pod courant. En multi-pod, une vue
 * globale exige une agrégation centralisée (Loki/OpenSearch pour les logs, Redis
 * pour le realtime) — dont la destination est un secret d'infra fourni par
 * l'environnement (12-factor), JAMAIS devinable depuis le process. Ce module sert
 * donc à **avertir** l'opérateur, jamais à choisir un driver cross-pod à sa place.
 */

/**
 * Indique si le process tourne dans un pod Kubernetes.
 *
 * Signal fiable et gratuit : le kubelet injecte `KUBERNETES_SERVICE_HOST` (+
 * `KUBERNETES_SERVICE_PORT`) dans TOUT conteneur d'un pod — présence = k8s. Ne dit
 * RIEN du nombre de replicas (un pod ignore ses pairs) : à consommer comme un
 * indice « multi-pod POSSIBLE », pas comme un compte de pods.
 *
 * @param env - table d'environnement (défaut `process.env`) — injectable pour les tests.
 * @returns `true` si des marqueurs Kubernetes sont présents.
 */
export function isInKubernetes(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.KUBERNETES_SERVICE_HOST || env.KUBERNETES_SERVICE_PORT);
}

/** Drivers de relecture LOCAUX (per-pod) : ne couvrent que le process courant. */
const LOCAL_VIEW_DRIVERS = new Set(["memory", "file", "cluster-file"]);

/**
 * Décide s'il faut AVERTIR que la vue des logs est limitée à un pod. Vrai quand on
 * tourne en Kubernetes (multi-pod possible), que le driver de relecture actif est
 * LOCAL (per-pod), et qu'AUCUNE destination d'agrégation cross-pod (Loki/OpenSearch)
 * n'est configurée. Pur (aucun accès système) → testable ; prend le NOM du driver
 * (string) pour interdire le piège du comparer-un-objet-driver (bug de type réel).
 *
 * @param inKubernetes - résultat de {@link isInKubernetes}.
 * @param activeDriverName - nom du driver de relecture actif (`ILogDriver.name`).
 * @param hasAggregation - une destination Loki/OpenSearch est configurée.
 * @returns true si un avertissement « vue par pod » est pertinent.
 */
export function shouldWarnPerPodView(
  inKubernetes: boolean,
  activeDriverName: string | undefined,
  hasAggregation: boolean,
): boolean {
  return (
    inKubernetes &&
    !hasAggregation &&
    LOCAL_VIEW_DRIVERS.has(activeDriverName ?? "")
  );
}
