import { missingScopes, rolesFromScopes } from "nodefony";
import type {
  IMcpTool,
  IMcpToolAnnotations,
  IMcpToolDefinition,
  IMcpToolResult,
  IMcpCaller,
  IMcpToolRun,
} from "nodefony";

export type {
  IMcpTool,
  IMcpToolAnnotations,
  IMcpToolDefinition,
  IMcpToolResult,
  IMcpCaller,
  IMcpToolRun,
};
/**
 * Outils MCP : la **collecte** de ceux qu'une application déclare, leur
 * publication et leur exécution — la part générique de toute porte MCP.
 *
 * Les CONTRATS (`IMcpTool` et ses voisins) vivent au cœur, parce qu'un module
 * les implémente par {@link IModule.getMcpTools} sans dépendre d'aucune porte ;
 * la MÉCANIQUE vit ici. Le catalogue `nodefony_*` n'est pas ici non plus : il
 * appartient à `@nodefony/devkit`, qui le déclare comme n'importe quel module.
 *
 * ## Pourquoi la collecte, et pas un registre
 *
 * Un module déclare ses outils par {@link IModule.getMcpTools} ; ils sont
 * ramassés **au moment de servir la requête**, jamais stockés. C'est
 * délibérément l'inverse du data plane admin ({@link IAdminRegistry}), qui a
 * besoin d'un registre parce qu'il monte des ROUTES au boot et qu'un module
 * arrivé trop tard n'aurait plus rien à monter. Un outil MCP n'a rien à monter :
 * il est lu à la demande. D'où trois propriétés gagnées gratuitement — aucune
 * structure allouée au démarrage (donc coût nul en production, où aucune porte
 * MCP n'existe), aucun ordre de `register()` à respecter, et une fraîcheur qui
 * est une propriété du mécanisme plutôt qu'une discipline à tenir.
 */

/**
 * Au-delà de quoi une réponse cesse d'être une réponse.
 *
 * Mesuré, pas choisi en l'air : `inspect routes` rendait 47 000 caractères et
 * `inspect config` 190 730 — le second dépassait ce que le client accepte, il
 * partait sur disque, et l'agent brûlait vingt tours à le relire au `jq`. Le
 * premier passait, et ne servait à rien pour autant : à qui demandait le NOMBRE
 * de routes, il fallait compter 119 objets dans un mur de JSON.
 *
 * La borne est donc largement SOUS la limite des clients : ce qu'on protège
 * n'est pas le transport, c'est la capacité de l'agent à répondre sans relire.
 */
export const MCP_TEXT_MAX_CHARS = 32_000;

/** Ce qu'on garde d'une valeur dans une vue d'ensemble : la surface. */
const SCALAR_MAX_CHARS = 120;

/**
 * La SURFACE d'un objet — ses champs scalaires courts, sans sa profondeur.
 *
 * Ce qui pèse dans un inventaire n'est presque jamais ce qu'on y cherche : sur
 * une route, `name`/`path`/`controller` tiennent en cent caractères, et c'est la
 * description, les tableaux de tags et les objets imbriqués qui font les 47 ko.
 * On jette donc la profondeur et on garde la surface — TOUTES les entrées
 * restent visibles, ce qu'un échantillon des N premières ne permet pas : une
 * question portant sur la 100ᵉ recevrait une réponse fausse, et l'agent n'aurait
 * aucun moyen de le savoir.
 */
function surfaceOf(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  const kept: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || typeof v === "number" || typeof v === "boolean") {
      kept[key] = v;
    } else if (typeof v === "string" && v.length <= SCALAR_MAX_CHARS) {
      kept[key] = v;
    } else if (Array.isArray(v) && v.every((e) => typeof e === "string")) {
      // Un tableau de mots courts EST de la surface (`methods: ["GET"]`) ; on
      // ne le garde que s'il ne se met pas à peser.
      const rendered = v.join(",");
      if (rendered.length <= SCALAR_MAX_CHARS) {
        kept[key] = v;
      }
    }
  }
  return kept;
}

/**
 * Une donnée trop volumineuse, ramenée à une RÉPONSE.
 *
 * Deux formes, selon ce qu'on a sous la main :
 *  - **un tableau** rend son `count` — la première chose qu'on veut d'une liste,
 *    et celle qu'un modèle calcule mal et cher — puis ses entrées en surface ;
 *  - **un objet** rend ses clés de premier niveau : c'est la carte qui permet de
 *    demander ensuite la bonne branche (pour `config`, `inspect module <nom>`).
 *
 * Dans les deux cas la réponse DIT ce qu'elle a fait, et elle le dit EN TÊTE.
 * Une troncature muette est pire que pas de troncature — l'agent croit tout
 * tenir ; une troncature annoncée APRÈS vingt mille caractères d'entrées ne vaut
 * guère mieux, il a déjà décidé quoi faire de ce qu'il a lu. Mesuré : sur la
 * tâche « annonce le nombre de routes », l'agent recevait `count` puis 88
 * entrées puis, tout en bas, l'avertissement — et repartait recompter les
 * entrées visibles au lieu de lire le compte exact qu'on venait de lui donner.
 *
 * Et la note ne renvoie PAS vers un affinement : `routes`, `services` ou
 * `modules` n'acceptent aucun filtre, si bien que « affine la demande » nommait
 * un geste qui n'existe pas. Elle désigne ce qui EST utilisable — `count`, exact
 * et portant sur la liste entière.
 */
function summarize(value: unknown, size: number): string {
  if (Array.isArray(value)) {
    const items = value.map(surfaceOf);
    let rendered = JSON.stringify(
      {
        count: value.length,
        note:
          `count = ${value.length} : c'est le nombre EXACT, il porte sur la liste entière. ` +
          `Les entrées ci-dessous sont ramenées à leur surface (${size} caractères au complet) — ` +
          `demande le détail d'une entrée précise plutôt que la liste entière`,
        items,
      },
      null,
      2,
    );
    if (rendered.length <= MCP_TEXT_MAX_CHARS) {
      return rendered;
    }
    // La surface elle-même déborde : on borne, et le `count` reste EXACT — c'est
    // lui qui dit à l'agent qu'il ne voit pas tout.
    let keptCount = items.length;
    while (keptCount > 1 && rendered.length > MCP_TEXT_MAX_CHARS) {
      keptCount = Math.floor(keptCount / 2);
      rendered = JSON.stringify(
        {
          count: value.length,
          note:
            `count = ${value.length} : c'est le nombre EXACT, il porte sur la liste entière. ` +
            `Seules ${keptCount} entrées sont montrées (la liste pèse ${size} caractères) — ` +
            `toute affirmation sur le NOMBRE se fonde sur count, jamais sur les entrées visibles.`,
          items: items.slice(0, keptCount),
        },
        null,
        2,
      );
    }
    return rendered;
  }
  const keys =
    value && typeof value === "object" ? Object.keys(value) : undefined;
  return JSON.stringify(
    {
      keys,
      note:
        `réponse de ${size} caractères, trop volumineuse pour être rendue entière — ` +
        `demande une branche précise (par exemple le module qui t'intéresse)`,
    },
    null,
    2,
  );
}

/**
 * Rend un résultat d'outil — les données partent en JSON indenté, lisible.
 *
 * Exporté parce qu'une application qui déclare un outil en a besoin : sans lui,
 * chacune réinventerait l'enveloppe `content[]`, et une enveloppe mal formée
 * n'échoue pas — elle rend un résultat vide que l'agent prend pour une réponse.
 *
 * **Un résultat est BORNÉ** ({@link MCP_TEXT_MAX_CHARS}) : au-delà, il rend un
 * résumé plutôt qu'un déversement (voir {@link summarize}). La garde vit ICI, et
 * non dans chaque outil, pour qu'un outil déclaré par une
 * application en hérite sans le savoir — c'est le genre de règle qu'on
 * n'applique jamais deux fois de la même façon si on la laisse à l'appelant.
 * En deçà de la borne — le cas courant — la donnée part TELLE QUELLE : un
 * consommateur qui la parse n'a rien à changer, et on ne paie pas la garde sur
 * 100 % des appels pour 1 % de gros sujets.
 *
 * @param value - donnée à rendre (sérialisée si ce n'est pas déjà du texte)
 * @param isError - marque un échec MÉTIER (pas une faute de protocole)
 */
export function mcpText(value: unknown, isError = false): IMcpToolResult {
  const rendered =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  // Un message d'erreur est déjà rédigé, et court : le résumer n'apporterait
  // rien et pourrait effacer la seule phrase que l'agent doit lire.
  const text =
    isError || rendered.length <= MCP_TEXT_MAX_CHARS
      ? rendered
      : summarize(value, rendered.length);
  return isError
    ? { content: [{ type: "text", text: text }], isError: true }
    : { content: [{ type: "text", text: text }] };
}

/**
 * Forme admise pour un nom d'outil.
 *
 * Ce nom ne reste pas dans le serveur : il voyage jusque dans le contexte du
 * modèle, et sert d'identifiant d'appel. Un nom porteur d'espace, de guillemet
 * ou de saut de ligne ne provoque pas d'erreur — il produit des appels que rien
 * ne résout, ce qui est bien pire à diagnostiquer. La borne haute est du même
 * ordre : un nom de 4 000 caractères passerait, et mangerait le contexte.
 */
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Ce qu'il faut pour ÉNUMÉRER les déclarations d'outils d'une application.
 *
 * Distinct de {@link IMcpCollectOptions}, qui ajoute l'appelant : énumérer est
 * une question sur le CODE (« que déclare cette application ? »), collecter est
 * une question sur une REQUÊTE (« que sert-on à celui-ci ? »). Le document de
 * ressource protégée, servi sans contexte d'appelant, ne peut poser que la
 * première.
 */
export interface IMcpDeclareOptions {
  /**
   * Modules chargés (`kernel.modules`), dont on lit `getMcpTools()`.
   *
   * Typé large à dessein : le cœur ne peut pas dépendre de la forme concrète
   * d'un module ici, et la lecture est de toute façon défensive.
   */
  modules?: Readonly<Record<string, unknown>> | undefined;
  /**
   * Appelé pour chaque déclaration ÉCARTÉE, avec le motif.
   *
   * Sans ce rappel, un outil mal nommé ou en collision disparaîtrait en
   * silence, et son auteur chercherait la faute dans son handler — qui n'a
   * jamais été appelé.
   */
  onSkip?: ((why: string) => void) | undefined;
}

/** Ce qu'il faut pour ramasser les outils SERVIS à un appelant. */
export interface IMcpCollectOptions extends IMcpDeclareOptions {
  /**
   * Ce que la porte a ÉTABLI de l'appelant. Absent = anonyme.
   *
   * Une porte sans authentification n'a rien à passer, et c'est le cas sûr :
   * l'anonyme par défaut RETIENT tout outil qui exige quoi que ce soit.
   */
  caller?: IMcpCaller | undefined;
  /**
   * Appelé pour chaque outil RETENU faute d'autorisation.
   *
   * Distinct d'{@link IMcpCollectOptions.onSkip}, et la distinction n'est pas
   * cosmétique : un `onSkip` dénonce une FAUTE de l'auteur (nom hors forme,
   * handler absent) et mérite un avertissement ; une rétention est le
   * fonctionnement NORMAL d'un catalogue filtré, et crier à chaque requête pour
   * chaque outil protégé noierait le journal. Le rappel existe quand même,
   * parce que sans lui un développeur qui déclare des scopes sur une porte non
   * authentifiée chercherait son outil sans jamais comprendre.
   */
  onWithheld?: (name: string, why: string) => void;
}

/** Appelant anonyme — le défaut, et le seul défaut sûr. */
const ANONYMOUS: IMcpCaller = {
  authenticated: false,
  scopes: [],
  // Aucun rôle : un appelant dont personne n'a rien dit n'obtient rien. La
  // porte qui décide autrement — parce qu'elle n'est pas protégée et qu'elle
  // l'assume — pose les rôles elle-même.
  roles: [],
};

/**
 * Préfixe RÉSERVÉ aux modules du framework (`@nodefony/*`) — un agent qui lit
 * `nodefony_inspect` doit pouvoir croire que c'est le framework qui répond.
 *
 * Sans la réserve, un module d'application pourrait déclarer `nodefony_doc` et
 * répondre à la place de l'outil que l'agent a lu dans la documentation du
 * framework : l'ordre de chargement des modules ne protège rien, il change
 * avec le manifeste.
 */
export const MCP_RESERVED_PREFIX = "nodefony_";

/** Portée npm des modules du framework, seuls détenteurs du préfixe réservé. */
const FRAMEWORK_SCOPE = "@nodefony/";

/**
 * Le module a-t-il droit au préfixe {@link MCP_RESERVED_PREFIX} ?
 *
 * Lit `getModuleName()` (le nom npm du paquet), défensivement : un module écrit
 * en JavaScript peut ne pas l'avoir, et une absence vaut refus.
 *
 * @param module - module chargé, de forme non garantie
 * @returns `true` si le module appartient à la portée `@nodefony/`
 */
function ownsReservedPrefix(module: unknown): boolean {
  if (typeof module !== "object" || module === null) return false;
  if (!("getModuleName" in module)) return false;
  const getName = module.getModuleName;
  if (typeof getName !== "function") return false;
  const name: unknown = getName.call(module);
  return typeof name === "string" && name.startsWith(FRAMEWORK_SCOPE);
}

/**
 * L'appelant satisfait-il ce que l'outil exige ?
 *
 * @returns `null` s'il passe, sinon le motif de la rétention
 */
function withholdReason(tool: IMcpTool, caller: IMcpCaller): string | null {
  const needsScopes = tool.scopes !== undefined && tool.scopes.length > 0;
  if (!needsScopes && tool.requiresAuth !== true) {
    return null;
  }
  if (!caller.authenticated) {
    // 🔴 Un outil qui agit AU NOM d'un compte exige le compte : le rôle
    // d'opérateur d'une porte non protégée n'en désigne aucun, et ne s'y
    // substitue donc pas.
    if (tool.actsForUser === true) {
      return "agit au nom d'un compte, l'appelant est anonyme";
    }
    // ⭐ On retient sur ce que l'appelant PEUT, pas sur la façon dont il l'a
    // prouvé. Une porte NON protégée n'a personne à authentifier et pose
    // pourtant des rôles — ceux de l'opérateur, dont la protection est son
    // PÉRIMÈTRE (`mcpCallerRoles`). Exiger de lui une identité prouvée cachait
    // un outil pendant qu'un autre, moins restrictif, lui rendait déjà les
    // mêmes données par le même chemin : une porte plus stricte en apparence,
    // et un décor en pratique. Le seul test qui vaille est donc « porte-t-il
    // déjà ce que ces scopes ouvriraient ? » — non pour un anonyme d'une porte
    // protégée (`roles: []`), oui pour l'opérateur local.
    const opened = needsScopes
      ? rolesFromScopes(tool.scopes as readonly string[])
      : [];
    if (
      opened.length > 0 &&
      opened.every((role) => caller.roles.includes(role))
    ) {
      return null;
    }
    return "exige une identité prouvée, l'appelant est anonyme";
  }
  if (!needsScopes) {
    return null;
  }
  // TOUS les scopes, pas au moins un : « lire » n'autorise pas « écrire »
  // parce qu'ils sont demandés ensemble.
  const missing = (tool.scopes as readonly string[]).filter(
    (scope) => !caller.scopes.includes(scope),
  );
  return missing.length === 0
    ? null
    : `scopes manquants : ${missing.join(", ")}`;
}

/**
 * Motif pour lequel une valeur rendue par `getMcpTools()` n'est pas un outil
 * servable, ou `null` si elle en est un.
 *
 * Un module peut être écrit en JavaScript : le contrat `IMcpTool` n'y est
 * vérifié par personne. `scopes` et `requiresAuth` portent l'autorisation —
 * `requiresAuth: "oui"` ne vaut pas `true` et servirait l'outil à un anonyme.
 * Une forme fausse se REFUSE à la déclaration, elle ne s'interprète jamais.
 *
 * @param tool - valeur déclarée par un module
 * @returns le motif du refus, ou `null`
 */
function mcpToolFault(tool: unknown): string | null {
  if (typeof tool !== "object" || tool === null) return "pas un objet";
  if (
    !("name" in tool) ||
    typeof tool.name !== "string" ||
    !NAME_PATTERN.test(tool.name)
  ) {
    return `nom absent ou hors forme — attendu ${NAME_PATTERN.source}`;
  }
  if (!("handler" in tool) || typeof tool.handler !== "function") {
    return "sans handler";
  }
  if (!("description" in tool) || typeof tool.description !== "string") {
    return "`description` n'est pas une chaîne";
  }
  if (
    !("inputSchema" in tool) ||
    typeof tool.inputSchema !== "object" ||
    tool.inputSchema === null ||
    Array.isArray(tool.inputSchema)
  ) {
    return "`inputSchema` n'est pas un objet";
  }
  if (
    "annotations" in tool &&
    tool.annotations !== undefined &&
    (typeof tool.annotations !== "object" || tool.annotations === null)
  ) {
    return "`annotations` n'est pas un objet";
  }
  if (
    "scopes" in tool &&
    tool.scopes !== undefined &&
    !(
      Array.isArray(tool.scopes) &&
      tool.scopes.every((scope: unknown) => typeof scope === "string")
    )
  ) {
    return "`scopes` n'est pas un tableau de chaînes";
  }
  if (
    "scopesFor" in tool &&
    tool.scopesFor !== undefined &&
    typeof tool.scopesFor !== "function"
  ) {
    return "`scopesFor` n'est pas une fonction";
  }
  if (
    "requiresAuth" in tool &&
    tool.requiresAuth !== undefined &&
    typeof tool.requiresAuth !== "boolean"
  ) {
    return "`requiresAuth` n'est pas un booléen";
  }
  if ("actsForUser" in tool && tool.actsForUser !== undefined) {
    if (typeof tool.actsForUser !== "boolean") {
      return "`actsForUser` n'est pas un booléen";
    }
    // Dans la bulle, les rôles du compte sont ENTIERS : le jeton ne les borne
    // pas. Le scope exigé est donc la seule borne entre un jeton étroit et les
    // droits d'un compte large — sans lui, l'outil n'est pas servable.
    if (
      tool.actsForUser &&
      !(
        "scopes" in tool &&
        Array.isArray(tool.scopes) &&
        tool.scopes.length > 0
      )
    ) {
      return "`actsForUser` exige des `scopes` : les rôles du compte ne sont pas bornés par le jeton";
    }
  }
  return null;
}

/** La valeur déclarée a la forme d'un outil servable (cf {@link mcpToolFault}). */
function isMcpTool(tool: unknown): tool is IMcpTool {
  return mcpToolFault(tool) === null;
}

/**
 * Énumère ce que cette application DÉCLARE — les outils de ses modules, lus
 * par `getMcpTools()` — sans rien retenir sur l'identité de qui que ce soit.
 *
 * Cinq refus, tous énoncés par `onSkip` plutôt que silencieux :
 *  - **nom hors forme** ({@link NAME_PATTERN}) — il ne serait pas appelable ;
 *  - **forme fausse** ({@link mcpToolFault}) — handler, description, schéma ou
 *    autorisation qui ne respectent pas `IMcpTool` ;
 *  - **préfixe réservé** ({@link MCP_RESERVED_PREFIX}) pris par un module hors de
 *    `@nodefony/` — un module d'application ne peut donc pas se substituer à
 *    `nodefony_inspect` et répondre à sa place ;
 *  - **collision** — le premier inscrit garde le nom ;
 *  - **déclaration en échec** — un `getMcpTools()` qui lève ne doit pas priver
 *    l'agent des outils de tous les autres modules.
 *
 * 🔴 **Ce que rend cette fonction n'est PAS servable tel quel** : elle contient
 * les outils réservés. Toute porte passe par {@link collectMcpTools}, qui filtre
 * sur l'appelant. Le seul usage légitime de la liste brute est de raisonner sur
 * le CODE — ce que la porte EXIGE ({@link mcpDeclaredScopes}) — jamais de
 * répondre à une requête.
 *
 * @param options - modules et journal des écarts
 * @returns les outils déclarés, dans l'ordre où ils seraient publiés
 */
export function declareMcpTools(options: IMcpDeclareOptions): IMcpTool[] {
  const declared: IMcpTool[] = [];
  const seen = new Set<string>();

  // Un module peut être écrit en JavaScript : rien ne garantit la forme reçue.
  const add = (tool: unknown, origin: string, ownsPrefix: boolean): void => {
    const name =
      typeof tool === "object" && tool !== null && "name" in tool
        ? tool.name
        : undefined;
    if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
      options.onSkip?.(
        `outil écarté (${origin}) : nom absent ou hors forme — attendu ${NAME_PATTERN.source}`,
      );
      return;
    }
    // AVANT la réservation du nom : un outil refusé ne doit pas priver le
    // module du framework qui viendrait après lui de son propre nom.
    if (!ownsPrefix && name.startsWith(MCP_RESERVED_PREFIX)) {
      options.onSkip?.(
        `outil « ${name} » écarté (${origin}) : le préfixe « ${MCP_RESERVED_PREFIX} » est réservé aux modules ${FRAMEWORK_SCOPE}*`,
      );
      return;
    }
    if (!isMcpTool(tool)) {
      options.onSkip?.(
        `outil « ${name} » écarté (${origin}) : ${mcpToolFault(tool)}`,
      );
      return;
    }
    if (seen.has(tool.name)) {
      options.onSkip?.(
        `outil « ${tool.name} » écarté (${origin}) : ce nom est déjà pris`,
      );
      return;
    }
    // Le nom est RÉSERVÉ même quand l'outil sera retenu à la collecte : sans
    // cela, un module pourrait publier un homonyme public d'un outil protégé
    // qu'il ne voit pas, et l'agent croirait appeler celui qu'il a lu dans la
    // documentation. C'est pourquoi la réservation vit ICI, avant tout filtre.
    seen.add(tool.name);
    declared.push(tool);
  };

  for (const [name, module] of Object.entries(options.modules ?? {})) {
    if (
      typeof module !== "object" ||
      module === null ||
      !("getMcpTools" in module)
    ) {
      continue;
    }
    const declare = module.getMcpTools;
    if (typeof declare !== "function") continue;
    let tools: unknown;
    try {
      tools = declare.call(module);
    } catch (error) {
      options.onSkip?.(
        `module « ${name} » : getMcpTools() a échoué — ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (!Array.isArray(tools)) {
      options.onSkip?.(
        `module « ${name} » : getMcpTools() doit rendre un tableau`,
      );
      continue;
    }
    const ownsPrefix = ownsReservedPrefix(module);
    for (const tool of tools) {
      add(tool, `module ${name}`, ownsPrefix);
    }
  }

  return declared;
}

/**
 * Ramasse les outils SERVIS à cet appelant.
 *
 * Aux trois refus de {@link declareMcpTools} s'ajoute une RÉTENTION, qui n'est
 * pas une faute : un outil dont l'appelant ne satisfait pas les exigences
 * ({@link IMcpTool.scopes}, {@link IMcpTool.requiresAuth}) ne sort pas d'ici.
 * ⭐ **Filtrer À LA COLLECTE protège `tools/list` ET `tools/call` d'un seul
 * geste** : le protocole ne reçoit que les outils servis, donc un outil retenu
 * est « inconnu » pour lui — indistinguable d'un outil inexistant, ce qui ne
 * révèle même pas son existence. Filtrer la liste sans filtrer l'appel n'aurait
 * été qu'un rideau, et c'est l'erreur classique : deux points de décision, dont
 * un qu'on oublie.
 *
 * @param options - modules, appelant et journaux
 * @returns les outils exécutables, dans l'ordre où ils seront publiés
 */
export function collectMcpTools(options: IMcpCollectOptions): IMcpTool[] {
  const caller = options.caller ?? ANONYMOUS;
  const served: IMcpTool[] = [];
  for (const tool of declareMcpTools(options)) {
    const withheld = withholdReason(tool, caller);
    if (withheld !== null) {
      options.onWithheld?.(tool.name, withheld);
      continue;
    }
    served.push(tool);
  }
  return served;
}

/**
 * Le vocabulaire de scopes que cette porte EXIGE — l'union de ce que ses outils
 * déclarent, jamais une liste écrite à côté.
 *
 * 🔴 **C'est ce qu'un client doit demander**, et c'est à ce titre qu'il est
 * publié (RFC 9728 `scopes_supported`) et nommé dans le défi (RFC 6750
 * `scope`). Une liste de configuration disait autre chose que le code par
 * simple oubli, dans les deux sens et sans qu'aucun contrôle ne l'aperçoive :
 * un scope publié que rien n'exige envoie demander un droit qui n'ouvre rien ;
 * un scope exigé que rien ne publie laisse le client deviner ce qu'on attend de
 * lui — et un outil de module en était systématiquement là.
 *
 * L'énumération est délibérément celle des outils DÉCLARÉS, pas de ceux servis
 * à un appelant : le document se lit avant d'avoir un jeton, et un catalogue
 * filtré n'annoncerait à l'anonyme que ce dont il n'a pas besoin.
 *
 * @param options - modules et journal des écarts
 * @returns les scopes, dédupliqués et triés ; vide si la porte n'exige rien
 */
export function mcpDeclaredScopes(options: IMcpDeclareOptions): string[] {
  const vocabulaire = new Set<string>();
  for (const tool of declareMcpTools(options)) {
    for (const scope of tool.scopes ?? []) vocabulaire.add(scope);
  }
  // Trié : le document est comparé d'une exécution à l'autre (tests, revue), et
  // l'ordre d'un `Set` suit celui de la déclaration — donc il change dès qu'un
  // module s'ajoute, pour un contenu identique.
  return [...vocabulaire].sort();
}

/**
 * Projette les outils pour `tools/list` — sans leur implémentation.
 *
 * Le `handler` est une fermeture sur l'état du serveur ; `JSON.stringify` le
 * laisserait tomber en silence, mais compter là-dessus reviendrait à publier
 * par accident ce qu'on ne publie pas exprès.
 */
export function publishMcpTools(
  tools: readonly IMcpTool[],
): IMcpToolDefinition[] {
  return tools.map(({ name, description, inputSchema, annotations }) =>
    // Absent → le champ n'est pas émis : les défauts de la spec s'appliquent,
    // on n'invente aucune promesse au nom de l'auteur de l'outil.
    annotations === undefined
      ? { name, description, inputSchema }
      : { name, description, inputSchema, annotations },
  );
}

/**
 * Exécute un outil par son nom public.
 *
 * Un échec métier (sujet inconnu, module absent) rend un résultat `isError`,
 * **pas** une erreur JSON-RPC : le protocole réserve celle-ci aux fautes de
 * protocole. La distinction compte pour l'agent — une erreur de protocole
 * signifie « tu t'y prends mal », un `isError` signifie « ta demande est
 * recevable, voici pourquoi elle n'aboutit pas » ; c'est la seconde qu'il peut
 * corriger seul.
 *
 * ⭐ **Aucun contrôle d'autorisation ici, et c'est voulu** : `tools` ne contient
 * que ce que {@link collectMcpTools} a servi à CET appelant. Refaire la
 * vérification à ce niveau créerait un second point de décision — deux copies
 * d'une même règle, qui divergent en silence. Le corollaire tient en une
 * phrase : **ne jamais passer ici une liste non filtrée.**
 *
 * @param name - nom public de l'outil (`nodefony_inspect`…)
 * @param args - arguments fournis par l'agent
 * @param tools - outils servis, tels que {@link collectMcpTools} les a ramassés
 * @param caller - appelant établi, transmis au handler (anonyme par défaut)
 * @param run - annulation et progression de CET appel (détaché par défaut)
 * @returns le résultat de l'outil, ou `null` si le nom n'est pas exposé
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  tools: readonly IMcpTool[],
  caller: IMcpCaller = ANONYMOUS,
  run: IMcpToolRun = DETACHED_RUN,
): Promise<IMcpToolResult | null> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return null;
  }
  const refusal = unknownArguments(tool, args);
  if (refusal !== null) {
    return mcpText(refusal, true);
  }
  // Seule exception à « aucun contrôle ici » : ce que les ARGUMENTS exigent ne
  // se sait qu'à l'appel. Une porte protégée l'a déjà jugé (403 + défi) ; ce
  // contrôle couvre l'appel en process et la porte non protégée.
  const scopes = mcpCallScopes(tool, args);
  if (scopes === null) {
    return mcpText(
      `« ${tool.name} » : les scopes de cet appel sont indéterminables (\`scopesFor\` a levé ou rendu une forme fausse) — appel refusé`,
      true,
    );
  }
  const missing = missingScopes(caller.scopes, scopes);
  if (missing.length > 0) {
    return mcpText(insufficientScopeMessage(tool.name, missing), true);
  }
  return tool.handler(args, caller, run);
}

/**
 * Tous les scopes qu'exige UN appel : ceux de l'outil, puis ceux que ses
 * arguments ajoutent ({@link IMcpTool.scopesFor}). Seule source de la règle,
 * lue par l'appel en process ET par le défi `insufficient_scope` d'une porte.
 *
 * @param tool - outil servi
 * @param args - arguments de l'appel
 * @returns les scopes exigés, sans doublon ; `null` si `scopesFor` lève ou rend
 *   une forme fausse (l'appel est alors refusé, jamais servi sans borne)
 */
export function mcpCallScopes(
  tool: IMcpTool,
  args: Readonly<Record<string, unknown>>,
): readonly string[] | null {
  const base = tool.scopes ?? [];
  if (tool.scopesFor === undefined) return base;
  let extra: unknown;
  try {
    extra = tool.scopesFor(args);
  } catch {
    return null;
  }
  if (
    !Array.isArray(extra) ||
    !extra.every((scope: unknown) => typeof scope === "string")
  ) {
    return null;
  }
  return extra.length === 0 ? base : [...new Set([...base, ...extra])];
}

/**
 * Le message d'un appel refusé faute de scope — le même pour le résultat
 * `isError` et la description du défi `403`.
 *
 * @param name - nom de l'outil
 * @param missing - scopes absents du jeton
 * @returns l'explication, qui nomme les scopes à demander
 */
export function insufficientScopeMessage(
  name: string,
  missing: readonly string[],
): string {
  return `« ${name} » avec ces arguments exige le(s) scope(s) ${missing.join(" ")}, absent(s) du jeton présenté — redemander un jeton qui les porte`;
}

/**
 * L'exécution d'un appel SANS porte qui l'observe (appel direct, test) : jamais
 * annulé, progression muette. Partagé — un signal jamais abattu ne retient rien.
 */
const DETACHED_RUN: IMcpToolRun = {
  signal: new AbortController().signal,
  progress: () => {},
};

/**
 * Arguments que l'outil ne déclare pas — refusés, jamais ignorés.
 *
 * ⚠️ Un paramètre accepté puis jeté est pire qu'un refus : la réponse a l'air
 * d'avoir honoré la demande. Vécu sur cette porte — un `limit` passé à la
 * recherche documentaire revenait avec vingt résultats, sans un mot, et
 * l'appelant en concluait que la borne ne marchait pas plutôt que de voir
 * qu'elle n'avait jamais été transmise. Le même silence accueillait une clé
 * mal orthographiée : l'outil répondait comme si de rien n'était.
 *
 * La garde vit ICI, une fois, plutôt que dans chaque handler — et elle
 * s'applique donc aussi aux outils qu'une application déclare. Un outil qui
 * veut réellement des arguments libres l'écrit dans son schéma
 * (`additionalProperties: true`), ce qui en fait un choix relu, pas un défaut.
 *
 * @param tool - l'outil visé, avec son schéma d'entrée.
 * @param args - ce que l'agent a passé.
 * @returns le message de refus, ou `null` si tout est déclaré.
 */
function unknownArguments(
  tool: IMcpTool,
  args: Record<string, unknown>,
): string | null {
  // `declareMcpTools` ne vérifie pas le schéma d'un outil de module, qui peut
  // venir de JavaScript : il peut manquer.
  const schema = tool.inputSchema as
    | {
        properties?: Record<string, unknown>;
        additionalProperties?: unknown;
      }
    | undefined;
  if (schema?.additionalProperties === true) return null;
  const declared = schema?.properties;
  // Pas de `properties` du tout = schéma non descriptif : on ne peut rien
  // affirmer, et refuser sur une absence serait deviner.
  if (!declared || typeof declared !== "object") return null;
  const intruders = Object.keys(args).filter(
    (key) => !Object.hasOwn(declared, key),
  );
  if (intruders.length === 0) return null;
  const known = Object.keys(declared);
  return (
    `« ${tool.name} » ne connaît pas ${intruders.map((c) => `« ${c} »`).join(", ")}. ` +
    (known.length > 0
      ? `Arguments acceptés : ${known.join(", ")}.`
      : "Cet outil ne prend aucun argument.")
  );
}
