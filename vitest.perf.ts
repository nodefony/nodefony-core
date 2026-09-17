/**
 * **Options Vitest qui ne changent que la VITESSE — jamais ce qui est exercé.**
 *
 * Socle partagé par les `vitest.config.ts` des espaces de travail, sur le modèle
 * de `vitest.oxc.ts` (qui porte, lui, les options `oxc` de transformation). La
 * séparation n'est pas cosmétique : ces réglages se justifient par une MESURE,
 * et une mesure se refait — les garder ensemble permet de les revoir d'un seul
 * endroit sans rouvrir vingt fichiers.
 *
 * La règle qui gouverne ce fichier : **rien ici ne doit changer le VERDICT d'une
 * suite.** Un réglage qui fait passer un test qui échouait — ou l'inverse —
 * n'appartient pas à ce socle, il appartient à la configuration du paquet
 * concerné, où il se discute cas par cas.
 */

/**
 * Persiste les modules transformés sur le disque et les réutilise d'un run à
 * l'autre — y compris entre deux process Vitest distincts.
 *
 * **Pourquoi.** Dans une suite de ce dépôt, la transformation des sources pèse
 * 66 à 71 % du temps d'un run, les tests eux-mêmes 2 %. Sans ce cache, chaque
 * `vitest run` retransforme tout le graphe depuis zéro. Mesuré sur
 * `@nodefony/framework` (médiane de 3 runs) : 4,30 s → 2,90 s, la part
 * `transform` tombant de 71 % à 28 %.
 *
 * 🔴 **Le défaut est ÉTEINT, parce que le gain n'existe qu'au DEUXIÈME run d'un
 * MÊME paquet.** À cache vide, le premier paie l'écriture sans rien récupérer
 * (mesuré, 4,20 s → 4,60 s). Or `npm run test:all` lance presque chaque paquet
 * UNE fois : il écrirait **270 Mo** pour ne les relire jamais. Un défaut qui
 * coûte à la commande d'autorité du dépôt pour servir un seul cas d'usage est le
 * mauvais défaut. Le cache s'ALLUME donc quand on le veut :
 *
 * ```bash
 * cd src/packages/@nodefony/http && NF_VITEST_FS_CACHE=1 npx vitest run
 * ```
 *
 * C'est exactement la boucle où il paie — on relance le même paquet, encore et
 * encore, en corrigeant. Il n'a rien à faire ailleurs.
 *
 * ⚠️ **Ce qu'il ne faut PAS lui imputer.** Ce défaut a d'abord été inversé sur
 * une conclusion FAUSSE : deux passes complètes rouges cache actif contre une
 * verte cache éteint, d'où « le cache fait rougir la suite ». La passe suivante,
 * cache éteint, est tombée sur le MÊME cas (`detachedStart.test.ts:393`) — deux
 * observations contre deux ne concluaient rien. Ce test est instable par
 * lui-même (2 échecs sur 5 passes, durée constante de 82 à 91 s dans toutes,
 * qu'il tombe ou non). La leçon vaut plus que le réglage : un verdict tiré de
 * deux runs n'est pas un verdict, et un réglage de performance qui n'a pas
 * d'interrupteur rend la question indécidable.
 *
 * **Ce qu'il ne faut PAS faire** : déplacer ce cache hors de `node_modules` avec
 * `fsModuleCachePath`. Cet emplacement est précisément ce qui l'invalide quand
 * les dépendances sont réinstallées. L'en sortir pour le persister exigerait de
 * mettre l'empreinte de `package-lock.json` dans la clé du cache — sans quoi une
 * suite tournerait sur des modules transformés d'une version antérieure d'une
 * dépendance, et sortirait VERTE.
 *
 * @param env - l'environnement à lire ; injecté pour que la règle s'éprouve sans
 *   toucher à `process.env` ni réimporter ce module — une manipulation qui rend
 *   un test fragile là où une fonction pure rend un verdict.
 * @returns les options `test` à étaler, et rien d'autre.
 */
export const transformCacheFor = (env: Record<string, string | undefined>) => {
  // Un interrupteur explicite, dans les deux sens : c'est ce qui rend le réglage
  // MESURABLE. Un réglage de performance qu'on ne peut pas éteindre n'est pas
  // pilotable — le premier soupçon devient indémontrable, et c'est exactement ce
  // qui est arrivé : trois passes complètes sans aucun moyen de rejouer la même
  // sans le cache. La quatrième, celle qui a tranché, n'a été possible qu'avec.
  const demande = env.NF_VITEST_FS_CACHE;
  // Une chaîne VIDE n'est pas une demande : `NF_VITEST_FS_CACHE=` traîne dans
  // les fichiers d'environnement et les définitions de tâches, et personne ne
  // l'a voulue.
  if (demande === undefined || demande === "") {
    return { fsModuleCache: false } as const;
  }
  // La forge garde le dernier mot : même demandé, le cache y serait écrit puis
  // jeté avec le `node_modules` que `npm ci` refait à chaque tâche.
  if (env.CI) {
    return { fsModuleCache: false } as const;
  }
  return {
    fsModuleCache: demande !== "0" && demande !== "false",
  } as const;
};

/**
 * Les options à étaler dans le bloc `test` d'une configuration de paquet,
 * résolues sur l'environnement courant.
 *
 * Étalées en TÊTE du bloc : une clé posée par la configuration du paquet
 * surcharge donc le socle, jamais l'inverse.
 */
export const transformCache = transformCacheFor(process.env);
