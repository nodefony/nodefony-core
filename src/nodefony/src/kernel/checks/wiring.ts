/**
 * Contrôle de CÂBLAGE — une classe écrite, mais que rien ne déclare.
 *
 * Le générateur (`nodefony create entity|controller`) pose le fichier ET son
 * câblage : l'entité entre dans `@entities([…])`, le controller dans
 * `@controllers([…])`. Écrit à la main, le fichier arrive seul — il compile, les
 * tests qui l'importent directement passent, et la panne n'apparaît qu'au
 * démarrage suivant : une table qui n'est jamais créée, un repository qui lève
 * « entité inconnue », une route qui répond 404 sans que rien ne l'explique.
 *
 * C'est le mode d'échec de la COPIE. Sur une application neuve, le générateur
 * est le chemin le plus court ; dès qu'une entité existe, copier le voisin le
 * devient — et personne ne peut garantir qu'un agent, ou un humain pressé,
 * appellera la commande. On ne fait donc pas appeler le générateur : on fait
 * échouer ce qui ne l'a pas appelé.
 *
 * Lecture PURE, comme le reste de `nodefony doctor` : aucun boot, aucun import du
 * code analysé. Le contrôle doit répondre y compris sur une application qui ne
 * démarre plus — c'est précisément là qu'on le consulte.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findReservedEntity } from "../../cli/scaffold/reservedEntities";
import { ROUTE_PATH_RE } from "../../cli/scaffold/routePaths";
import { collectSources } from "./walk";
import {
  extractManifestModuleOrder,
  findStoreOrderFault,
  readInstalledStoreManifest,
  storeOrderFaultMessage,
} from "../storeManifest";
import {
  readManifestSources,
  withoutComments,
  diskManifestReader,
  reservedFragmentFiles,
  fragmentsWithoutSatisfies,
} from "./sourceText";

/** Un câblage manquant, ou un nom qui dépossède un module du framework. */
export interface IWiringFinding {
  kind:
    | "orphan-entity"
    | "orphan-controller"
    | "orphan-service"
    | "reserved-entity"
    | "missing-brick"
    | "store-order"
    | "route-colon-param"
    | "reponse-a-la-main"
    | "firewall-area-enumere"
    | "hook-lifecycle-inconnu"
    | "reserved-fragment-name"
    | "champ-facultatif-que-la-base-exige"
    | "fragment-without-satisfies";
  /** Phrase lisible, déjà orientée vers la correction. */
  message: string;
  /** Fichier fautif, relatif à la racine analysée. */
  file: string;
}

/**
 * Une INFORMATION de câblage — ni erreur ni avertissement : l'application
 * démarre, mais un lecteur statique (le générateur, un agent) y lit autre chose
 * que ce qui tournera. Jamais comptée dans le verdict de `doctor`.
 */
export interface IWiringNotice {
  kind: "orm-connector-fallback" | "orm-connector-in-code";
  /** Phrase lisible, avec le geste qui la fait taire. */
  message: string;
  /** Fichier concerné, relatif à la racine analysée. */
  file: string;
}

export interface IWiringCheckOptions {
  /** Cibles à explorer : une application, et ses `modules/*`. */
  roots: string[];
  /** Racine servant à raccourcir les chemins affichés. */
  cwd?: string;
  /**
   * Racine du PROJET — c'est elle qui porte le manifeste des modules.
   *
   * Distincte des cibles : un module vit dans `modules/blog`, mais la brique
   * dont son code dépend se déclare dans le `nodefony.config.ts` de
   * l'application. Absente, le contrôle des briques est simplement sauté.
   */
  projectRoot?: string;
}

/**
 * Ce qu'un code EXIGE d'avoir été déclaré, et que la compilation ne dit pas.
 *
 * Le générateur refuse d'écrire quand la brique manque — c'est une de ses
 * gardes. Écrit à la main, le même code compile dès que le paquet traîne dans
 * `node_modules` (hissé par une transitive), et la panne attend le démarrage :
 * le module n'étant pas dans le manifeste, il n'est jamais chargé, donc le canal
 * n'existe pas, l'entité n'est enregistrée nulle part, la garde ne garde rien.
 *
 * Le marqueur vise l'USAGE, jamais la définition : `extends RealtimeController`
 * et non `class RealtimeController`, sans quoi le module qui fournit la brique
 * s'accuserait lui-même.
 */
const BRICKS: ReadonlyArray<{
  marker: RegExp;
  packages: string[];
  what: string;
}> = [
  {
    marker: /extends\s+RealtimeController\b|@RealtimeChannel\b/u,
    packages: ["@nodefony/realtime"],
    what: "un canal temps réel",
  },
  {
    marker: /\bdefineEntity\s*\(/u,
    packages: ["@nodefony/drizzle", "@nodefony/mongoose"],
    what: "une entité",
  },
  {
    marker: /@IsGranted\b/u,
    packages: ["@nodefony/security"],
    what: "une garde d'autorisation",
  },
];

export interface IWiringCheckResult {
  findings: IWiringFinding[];
  /** Informations — hors verdict (cf {@link IWiringNotice}). */
  notices: IWiringNotice[];
  /** Nombre de fichiers d'entité et de controller réellement analysés. */
  scanned: number;
}

/**
 * `export const XEntity = defineEntity({` — le descripteur, pas la table.
 *
 * C'est LUI que `@entities([…])` doit nommer : la table Drizzle seule
 * n'enregistre rien, et une application qui ne déclare que la table démarre
 * sans sa propre entité.
 */
const ENTITY_RE = /export\s+const\s+(\w+)\s*=\s*defineEntity\s*\(/gu;

/** Les modules ORM dont un connecteur peut se déclarer dans le manifeste. */
const ORM_PACKAGES = ["@nodefony/drizzle", "@nodefony/mongoose"] as const;
/** Un bloc `connectors: {` — la déclaration, là où le générateur la lit. */
const CONNECTORS_BLOCK_RE = /\bconnectors\s*:\s*\{/u;
/** `new DrizzleOrm("nom"` — un connecteur ouvert dans le code. */
const ORM_IN_CODE_RE =
  /\bnew\s+(DrizzleOrm|MongooseOrm)\s*\(\s*(?:["'`]([\w-]+)["'`])?/gu;
/** La définition d'un adapter — sa cible est épargnée. */
const ORM_CLASS_DEFINITION_RE = /\bclass\s+(?:DrizzleOrm|MongooseOrm)\b/u;

/**
 * Les colonnes qu'une entité rend OBLIGATOIRES sans leur donner de défaut.
 *
 * Une colonne `notNull()` sans `default`/`$defaultFn` n'accepte rien d'absent :
 * si le contrat d'entrée la laisse facultative, la validation passe et c'est la
 * BASE qui refuse — un 500, là où l'application devait rendre un 422 nommant le
 * champ. La clé primaire est écartée : elle est presque toujours engendrée.
 *
, et un motif qui l'ignore tronque la chaîne AVANT lui — la colonne ressort
 * alors « exigée » bien qu'elle porte un défaut. Mesuré sur le `createdAt` du
 * gabarit, qui aurait été accusé à tort le jour où son contrat le rend facultatif.
 *
 * @param source - le texte du fichier d'entité, commentaires déjà retirés.
 * @returns les noms de colonnes exigées, en minuscules.
 */
export function requiredColumns(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(
    /(\w+)\s*:\s*(\w+)\s*\((?:[^()]|\([^()]*\))*\)((?:\s*\.[\w$]+\s*\((?:[^()]|\([^()]*\))*\))*)/gu,
  )) {
    const field = m[1];
    const suffixes = m[3] ?? "";
    if (field === undefined) continue;
    if (!/\.notNull\s*\(/u.test(suffixes)) continue;
    // Un défaut, une clé primaire : l'absence est alors légitime à l'entrée.
    if (
      /\.(?:default|\$defaultFn|defaultNow|primaryKey)\s*\(/u.test(suffixes)
    ) {
      continue;
    }
    out.push(field.toLowerCase());
  }
  return out;
}

/**
 * Les champs qu'un contrat de CRÉATION déclare facultatifs.
 *
 * Le schéma de mise à jour est volontairement ignoré : un `.partial()` rend
 * tout facultatif, et c'est son rôle — une modification ne renvoie pas l'objet
 * entier. Seule la création doit exiger ce que la base exige.
 *
 * @param source - le texte du fichier `*.schema.ts`, commentaires retirés.
 * @returns les noms de champs facultatifs, en minuscules.
 */
export function optionalInputFields(source: string): string[] {
  const creation =
    /export\s+const\s+create\w*Schema\s*=\s*z\s*\.\s*\w*[Oo]bject\s*\(\s*\{([\s\S]*?)\n\}\s*\)/u.exec(
      source,
    )?.[1];
  if (creation === undefined) return [];
  const out: string[] = [];
  for (const m of creation.matchAll(/(\w+)\s*:\s*([^\n]*)/gu)) {
    const field = m[1];
    const right = m[2] ?? "";
    if (field === undefined) continue;
    if (/\.(?:optional|nullish)\s*\(/u.test(right))
      out.push(field.toLowerCase());
  }
  return out;
}

/** `name: "Post"` du descripteur — ce que voit le registre ORM, qui est PLAT. */
const ENTITY_NAME_RE = /\bname\s*:\s*["'`](\w+)["'`]/u;

/** `export class XController` — décoré ou non, la déclaration est la même. */
const CONTROLLER_RE = /export\s+class\s+(\w*Controller)\b/gu;

/**
 * `@injectable()` posé sur une classe — le marqueur, pas le dossier.
 *
 * Viser le décorateur plutôt qu'un emplacement (`nodefony/service`) évite
 * d'imposer une convention que le framework n'impose pas : un service se
 * reconnaît à ce qu'il déclare, et l'application le range où elle veut.
 * Une classe `abstract` est exclue à la lecture — c'est une base, pas une
 * instance à enregistrer.
 */
const SERVICE_RE =
  /@injectable\s*\([\s\S]{0,160}?\)\s*(?:export\s+)?(?:default\s+)?(abstract\s+)?class\s+(\w+)/gu;

/** Contenu de chaque `@services([…])` — la liste, pas l'appel. */
const SERVICES_LIST_RE = /@services\s*\(\s*\[([\s\S]{0,2000}?)\]/gu;

/**
 * Enregistrement IMPÉRATIF d'un service, la seconde voie légitime.
 *
 * La règle du contrôle est « quelqu'un te DÉCLARE », pas « tu passes par le
 * décorateur » : les modules du framework posent une partie de leurs services à
 * la main, souvent parce que l'instance dépend d'une valeur résolue au
 * démarrage. Les tenir pour orphelins accuserait le cœur de ne pas suivre une
 * convention dont il est l'auteur.
 */
const IMPERATIVE_RE =
  /(?:addService|container\.set|\.set)\s*\(\s*[^)]{0,120}?\b(\w+)\b/gu;

/**
 * Le segment variable écrit à la mode d'un AUTRE framework : `/:handle`.
 *
 * Nodefony écrit `{handle}` ; Express, Nest et Fastify écrivent `:handle`. La
 * confusion ne produit ni erreur de compilation ni avertissement au démarrage :
 * le chemin est monté comme un LITTÉRAL, la route apparaît dans
 * `inspect routes`, et elle ne correspond à aucune URL réelle. Le symptôme est
 * un 404 sur une route qu'on voit dans le code — le plus coûteux à diagnostiquer
 * de tous, puisque tout a l'air juste.
 *
 * Le `/` exigé devant le `:` écarte ce qui n'est pas un segment : `http://`,
 * `C:/`, une heure. Un deux-points ailleurs dans un chemin ne dit rien.
 */
const COLON_SEGMENT_RE = /\/:(\w+)/u;

/** Une classe de ce fichier étend-elle `Controller` ? Sinon la réponse ne la concerne pas. */
const EXTENDS_CONTROLLER_RE = /\bclass\s+\w+\s+extends\s+Controller\b/u;

/**
 * La réponse HTTP écrite À LA MAIN, alors qu'une façade la rend.
 *
 * Mesuré sur le banc de découvrabilité : servir une PAGE est le seul rendu dont
 * aucun gabarit d'application sans frontend ne montre d'exemple, et l'
 * `AGENTS.md` ne nommait aucune façade de réponse ordinaire. Deux agents sur
 * trois ont donc bricolé — l'un en castant (`this.response as any`), l'autre en
 * posant `Content-Type` lui-même. Les deux « marchent » à l'essai : c'est
 * exactement pourquoi rien ne les signale.
 *
 * Ce qui se perd, et qu'aucun test de l'application ne voit : la négociation de
 * contenu, l'encodage, le nonce CSP de la requête, et les hooks de fin de
 * réponse (journal, profileur, métriques) que le pipeline attache autour de
 * `render`. Écrire dans le socle court-circuite la couche qui les porte.
 *
 * Trois motifs, un seul manquement — chacun est une façon distincte de sortir
 * du pipeline, et chacun a sa façade :
 * `this.renderJson(obj)` · `this.setContextHtml()` + `this.render(html)` ·
 * `this.streamFile(f)` / `renderMediaStream(f)` / `renderFileDownload(f)`.
 *
 * Poser un en-tête MÉTIER (`X-Total-Count`, `Cache-Control`) reste légitime et
 * n'est pas visé : seul `Content-Type` l'est, parce que c'est la façade qui le
 * décide, et parce que le poser deux fois produit une réponse que le client lit
 * de travers.
 */
const RESPONSE_CAST_RE = /\bthis\.response\s+as\s+(?:any|unknown)\b/u;

/** `setHeader("Content-Type", …)` ou `setHeaders({ "content-type": … })`, sur quoi que ce soit. */
const RESPONSE_CONTENT_TYPE_RE =
  /\.setHeaders?\s*\(\s*(?:\{\s*)?["'`]content-type["'`]/iu;

/** L'écriture directe dans le socle : `this.response.end(…)`, `writeHead(…)`. */
const RESPONSE_RAW_WRITE_RE =
  /\bthis\.response\s*\??\.\s*(?:end|writeHead)\s*\(/u;

/**
 * Les TROIS hooks de cycle de vie qu'un module peut porter — la liste est
 * fermée par le code, pas par une convention.
 *
 * `Module.setEvents()` (`Module.ts:222`) attache chacun sous un `if
 * (this.onKernelX)`. Un nom voisin — `onKernelBooted`, `onBoot`,
 * `onKernelStart` recopié d'une Command — n'entre dans aucun de ces `if` :
 * la méthode est écrite, elle compile, elle s'affiche dans le fichier, et elle
 * n'est JAMAIS appelée. Aucun test ne le voit non plus, sauf à démarrer le
 * kernel entier ; le symptôme est une initialisation qui n'a pas lieu, très
 * loin de sa cause.
 */
const HOOKS_MODULE = new Set([
  "onKernelRegister",
  "onKernelBoot",
  "onKernelReady",
]);

/**
 * Une DÉCLARATION de méthode `onKernel…`, jamais un appel.
 *
 * L'ancrage en début de ligne (indentation d'un corps de classe) écarte
 * `this.onKernelBoot()` et `module.onKernelReady()` : un appel au bon hook ne
 * doit pas s'accuser lui-même.
 */
const HOOK_DECL_RE =
  /^\s{2,}(?:public\s+|private\s+|protected\s+)?(?:override\s+)?(?:async\s+)?(onKernel\w+)\s*\(/gmu;

/** Une classe de ce fichier étend-elle `Module` ? Sinon les hooks ne la concernent pas. */
const EXTENDS_MODULE_RE = /\bclass\s+\w+\s+extends\s+Module\b/u;

/** Où commence le bloc `areas: {` du manifeste. */
const AREAS_START_RE = /\bareas\s*:\s*\{/u;

/**
 * Le bloc `areas: { … }` du manifeste, et lui seul — accolades ÉQUILIBRÉES.
 *
 * `pattern:` est un mot trop courant pour être lu partout — la clé existe dans
 * une config de bundler, une règle de lint, un routeur front. Le contrôle ne
 * doit accuser que ce qu'il comprend.
 *
 * 🔴 Le comptage n'est pas un raffinement : une expression régulière ne sait
 * pas équilibrer des accolades, et celle qui tenait ce rôle s'arrêtait à la
 * PREMIÈRE fermante peu indentée — donc à la fin de la première zone. Toutes
 * les zones suivantes échappaient au contrôle en silence, et un manifeste à
 * cinq zones n'en faisait juger qu'une.
 *
 * @param source - le manifeste, commentaires déjà retirés.
 * @returns le corps du bloc, ou `null` s'il n'y en a pas.
 */
function extractAreasBlock(source: string): string | null {
  const start = AREAS_START_RE.exec(source);
  if (!start) return null;
  const from = start.index + start[0].length;
  let depth = 1;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(from, i);
    }
  }
  return null; // bloc non refermé : on ne juge pas ce qu'on ne comprend pas
}

/** `pattern: "^/api/account"` — la valeur écrite, telle quelle. */
const AREA_PATTERN_RE = /\bpattern\s*:\s*["'`]([^"'`\n]+)["'`]/gu;

/** L'en-tête d'une zone du bloc `areas` — `"nom": {` ou `nom: {`. */
const AREA_ENTRY_RE = /["'`]?[\w-]+["'`]?\s*:\s*\{/gu;

/** `authenticators: ["session", "anonymous"]` — la liste écrite, telle quelle. */
const AREA_AUTHENTICATORS_RE = /\bauthenticators\s*:\s*\[([^\]]*)\]/u;

/**
 * Les zones d'un bloc `areas` — leur pattern, et ce que chacune FAIT.
 *
 * Le pattern seul ne suffit pas à juger : une zone qui OUVRE et une zone qui
 * FERME se jugent à l'envers l'une de l'autre (cf {@link zoneEnumere}). Le
 * découpage se fait sur les EN-TÊTES de zone plutôt que sur les accolades —
 * un corps de zone est plat en pratique, et une accolade équilibrée ne se lit
 * pas en expression régulière.
 *
 * Limite assumée : une zone qui imbriquerait un sous-objet AVANT sa liste
 * d'authenticators verrait cette liste rattachée à la tranche suivante, donc
 * serait lue comme fermée. C'est le comportement d'avant cette distinction —
 * on signale, quitte à être prudent, jamais l'inverse.
 *
 * @param areasBlock - le corps du bloc `areas`, commentaires déjà retirés.
 * @returns une entrée par zone portant un `pattern`.
 */
function parseAreas(
  areasBlock: string,
): { pattern: string; grantsAnonymous: boolean }[] {
  const starts: number[] = [];
  const entryRe = new RegExp(AREA_ENTRY_RE.source, "gu");
  let entry: RegExpExecArray | null;
  while ((entry = entryRe.exec(areasBlock)) !== null) starts.push(entry.index);

  const areas: { pattern: string; grantsAnonymous: boolean }[] = [];
  for (let i = 0; i < starts.length; i++) {
    const slice = areasBlock.slice(
      starts[i],
      starts[i + 1] ?? areasBlock.length,
    );
    const pattern = new RegExp(AREA_PATTERN_RE.source, "u").exec(slice)?.[1];
    if (pattern === undefined) continue;
    const list = AREA_AUTHENTICATORS_RE.exec(slice)?.[1] ?? "";
    areas.push({
      pattern,
      grantsAnonymous: /["'`]anonymous["'`]/u.test(list),
    });
  }
  return areas;
}

/**
 * La part LITTÉRALE d'un pattern — ce qu'il couvre à coup sûr.
 *
 * `^/api/account/(profile|invoices)` → `/api/account`. On coupe au premier
 * métacaractère, puis au dernier `/` : un segment tronqué (`/api/acc`) ne
 * désigne rien et ferait un conseil faux.
 */
function prefixeLitteral(pattern: string): string {
  const withoutAnchor = pattern.replace(/^\^/u, "");
  const coupe = withoutAnchor.search(/[([{|?*+$\\]/u);
  const litteral = coupe === -1 ? withoutAnchor : withoutAnchor.slice(0, coupe);
  const last = litteral.lastIndexOf("/");
  return last > 0 ? litteral.slice(0, last) : litteral;
}

/**
 * Une zone qui ÉNUMÈRE des routes au lieu de couvrir un espace.
 *
 * Le mode d'échec est mesuré, pas supposé : sommés de protéger deux routes d'un
 * même espace, 3 agents sur 4 écrivent `^/api/account/(profile|invoices)`. Les
 * deux routes refusent bien l'anonyme, les tests passent, la revue passe — et la
 * TROISIÈME route de l'espace, ajoutée plus tard, est publique. Rien ne le
 * signale : la zone existe et paraît couvrir l'espace.
 *
 * Le contrôle ne peut pas le voir en interrogeant les routes (elles n'existent
 * pas encore — c'est tout le problème), donc il lit la FORME. Deux signaux, et
 * aucun n'est une question de style :
 *
 * - une **ancre de fin** (`$`) — la zone ne couvre qu'un chemin exact, donc
 *   aucune route sœur, jamais ;
 * - une **alternance** précédée d'au moins deux segments littéraux
 *   (`/api/account/(…|…)`) — l'alternance sert alors à lister des routes. En
 *   tête (`^/(api|admin)`) elle désigne au contraire deux espaces : légitime,
 *   et épargnée.
 *
 * 🔴 **Ce raisonnement ne vaut que pour une zone qui PROTÈGE.** Une zone qui
 * OUVRE — `"anonymous"` dans ses authenticators — l'inverse terme à terme :
 * énumérer y est le geste JUSTE, puisque c'est un pattern LARGE qui ouvrirait
 * tout l'espace. Le tri se fait donc chez l'appelant ({@link parseAreas}), et
 * pas ici : le conseil rendu par ce contrôle (« écris `^/api` ») ouvrirait
 * alors à l'anonyme l'espace entier que la zone fermée voisine vient de
 * boucher. C'est exactement ce que le gabarit d'application recommande
 * d'écrire, et que ce contrôle condamnait.
 *
 * @param pattern - la valeur écrite dans le manifeste.
 * @returns le préfixe à employer, ou `null` si la zone est saine.
 */
function zoneEnumere(pattern: string): string | null {
  const body = pattern.replace(/^\^/u, "");
  const prefix = prefixeLitteral(pattern);
  const segments = prefix.split("/").filter(Boolean).length;
  if (/\$/u.test(body)) return prefix;
  if (/\([^)]*\|/u.test(body) && segments >= 2) return prefix;
  return null;
}

/**
 * Où le câblage d'une cible peut vivre — et nulle part ailleurs.
 *
 * Borner n'est pas une optimisation : depuis la racine d'un dépôt, un parcours
 * libre descend dans les décors jetables (`tmp/`), les applications d'exemple et
 * les bases de développement, et rend des manquements qui n'appartiennent à
 * personne. Un contrôle qui accuse le décor est un contrôle qu'on désactive.
 */
const WIRING_DIRS = ["nodefony", "src"];

/**
 * Sources qui CÂBLENT — les tests en sont exclus, et ce n'est pas un détail.
 *
 * Le test généré par `create entity` importe l'entité pour l'enregistrer sur une
 * base en mémoire. Le compter comme une référence rendrait le contrôle aveugle
 * exactement au cas qu'il cherche : un fichier écrit à la main, importé par son
 * seul test, et absent du démarrage réel.
 *
 * Même filtre que les sources embarquées de `checkPackageDeps`, pour une raison
 * différente — là-bas les tests ne partent pas dans le paquet, ici ils ne
 * câblent pas l'application.
 */
function wiringSources(dir: string): string[] {
  const found: string[] = [];
  // L'`index.ts` de la cible porte les décorateurs-listes : il est le premier
  // endroit où un symbole doit apparaître, et souvent le seul.
  for (const name of ["index.ts", "index.tsx"]) {
    const f = path.join(dir, name);
    if (statSync(f, { throwIfNoEntry: false })) found.push(f);
  }
  // Le marcheur et sa règle d'exclusion sont COMMUNS (`walk.ts`) : recopiée
  // ici, la liste divergeait de celle des autres contrôles au premier ajout.
  found.push(
    ...collectSources(dir, {
      extensions: [".ts", ".tsx"],
      subdirs: WIRING_DIRS,
    }),
  );
  return found;
}

/** Lit un fichier, ou rend la chaîne vide (un fichier illisible n'accuse personne). */
function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** Le symbole est-il nommé quelque part AILLEURS que dans son propre fichier ? */
function referencedElsewhere(
  symbol: string,
  ownFile: string,
  sources: Map<string, string>,
): boolean {
  const re = new RegExp(`\\b${symbol}\\b`, "u");
  for (const [file, content] of sources) {
    if (file === ownFile) continue;
    if (re.test(content)) return true;
  }
  return false;
}

/**
 * Une cible plausible : un dossier qui porte `nodefony/entity` ou
 * `nodefony/controllers`. Tout le reste n'a rien à câbler.
 */
function isTarget(dir: string): boolean {
  return ["entity", "controllers", "service", "services"].some((sub) =>
    statSync(path.join(dir, "nodefony", sub), { throwIfNoEntry: false }),
  );
}

/**
 * Contrôle le câblage d'une application et de ses modules locaux.
 *
 * Trois manquements, tous invisibles à la compilation :
 *
 * - **entité orpheline** — le descripteur n'est nommé nulle part, donc aucun
 *   `@entities([…])` ne l'enregistre : sa table ne sera pas créée ;
 * - **controller orphelin** — la classe n'est nommée nulle part, donc aucune de
 *   ses routes n'est montée ;
 * - **service orphelin** — la classe porte `@injectable` mais n'apparaît dans
 *   aucun `@services([…])` ni enregistrement impératif. Seul manquement dont
 *   le critère n'est PAS « quelqu'un te nomme » : un service non déclaré est
 *   presque toujours nommé — par le controller qui le reçoit en paramètre. Le
 *   framework l'auto-résout alors depuis le registre des classes, ce qui donne
 *   une application qui fonctionne et un service qui n'existe pour personne
 *   d'autre : hors ordre de démarrage, hors rapport de boot, hors politique
 *   d'erreur, hors introspection, construit à la première requête ;
 * - **nom réservé** — l'entité porte le nom d'une entité d'un module du
 *   framework (`User`, `session`…). Le registre ORM est PLAT : l'homonyme
 *   dépossède le module, et l'application s'arrête au démarrage sur un message
 *   qui parle d'une colonne inconnue, jamais du doublon. Le registre est celui
 *   du scaffold ({@link findReservedEntity}), pas une seconde liste.
 *
 * @param options - cibles à explorer et racine d'affichage.
 * @returns les manquements et le nombre de fichiers analysés.
 */
export function checkWiring(options: IWiringCheckOptions): IWiringCheckResult {
  const { roots, cwd = process.cwd(), projectRoot } = options;
  const findings: IWiringFinding[] = [];
  const notices: IWiringNotice[] = [];
  let scanned = 0;

  // Le manifeste et le manifeste npm de l'application, lus UNE fois. Les deux
  // comptent, et pour des raisons différentes : `nodefony.config.ts` décide de
  // ce qui est CHARGÉ, `package.json` de ce qui est INSTALLÉ. Une brique
  // installée mais absente du manifeste ne s'exécute jamais.
  // Le manifeste n'est plus forcément UN fichier : ses fragments de
  // `nodefony/config/` en font partie. La doctrine — ce qu'un fragment porte,
  // ce qui reste dans la racine, pourquoi on lit tout de même l'ensemble —
  // est écrite UNE fois, dans la TSDoc de `readManifestSources`. Lire le seul
  // fichier racine ferait conclure « brique installée mais jamais chargée »
  // sur une application parfaitement câblée.
  const manifestSources = projectRoot
    ? readManifestSources(projectRoot, diskManifestReader)
    : [];
  const manifeste = manifestSources.map((m) => m.source).join("\n");
  // Le manifeste entre ici SANS ses commentaires, pour la raison inverse de
  // celle des sources : une brique CITÉE dans un commentaire (« décommente
  // ceci pour activer @nodefony/security ») passerait pour déclarée, et la
  // garde des briques manquantes se tairait sur une application qui ne charge
  // rien. Le `package.json` reste brut : c'est du JSON, et le nettoyer
  // abîmerait ses valeurs sans rien retirer.
  const declared = projectRoot
    ? [
        withoutComments(manifeste),
        read(path.join(projectRoot, "package.json")),
      ].join("\n")
    : "";

  // Les zones vivent au niveau du PROJET : le contrôle se fait une fois, hors de
  // la boucle des cibles, sinon le même manquement serait rendu autant de fois
  // qu'il y a de modules locaux.
  // Un fichier au nom RÉSERVÉ dans le dossier des fragments n'est lu par
  // aucun contrôle ET chargé par personne : le taire serait la pire réponse.
  if (projectRoot) {
    // Un module ORM chargé SANS connecteur déclaré : l'application démarre sur
    // le `default` que le module se fournit, mais tout ce qui lit la
    // configuration sans démarrer — `create entity`, la page « Créer » de la
    // console — écrit alors sur un connecteur DEVINÉ. Une information, pas un
    // défaut : c'est le cas de toute application qui n'a qu'une base.
    const code = withoutComments(manifeste);
    const orm = ORM_PACKAGES.find((p) =>
      new RegExp(`["'\`]${p}["'\`]`, "u").test(code),
    );
    if (orm && !CONNECTORS_BLOCK_RE.test(code)) {
      notices.push({
        kind: "orm-connector-fallback",
        file: path.relative(cwd, path.join(projectRoot, "nodefony.config.ts")),
        message:
          `${orm} est chargé mais aucun connecteur n'est déclaré : l'application ` +
          `tourne sur le connecteur \`default\` que le module se fournit, moteur ` +
          `déduit de NF_DATABASE_URL (sqlite sans elle). C'est aussi sur lui que ` +
          `\`create entity\` écrira. Pour le nommer, ou en déclarer d'autres : ` +
          `\`connectors: { … }\` dans nodefony/config/${orm.split("/")[1]}.ts`,
      });
    }

    // L'ORDRE des modules décide de ce que l'application POSSÈDE au démarrage.
    // Un fournisseur de magasins durables déclaré après son consommateur laisse
    // sessions, jetons, passkeys, audit et second facteur retomber en mémoire —
    // et le serveur sert quand même. Le boot le REFUSE (fatal) ; ici on le dit
    // à FROID, sans démarrer : c'est le seul verdict qu'une chaîne d'intégration
    // ou une application cassée peuvent encore obtenir.
    const order = extractManifestModuleOrder(withoutComments(manifeste));
    if (order.length > 1) {
      const fault = findStoreOrderFault(
        order.map((name) => ({
          name,
          manifest: readInstalledStoreManifest(projectRoot, name),
        })),
      );
      if (fault) {
        findings.push({
          kind: "store-order",
          file: path.relative(
            cwd,
            manifestSources[0]?.path ??
              path.join(projectRoot, "nodefony.config.ts"),
          ),
          message: storeOrderFaultMessage(fault),
        });
      }
    }

    for (const file of reservedFragmentFiles(projectRoot, diskManifestReader)) {
      const base = path.basename(file);
      const suggested =
        base === "config.ts"
          ? "<module>.ts"
          : base.replace(/\.config\.ts$/u, ".ts");
      findings.push({
        kind: "reserved-fragment-name",
        file: path.relative(cwd, file),
        message:
          `\`${base}\` porte un nom réservé au chargement d'un MODULE (\`config.ts\`, ` +
          `\`*.config.ts\`) : dans \`nodefony/config/\` il est ignoré par les contrôles ` +
          `du manifeste ET chargé par personne. Un fragment se nomme \`${suggested}\` ` +
          `et s'importe depuis nodefony.config.ts`,
      });
    }
    // Un bloc EXTRAIT perd l'excess property check que le manifeste lui
    // donnait : sans `satisfies`, une clé inconnue compile puis Zod la retire
    // en silence au boot. L'extraction ne retire cette garde qu'ici — donc
    // c'est ici qu'on la redemande.
    for (const file of fragmentsWithoutSatisfies(
      projectRoot,
      diskManifestReader,
    )) {
      findings.push({
        kind: "fragment-without-satisfies",
        file: path.relative(cwd, file),
        message:
          `\`${path.basename(file)}\` rend une configuration sans \`satisfies\` : ` +
          `dans le manifeste, TypeScript refusait une clé inconnue au point d'appel ; ` +
          `extraite, elle compile et Zod la retire EN SILENCE au boot — le module ` +
          `démarre alors sur son défaut. Écrire ` +
          `\`(ctx) => ({ … }) satisfies I<Module>ConfigInput\``,
      });
    }
  }

  // Une source à la fois : le constat nomme le fichier qui PORTE la zone —
  // pointer le manifeste racine pour un bloc `areas` extrait enverrait
  // corriger là où il n'y a rien (même règle que le rapport de surface).
  for (const {
    path: manifestFile,
    source: manifestSource,
  } of manifestSources) {
    const areasBlock = extractAreasBlock(withoutComments(manifestSource));
    if (!areasBlock) continue;
    for (const { pattern, grantsAnonymous } of parseAreas(areasBlock)) {
      // Une zone qui OUVRE se juge à l'envers : y énumérer est le geste juste.
      if (grantsAnonymous) continue;
      const prefix = zoneEnumere(pattern);
      if (!prefix) continue;
      findings.push({
        kind: "firewall-area-enumere",
        file: path.relative(cwd, manifestFile),
        message:
          `la zone "${pattern}" énumère des routes au lieu de couvrir un espace — ` +
          `écris pattern: "^${prefix}". Tel quel, les routes visées sont bien ` +
          `protégées et TOUTE route ajoutée ensuite sous ${prefix} naîtra publique, ` +
          `sans qu'aucun test ne le voie : la zone existe et paraît couvrir l'espace`,
      });
    }
  }

  for (const root of roots) {
    if (!statSync(root, { throwIfNoEntry: false }) || !isTarget(root)) {
      continue;
    }
    // Le contenu de la cible est lu UNE fois : chaque symbole se cherche
    // ensuite en mémoire, sans relire l'arborescence par déclaration.
    //
    // Il est rangé SANS SES COMMENTAIRES, et c'est ici que ça se joue plutôt
    // qu'au cas par cas : les onze lecteurs de cette fonction cherchent tous
    // un USAGE — une garde posée, un hook déclaré, une entité définie, un
    // symbole nommé ailleurs. Aucun ne veut de ce qu'un TSDoc EXPLIQUE. Le
    // nettoyage écrit dans un seul contrôle laissait les dix autres accuser la
    // documentation : le contrôleur du générateur, qui commente `@IsGranted`
    // sans jamais l'employer, faisait sortir `npm run verify` en 1 sur une
    // application qui venait de naître.
    const sources = new Map<string, string>();
    for (const file of wiringSources(root)) {
      sources.set(file, withoutComments(read(file)));
    }
    const rel = (f: string): string => path.relative(cwd, f);

    // Un connecteur OUVERT dans le code, hors de l'adapter qui définit la
    // classe : invisible à toute lecture de la configuration. Le marqueur vise
    // l'USAGE (`new DrizzleOrm(`), et une cible qui DÉFINIT la classe est
    // épargnée — l'adapter a le droit d'instancier ce qu'il déclare.
    const definesOrm = [...sources.values()].some((c) =>
      ORM_CLASS_DEFINITION_RE.test(c),
    );
    if (!definesOrm) {
      for (const [file, content] of sources) {
        for (const m of content.matchAll(ORM_IN_CODE_RE)) {
          const name = m[2] ? `« ${m[2]} » ` : "";
          notices.push({
            kind: "orm-connector-in-code",
            file: rel(file),
            message:
              `connecteur ${name}ouvert dans le code (\`new ${m[1]}(\`) : ` +
              `aucune lecture de la configuration ne le voit — \`create entity\` ` +
              `et la page « Créer » ne le proposent pas, \`orm:migrate\` ne ` +
              `sait pas le suivre. Le déclarer dans \`connectors\` ` +
              `(nodefony/config/<orm>.ts) et enregistrer ses entités par ` +
              `\`@entities([…], { connector })\``,
          });
        }
      }
    }

    // Ce que la cible DÉCLARE, relevé une fois — deux voies, une seule réponse
    // à la question « ce service existera-t-il au démarrage ? ».
    const declaredServices = new Set<string>();
    for (const content of sources.values()) {
      for (const [, list] of content.matchAll(SERVICES_LIST_RE)) {
        for (const [, name] of list.matchAll(/\b(\w+)\b/gu)) {
          declaredServices.add(name);
        }
      }
      for (const [, name] of content.matchAll(IMPERATIVE_RE)) {
        declaredServices.add(name);
      }
    }

    for (const [file, content] of sources) {
      // Un service se cherche PARTOUT dans la cible : contrairement à une
      // entité ou un controller, son emplacement n'est pas conventionnel.
      for (const [, isAbstract, symbol] of content.matchAll(SERVICE_RE)) {
        if (isAbstract) continue;
        // Compté qu'il soit déclaré ou non : `scanned` dit ce que le contrôle a
        // REGARDÉ. Ne compter que les fautifs ferait passer « 0 manquement sur
        // 0 classe » pour un examen, alors que c'est une absence d'examen.
        scanned += 1;
        if (declaredServices.has(symbol)) continue;
        findings.push({
          kind: "orphan-service",
          file: rel(file),
          message:
            `${symbol} porte @injectable mais n'est déclaré nulle part — sans ` +
            `@services([${symbol}]) sur le module, il n'entre pas dans l'ordre de ` +
            `démarrage, échappe au rapport de boot et à l'introspection, et n'est ` +
            `construit qu'à la première requête qui le réclame`,
        });
      }

      // Les routes se cherchent PARTOUT, comme les services : un controller
      // rangé hors de `nodefony/controllers` reste un controller, et c'est
      // justement le fichier écrit à la main qui porte la faute.
      for (const m of content.matchAll(ROUTE_PATH_RE)) {
        const routePath = m[1] ?? m[2] ?? "";
        const colon = COLON_SEGMENT_RE.exec(routePath);
        if (!colon) continue;
        const corrected = routePath.replace(/\/:(\w+)/gu, "/{$1}");
        findings.push({
          kind: "route-colon-param",
          file: rel(file),
          message:
            `le chemin "${routePath}" déclare son segment variable à la mode d'un autre ` +
            `framework — Nodefony écrit "${corrected}". Tel quel, ":${colon[1]}" est monté ` +
            `comme un littéral : la route s'affiche dans inspect routes et répond 404 ` +
            `à toute URL réelle`,
        });
      }

      // La réponse ne se juge que dans un controller : ailleurs, `setHeader` ne
      // dit rien.
      if (EXTENDS_CONTROLLER_RE.test(content)) {
        const facades =
          `les façades : this.renderJson(obj) pour du JSON, ` +
          `this.setContextHtml() puis this.render(html) pour une page, ` +
          `this.streamFile(f) / renderMediaStream(f) / renderFileDownload(f) pour un fichier`;
        const manquements: [RegExp, string][] = [
          [
            RESPONSE_CAST_RE,
            `this.response est casté en any — c'est le signal d'une façade ratée, et le ` +
              `cast fait taire le seul contrôle qui aurait nommé la bonne`,
          ],
          [
            RESPONSE_CONTENT_TYPE_RE,
            `Content-Type est posé à la main — c'est la façade qui le décide, et le poser ` +
              `deux fois rend une réponse que le client lit de travers`,
          ],
          [
            RESPONSE_RAW_WRITE_RE,
            `la réponse est écrite directement dans le socle (end/writeHead) — le body part ` +
              `sans passer par le pipeline`,
          ],
        ];
        for (const [pattern, quoi] of manquements) {
          if (!pattern.test(content)) continue;
          findings.push({
            kind: "reponse-a-la-main",
            file: rel(file),
            message:
              `${quoi}. Court-circuitée ainsi, la réponse perd la négociation de contenu, ` +
              `l'encodage, le nonce CSP de la requête et les hooks de fin de réponse ` +
              `(journal, profileur) — tout cela sans qu'aucun test ne le voie, puisque le ` +
              `body arrive bien. Emploie ${facades}`,
          });
        }
      }

      // Les hooks se cherchent dans tout fichier qui déclare un module — c'est
      // l'`index.ts` en général, mais rien ne l'impose.
      if (EXTENDS_MODULE_RE.test(content)) {
        for (const [, hook] of content.matchAll(HOOK_DECL_RE)) {
          if (HOOKS_MODULE.has(hook)) continue;
          findings.push({
            kind: "hook-lifecycle-inconnu",
            file: rel(file),
            message:
              `${hook}() n'est pas un hook de module — seuls ${[...HOOKS_MODULE].join(", ")} ` +
              `sont attachés au démarrage. Écrite ainsi, la méthode compile et n'est JAMAIS ` +
              `appelée : ce qu'elle initialise ne le sera pas, et rien ne le signalera`,
          });
        }
      }

      const dir = path.dirname(file);
      const inEntities = dir.endsWith(path.join("nodefony", "entity"));
      const inControllers = dir.endsWith(path.join("nodefony", "controllers"));
      if (!inEntities && !inControllers) continue;
      scanned += 1;

      if (declared) {
        for (const brick of BRICKS) {
          if (!brick.marker.test(content)) continue;
          if (brick.packages.some((p) => declared.includes(p))) continue;
          findings.push({
            kind: "missing-brick",
            file: rel(file),
            message:
              `ce fichier déclare ${brick.what}, mais ${brick.packages.join(" ni ")} ` +
              `n'est ${brick.packages.length > 1 ? "" : "pas "}déclaré par l'application — ` +
              `le module ne sera pas chargé, et le code ` +
              `compilera sans jamais s'exécuter`,
          });
        }
      }

      if (inEntities) {
        for (const [, symbol] of content.matchAll(ENTITY_RE)) {
          if (!referencedElsewhere(symbol, file, sources)) {
            findings.push({
              kind: "orphan-entity",
              file: rel(file),
              message:
                `${symbol} n'est déclarée nulle part — sans @entities([${symbol}]) sur le module, ` +
                `sa table n'est pas créée au démarrage et le repository lèvera « entité inconnue »`,
            });
          }
          // Le contrat d'entrée vit dans le fichier VOISIN — c'est la convention
          // que pose le générateur, et le seul lien qui existe : ni `@entity`
          // ni le registre ORM ne connaissent le schéma Zod. Pas de voisin, pas
          // de contrôle : on ne reproche rien à qui n'a pas suivi la convention.
          const voisin = file.replace(/\.ts$/u, ".schema.ts");
          const contract = sources.get(voisin);
          if (contract !== undefined) {
            const optional = new Set(optionalInputFields(contract));
            for (const required of requiredColumns(content)) {
              if (!optional.has(required)) continue;
              findings.push({
                kind: "champ-facultatif-que-la-base-exige",
                file: rel(voisin),
                message:
                  `\`${required}\` est facultatif à la création alors que la colonne est notNull() sans défaut — ` +
                  `un POST sans ce champ passe la validation puis meurt en base : 500, ` +
                  `quand l'application devait rendre un 422 qui le nomme`,
              });
            }
          }
          const entityName = ENTITY_NAME_RE.exec(
            content.slice(content.indexOf(symbol)),
          )?.[1];
          const reserved = entityName
            ? findReservedEntity(entityName)
            : undefined;
          // Une entité que l'APPLICATION possède n'est pas une collision : c'est
          // le chemin normal depuis que le framework ne livre plus sa table.
          // Le drapeau vit dans la table du scaffold, et non ici, pour que les
          // deux lieux qui la consultent ne se mettent pas à diverger.
          if (reserved && !reserved.appOwned) {
            findings.push({
              kind: "reserved-entity",
              file: rel(file),
              message:
                `${symbol} déclare name: "${entityName}", qui appartient au module « ${reserved.module} » — ` +
                `le registre ORM est plat, l'application ne démarrera plus.\n  → ${reserved.advice}`,
            });
          }
        }
      }

      if (inControllers) {
        for (const [, symbol] of content.matchAll(CONTROLLER_RE)) {
          if (!referencedElsewhere(symbol, file, sources)) {
            findings.push({
              kind: "orphan-controller",
              file: rel(file),
              message:
                `${symbol} n'est déclaré nulle part — sans @controllers([${symbol}]) sur le module, ` +
                `aucune de ses routes n'est montée et elles répondront 404`,
            });
          }
        }
      }
    }
  }

  return { findings, notices, scanned };
}
