import {
  INSPECT_SUBJECTS,
  readAdminSubject,
  callAdminEndpoint,
  type IAdminBrokerLike,
  type InspectResult,
} from "../kernel/inspect/adminSubjects";
import { outlineMarkdown } from "../kernel/inspect/docOutline";
import type { IAdminCaller } from "../kernel/adminPlane/adminCaller";
import { ADMIN_SCOPE_READ } from "../kernel/adminPlane/adminCaller";
import {
  adminReadCatalog,
  findAdminReadEntry,
  type IAdminCatalogView,
} from "../kernel/adminPlane/catalog";
import { readSymbolsGraph, lookupSymbol } from "../cli/symbols";
import {
  collectCheckReport,
  countCheckFindings,
} from "../kernel/checks/runCheck";
import type {
  IMcpTool,
  IMcpToolDefinition,
  IMcpToolResult,
  IMcpCaller,
} from "../types/IMcpTool";

export type { IMcpTool, IMcpToolDefinition, IMcpToolResult, IMcpCaller };

/**
 * Outils MCP : le **catalogue intégré** du framework, et la **collecte** de ceux
 * qu'une application déclare.
 *
 * ⚠️ **Rien n'est calculé ici.** Chaque outil intégré traduit un appel JSON-RPC
 * vers une brique qui répond DÉJÀ à une autre porte : `inspect` lit le plan
 * d'administration par {@link readAdminSubject} (la même fonction que la
 * commande `nodefony inspect`), `check` appelle {@link collectCheckReport} (la
 * même que `nodefony check`). Une source, plusieurs portes — un outil qui
 * recalculerait sa réponse finirait par contredire la commande, et c'est lui
 * qu'on croirait sur parole.
 *
 * ⭐ **La description d'un outil est le premier critère de son déclenchement.**
 * Un modèle n'appelle pas ce qu'il ne comprend pas : le POC de 2026-05 l'a payé
 * cash — un outil à description neutre n'a jamais été appelé, un skill
 * auto-déclenché prenait la main à chaque fois. Ces descriptions disent donc ce
 * que l'outil rend ET quand s'en servir, pas seulement son nom.
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
const MCP_TEXT_MAX_CHARS = 32_000;

/** Ce qu'on garde d'une valeur dans une vue d'ensemble : la surface. */
const SCALAIRE_MAX_CHARS = 120;

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
function surfaceDe(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  const garde: Record<string, unknown> = {};
  for (const [cle, v] of Object.entries(value)) {
    if (v === null || typeof v === "number" || typeof v === "boolean") {
      garde[cle] = v;
    } else if (typeof v === "string" && v.length <= SCALAIRE_MAX_CHARS) {
      garde[cle] = v;
    } else if (Array.isArray(v) && v.every((e) => typeof e === "string")) {
      // Un tableau de mots courts EST de la surface (`methods: ["GET"]`) ; on
      // ne le garde que s'il ne se met pas à peser.
      const rendu = v.join(",");
      if (rendu.length <= SCALAIRE_MAX_CHARS) {
        garde[cle] = v;
      }
    }
  }
  return garde;
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
function resumer(value: unknown, taille: number): string {
  if (Array.isArray(value)) {
    const items = value.map(surfaceDe);
    let rendu = JSON.stringify(
      {
        count: value.length,
        note:
          `count = ${value.length} : c'est le nombre EXACT, il porte sur la liste entière. ` +
          `Les entrées ci-dessous sont ramenées à leur surface (${taille} caractères au complet) — ` +
          `demande le détail d'une entrée précise plutôt que la liste entière`,
        items,
      },
      null,
      2,
    );
    if (rendu.length <= MCP_TEXT_MAX_CHARS) {
      return rendu;
    }
    // La surface elle-même déborde : on borne, et le `count` reste EXACT — c'est
    // lui qui dit à l'agent qu'il ne voit pas tout.
    let gardees = items.length;
    while (gardees > 1 && rendu.length > MCP_TEXT_MAX_CHARS) {
      gardees = Math.floor(gardees / 2);
      rendu = JSON.stringify(
        {
          count: value.length,
          note:
            `count = ${value.length} : c'est le nombre EXACT, il porte sur la liste entière. ` +
            `Seules ${gardees} entrées sont montrées (la liste pèse ${taille} caractères) — ` +
            `toute affirmation sur le NOMBRE se fonde sur count, jamais sur les entrées visibles.`,
          items: items.slice(0, gardees),
        },
        null,
        2,
      );
    }
    return rendu;
  }
  const keys =
    value && typeof value === "object" ? Object.keys(value) : undefined;
  return JSON.stringify(
    {
      keys,
      note:
        `réponse de ${taille} caractères, trop volumineuse pour être rendue entière — ` +
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
 * résumé plutôt qu'un déversement (voir {@link resumer}). La garde vit ICI, et
 * non dans les quatre outils intégrés, pour qu'un outil déclaré par une
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
  const texte =
    isError || rendered.length <= MCP_TEXT_MAX_CHARS
      ? rendered
      : resumer(value, rendered.length);
  return isError
    ? { content: [{ type: "text", text: texte }], isError: true }
    : { content: [{ type: "text", text: texte }] };
}

/**
 * Marge laissée au corps d'un refus. Un producteur qui explique pourquoi il
 * refuse tient en quelques centaines d'octets (un plan de page, une liste de
 * valeurs) ; au-delà, c'est une donnée déguisée en message d'erreur, et une
 * réponse démesurée sature la fenêtre de celui qui la lit.
 */
const MCP_ERROR_BODY_MAX_CHARS = 4_000;

/**
 * Rend un refus du plan d'administration — la phrase ET ce que le producteur a
 * joint pour la corriger.
 *
 * ⚠️ Rendre la seule phrase faisait conclure l'inverse de la vérité : demander
 * une section absente d'une page PRÉSENTE produit « … introuvable (404) », et
 * l'agent en déduisait que la page n'existait pas — alors que le producteur
 * joignait le plan de cette page, c'est-à-dire la réponse. Une porte qui résume
 * un refus lui fait dire autre chose.
 *
 * @param read - l'échec rendu par la lecture, corps du producteur inclus.
 * @returns le résultat d'outil, en erreur, borné en volume.
 */
function mcpEchecAdmin(
  read: Extract<InspectResult, { ok: false }>,
): IMcpToolResult {
  if (read.body === undefined || read.body === null) {
    return mcpText(read.message, true);
  }
  const rendu = JSON.stringify(read.body, null, 2);
  const corps =
    rendu.length <= MCP_ERROR_BODY_MAX_CHARS
      ? rendu
      : `${rendu.slice(0, MCP_ERROR_BODY_MAX_CHARS)}\n… corps du refus tronqué (${rendu.length} caractères)`;
  return mcpText(`${read.message}\n\n${corps}`, true);
}

/**
 * Marge laissée à l'enveloppe JSON d'une page : `frontmatter`, `slug`, guillemets
 * échappés. Sous-estimer ferait retomber la page dans le résumé générique — celui
 * qui rend des CLÉS, c'est-à-dire rien d'utile sur un markdown.
 */
const DOC_ENVELOPE_CHARS = 4_000;

/**
 * Une page de documentation, ou son PLAN quand elle est trop lourde.
 *
 * Le résumé générique ({@link resumer}) sait ramener une liste à son compte et un
 * objet à ses clés ; sur une page de 78 ko il rendrait
 * `keys: [slug, frontmatter, markdown]` et conseillerait « demande une branche
 * précise » — une phrase qui ne désigne aucun geste possible. Le plan, lui, se lit
 * en quelques centaines d'octets et nomme exactement ce qu'il faut redemander.
 *
 * @param data - ce que le producteur a rendu pour la page
 * @param module - module interrogé, pour rédiger le geste suivant
 * @param slug - page interrogée, idem
 */
function pageOrOutline(data: unknown, module: string, slug: string): unknown {
  const page = data as { markdown?: unknown } | null;
  const markdown = typeof page?.markdown === "string" ? page.markdown : null;
  if (
    markdown === null ||
    markdown.length <= MCP_TEXT_MAX_CHARS - DOC_ENVELOPE_CHARS
  ) {
    return data;
  }
  return {
    ...(data as object),
    markdown: undefined,
    chars: markdown.length,
    note:
      `cette page pèse ${markdown.length} caractères — voici son PLAN. ` +
      `Rappelle l'outil avec section: "<titre>" ` +
      `(module: "${module}", slug: "${slug}") pour n'obtenir que le passage utile.`,
    outline: outlineMarkdown(markdown),
  };
}

/**
 * Clé de module telle que le kernel la connaît, depuis un nom de package npm.
 *
 * Le graphe symbolique indexe par nom npm (`@nodefony/http`) ; le plan
 * d'administration, lui, désigne les modules par leur clé courte (`http`), et
 * le socle sous le nom logique `core` — son package réel s'appelant `nodefony`
 * pour des raisons d'histoire. Deux vocabulaires pour une même chose : la
 * traduction vit ICI, une fois, plutôt que dans chaque appelant.
 */
function moduleKey(packageName: string): string {
  if (packageName === "nodefony" || packageName === "@nodefony/core") {
    return "core";
  }
  return packageName.replace(/^@nodefony\//u, "");
}

/**
 * Largeur maximale d'un résumé dans le catalogue d'administration.
 *
 * Le catalogue vaut par sa densité : soixante lignes qu'on parcourt d'un coup
 * d'œil. Un résumé de trois phrases y ferait perdre la colonne de gauche — le
 * chemin, c'est-à-dire la seule chose qu'on recopie ensuite.
 */
const CATALOG_SUMMARY_MAX = 96;

/** Largeur de la colonne des chemins, au-delà de laquelle on cesse d'aligner. */
const CATALOG_PATH_COLUMN = 34;

/**
 * Budget du catalogue rendu, sous la borne générique de {@link mcpText}.
 *
 * 🔴 Il ne s'agit pas de politesse : au-delà de sa borne, `mcpText` remplace une
 * CHAÎNE par une note générique — le résumé sait ramener une liste à son compte
 * et un objet à ses clés, mais d'un texte il ne garde rien. Le catalogue
 * disparaîtrait donc en entier, en conseillant « demande une branche précise »,
 * un geste qui ne désigne rien ici. On borne nous-mêmes, en gardant des entrées
 * ET en nommant les deux restrictions qui EXISTENT.
 */
const CATALOG_MAX_CHARS = 24_000;

/**
 * Met le catalogue en forme pour un lecteur qui va s'en servir tout de suite.
 *
 * Texte plutôt que JSON, et ce n'est pas une question de goût : la même
 * information sérialisée en objets indentés pèse environ trois fois plus, pour
 * une porte dont l'unique raison d'être est de ne pas coûter de contexte. Le
 * groupement par producteur porte la seule structure nécessaire — le producteur
 * est le premier argument de l'appel qui suit.
 *
 * @param view - ce que le cœur a retenu, et ce qu'il a écarté.
 * @returns le catalogue rendu, écarts annoncés.
 */
function renderAdminCatalog(view: IAdminCatalogView): string {
  const ecarts: string[] = [];
  if (view.mutations > 0) {
    ecarts.push(
      `${view.mutations} mutations (POST/PATCH/DELETE — cette porte ne fait que LIRE)`,
    );
  }
  if (view.selfService > 0) {
    ecarts.push(
      `${view.selfService} self-service liés à une session (« me », « sessions/mine ») — cette porte n'a pas d'utilisateur connecté`,
    );
  }
  if (view.denied > 0) {
    ecarts.push(`${view.denied} hors des droits de ce jeton`);
  }
  if (view.filtered > 0) {
    ecarts.push(`${view.filtered} hors du filtre demandé`);
  }

  const lines: string[] = [
    `${view.entries.length} lectures appelables — sur ${view.total} endpoints déclarés par cette application.`,
    `Appel : nodefony_admin_call { namespace, path, params?, query? } — recopier « path » TEL QUEL, variables comprises.`,
  ];
  if (ecarts.length > 0) {
    lines.push(`Non listés : ${ecarts.join(" · ")}.`);
  }

  let namespace: string | null = null;
  for (const entry of view.entries) {
    if (entry.namespace !== namespace) {
      namespace = entry.namespace;
      const count = view.entries.filter(
        (other) => other.namespace === namespace,
      ).length;
      lines.push("", `## ${namespace} (${count})`);
    }
    const summary =
      entry.summary.length > CATALOG_SUMMARY_MAX
        ? `${entry.summary.slice(0, CATALOG_SUMMARY_MAX - 1)}…`
        : entry.summary;
    const suffix = summary === "" ? "" : `  ${summary}`;
    lines.push(`${entry.path.padEnd(CATALOG_PATH_COLUMN)}${suffix}`.trimEnd());
    // Ce que l'endpoint accepte dans sa query, quand il rend une liste. Le
    // plan REFUSE en 400 tout tri ou filtre non déclaré : le taire ferait
    // conclure à un endpoint cassé là où il n'a rien promis.
    const caps: string[] = [];
    if (entry.page?.sortable.length) {
      caps.push(`tri: ${entry.page.sortable.join(",")}`);
    }
    if (entry.page?.filters.length) {
      caps.push(`filtres: ${entry.page.filters.join(",")}`);
    }
    if (entry.page?.search) caps.push("recherche q");
    if (caps.length > 0) {
      lines.push(`${" ".repeat(4)}${caps.join(" | ")}`);
    }
  }
  if (view.entries.length === 0) {
    lines.push("", "(aucune entrée ne répond à cette demande)");
  }
  const rendu = lines.join("\n");
  if (rendu.length <= CATALOG_MAX_CHARS) return rendu;
  // Bornage ANNONCÉ, et le geste proposé existe vraiment — restreindre par
  // producteur ou par termes. Une troncature muette ferait conclure que le
  // reste du plan n'existe pas.
  const coupe = rendu.slice(0, CATALOG_MAX_CHARS);
  const propre = coupe.slice(0, coupe.lastIndexOf("\n"));
  return `${propre}\n\n… catalogue tronqué (${rendu.length} caractères pour ${view.entries.length} entrées). Rappelle l'outil avec namespace: "<producteur>" ou q: "<termes>" pour voir le reste.`;
}

/**
 * Projette un argument d'agent en table de chaînes, ou dit pourquoi il ne l'est
 * pas.
 *
 * Refuser plutôt qu'ignorer : un paramètre accepté puis jeté produit une
 * réponse qui a l'air d'avoir honoré la demande, et c'est le pire des deux
 * mondes — l'appelant en tire une conclusion fausse sans jamais voir d'erreur.
 *
 * @param value - ce que l'agent a passé.
 * @param champ - nom du champ, pour rédiger le refus.
 * @param arrays - accepter les listes de chaînes (vrai pour une query string).
 * @returns la table, ou le motif du refus.
 */
function stringTable(
  value: unknown,
  champ: string,
  arrays: false,
): { ok: true; value: Record<string, string> } | { ok: false; why: string };
function stringTable(
  value: unknown,
  champ: string,
  arrays: true,
):
  | { ok: true; value: Record<string, string | string[]> }
  | { ok: false; why: string };
function stringTable(
  value: unknown,
  champ: string,
  arrays: boolean,
):
  | { ok: true; value: Record<string, string | string[]> }
  | { ok: false; why: string } {
  if (value === undefined || value === null) return { ok: true, value: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      why: `« ${champ} » doit être un objet { clé: valeur }`,
    };
  }
  const table: Record<string, string | string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      table[key] = raw;
      continue;
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      // Un agent écrit volontiers `{ limit: 20 }` : le convertir est fidèle à
      // son intention, une URL ne transporte de toute façon que du texte.
      table[key] = String(raw);
      continue;
    }
    if (
      arrays &&
      Array.isArray(raw) &&
      raw.every((item) => typeof item === "string")
    ) {
      table[key] = raw as string[];
      continue;
    }
    return {
      ok: false,
      why: `« ${champ}.${key} » n'est pas une valeur transportable — attendu du texte${arrays ? " ou une liste de textes" : ""}`,
    };
  }
  return { ok: true, value: table };
}

/** Ce dont les outils INTÉGRÉS ont besoin — injecté, jamais lu ici. */
export interface IMcpToolDeps {
  /** Le service `adminBroker` du conteneur, ou `undefined` s'il manque. */
  broker: IAdminBrokerLike | undefined;
  /** Compose la carte de visite de l'application. */
  getCard: () => unknown;
  /**
   * Racine depuis laquelle lire le disque (graphe symbolique, diagnostic).
   *
   * Injectée plutôt que lue par `process.cwd()` : le serveur répond dans le
   * process de l'application, dont le dossier courant n'est pas garanti être
   * celui du projet — et un outil qui diagnostiquerait le mauvais dossier
   * conclurait « rien à signaler » avec aplomb.
   */
  projectRoot: string;
}

/** Préfixe des noms d'outils intégrés — un agent voit à qui il parle. */
const PREFIX = "nodefony_";

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
 * Clés des outils intégrés — ce que l'allowlist de configuration nomme.
 *
 * Publiée pour qu'un schéma de configuration puisse la valider au lieu de la
 * retaper : une clé inconnue en config est silencieusement sans effet, et
 * l'utilisateur croit avoir activé quelque chose.
 */
export const BUILTIN_MCP_TOOL_KEYS = [
  "inspect",
  "card",
  "check",
  "symbols",
  "docs",
  "admin_list",
  "admin_call",
] as const;

/** Clé d'un outil intégré. */
export type BuiltinMcpToolKey = (typeof BUILTIN_MCP_TOOL_KEYS)[number];

/**
 * Liste des sujets, rendue lisible pour la description de l'outil.
 *
 * Dérivée de {@link INSPECT_SUBJECTS} : ajouter un sujet au cœur le publie ici
 * sans rien réécrire, et il ne peut pas exister de sujet annoncé qu'on ne
 * saurait pas lire.
 */
function subjectLines(): string {
  return Object.entries(INSPECT_SUBJECTS)
    .map(([key, spec]) => `- \`${key}\` : ${spec.summary}`)
    .join("\n");
}

/**
 * Catalogue intégré du framework, indexé par clé d'allowlist.
 *
 * Chaque handler capture ses dépendances par fermeture : c'est ce qui permet à
 * ces quatre outils d'être des {@link IMcpTool} ordinaires, du même type que
 * ceux d'une application — le serveur n'a plus aucun cas particulier à traiter.
 *
 * @param deps - briques qui répondent réellement
 */
export function builtinMcpTools(
  deps: IMcpToolDeps,
): Record<BuiltinMcpToolKey, IMcpTool> {
  return {
    inspect: {
      name: `${PREFIX}inspect`,
      description:
        "Lit l'état RÉEL de cette application Nodefony : les routes réellement " +
        "montées, les modules chargés, les services enregistrés, la " +
        "configuration effective et la provenance de chaque valeur, les stores " +
        "de données, les entités de l'ORM. À utiliser avant d'écrire du code " +
        "qui suppose une route, un service ou une clé de configuration — la " +
        "réponse vient de l'application qui tourne, pas d'une lecture des " +
        "sources, donc elle ne peut pas se tromper sur ce qui est chargé.\n\n" +
        `Sujets disponibles :\n${subjectLines()}`,
      inputSchema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            enum: Object.keys(INSPECT_SUBJECTS),
            description: "Ce qu'on veut voir",
          },
          target: {
            type: "string",
            description:
              "Paramètre du sujet, quand il en attend un (ex. le nom d'un module pour `module`)",
          },
        },
        required: ["subject"],
      },
      handler: async (args, caller) => {
        const subject = typeof args.subject === "string" ? args.subject : "";
        const target =
          typeof args.target === "string" ? args.target : undefined;
        const read = await readAdminSubject(
          deps.broker,
          subject,
          adminCallerFromMcp(caller),
          target,
        );
        return read.ok ? mcpText(read.data) : mcpEchecAdmin(read);
      },
    },

    card: {
      name: `${PREFIX}card`,
      description:
        "Carte de visite de l'application : son identité, les modules " +
        "chargés, où trouver la documentation, et les commandes à lancer. À " +
        "utiliser en ARRIVANT sur une application inconnue, avant toute autre " +
        "exploration — elle dit en un appel ce qu'il y a et où aller ensuite.",
      inputSchema: { type: "object", properties: {} },
      handler: () => mcpText(deps.getCard()),
    },

    check: {
      name: `${PREFIX}check`,
      description:
        "Diagnostic STATIQUE de l'application : classes écrites que rien " +
        "n'enregistre (entité, controller ou service jamais câblé), paquets " +
        "importés sans être déclarés, variables d'environnement requises " +
        "absentes, modules du manifeste non installés, ports occupés, et le " +
        "bilan du dernier démarrage. À utiliser APRÈS avoir écrit ou généré du " +
        "code, avant de conclure que c'est fini : ni la compilation ni les " +
        "tests ne voient qu'une classe n'est branchée à rien.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const report = await collectCheckReport(deps.projectRoot);
        // Le VERDICT accompagne le rapport : sans lui, un agent devrait
        // recompter trois listes pour savoir s'il peut passer à la suite — et
        // c'est exactement le genre de calcul qu'on lui fait rater.
        const total = countCheckFindings(report);
        return mcpText({
          verdict: total === 0 ? "ok" : "manquements",
          total,
          ...report,
        });
      },
    },

    docs: {
      name: `${PREFIX}docs`,
      description:
        "Cherche et lit la DOCUMENTATION des modules installés — la prose " +
        "écrite par leurs auteurs : concepts, recettes, pièges, exemples. À " +
        "utiliser AVANT d'écrire du code qui utilise une brique du framework, " +
        "et avant de conclure qu'une capacité n'existe pas. ⭐ Cette " +
        "documentation vit sous `node_modules`, que les outils de recherche de " +
        "fichiers EXCLUENT par défaut (dossier ignoré par git) : elle est " +
        "livrée avec les paquets mais introuvable autrement qu'ici.\n\n" +
        "Sans argument : ce que l'application documente, module par module. " +
        "Avec `query` : les pages qui portent tous les termes, avec leurs " +
        "extraits. Avec `module` et `slug` : la page. Une page pèse souvent " +
        "plus que ce qu'une réponse peut porter — demander alors `outline` " +
        "pour son plan, puis `section` pour le seul passage utile.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Texte cherché dans toute la documentation ; les espaces " +
              "séparent des termes CUMULATIFS (`session redis` = les deux)",
          },
          module: {
            type: "string",
            description:
              "Module dont on veut la documentation (`http`, `security`, `core`…)",
          },
          slug: {
            type: "string",
            description:
              "Page à lire, telle que la recherche ou l'index la nomme",
          },
          section: {
            type: "string",
            description:
              "Titre de la seule section voulue (approchant suffit : sans " +
              "accent, sans casse, sans emoji)",
          },
          outline: {
            type: "boolean",
            description:
              "Rendre le PLAN de la page au lieu de son corps — le premier " +
              "geste sur une page volumineuse",
          },
        },
      },
      handler: async (args, caller) => {
        const admin = adminCallerFromMcp(caller);
        const module = typeof args.module === "string" ? args.module : "";
        const slug = typeof args.slug === "string" ? args.slug : "";
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const section = typeof args.section === "string" ? args.section : "";

        // Lire UNE page : c'est le seul cas qui demande les deux coordonnées.
        if (module !== "" && slug !== "") {
          const read = await callAdminEndpoint(
            deps.broker,
            {
              namespace: "kernel",
              path: "module/{name}/docs/{slug}",
              params: { name: module, slug },
              query:
                section !== ""
                  ? { section }
                  : args.outline === true
                    ? { outline: "1" }
                    : {},
              label: `${module}/${slug}`,
            },
            admin,
          );
          if (!read.ok) return mcpEchecAdmin(read);
          return mcpText(pageOrOutline(read.data, module, slug));
        }
        if (query !== "") {
          const read = await callAdminEndpoint(
            deps.broker,
            {
              namespace: "kernel",
              path: "docs/search",
              query: { q: query },
              label: `recherche « ${query} »`,
            },
            admin,
          );
          return read.ok ? mcpText(read.data) : mcpEchecAdmin(read);
        }
        // Un module sans page nommée : son sommaire. Sans module : tout.
        const read =
          module !== ""
            ? await callAdminEndpoint(
                deps.broker,
                {
                  namespace: "kernel",
                  path: "module/{name}/docs",
                  params: { name: module },
                  label: module,
                },
                admin,
              )
            : await callAdminEndpoint(
                deps.broker,
                {
                  namespace: "kernel",
                  path: "docs",
                  label: "documentation",
                },
                admin,
              );
        return read.ok ? mcpText(read.data) : mcpEchecAdmin(read);
      },
    },

    symbols: {
      name: `${PREFIX}symbols`,
      description:
        "Donne la SIGNATURE RÉELLE d'un symbole du framework — ses " +
        "paramètres, ses types de retour, sa documentation — plus ce qu'il " +
        "étend ou implémente et où il est défini. À utiliser AVANT d'appeler " +
        "une classe, une interface ou une fonction du framework, plutôt que " +
        "d'en deviner les arguments. ⭐ La déclaration est lue dans les types " +
        "LIVRÉS du paquet installé (`node_modules`, que les outils de " +
        "recherche de fichiers excluent) : c'est la version qui tourne " +
        "vraiment, pas une supposition. Sans argument, rend le résumé du " +
        "graphe ; avec `module`, la surface exportée d'un paquet.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "Nom exact du symbole (ex. `AbstractCrudService`, `IKernel`)",
          },
          module: {
            type: "string",
            description:
              "Paquet dont on veut la surface exportée (ex. `@nodefony/http`)",
          },
        },
      },
      handler: async (args, caller) => {
        const graph = readSymbolsGraph(deps.projectRoot);
        if (graph === null) {
          // Dire que le graphe MANQUE, et comment le rétablir : le silence
          // laisserait croire que le symbole cherché n'existe pas.
          return mcpText(
            "aucun graphe symbolique atteignable — il est publié par le paquet " +
              "`nodefony` (node_modules/nodefony/.ai/symbols.json) et régénérable " +
              "dans ce dépôt par `npm run generate-symbols`",
            true,
          );
        }
        const wanted = typeof args.name === "string" ? args.name : null;
        const module = typeof args.module === "string" ? args.module : null;

        if (wanted !== null) {
          const sym = lookupSymbol(graph, wanted);
          if (!sym) {
            return mcpText(
              `« ${wanted} » est introuvable dans le graphe (${Object.keys(graph.symbols).length} symboles)`,
              true,
            );
          }
          // Le graphe dit qu'il existe ; la DÉCLARATION dit ce qu'il prend.
          // Sans elle, l'agent en est réduit à deviner une signature — et le
          // `.d.ts` qui la porte vit sous `node_modules`, que ses outils de
          // recherche excluent.
          const declared = await callAdminEndpoint(
            deps.broker,
            {
              namespace: "kernel",
              path: "module/{name}/symbol/{symbol}",
              params: { name: moduleKey(sym.module), symbol: sym.name },
              label: sym.name,
            },
            adminCallerFromMcp(caller),
          );
          return mcpText(
            declared.ok
              ? { ...sym, ...(declared.data as object) }
              : { ...sym, declaration: null, why: declared.message },
          );
        }

        const entries = Object.values(graph.symbols).filter(
          (s) => module === null || s.module === module,
        );
        if (module !== null) {
          return mcpText(entries.sort((a, b) => a.name.localeCompare(b.name)));
        }
        // Résumé : combien, et dans quels paquets — la question qu'on se pose en
        // premier quand un symbole manque à l'appel.
        const parPaquet: Record<string, number> = Object.create(null);
        for (const sym of entries) {
          parPaquet[sym.module] = (parPaquet[sym.module] ?? 0) + 1;
        }
        return mcpText({ total: entries.length, parPaquet });
      },
    },

    admin_list: {
      name: `${PREFIX}admin_list`,
      description:
        "Catalogue des lectures d'ADMINISTRATION que cette application " +
        "expose — bien au-delà des sujets de `nodefony_inspect` : journaux, " +
        "sessions, comptes, clés d'API, webhooks, profileur, santé des " +
        "connexions, entités, capacités de pagination. Chaque ligne est " +
        "directement appelable par `nodefony_admin_call`. À utiliser dès que " +
        "`nodefony_inspect` ne couvre pas ce qu'on cherche, plutôt que de " +
        "supposer que la donnée n'existe pas.\n\n" +
        "Un seul appel rend tout le catalogue ; `namespace` et `q` servent à " +
        "le réduire quand on sait déjà ce qu'on cherche.",
      inputSchema: {
        type: "object",
        properties: {
          namespace: {
            type: "string",
            description:
              "Ne garder qu'un producteur (`kernel`, `http`, `security`, `syslog`, `user`, `orm`…)",
          },
          q: {
            type: "string",
            description:
              "Termes cherchés dans le chemin et le résumé ; les espaces " +
              "séparent des termes CUMULATIFS (`session redis` = les deux)",
          },
        },
      },
      requiresAuth: true,
      scopes: [ADMIN_SCOPE_READ],
      handler: (args, caller) =>
        mcpText(
          renderAdminCatalog(
            adminReadCatalog(deps.broker, adminCallerFromMcp(caller), {
              namespace:
                typeof args.namespace === "string" ? args.namespace : undefined,
              q: typeof args.q === "string" ? args.q : undefined,
            }),
          ),
        ),
    },

    admin_call: {
      name: `${PREFIX}admin_call`,
      description:
        "Appelle une lecture d'administration, telle que `nodefony_admin_list` " +
        "la nomme. La réponse vient de l'application qui TOURNE — pas d'une " +
        "lecture des sources — et elle est identique à ce que rendrait la " +
        "console d'administration, redaction des secrets comprise.\n\n" +
        "LECTURE seule : les mutations du plan (créer, modifier, supprimer) ne " +
        "passent pas par ici. Recopier `namespace` et `path` tels quels ; " +
        "`params` porte les variables du chemin (`module/{name}` → " +
        '`{ name: "http" }`), `query` les paramètres de requête que ' +
        "l'endpoint accepte (pagination `page`/`limit`, tri `sort`, recherche " +
        "`q`). Le catalogue publie, sous chaque entrée qui rend une liste, les " +
        "tris et filtres RÉELLEMENT acceptés — tout le reste est refusé en 400, " +
        "jamais ignoré.",
      inputSchema: {
        type: "object",
        properties: {
          namespace: {
            type: "string",
            description: "Producteur, tel que le catalogue le titre",
          },
          path: {
            type: "string",
            description:
              "Chemin, recopié TEL QUEL du catalogue (variables `{…}` comprises)",
          },
          params: {
            type: "object",
            description:
              'Valeurs des variables du chemin, par nom (`{ name: "http" }`)',
            additionalProperties: { type: "string" },
          },
          query: {
            type: "object",
            description:
              'Paramètres de requête, comme une URL les porterait (`{ limit: "20" }`)',
          },
        },
        required: ["namespace", "path"],
      },
      requiresAuth: true,
      scopes: [ADMIN_SCOPE_READ],
      handler: async (args, caller) => {
        const admin = adminCallerFromMcp(caller);
        const namespace =
          typeof args.namespace === "string" ? args.namespace.trim() : "";
        const path = typeof args.path === "string" ? args.path.trim() : "";
        if (namespace === "" || path === "") {
          return mcpText(
            "« namespace » et « path » sont requis — demande d'abord " +
              "nodefony_admin_list, puis recopie les deux tels quels",
            true,
          );
        }

        // ⭐ Résolu DANS le catalogue, jamais à côté : ce qui n'y est pas
        // listé n'est pas appelable, et l'inverse est vrai aussi. Un second
        // parcours « équivalent » du registre finirait par diverger, et ce
        // serait celui-ci — le moins relu — qui deviendrait le permissif.
        const entry = findAdminReadEntry(deps.broker, admin, namespace, path);
        if (!entry) {
          const proches = adminReadCatalog(deps.broker, admin, { namespace });
          return mcpText(
            proches.entries.length === 0
              ? `« ${namespace}/${path} » n'est pas appelable ici, et « ${namespace} » ne propose aucune lecture — soit ce module n'est pas chargé, soit ce jeton ne l'ouvre pas. nodefony_admin_list rend le catalogue réel.`
              : `« ${namespace}/${path} » n'est pas appelable ici. Chemins de « ${namespace} » : ${proches.entries.map((other) => other.path).join(", ")}`,
            true,
          );
        }

        const params = stringTable(args.params, "params", false);
        if (!params.ok) return mcpText(params.why, true);
        const query = stringTable(args.query, "query", true);
        if (!query.ok) return mcpText(query.why, true);

        // Une variable de chemin absente ne produit pas une erreur lisible : le
        // handler reçoit `undefined` et refuse pour une raison qui n'a plus
        // aucun rapport avec l'oubli. On la nomme ici, où on la voit encore.
        const manquants = entry.params.filter(
          (name) => typeof params.value[name] !== "string",
        );
        if (manquants.length > 0) {
          return mcpText(
            `« ${namespace}/${path} » attend ${manquants.length > 1 ? "les variables" : "la variable"} ${manquants.map((name) => `« ${name} »`).join(", ")} dans « params »`,
            true,
          );
        }

        const read = await callAdminEndpoint(
          deps.broker,
          {
            namespace,
            path,
            method: "GET",
            params: params.value,
            query: query.value,
            label: `${namespace}/${path}`,
          },
          admin,
        );
        return read.ok ? mcpText(read.data) : mcpEchecAdmin(read);
      },
    },
  };
}

/** Ce qu'il faut pour ramasser les outils d'une application. */
export interface IMcpCollectOptions {
  /**
   * Allowlist des outils INTÉGRÉS (clés courtes, cf
   * {@link BUILTIN_MCP_TOOL_KEYS}).
   *
   * ⚠️ Elle ne porte QUE sur les intégrés. Un outil déclaré par un module est
   * publié sans condition : exiger qu'il soit AUSSI nommé ici en ferait un
   * outil accepté puis jeté — déclaré dans le code, absent de `tools/list`, et
   * sans le moindre message pour l'expliquer.
   */
  builtins: readonly string[];
  /** Dépendances des outils intégrés. */
  deps: IMcpToolDeps;
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
  onSkip?: (why: string) => void;
  /**
   * Ce que la porte a ÉTABLI de l'appelant. Absent = anonyme.
   *
   * Une porte sans authentification n'a rien à passer, et c'est le cas sûr :
   * l'anonyme par défaut RETIENT tout outil qui exige quoi que ce soit.
   */
  caller?: IMcpCaller;
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
 * L'appelant satisfait-il ce que l'outil exige ?
 *
 * @returns `null` s'il passe, sinon le motif de la rétention
 */
/**
 * Présente un appelant MCP au plan d'administration.
 *
 * Aucune décision ici : les rôles ont été posés par la porte, qui seule sait si
 * elle est protégée et par qui. Cette fonction ne fait que TRADUIRE — et c'est
 * volontaire : la traduction est le seul endroit où une identité pourrait se
 * perdre, alors elle ne fait rien d'autre que la transporter.
 *
 * @param caller - l'appelant établi par la porte.
 * @returns la même identité, dans le vocabulaire du plan d'administration.
 */
function adminCallerFromMcp(caller: IMcpCaller): IAdminCaller {
  return {
    user: null,
    roles: caller.roles,
    label: caller.subject
      ? `le porteur « ${caller.subject} »`
      : caller.authenticated
        ? "un porteur authentifié"
        : "un appelant anonyme",
  };
}

function withholdReason(tool: IMcpTool, caller: IMcpCaller): string | null {
  const needsScopes = tool.scopes !== undefined && tool.scopes.length > 0;
  if (!needsScopes && tool.requiresAuth !== true) {
    return null;
  }
  if (!caller.authenticated) {
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
 * Ramasse les outils servis par cette application : les intégrés autorisés,
 * puis ceux que les modules déclarent.
 *
 * Trois refus, tous énoncés par `onSkip` plutôt que silencieux :
 *  - **nom hors forme** ({@link NAME_PATTERN}) — il ne serait pas appelable ;
 *  - **collision** — le premier inscrit garde le nom, les intégrés passant en
 *    tête ; un module ne peut donc pas se substituer à `nodefony_inspect` et
 *    répondre à sa place ;
 *  - **déclaration en échec** — un `getMcpTools()` qui lève ne doit pas priver
 *    l'agent des outils de tous les autres modules.
 *
 * Et un quatrième, qui n'est pas un refus mais une RÉTENTION : un outil dont
 * l'appelant ne satisfait pas les exigences ({@link IMcpTool.scopes},
 * {@link IMcpTool.requiresAuth}) ne sort pas d'ici. ⭐ **Filtrer À LA COLLECTE
 * protège `tools/list` ET `tools/call` d'un seul geste** : le protocole ne
 * reçoit que les outils servis, donc un outil retenu est « inconnu » pour lui —
 * indistinguable d'un outil inexistant, ce qui ne révèle même pas son
 * existence. Filtrer la liste sans filtrer l'appel n'aurait été qu'un rideau, et
 * c'est l'erreur classique : deux points de décision, dont un qu'on oublie.
 *
 * @param options - allowlist, dépendances, modules, appelant et journaux
 * @returns les outils exécutables, dans l'ordre où ils seront publiés
 */
export function collectMcpTools(options: IMcpCollectOptions): IMcpTool[] {
  const collected: IMcpTool[] = [];
  const seen = new Set<string>();
  const caller = options.caller ?? ANONYMOUS;

  const add = (tool: IMcpTool, origin: string): void => {
    if (typeof tool?.name !== "string" || !NAME_PATTERN.test(tool.name)) {
      options.onSkip?.(
        `outil écarté (${origin}) : nom absent ou hors forme — attendu ${NAME_PATTERN.source}`,
      );
      return;
    }
    if (typeof tool.handler !== "function") {
      options.onSkip?.(
        `outil « ${tool.name} » écarté (${origin}) : sans handler`,
      );
      return;
    }
    if (seen.has(tool.name)) {
      options.onSkip?.(
        `outil « ${tool.name} » écarté (${origin}) : ce nom est déjà pris`,
      );
      return;
    }
    // Le nom est RÉSERVÉ même quand l'outil est retenu : sans cela, un module
    // pourrait publier un homonyme public d'un outil protégé qu'il ne voit
    // pas, et l'agent croirait appeler celui qu'il a lu dans la documentation.
    seen.add(tool.name);
    const withheld = withholdReason(tool, caller);
    if (withheld !== null) {
      options.onWithheld?.(tool.name, withheld);
      return;
    }
    collected.push(tool);
  };

  // Les intégrés d'abord : ils gagnent toute collision, donc aucun module ne
  // peut prendre la place de `nodefony_inspect` et répondre à sa place.
  const builtin = builtinMcpTools(options.deps);
  for (const key of options.builtins) {
    // `Object.hasOwn` n'est pas une précaution de style : sans lui,
    // `tools: ["toString"]` résolvait une méthode héritée d'`Object.prototype`,
    // la valeur n'étant pas `undefined` elle franchissait le filtre, et un
    // outil fantôme entrait dans le catalogue publié.
    if (Object.hasOwn(builtin, key)) {
      add(builtin[key as BuiltinMcpToolKey], "intégré");
    }
  }

  for (const [name, module] of Object.entries(options.modules ?? {})) {
    const declare = (module as { getMcpTools?: unknown } | null)?.getMcpTools;
    if (typeof declare !== "function") continue;
    let declared: unknown;
    try {
      declared = (declare as () => unknown).call(module);
    } catch (error) {
      options.onSkip?.(
        `module « ${name} » : getMcpTools() a échoué — ${(error as Error).message}`,
      );
      continue;
    }
    if (!Array.isArray(declared)) {
      options.onSkip?.(
        `module « ${name} » : getMcpTools() doit rendre un tableau`,
      );
      continue;
    }
    for (const tool of declared) {
      add(tool as IMcpTool, `module ${name}`);
    }
  }

  return collected;
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
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
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
 * @returns le résultat de l'outil, ou `null` si le nom n'est pas exposé
 */
export async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  tools: readonly IMcpTool[],
  caller: IMcpCaller = ANONYMOUS,
): Promise<IMcpToolResult | null> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return null;
  }
  return tool.handler(args, caller);
}
