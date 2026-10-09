/**
 * Contrat d'un outil **Model Context Protocol** — défini dans le CORE.
 *
 * Vit ici, et non dans le module qui sert la porte HTTP, pour la raison qui
 * gouverne déjà {@link IAdminApi} : un outil peut être produit par n'importe
 * quel niveau de la pile — un module métier d'application, un adapter ORM, un
 * futur module IA — et le contrat doit donc résider au plus bas niveau commun.
 * Un contrat logé dans un module `policy: "dev"` obligerait toute application
 * voulant déclarer un outil à dépendre d'un paquet qui disparaît en production.
 *
 * Séparation des rôles :
 *  - Ce fichier = **producteur**. Un module déclare *quels* outils il offre, par
 *    `getMcpTools()`, sans rien connaître du transport ni du protocole.
 *  - `mcp/server.ts` (core) = **protocole**. Il reçoit des outils déjà résolus.
 *  - Un controller de module = **transport**. Il traduit HTTP ↔ JSON-RPC.
 */

/**
 * Ce que rend un outil — du contenu, et l'aveu d'un échec métier.
 *
 * Un échec métier se dit par `isError`, jamais par une exception : le protocole
 * réserve ses erreurs aux fautes de protocole. La distinction compte pour
 * l'agent — une erreur de protocole signifie « tu t'y prends mal », un `isError`
 * signifie « ta demande est recevable, voici pourquoi elle n'aboutit pas » ;
 * c'est la seconde qu'il peut corriger seul.
 */
export interface IMcpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean | undefined;
}

/**
 * Ce que le transport a pu ÉTABLIR de l'appelant — jamais ce qu'il prétend.
 *
 * La spec autorise le catalogue à varier selon l'autorisation présentée, et
 * pose la condition qui rend cela sûr : « credentials are **per-request input,
 * not connection state** ». D'où cet objet, construit à CHAQUE requête par la
 * porte, et jamais mémorisé entre deux.
 *
 * ⚠️ **Une porte qui n'authentifie pas rend un appelant anonyme** — pas une
 * autorisation implicite. Tant que le rôle *resource server* n'est pas branché,
 * `authenticated` est `false` et `scopes` est vide : les outils qui exigent
 * quoi que ce soit sont retenus, jamais servis par défaut.
 */
export interface IMcpCaller {
  /**
   * Une identité a-t-elle été PROUVÉE (jeton validé) ?
   *
   * `false` par défaut, et c'est le seul défaut sûr : le jour où quelqu'un
   * branche une porte authentifiée en oubliant de poser ce drapeau, les outils
   * protégés restent invisibles — l'inverse aurait ouvert.
   */
  authenticated: boolean;
  /** Scopes réellement accordés par le serveur d'autorisation. */
  scopes: readonly string[];
  /**
   * Rôles Nodefony de cet appelant — ce sur quoi le plan d'administration
   * tranche.
   *
   * Posés par la PORTE, qui seule connaît sa configuration : une porte non
   * protégée (module de développement, bornée par son périmètre et ses gardes
   * de transport) accorde le rôle d'opérateur et l'ÉNONCE ; une porte protégée
   * les dérive du jeton ({@link rolesFromScopes}) et n'accorde rien d'autre.
   *
   * Champ **obligatoire** : le compilateur force chaque porte à décider. Il l'a
   * été après avoir constaté l'inverse — la lecture d'administration fabriquait
   * un administrateur, donc tout porteur d'un jeton d'audience valide, même
   * sans aucun droit, obtenait tout.
   */
  roles: readonly string[];
  /** Sujet du jeton (`sub`), pour l'audit et pour filtrer les données rendues. */
  subject?: string | undefined;
}

/**
 * Ce que la porte prête à un outil pendant SON exécution : de quoi savoir que
 * l'agent est parti, et de quoi lui donner signe de vie.
 *
 * Construit à chaque appel, jamais retenu : il ne vaut que pour la requête qui
 * l'a porté. Un outil court l'ignore — un handler à deux paramètres reste
 * parfaitement valide.
 */
export interface IMcpToolRun {
  /**
   * Abattu quand l'agent abandonne l'appel. Sur le transport HTTP, fermer le
   * flux de réponse EST l'annulation (`basic/patterns/cancellation`) : un outil
   * long le consulte entre deux étapes, ou le passe à ce qu'il attend
   * (`fetch`, minuteur, requête de base).
   */
  readonly signal: AbortSignal;
  /**
   * Signale l'avancement (`notifications/progress`).
   *
   * Sans effet quand l'agent n'en a pas demandé (aucun `progressToken`), quand
   * la porte ne sait pas tenir un flux, ou une fois l'outil terminé — l'outil
   * n'a donc jamais à s'en soucier. Une valeur qui ne CROÎT pas est ignorée (la
   * norme exige une suite croissante), et la cadence est bornée par la porte.
   *
   * @param progress - l'avancement atteint (une durée, un compte, une part).
   * @param total - le total, s'il est connu.
   * @param message - une phrase lisible : ce qui se passe à cet instant.
   */
  progress(progress: number, total?: number, message?: string): void;
}

/** Un outil tel que `tools/list` le publie — sans son implémentation. */
export interface IMcpToolDefinition {
  /**
   * Identifiant d'appel. Forme admise : `[a-zA-Z0-9_-]{1,64}`.
   *
   * Ce nom ne reste pas dans le serveur — il voyage jusque dans le contexte du
   * modèle. Un nom hors forme n'échoue pas franchement : il produit des appels
   * que rien ne résout.
   */
  name: string;
  /**
   * ⭐ **Le premier critère de déclenchement de l'outil**, avant toute
   * considération technique. Un modèle n'appelle pas ce qu'il ne comprend pas :
   * dire ce que l'outil REND et QUAND s'en servir, pas seulement son nom.
   */
  description: string;
  /** Schéma JSON des arguments attendus. */
  inputSchema: Record<string, unknown>;
}

/**
 * Un outil exécutable : ce que `tools/list` publie, plus ce qui répond.
 *
 * C'est le contrat qu'un module implémente pour ajouter un outil à la porte MCP
 * de son application. Le handler ne reçoit QUE les arguments de l'agent : tout
 * ce dont il a besoin par ailleurs (services, kernel, connexions) est capturé
 * par fermeture au moment de la déclaration — le déclarant est un module, il a
 * déjà tout sous la main.
 *
 * @example
 * ```ts
 * import { Module, mcpText, type IMcpTool } from "nodefony";
 *
 * class Shop extends Module {
 *   getMcpTools(): IMcpTool[] {
 *     return [{
 *       name: "shop_stock",
 *       description:
 *         "Stock réel d'une référence produit. À utiliser avant de proposer " +
 *         "une commande — la réponse vient de la base, pas d'un cache.",
 *       inputSchema: {
 *         type: "object",
 *         properties: { sku: { type: "string", description: "Référence" } },
 *         required: ["sku"],
 *       },
 *       handler: async (args) => mcpText(await this.stock(String(args.sku))),
 *     }];
 *   }
 * }
 * ```
 */
export interface IMcpTool extends IMcpToolDefinition {
  /**
   * Scopes OAuth exigés — **tous**, pas au moins un.
   *
   * Absent = outil public, servi à qui atteint la porte. Présent, l'outil est
   * **retenu** tant que l'appelant ne les présente pas : il n'apparaît pas dans
   * `tools/list` ET n'est pas appelable en le nommant — un catalogue filtré qui
   * resterait appelable ne serait qu'un rideau.
   *
   * La spec le permet explicitement (`server/tools`) : le jeu d'outils « MAY
   * vary by the authorization presented on the request — for example, returning
   * only the tools the caller's granted scopes permit ». Elle interdit en
   * revanche de le faire varier PAR CONNEXION : c'est pourquoi la décision se
   * prend sur les identifiants de la requête, jamais sur un état retenu.
   */
  scopes?: readonly string[] | undefined;
  /**
   * Exige une identité prouvée, sans scope particulier.
   *
   * Utile quand l'outil filtre lui-même ce qu'il rend selon
   * {@link IMcpCaller.subject} — « mes commandes », « mes tâches ». Déclarer
   * des {@link IMcpTool.scopes} l'implique déjà.
   */
  requiresAuth?: boolean | undefined;
  /**
   * Implémentation. Un échec métier se rend en `isError`, pas en exception.
   *
   * ⚠️ **Une exception est OPAQUE pour l'agent** : il ne reçoit qu'un
   * `-32603` générique qui nomme l'outil, et le message part au journal du
   * serveur — il pourrait porter un chemin, une chaîne de connexion ou un
   * secret. Pour EXPLIQUER un échec à l'agent, rendre `isError` (par
   * `mcpText(raison, true)`) : c'est le seul canal qui lui parvient.
   *
   * Le second paramètre porte l'appelant ÉTABLI : un outil authentifié doit
   * pouvoir borner ce qu'il rend à son sujet, et pas seulement décider s'il
   * répond. Le troisième ({@link IMcpToolRun}) sert l'outil LONG : annulation
   * et progression. Un handler qui les ignore reste parfaitement valide.
   * Optionnel pour l'APPELANT : la porte le fournit toujours, un appel direct
   * (un test) peut s'en passer — l'outil écrit donc `run?.progress(…)`.
   */
  handler: (
    args: Record<string, unknown>,
    caller: IMcpCaller,
    run?: IMcpToolRun,
  ) => IMcpToolResult | Promise<IMcpToolResult>;
}
