/**
 * Contrôle de FRAÎCHEUR — ce qui tourne n'est pas ce qui est écrit.
 *
 * Le runtime charge `dist/`, jamais les sources. Une route ajoutée et non
 * bâtie répond donc 404, un export retiré reste servi, et rien ne le dit :
 * le fichier existe, il compile, le test qui l'importe directement passe.
 * C'est la cause perdue la plus fréquente de ce framework — au point que le
 * noyau la devine déjà, mais seulement APRÈS un échec de démarrage, dans son
 * conseil de remédiation. Ici, on la voit AVANT.
 *
 * Même famille pour le plancher de Node : une version trop basse ne se
 * manifeste qu'au premier octet de syntaxe non reconnue, à un endroit qui
 * n'a aucun rapport avec la cause.
 *
 * Lecture PURE, comme le reste de `nodefony doctor` : des dates de fichiers
 * et deux manifestes, aucun boot, aucun import du code analysé.
 *
 * ⚠️ La date d'un `dist/` est un INDICE, pas une preuve. Un cache de build
 * peut restaurer un artefact avec un horodatage neuf sans que son contenu
 * corresponde aux sources ; l'inverse — sources plus récentes que le build —
 * reste, lui, toujours vrai. C'est pourquoi ce contrôle n'accuse QUE dans ce
 * sens, et le dit dans son message.
 */
import path from "node:path";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { formatDuration } from "./report";
import { isSkippedDir, isTestFile } from "./walk";

/** Un écart entre ce qui est écrit et ce qui s'exécutera. */
export interface IFreshnessFinding {
  kind:
    | "dist-stale"
    | "dist-missing"
    | "node-below-engines"
    | "framework-stale"
    | "framework-missing";
  /** Phrase actionnable : le constat, et le geste qui le répare. */
  message: string;
  /** Fichier qui porte le constat, relatif à la racine (si pertinent). */
  file?: string;
}

/** Ce que le contrôle a regardé — et ce qu'il n'a PAS pu regarder. */
export interface IFreshnessResult {
  findings: IFreshnessFinding[];
  /**
   * `true` quand aucun `dist/` n'existe ET qu'aucune source n'a été trouvée :
   * il n'y a rien à comparer, et le silence ne vaut pas quitus.
   */
  notComparable: boolean;
}

/** Dossiers de sources d'une application, dans l'ordre où on les rencontre. */
const SOURCES = ["nodefony", "src", "index.ts", "nodefony.config.ts", "env.ts"];

/**
 * Ce fichier entre-t-il dans le build ?
 *
 * Un test n'y entre PAS : le bundler ne l'emporte pas, et le `dist/` n'a
 * aucune raison d'être plus récent que lui. Le compter faisait réclamer un
 * `npm run build` après chaque test écrit — un geste inutile, réclamé par un
 * outil de diagnostic, donc un outil qu'on apprend à ignorer.
 *
 * @param chemin - chemin relatif, écrit en `/`.
 * @returns `true` si une modification de ce fichier périme le build.
 */
function isBuiltSource(chemin: string): boolean {
  // Un `.d.ts` est PRODUIT par le build : plus récent que lui par
  // construction, il ferait crier à chaque compilation. C'est la seule
  // exclusion propre à ce contrôle.
  if (!chemin.endsWith(".ts") || chemin.endsWith(".d.ts")) return false;
  if (isTestFile(chemin)) return false;
  // Le reste vient de la règle COMMUNE (`walk.ts`) : ce parcours ne peut pas
  // lister les fichiers à sauter pour son compte — c'est ainsi qu'il s'est mis
  // à compter les tests que les autres contrôles excluaient déjà.
  return !chemin.split("/").some((segment) => isSkippedDir(segment));
}

/** La source la plus RÉCEMMENT modifiée sous un chemin, et laquelle. */
function newestUnder(
  root: string,
  rel: string,
): { mtime: number; file: string } {
  const rien = { mtime: 0, file: "" };
  const cible = path.join(root, rel);
  const stat = statSync(cible, { throwIfNoEntry: false });
  if (!stat) return rien;
  if (stat.isFile())
    return isBuiltSource(rel) ? { mtime: stat.mtimeMs, file: rel } : rien;
  let trouve = rien;
  for (const entree of readdirSync(cible, {
    recursive: true,
    encoding: "utf8",
  })) {
    // Normaliser AVANT de filtrer : `readdirSync` rend `a\b` sous Windows, et
    // un filtre écrit en `/` n'y mordrait pas.
    const chemin = entree.split(path.sep).join("/");
    if (!isBuiltSource(chemin)) continue;
    const s = statSync(path.join(cible, entree), { throwIfNoEntry: false });
    if (s?.isFile() && s.mtimeMs > trouve.mtime) {
      // Le FICHIER, pas la racine qui le contient : « `src` est plus récent
      // que le build » n'apprend rien, et n'aide personne à comprendre
      // pourquoi le contrôle crie.
      trouve = { mtime: s.mtimeMs, file: `${rel}/${chemin}` };
    }
  }
  return trouve;
}

/** La version majeure exigée par `engines.node`, ou `null` si non déclarée. */
export function requiredNodeMajor(engines: unknown): number | null {
  if (typeof engines !== "object" || engines === null) return null;
  const brut = (engines as { node?: unknown }).node;
  if (typeof brut !== "string") return null;
  const m = /(\d+)/u.exec(brut);
  return m ? Number.parseInt(m[1] as string, 10) : null;
}

/**
 * Confronte les sources au build, et la version de Node au plancher déclaré.
 *
 * @param projectRoot - racine de l'application.
 * @param nodeVersion - version du runtime (injectée : une fonction qui lit
 *   `process.version` ne s'éprouve que sur la version qu'elle décrit).
 * @returns les écarts, et si la comparaison a pu avoir lieu.
 */
export function checkFreshness(
  projectRoot: string,
  nodeVersion: string = process.version,
): IFreshnessResult {
  const findings: IFreshnessFinding[] = [];

  const dist = path.join(projectRoot, "dist", "index.js");
  const distStat = statSync(dist, { throwIfNoEntry: false });
  let plusRecente = 0;
  let porteuse = "";
  for (const rel of SOURCES) {
    const quand = newestUnder(projectRoot, rel);
    if (quand.mtime > plusRecente) {
      plusRecente = quand.mtime;
      porteuse = quand.file;
    }
  }

  if (plusRecente > 0 && !distStat) {
    findings.push({
      kind: "dist-missing",
      message:
        "l'application n'est pas construite (`dist/index.js` absent) : le " +
        "runtime charge le build, pas les sources — toute route répondra 404. " +
        "→ `npm run build`",
      file: "dist/index.js",
    });
  } else if (distStat && plusRecente > distStat.mtimeMs) {
    const ecart = formatDuration((plusRecente - distStat.mtimeMs) / 1000);
    findings.push({
      kind: "dist-stale",
      message:
        `des sources ont changé APRÈS le dernier build (\`${porteuse}\` est ` +
        `plus récent de ${ecart} que \`dist/index.js\`) : le runtime sert ` +
        "encore l'ancien code — une route neuve répondra 404, un export retiré " +
        "restera servi. → `npm run build`",
      file: porteuse,
    });
  }

  const manifeste = path.join(projectRoot, "package.json");
  if (existsSync(manifeste)) {
    try {
      const pkg = JSON.parse(readFileSync(manifeste, "utf8")) as {
        engines?: unknown;
      };
      const exige = requiredNodeMajor(pkg.engines);
      const courant = Number.parseInt(nodeVersion.replace(/^v/u, ""), 10);
      if (exige !== null && Number.isFinite(courant) && courant < exige) {
        findings.push({
          kind: "node-below-engines",
          message:
            `Node ${nodeVersion} est en deçà du plancher déclaré par cette ` +
            `application (\`engines.node\` exige ${exige} ou plus) : l'échec ` +
            "arrivera sur une syntaxe non reconnue, loin de sa cause. " +
            "→ installer Node " +
            `${exige}, ou relever \`engines.node\` en connaissance de cause`,
          file: "package.json",
        });
      }
    } catch {
      /* manifeste illisible : ce n'est pas le sujet de ce contrôle */
    }
  }

  return { findings, notComparable: plusRecente === 0 && !distStat };
}

/**
 * Le préfixe des paquets du framework — un seul endroit, parce que la question
 * « ce paquet est-il des nôtres ? » se pose ici et nulle part ailleurs.
 */
const PREFIXE_FRAMEWORK = "@nodefony/";

/**
 * Le paquet est-il LIÉ à un checkout local, plutôt qu'installé ?
 *
 * C'est toute la question de ce contrôle. Un paquet installé depuis npm arrive
 * bâti : son `dist/` est dans le tarball, il n'y a rien à vérifier et crier
 * dessus ferait ignorer le diagnostic par toute application du monde. Un paquet
 * LIÉ, lui, est un dossier de travail dont le `dist/` ne se met à jour que si
 * quelqu'un le bâtit — et c'est le régime du dépôt self-hosted comme d'une
 * application liée pour le développement.
 *
 * Le lien se CONSTATE (`lstat`), il ne se déduit pas du manifeste : `npm link`,
 * `file:` et un workspace npm produisent tous un lien symbolique, alors qu'ils
 * s'écrivent différemment dans le `package.json` — et certains ne s'y écrivent
 * pas du tout.
 *
 * @param chemin - le chemin du paquet sous `node_modules`.
 * @returns `true` si c'est un lien vers un dossier de travail.
 */
function estLie(chemin: string): boolean {
  try {
    return lstatSync(chemin).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Les paquets `@nodefony/*` LIÉS dont le build manque ou date d'avant les sources.
 *
 * Le runtime charge le `dist/` d'un paquet, jamais ses sources — exactement
 * comme pour l'application. La différence est le coût du symptôme : un paquet
 * du framework périmé fait répondre 404 à une route pourtant écrite, ou lever
 * « does not provide an export named … » au démarrage, sans que rien ne
 * désigne la cause. C'est la panne la plus fréquente de ce framework, et la
 * seule que `doctor` ne voyait pas — il ne regardait que le `dist/` de
 * l'application.
 *
 * ⚠️ Ne regarde QUE les paquets liés (cf {@link estLie}), et n'accuse que dans
 * le sens sûr : sources plus récentes que le build. Un cache peut restaurer un
 * `dist/` daté du futur sans que son contenu corresponde ; l'inverse reste
 * toujours vrai.
 *
 * @param projectRoot - racine de l'application (celle qui porte `node_modules`).
 * @returns les paquets à rebâtir, avec le geste — vide quand tout est à jour,
 *   qu'il n'y a pas de `node_modules`, ou que rien n'est lié.
 */
export function checkFrameworkBuild(projectRoot: string): IFreshnessFinding[] {
  const scope = path.join(
    projectRoot,
    "node_modules",
    PREFIXE_FRAMEWORK.slice(0, -1),
  );
  let noms: string[];
  try {
    noms = readdirSync(scope);
  } catch {
    // Ni `node_modules`, ni portée `@nodefony` : rien à dire. Une application
    // qui n'a pas encore installé ses dépendances a d'autres contrôles qui la
    // renseignent, et celui-ci n'a rien constaté.
    return [];
  }
  const findings: IFreshnessFinding[] = [];
  for (const nom of noms.sort()) {
    const paquet = path.join(scope, nom);
    if (!estLie(paquet)) continue;
    const complet = `${PREFIXE_FRAMEWORK}${nom}`;
    // Le lien est suivi une fois : tout ce qui suit porte sur le dossier de
    // travail réel, jamais sur le lien lui-même (dont la date ne dit rien).
    let reel: string;
    try {
      reel = realpathSync(paquet);
    } catch {
      continue;
    }
    const dist = statSync(path.join(reel, "dist", "index.js"), {
      throwIfNoEntry: false,
    });
    let plusRecente = 0;
    let porteuse = "";
    for (const rel of SOURCES) {
      const quand = newestUnder(reel, rel);
      if (quand.mtime > plusRecente) {
        plusRecente = quand.mtime;
        porteuse = quand.file;
      }
    }
    if (plusRecente === 0) continue; // aucune source : rien à comparer
    if (!dist) {
      findings.push({
        kind: "framework-missing",
        message:
          `\`${complet}\` est LIÉ à un dossier de travail qui n'est pas ` +
          "construit (`dist/index.js` absent) : le runtime charge le build, " +
          "donc ce paquet n'apporte rien — routes en 404, exports " +
          "introuvables au démarrage. → `npm run build` dans le dépôt du " +
          "framework (bâtir l'application ne construit PAS ses paquets liés)",
        file: path.join("node_modules", complet, "dist", "index.js"),
      });
      continue;
    }
    if (plusRecente > dist.mtimeMs) {
      const ecart = formatDuration((plusRecente - dist.mtimeMs) / 1000);
      findings.push({
        kind: "framework-stale",
        message:
          `\`${complet}\` est LIÉ, et ses sources ont changé APRÈS son build ` +
          `(\`${porteuse}\` est plus récent de ${ecart} que son ` +
          "`dist/index.js`) : c'est l'ANCIEN code du framework qui s'exécute. " +
          "→ `npm run build` dans le dépôt du framework",
        file: path.join("node_modules", complet, "dist", "index.js"),
      });
    }
  }
  return findings;
}
