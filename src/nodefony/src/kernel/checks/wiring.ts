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
 * Lecture PURE, comme le reste de `nodefony check` : aucun boot, aucun import du
 * code analysé. Le contrôle doit répondre y compris sur une application qui ne
 * démarre plus — c'est précisément là qu'on le consulte.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findReservedEntity } from "../../cli/scaffold/reservedEntities";

/** Un câblage manquant, ou un nom qui dépossède un module du framework. */
export interface IWiringFinding {
  kind:
    | "orphan-entity"
    | "orphan-controller"
    | "orphan-service"
    | "reserved-entity"
    | "missing-brick"
    | "route-colon-param"
    | "firewall-area-enumere"
    | "hook-lifecycle-inconnu";
  /** Phrase lisible, déjà orientée vers la correction. */
  message: string;
  /** Fichier fautif, relatif à la racine analysée. */
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
 * Un chemin de route Nodefony, tel qu'il est écrit — soit en premier argument
 * d'un décorateur de méthode, soit sous la clé `path` D'UN `@route`.
 *
 * Les deux formes existent et se valent ; n'en lire qu'une rendrait le contrôle
 * aveugle à l'autre, ce qui est pire que pas de contrôle du tout — on croirait
 * la question posée.
 *
 * ⚠️ Le `path:` est borné au voisinage d'un `@route(` et NON lu partout : la
 * clé est celle de react-router, où `:id` est la syntaxe JUSTE. Lu librement,
 * le contrôle accusait les cinq routes du frontend de Studio — un contrôle qui
 * accuse du code correct est un contrôle qu'on désactive, et il aurait fait
 * « corriger » un routage qui marchait.
 */
const ROUTE_PATH_RE =
  /@(?:Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(\s*["'`]([^"'`\n]*)["'`]|@route\s*\([\s\S]{0,300}?\bpath\s*:\s*["'`]([^"'`\n]*)["'`]/gu;

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

/**
 * Le bloc `areas: { … }` du manifeste, et lui seul.
 *
 * `pattern:` est un mot trop courant pour être lu partout — la clé existe dans
 * une config de bundler, une règle de lint, un routeur front. Le contrôle ne
 * doit accuser que ce qu'il comprend.
 */
const AREAS_BLOCK_RE = /\bareas\s*:\s*\{([\s\S]{0,4000}?)\n\s{0,10}\}/u;

/** `pattern: "^/api/account"` — la valeur écrite, telle quelle. */
const AREA_PATTERN_RE = /\bpattern\s*:\s*["'`]([^"'`\n]+)["'`]/gu;

/**
 * Les commentaires, ôtés AVANT toute analyse du manifeste.
 *
 * Sans quoi le contrôle mord sur le gabarit lui-même : le commentaire qui
 * apprend à ne PAS énumérer cite le contre-exemple
 * (`"^/api/account/(profile|invoices)"`), et toute application fraîche
 * commencerait par un avertissement portant sur du texte explicatif. Un
 * contrôle qui accuse sa propre documentation est un contrôle qu'on désactive.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

/**
 * La part LITTÉRALE d'un pattern — ce qu'il couvre à coup sûr.
 *
 * `^/api/account/(profile|invoices)` → `/api/account`. On coupe au premier
 * métacaractère, puis au dernier `/` : un segment tronqué (`/api/acc`) ne
 * désigne rien et ferait un conseil faux.
 */
function prefixeLitteral(pattern: string): string {
  const sansAncre = pattern.replace(/^\^/u, "");
  const coupe = sansAncre.search(/[([{|?*+$\\]/u);
  const litteral = coupe === -1 ? sansAncre : sansAncre.slice(0, coupe);
  const dernier = litteral.lastIndexOf("/");
  return dernier > 0 ? litteral.slice(0, dernier) : litteral;
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
 * @param pattern - la valeur écrite dans le manifeste.
 * @returns le préfixe à employer, ou `null` si la zone est saine.
 */
function zoneEnumere(pattern: string): string | null {
  const corps = pattern.replace(/^\^/u, "");
  const prefixe = prefixeLitteral(pattern);
  const segments = prefixe.split("/").filter(Boolean).length;
  if (/\$/u.test(corps)) return prefixe;
  if (/\([^)]*\|/u.test(corps) && segments >= 2) return prefixe;
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
  const walk = (d: string): void => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name === "tests" ||
        e.name.startsWith(".")
      ) {
        continue;
      }
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.tsx?$/u.test(e.name) && !/\.test\.tsx?$/u.test(e.name)) {
        found.push(p);
      }
    }
  };
  for (const sub of WIRING_DIRS) {
    const d = path.join(dir, sub);
    if (statSync(d, { throwIfNoEntry: false })) walk(d);
  }
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
  let scanned = 0;

  // Le manifeste et le manifeste npm de l'application, lus UNE fois. Les deux
  // comptent, et pour des raisons différentes : `nodefony.config.ts` décide de
  // ce qui est CHARGÉ, `package.json` de ce qui est INSTALLÉ. Une brique
  // installée mais absente du manifeste ne s'exécute jamais.
  const manifestePath = projectRoot
    ? path.join(projectRoot, "nodefony.config.ts")
    : "";
  const manifeste = manifestePath ? read(manifestePath) : "";
  const declared = projectRoot
    ? [manifeste, read(path.join(projectRoot, "package.json"))].join("\n")
    : "";

  // Les zones vivent au niveau du PROJET : le contrôle se fait une fois, hors de
  // la boucle des cibles, sinon le même manquement serait rendu autant de fois
  // qu'il y a de modules locaux.
  const areasBlock = AREAS_BLOCK_RE.exec(sansCommentaires(manifeste))?.[1];
  if (areasBlock) {
    for (const [, pattern] of areasBlock.matchAll(AREA_PATTERN_RE)) {
      const prefixe = zoneEnumere(pattern);
      if (!prefixe) continue;
      findings.push({
        kind: "firewall-area-enumere",
        file: path.relative(cwd, manifestePath),
        message:
          `la zone "${pattern}" énumère des routes au lieu de couvrir un espace — ` +
          `écris pattern: "^${prefixe}". Tel quel, les routes visées sont bien ` +
          `protégées et TOUTE route ajoutée ensuite sous ${prefixe} naîtra publique, ` +
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
    const sources = new Map<string, string>();
    for (const file of wiringSources(root)) {
      sources.set(file, read(file));
    }
    const rel = (f: string): string => path.relative(cwd, f);

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
        const corrige = routePath.replace(/\/:(\w+)/gu, "/{$1}");
        findings.push({
          kind: "route-colon-param",
          file: rel(file),
          message:
            `le chemin "${routePath}" déclare son segment variable à la mode d'un autre ` +
            `framework — Nodefony écrit "${corrige}". Tel quel, ":${colon[1]}" est monté ` +
            `comme un littéral : la route s'affiche dans inspect routes et répond 404 ` +
            `à toute URL réelle`,
        });
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
              `n'est déclaré par l'application — le module ne sera pas chargé, et le code ` +
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
          const entityName = ENTITY_NAME_RE.exec(
            content.slice(content.indexOf(symbol)),
          )?.[1];
          const reserved = entityName
            ? findReservedEntity(entityName)
            : undefined;
          if (reserved) {
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

  return { findings, scanned };
}
