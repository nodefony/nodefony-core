/**
 * Temps réel — backplane de diffusion et journaux remontés du navigateur.
 *
 * Fragment du manifeste de l'application : `nodefony.config.ts` l'importe et
 * passe le résultat à `use("@nodefony/realtime", …)`. Rien ne charge ce fichier
 * tout seul — c'est l'import du manifeste qui le monte, et lui seul.
 *
 * 🔴 `satisfies` n'est PAS décoratif. Écrit dans le manifeste, ce littéral
 * était vérifié au point d'appel : une clé inconnue y était refusée. Rendu par
 * une fonction, il ne l'est plus — la clé compile, puis Zod la retire EN
 * SILENCE au boot, et le module démarre sur son défaut. `satisfies` rétablit
 * ce contrôle, et `nodefony doctor` refuse un fragment qui s'en passe.
 *
 * @module
 */
import type { IRealtimeConfigInput } from "@nodefony/realtime";

/**
 * La configuration de `@nodefony/realtime` pour cette application.
 *
 * Backplane `cluster` (IPC intra-pod, relais par le maître) par DÉFAUT : zéro
 * dépendance externe. Mono-process → hub local ; en cluster (`--workers N`) →
 * fan-out IPC entre les workers du même pod. Redis est un OPT-IN cross-pod,
 * déclaré par `NF_REDIS_URL` dans le manifeste.
 *
 * Ne dépend pas de `ctx` : rien ici ne change avec l'environnement.
 */
export const realtimeConfig = () =>
  ({
    backplane: { driver: "cluster" },
    // #35 — accepte les journaux que les navigateurs remontent, et les
    // réinjecte dans le journal du pod (origine forcée `browser`, débit et
    // taille bornés par connexion). Ouvert ICI parce que ce dépôt est aussi
    // l'application de développement du framework : c'est ce qui permet de
    // voir, dans la console d'administration, une erreur de page et la requête
    // qui l'a précédée sur la même ligne de temps. Fermé par défaut ailleurs.
    clientLogs: { enabled: true },
  }) satisfies IRealtimeConfigInput;
