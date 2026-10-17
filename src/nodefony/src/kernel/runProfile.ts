/**
 * Profil d'exécution d'un run — la DÉCLARATION, par la commande, de ce dont le
 * run a besoin (serveurs, durée de vie, terminal, infrastructure, schéma), et
 * les quatre questions que le reste du framework lui pose.
 *
 * Module FEUILLE : aucun état du Kernel, aucun import de `./Kernel`. C'est ce
 * qui permet à `types/IKernel.ts`, `types/ICliKernel.ts` et `types/ICommand.ts`
 * d'importer le type canonique au lieu d'en recopier un miroir (le cycle
 * `Kernel → Service → IService → IKernel → Kernel` ne passe pas par ici).
 * `Kernel.ts` ré-exporte l'ensemble : sa surface publique est inchangée.
 */
import type { IStoreConnectivity } from "../config/infra";

/**
 * Durée de vie d'un run : `"oneshot"` = fait sa tâche puis le process sort (build,
 * install, help) ; `"longrunning"` = reste vivant jusqu'à un signal (serveur, daemon,
 * REPL) — maintenu soit par un socket en écoute, soit par un park explicite.
 */
export type RunLifetime = "oneshot" | "longrunning";

/**
 * Profil d'exécution d'un run — remplace l'ancien binaire `KernelType` (SERVER/CONSOLE)
 * qui écrasait 3 axes orthogonaux en un seul drapeau. Déclaré par chaque commande.
 *
 * - `servers` — monte des serveurs réseau HTTP/WS.
 * - `lifetime` — voir {@link RunLifetime}.
 * - `interactive` — a besoin d'un TTY (REPL, menu). Consommé au câblage REPL (différé).
 * - `externalServices` — ouvre des connexions SORTANTES vers l'infrastructure de
 *   l'application (base de données, cache, courtier). Voir ci-dessous.
 *
 * Note : le démarrage réel des serveurs reste piloté par `kernelEvent` + la présence du
 * `HttpKernel`. En revanche `lifetime` est désormais EFFECTIF : à la fin d'un run sans
 * serveur, le Kernel parke (daemon) ou terminate (one-shot) — cf `Kernel.finishOrPark`
 * et `Kernel.park` (source unique du park, ex-`new Promise(()=>{})` inline).
 */
export interface IRunProfile {
  servers: boolean;
  lifetime: RunLifetime;
  interactive: boolean;
  /**
   * Ce run a-t-il besoin de l'infrastructure de l'application ?
   *
   * `servers` dit si le run ouvre des PORTS ; celui-ci dit s'il ouvre des
   * CONNEXIONS — base de données, cache, courtier de messages. Les deux sont
   * orthogonaux : construire un frontend n'a besoin ni de l'un ni de l'autre,
   * `orm:migrate` a besoin du second sans le premier.
   *
   * **Le besoin se DÉCLARE, il ne se déduit pas**, et le défaut est `false` :
   * un run qui ne dit rien n'ouvre aucune connexion. Sans cet axe, tout ce qui
   * boote le kernel exigeait la base — `npm create nodefony` échouait en code 70
   * sur son propre `npm run build`, avant même que l'utilisateur n'ait pu
   * démarrer l'infrastructure que le scaffold lui conseille deux lignes plus bas.
   *
   * Ce n'est PAS un interrupteur « tolérer une base absente » : une commande qui
   * déclare le besoin échoue toujours, bruyamment, si l'infrastructure manque.
   * La question posée n'est pas « est-ce fatal ? » mais « ce run en a-t-il besoin ? ».
   */
  externalServices: boolean;
  /**
   * Ce run TRAVAILLE le schéma de la base — écrire, appliquer, lire l'état des
   * migrations (`orm:*`) ?
   *
   * Un tel run se connecte (`externalServices`), mais il ne doit RIEN
   * fabriquer au démarrage : un démarrage en développement dérive le schéma du
   * code, et la base se retrouvait peuplée par la commande même qui devait en
   * écrire la première migration — qui refusait alors d'écrire. Il ne doit pas
   * non plus confier les briques du framework à des tables qui n'existent peut-
   * être pas encore : ses stores `auto` restent en mémoire le temps du run.
   *
   * Optionnel, `false` par défaut : seule la famille `orm:*` le déclare, par
   * {@link CONSOLE_SCHEMA_RUN_PROFILE}.
   */
  schemaWork?: boolean;
}

/** Profil par défaut — équivaut à l'ancien `type = "CONSOLE"` (one-shot, sans serveur). */
export const CONSOLE_RUN_PROFILE: Readonly<IRunProfile> = Object.freeze({
  servers: false,
  lifetime: "oneshot",
  interactive: false,
  externalServices: false,
});

/**
 * Profil d'une commande console qui a besoin de l'infrastructure — `orm:migrate`,
 * `security:user:add`, tout ce qui LIT ou ÉCRIT des données.
 *
 * Existe pour que le besoin s'écrive en un mot au lieu d'un littéral recopié :
 * une commande qui redonne les quatre axes à la main finit par en figer un qui
 * changera ailleurs.
 */
export const CONSOLE_DATA_RUN_PROFILE: Readonly<IRunProfile> = Object.freeze({
  ...CONSOLE_RUN_PROFILE,
  externalServices: true,
});

/**
 * Profil d'une commande qui TRAVAILLE le schéma (`orm:generate`, `orm:migrate`…) :
 * connectée, mais sans schéma dérivé au démarrage ni store durable `auto`.
 * Cf {@link IRunProfile.schemaWork}.
 */
export const CONSOLE_SCHEMA_RUN_PROFILE: Readonly<IRunProfile> = Object.freeze({
  ...CONSOLE_DATA_RUN_PROFILE,
  schemaWork: true,
});

/**
 * Ce run travaille-t-il le schéma de la base ? Point d'appel UNIQUE de la question.
 *
 * @param kernel - le kernel courant, ou `null` hors kernel.
 * @returns `true` si le run a déclaré `schemaWork`.
 */
export function runWorksOnSchema(
  kernel: { runProfile?: IRunProfile | null } | null | undefined,
): boolean {
  return kernel?.runProfile?.schemaWork === true;
}

/**
 * Les briques du framework peuvent-elles, dans ce run, résoudre leur store
 * `auto` vers un backend CONNECTÉ (base, cache) — et sinon, pourquoi ?
 *
 * Oui si le run ouvre des connexions ET ne travaille pas le schéma : celui qui
 * écrit la première migration ne peut pas lire des tables qui n'existent pas
 * encore. Point d'appel UNIQUE des stores — à passer à `resolveAutoStore` et à
 * `durableStoreRemedy`, jamais `runNeedsExternalServices`, qui décide de la
 * CONNEXION, pas du store.
 *
 * @param kernel - le kernel courant, ou `null` hors kernel.
 * @returns le verdict, avec sa cause quand il refuse.
 */
export function storeConnectivity(
  kernel: { runProfile?: IRunProfile | null } | null | undefined,
): IStoreConnectivity {
  if (!runNeedsExternalServices(kernel)) {
    return { allowed: false, cause: "no-external-services" };
  }
  return runWorksOnSchema(kernel)
    ? { allowed: false, cause: "schema-work" }
    : { allowed: true };
}

/**
 * Ce run a-t-il DÉCLARÉ avoir besoin de l'infrastructure de l'application ?
 *
 * Point d'appel UNIQUE de la question : les services qui ouvrent une connexion
 * au boot (ORM SQL, ORM document) la posent tous ici plutôt que de relire
 * `runProfile` chacun à sa façon — deux lectures divergeraient le jour où
 * l'axe gagnerait une nuance, et l'une des deux bases se connecterait encore.
 *
 * Répond `false` quand le profil n'est pas encore posé : avant que le run ne se
 * soit déclaré, personne ne peut affirmer qu'il a besoin d'une connexion.
 *
 * @param kernel - le kernel courant, ou `null` hors kernel.
 * @returns `true` si le run a déclaré `externalServices`.
 */
export function runNeedsExternalServices(
  kernel: { runProfile?: IRunProfile | null } | null | undefined,
): boolean {
  return kernel?.runProfile?.externalServices === true;
}

/**
 * Ce run SERVIRA-t-il du trafic ? — le fait que la garde `requiredIn` de
 * `env.ts` lit à l'import de l'application.
 *
 * Deux sources : le PROFIL courant (une commande au profil serveur statique),
 * et l'INTENTION déclarée de la commande (`servesTraffic`). La seconde existe
 * parce que les commandes de lancement — `production`, `cluster`,
 * `development` — ne posent leur profil serveur qu'à `onKernelStart`, APRÈS cet
 * import : lu sur le seul profil, le fait valait « console » pour elles, et un
 * secret « requis en production » n'était jamais exigé.
 *
 * @param profile - le profil d'exécution courant, s'il est déjà connu.
 * @param command - la commande résolue, s'il y en a une.
 * @returns `true` si le run servira du trafic.
 */
export function runWillServeTraffic(
  profile: Pick<IRunProfile, "servers"> | null | undefined,
  command: { servesTraffic?: boolean } | null | undefined,
): boolean {
  return (profile?.servers ?? false) || command?.servesTraffic === true;
}
