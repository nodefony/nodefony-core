/**
 * `doctor` — la SURFACE OUVERTE, et les entités écrites pour un autre moteur.
 *
 * Deux angles morts, tous deux lisibles sans démarrer, tous deux silencieux
 * aujourd'hui.
 *
 * **La surface ouverte ne se voit nulle part d'un coup.** Une route porte
 * `@BypassFirewall` ou `@Anonymous`, une zone porte `security: false` — chacun
 * est légitime pris isolément, et personne n'a jamais la liste sous les yeux.
 * C'est ainsi qu'une route de mise au point reste ouverte en production. Le
 * remède n'est donc PAS un verdict : c'est un INVENTAIRE. Un contrôle qui crie
 * sur un geste légitime est un contrôle qu'on apprend à passer outre — seul le
 * cas indéfendable (une zone publique qui couvre tout l'espace) devient un
 * manquement.
 *
 * **Une entité écrite pour le mauvais dialecte est ÉCARTÉE EN SILENCE.** Une
 * entité qui importe `drizzle-orm/pg-core` alors que le connecteur est `sqlite`
 * n'est pas une erreur pour l'outil : il la met de côté et écrit une migration
 * sans elle. La table n'est jamais créée, l'application démarre, la route
 * répond 500 au premier usage, et rien dans le code ne montre la cause.
 *
 * ⚠️ Ce module lit des SOURCES, jamais un `dist/` : le contrôle doit répondre y
 * compris sur une application qui ne compile plus — c'est précisément là qu'on
 * le consulte.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { collectSources } from "./walk";

/** Ce qui rend une route ou une zone atteignable sans authentification. */
export type OpeningKind =
  | "bypass-firewall"
  | "anonymous"
  /** `bypassFirewall: true` posé à la main dans une route programmatique. */
  | "bypass-option"
  | "public-area";

/** Un point d'entrée ouvert, tel qu'il s'affiche dans l'inventaire. */
export interface IOpening {
  kind: OpeningKind;
  /**
   * Ce qui est ouvert : un nom de méthode, le motif d'une zone — ou RIEN.
   *
   * Vide quand le nom n'est pas littéral : une route posée dans une boucle
   * (`Router.createRoute(name, …)`) n'a pas de nom lisible dans le source, et
   * en inventer un serait pire que de n'en donner aucun.
   */
  what: string;
  /** Le fichier qui le déclare, relatif à la racine analysée. */
  file: string;
}

/** Un manquement de surface ou de dialecte. */
export interface ISurfaceFinding {
  kind: "public-area-covers-all" | "entity-other-dialect";
  message: string;
  file: string;
}

/** Ce que le contrôle a relevé. */
export interface ISurfaceResult {
  findings: ISurfaceFinding[];
  /** L'inventaire — une INFORMATION, jamais un verdict. */
  openings: IOpening[];
  /** Fichiers de source parcourus. */
  scanned: number;
  /** Le dialecte du connecteur, tel qu'on a pu le déterminer. */
  dialect: SqlDialectName | null;
  /** D'où vient ce dialecte, pour que le lecteur puisse le contredire. */
  dialectFrom: string;
  /** Entités relevées, tous dialectes confondus. */
  entitiesScanned: number;
}

/** Les moteurs qu'une entité peut viser. */
export type SqlDialectName = "sqlite" | "postgres" | "mysql";

export interface ISurfaceCheckOptions {
  /** Cibles à explorer : une application, et ses `modules/*`. */
  roots: string[];
  /** Racine servant à raccourcir les chemins affichés. */
  cwd: string;
  /** Racine du PROJET — c'est elle qui porte le manifeste. */
  projectRoot?: string;
  /**
   * L'environnement, d'où l'on tire l'infrastructure déclarée.
   *
   * Injecté : une fonction qui lit `process.env` ne s'éprouve que dans
   * l'environnement où elle tourne.
   */
  env: Record<string, string | undefined>;
  /**
   * Les chemins d'entités dont le dialecte divergent est ASSUMÉ.
   *
   * Déclarés par le projet (`package.json` → `nodefony.doctor.entityDialect`).
   * Sans cette porte, un dépôt qui porte volontairement des entités
   * multi-moteurs — un banc de portabilité, par exemple — ne peut jamais être
   * vert, et c'est le contrôle entier qu'on finit par ignorer.
   */
  dialectExceptions?: readonly string[];
}

/** Un import de table Drizzle : `drizzle-orm/pg-core` et ses frères. */
const DRIZZLE_CORE_RE = /["']drizzle-orm\/(sqlite|pg|mysql)-core["']/gu;

/** Le dialecte de Nodefony pour un segment d'import Drizzle. */
const DIALECT_OF_IMPORT: Record<string, SqlDialectName> = {
  sqlite: "sqlite",
  pg: "postgres",
  mysql: "mysql",
};

/**
 * Le caractère du décorateur, COMPOSÉ et non écrit.
 *
 * 🔴 Un contrôle qui cherche une chaîne la contient forcément, et s'accuse
 * lui-même : au premier essai, ce fichier a inventorié deux « routes ouvertes »
 * dans son propre source, et le rendu les affichait au même rang que les
 * vraies. Composer le motif est le seul remède qui ne demande ni exception
 * arbitraire ni exclusion d'un dossier — la chaîne cherchée n'existe nulle part
 * ici, donc rien à excepter.
 */
const AT = "@";

/** `@BypassFirewall`, avec ou sans parenthèses — c'est un DRAPEAU. */
const BYPASS_RE = new RegExp(`${AT}BypassFirewall\\b`, "gu");

/** `@Anonymous` — le même mécanisme, dit autrement. */
const ANONYMOUS_RE = new RegExp(`${AT}Anonymous\\b`, "gu");

/** `bypassFirewall: true` posé dans les options d'une route. */
const BYPASS_OPTION_RE = /\bbypassFirewall\s*:\s*true\b/gu;

/** La déclaration qui SUIT une ouverture — c'est elle qu'on nomme. */
const MEMBER_AFTER_RE =
  /\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]{0,200}\)\s*[:{]/u;

/** Une ouverture posée sur la CLASSE ouvre TOUTES ses routes — on le dit. */
const CLASS_AFTER_RE = /\bclass\s+([A-Za-z_$][\w$]*)/u;

/**
 * Ce qui fait d'un fichier un porteur de ROUTES.
 *
 * DEUX formes, et il faut les deux : le décorateur, et l'héritage. Les routes
 * d'un contrôleur du framework se posent programmatiquement, sans décorateur —
 * n'accepter que la première ferait disparaître de l'inventaire cinq
 * contrôleurs d'authentification, tous légitimement ouverts, donc exactement
 * ceux qu'on veut voir listés.
 */
const CONTROLLER_RE = new RegExp(
  `${AT}controller\\b|\\bextends\\s+Controller\\b`,
  "u",
);

/** Le bloc `areas: { … }` du manifeste, et lui seul. */
const AREAS_BLOCK_RE = /\bareas\s*:\s*\{/u;

/**
 * Des chemins témoins, choisis pour n'avoir AUCUN préfixe commun utile.
 *
 * Un motif qui les accepte tous accepte n'importe quelle requête.
 */
const PROBE_PATHS = ["/", "/admin", "/x/y/z", "/nodefony/kernel/api"] as const;

/**
 * Ce motif de zone laisse-t-il passer TOUT l'espace d'URL ?
 *
 * CONSTATÉ, jamais listé : le motif est compilé et éprouvé exactement comme le
 * firewall le fait (`SecuredArea.ts:25` — `new RegExp(pattern, "u")`, non
 * ancré, `test(pathname)`), puis confronté à des chemins sans parenté. Une
 * liste écrite à la main disait le contraire du produit dans les deux sens :
 * elle CONDAMNAIT `^/api`, qui ne couvre que `/api…`, et laissait passer
 * `^/.*`, `.*` et `^`, qui ouvrent réellement tout.
 *
 * @param pattern - le motif tel que le manifeste l'écrit.
 * @returns `true` si aucune route ne peut échapper à cette zone.
 */
export function coversEverything(pattern: string): boolean {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "u");
  } catch {
    // Un motif que le firewall lui-même refuserait : ce n'est pas à ce
    // contrôle de le juger, il a déjà été inventorié.
    return false;
  }
  return PROBE_PATHS.every((chemin) => re.test(chemin));
}

/**
 * Les commentaires, ôtés AVANT toute analyse.
 *
 * Sans quoi le contrôle mord sur la documentation : un commentaire qui apprend
 * à ne PAS ouvrir une zone cite forcément le contre-exemple, et toute
 * application fraîche commencerait par un avertissement portant sur du texte
 * explicatif. Un contrôle qui accuse sa propre documentation est un contrôle
 * qu'on désactive.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

/**
 * Le contenu d'un bloc d'accolades ÉQUILIBRÉES à partir d'une position.
 *
 * Une expression régulière ne sait pas compter les accolades : un bloc `areas`
 * contenant une zone qui contient ses authentificateurs se ferait couper au
 * premier `}` venu, et la moitié des zones deviendrait invisible — un contrôle
 * de surface qui ne voit qu'une partie de la surface est pire qu'aucun.
 *
 * @param source - le texte à lire.
 * @param open - l'index de l'accolade ouvrante.
 * @returns le contenu entre les accolades, vide si elles ne se referment pas.
 */
export function balancedBlock(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

/**
 * Les zones publiques déclarées dans un manifeste.
 *
 * Fonction PURE sur le TEXTE du manifeste : c'est ce qui la rend éprouvable
 * sans écrire de fichier, et ce qui lui permet de répondre sur un manifeste que
 * TypeScript refuserait de compiler.
 *
 * @param manifest - le contenu de `nodefony.config.ts`.
 * @returns une entrée par zone `security: false`, avec son motif.
 */
export function publicAreas(manifest: string): { pattern: string }[] {
  const clean = withoutComments(manifest);
  const at = clean.search(AREAS_BLOCK_RE);
  if (at === -1) return [];
  const block = balancedBlock(clean, clean.indexOf("{", at));
  const zones: { pattern: string }[] = [];
  // Chaque zone est un objet du bloc : on les prend un par un, en comptant les
  // accolades — leurs authentificateurs sont eux-mêmes des objets.
  let i = 0;
  while (i < block.length) {
    const brace = block.indexOf("{", i);
    if (brace === -1) break;
    const zone = balancedBlock(block, brace);
    i = brace + zone.length + 2;
    if (!/\bsecurity\s*:\s*false\b/u.test(zone)) continue;
    const pattern = /\bpattern\s*:\s*["'`]([^"'`\n]+)["'`]/u.exec(zone)?.[1];
    zones.push({ pattern: pattern ?? "(motif non littéral)" });
  }
  return zones;
}

/**
 * Le dialecte du connecteur, tel qu'on peut le déterminer SANS démarrer.
 *
 * Trois sources, dans l'ordre de précédence du produit : l'infrastructure
 * déclarée gagne (un hébergeur pose l'URL), puis ce que le manifeste écrit,
 * puis le défaut du module. La provenance est RENDUE avec la valeur : un
 * dialecte affirmé sans dire d'où il vient ne se contredit pas.
 *
 * @param manifest - le contenu de `nodefony.config.ts`.
 * @param env - l'environnement dans lequel le diagnostic tourne.
 * @returns le dialecte et sa provenance, `null` si rien ne le dit.
 */
export function connectorDialect(
  manifest: string,
  env: Record<string, string | undefined>,
): { dialect: SqlDialectName | null; from: string } {
  // La provenance nomme la variable RÉELLEMENT lue : annoncer
  // `NF_DATABASE_URL` alors que la valeur venait de l'alias de plateforme
  // envoyait corriger une variable qui n'existe pas sur ce poste.
  const from = env.NF_DATABASE_URL ? "NF_DATABASE_URL" : "DATABASE_URL";
  const url = env.NF_DATABASE_URL || env.DATABASE_URL;
  if (url) {
    const scheme = /^([a-z0-9+]+):/iu.exec(url)?.[1]?.toLowerCase() ?? "";
    if (scheme.startsWith("postgres")) return { dialect: "postgres", from };
    if (scheme.startsWith("mysql")) return { dialect: "mysql", from };
    if (scheme.startsWith("sqlite") || scheme === "file")
      return { dialect: "sqlite", from };
  }
  const written = /\bdialect\s*:\s*["'`](sqlite|postgres|mysql)["'`]/u.exec(
    withoutComments(manifest),
  )?.[1];
  if (written)
    return {
      dialect: written as SqlDialectName,
      from: "nodefony.config.ts",
    };
  // Le défaut du module drizzle. Rendu explicitement plutôt que deviné : c'est
  // le cas le plus fréquent, et taire sa provenance rendrait le manquement
  // incompréhensible sur une application qui n'a jamais écrit `dialect`.
  return { dialect: "sqlite", from: "défaut du connecteur" };
}

/** Extensions dans lesquelles une déclaration peut vivre. */
const SOURCE_EXT = new Set([".ts", ".mts", ".cts"]);

/**
 * Le dossier où les entités sont CHERCHÉES, tel que le producteur le définit.
 *
 * `nodefony/entity/**`, et rien d'autre (`appSchema.ts:71`). Élargir au reste
 * du dépôt ferait accuser ce qui n'est pas une entité : l'adaptateur ORM
 * lui-même importe les trois dialectes, et c'est son travail.
 */
const ENTITY_DIR = `${path.sep}nodefony${path.sep}entity${path.sep}`;

/** Les sources d'une cible, sans jamais entrer dans un `dist/`. */
function sources(root: string): string[] {
  // Le marcheur est COMMUN (`walk.ts`) : ce qu'on saute ne se redécide pas
  // contrôle par contrôle. Seule la profondeur est propre ici — une cible est
  // un module, pas un dépôt.
  return collectSources(root, { extensions: [...SOURCE_EXT], maxDepth: 8 });
}

/**
 * Le nom déclaré juste après une ouverture.
 *
 * Une ouverture posée sur la CLASSE ne vaut pas pour une méthode : elle ouvre
 * tout le contrôleur, et l'afficher comme une route unique ferait sous-estimer
 * la surface d'un facteur égal au nombre de ses routes.
 */
function openingName(source: string, at: number): string {
  const after = source.slice(at, at + 400);
  const method = MEMBER_AFTER_RE.exec(after)?.[1];
  const klass = CLASS_AFTER_RE.exec(after)?.[1];
  // Le plus PROCHE gagne : un décorateur de méthode a du code de classe plus
  // loin dans sa fenêtre, et l'inverse est vrai aussi.
  const iMethod = method ? after.indexOf(method) : Infinity;
  const iClass = klass ? after.indexOf(klass) : Infinity;
  if (klass && iClass < iMethod) return `${klass} (toutes ses routes)`;
  return method ?? "(déclaration non nommée)";
}

/** Relève une famille d'ouvertures dans un fichier. */
function collectOpenings(
  source: string,
  file: string,
  re: RegExp,
  kind: OpeningKind,
  out: IOpening[],
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // Une OPTION de route ne précède aucune déclaration : elle est posée à
    // l'intérieur d'un objet, souvent dans une boucle. Chercher un nom après
    // elle rendrait celui du code qui suit, c'est-à-dire un nom FAUX.
    const what = kind === "bypass-option" ? "" : openingName(source, m.index);
    out.push({ kind, what, file });
  }
}

/**
 * Réécrit un chemin en séparateurs `/`, quelle que soit sa grammaire d'origine.
 *
 * 🔴 **Axiome 2 : normaliser AVANT de filtrer ou comparer.** Une exception de
 * dialecte est un chemin qui VOYAGE — elle vient de la configuration du projet,
 * écrite une fois et lue sur les trois systèmes, donc en `/`. Le chemin auquel
 * on la compare sort de `path.relative` : sous Windows il porte des `\`. Le
 * filtre ne mordait donc jamais là-bas, et une divergence pourtant DÉCLARÉE
 * par le projet était accusée — forge Windows rouge, même passe verte ailleurs.
 *
 * Les DEUX séparateurs sont traités, pas seulement celui du poste : rien ne dit
 * que l'exception n'a pas été écrite avec la grammaire de la machine où elle a
 * été ajoutée.
 *
 * @param chemin - le chemin à normaliser.
 * @param sep - la grammaire à appliquer ; injectée pour que la règle
 *   s'éprouve avec `path.win32.sep` depuis n'importe quel système — sans elle,
 *   le cas Windows ne serait vérifiable que sous Windows.
 * @returns le même chemin, en `/`.
 */
export function toPortablePath(chemin: string, sep: string = path.sep): string {
  return chemin.split(sep).join("/").split("\\").join("/");
}

/**
 * Relève la surface ouverte et les entités hors dialecte.
 *
 * @param options - cibles, racine du projet, environnement, exceptions.
 * @returns l'inventaire, les manquements, et ce qui a été parcouru.
 */
export function checkSurface(options: ISurfaceCheckOptions): ISurfaceResult {
  const { roots, cwd, projectRoot, env } = options;
  const exceptions = (options.dialectExceptions ?? []).map((e) =>
    toPortablePath(e),
  );
  const findings: ISurfaceFinding[] = [];
  const openings: IOpening[] = [];
  let scanned = 0;
  let entitiesScanned = 0;

  const read = (file: string): string => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return "";
    }
  };

  const manifestPath = projectRoot
    ? path.join(projectRoot, "nodefony.config.ts")
    : "";
  const manifest = manifestPath ? read(manifestPath) : "";

  // Les zones vivent au niveau du PROJET : le relevé se fait une fois, hors de
  // la boucle des cibles, sinon la même zone serait comptée autant de fois
  // qu'il y a de modules locaux.
  for (const zone of publicAreas(manifest)) {
    openings.push({
      kind: "public-area",
      what: zone.pattern,
      file: path.relative(cwd, manifestPath),
    });
    if (!coversEverything(zone.pattern)) continue;
    findings.push({
      kind: "public-area-covers-all",
      file: path.relative(cwd, manifestPath),
      message:
        `la zone "${zone.pattern}" est publique (security: false) et couvre ` +
        `TOUT l'espace : aucune route de l'application n'est protégée, et une ` +
        `route ajoutée demain naîtra publique sans qu'aucun test ne le voie`,
    });
  }

  const { dialect, from } = connectorDialect(manifest, env);

  // Un fichier n'est lu QU'UNE fois : les cibles se recouvrent (la racine du
  // projet contient ses `modules/*`), et sans cela le même manquement était
  // rendu deux fois — vu au premier essai sur le terrain.
  const seen = new Set<string>();
  for (const root of roots) {
    if (!statSync(root, { throwIfNoEntry: false })) continue;
    for (const file of sources(root)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const raw = read(file);
      if (!raw) continue;
      scanned++;
      const relative = path.relative(cwd, file);
      const clean = withoutComments(raw);

      // Seuls les CONTRÔLEURS portent des routes : ailleurs, la chaîne
      // `@BypassFirewall` est du code qui en parle, pas une route ouverte.
      if (CONTROLLER_RE.test(clean)) {
        collectOpenings(
          clean,
          relative,
          BYPASS_RE,
          "bypass-firewall",
          openings,
        );
        collectOpenings(clean, relative, ANONYMOUS_RE, "anonymous", openings);
        collectOpenings(
          clean,
          relative,
          BYPASS_OPTION_RE,
          "bypass-option",
          openings,
        );
      }

      // Le dialecte ne se contrôle que là où le producteur CHERCHE ses
      // entités : ailleurs, un import des trois moteurs est légitime.
      if (!file.includes(ENTITY_DIR)) continue;
      DRIZZLE_CORE_RE.lastIndex = 0;
      const imported = new Set<SqlDialectName>();
      let m: RegExpExecArray | null;
      while ((m = DRIZZLE_CORE_RE.exec(clean)) !== null) {
        const found = DIALECT_OF_IMPORT[m[1] ?? ""];
        if (found) imported.add(found);
      }
      if (imported.size === 0) continue;
      entitiesScanned++;
      if (!dialect) continue;
      if (imported.has(dialect)) continue;
      // Le projet a DÉCLARÉ que cette divergence est voulue : un dépôt qui
      // porte un banc multi-moteurs ne doit pas être condamné pour cela.
      if (exceptions.some((e) => toPortablePath(relative).includes(e)))
        continue;
      const wrote = [...imported].join(", ");
      findings.push({
        kind: "entity-other-dialect",
        file: relative,
        message:
          `cette entité est écrite pour ${wrote}, alors que le connecteur est ` +
          `${dialect} (${from}) — l'outil de migration l'ÉCARTE en silence, la ` +
          `table ne sera jamais créée, et la première requête répondra 500`,
      });
    }
  }

  return {
    findings,
    openings,
    scanned,
    dialect,
    dialectFrom: from,
    entitiesScanned,
  };
}
