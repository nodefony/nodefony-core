/**
 * Configuration CLUSTER / TOPOLOGIE de l'application — successeur cloud-native de
 * l'ancien `pm2.config.ts` (`instances`), qui est déprécié (retrait Phase 16).
 *
 * C'est la « molette topologie » côté DevOps : combien de process Node lancer.
 *
 *   workers: 1        → VRAI mono-process (défaut cloud-native : 1 process = 1 pod,
 *                       scaling horizontal délégué à l'orchestrateur k8s/HPA/Cloud Run).
 *                       Aucune machinerie cluster (pas de master, pas de backplane).
 *   workers: "auto"   → nb de workers cgroup-aware (quota CPU du conteneur, JAMAIS
 *                       os.cpus()). Pour grosse VM / VPS / gros pod SANS orchestrateur.
 *   workers: <N>      → nombre explicite de workers.
 *
 * OVERRIDES À L'EXÉCUTION (sans éditer ce fichier — priorité décroissante) :
 *   1. CLI            `nodefony cluster --workers <n|auto>`
 *   2. env            NF_WORKERS=<n|auto>   (Docker / k8s)
 *   3. ce fichier     cluster.workers              (le défaut DevOps)
 *
 * ⚠️ Ce fichier doit rester KERNEL-FREE (aucun `Nodefony.getKernel()`, aucun import
 *    qui déréférence le kernel) : le process MASTER l'importe AVANT de booter le
 *    moindre Kernel pour décider du nombre de workers à forker.
 *
 * `development` ignore ce réglage : le mode dev est TOUJOURS mono-process (Vite/HMR
 * exige un process maître unique).
 */
import type { IClusterConfig } from "nodefony";

const cluster: IClusterConfig = {
  workers: 1,
};

export default cluster;
