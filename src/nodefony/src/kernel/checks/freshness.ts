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
import { withoutComments } from "./sourceText";

/** Un écart entre ce qui est écrit et ce qui s'exécutera. */
export interface IFreshnessFinding {
  kind:
    | "dist-stale"
    | "dist-missing"
    | "node-below-engines"
    | "framework-stale"
    | "framework-missing"
    | "frontend-stale"
    | "frontend-missing";
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
 * @param filePath - chemin relatif, écrit en `/`.
 * @returns `true` si une modification de ce fichier périme le build.
 */
function isBuiltSource(filePath: string): boolean {
  // Un `.d.ts` est PRODUIT par le build : plus récent que lui par
  // construction, il ferait crier à chaque compilation. C'est la seule
  // exclusion propre à ce contrôle.
  if (!filePath.endsWith(".ts") || filePath.endsWith(".d.ts")) return false;
  if (isTestFile(filePath)) return false;
  // Le reste vient de la règle COMMUNE (`walk.ts`) : ce parcours ne peut pas
  // lister les fichiers à sauter pour son compte — c'est ainsi qu'il s'est mis
  // à compter les tests que les autres contrôles excluaient déjà.
  return !filePath.split("/").some((segment) => isSkippedDir(segment));
}

/** La source la plus RÉCEMMENT modifiée sous un chemin, et laquelle. */
function newestUnder(
  root: string,
  rel: string,
): { mtime: number; file: string } {
  const rien = { mtime: 0, file: "" };
  const target = path.join(root, rel);
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return rien;
  if (stat.isFile())
    return isBuiltSource(rel) ? { mtime: stat.mtimeMs, file: rel } : rien;
  let found = rien;
  for (const entry of readdirSync(target, {
    recursive: true,
    encoding: "utf8",
  })) {
    // Normaliser AVANT de filtrer : `readdirSync` rend `a\b` sous Windows, et
    // un filtre écrit en `/` n'y mordrait pas.
    const filePath = entry.split(path.sep).join("/");
    if (!isBuiltSource(filePath)) continue;
    const s = statSync(path.join(target, entry), { throwIfNoEntry: false });
    if (s?.isFile() && s.mtimeMs > found.mtime) {
      // Le FICHIER, pas la racine qui le contient : « `src` est plus récent
      // que le build » n'apprend rien, et n'aide personne à comprendre
      // pourquoi le contrôle crie.
      found = { mtime: s.mtimeMs, file: `${rel}/${filePath}` };
    }
  }
  return found;
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
 * Une entrée frontend DÉCLARÉE par l'application : sa racine Vite et sa sortie.
 *
 * Les deux chemins viennent de la déclaration elle-même, jamais d'une
 * convention devinée : `outDir` se réécrit par entrée, et un contrôle qui
 * chercherait `public/dist` en dur se tairait sur toute application qui a
 * choisi autre chose — en ayant l'air de l'avoir vérifiée.
 */
interface IFrontendEntry {
  /** Racine Vite, relative à la racine du projet. */
  root: string;
  /** Dossier de sortie du build, relatif à la racine du projet. */
  outDir: string;
  /** Le fichier qui porte la déclaration, pour nommer le constat. */
  file: string;
}

/** `svc.registerEntry(module, { … })` — le bloc d'options, quel qu'en soit le porteur. */
const REGISTER_ENTRY_RE =
  /\bregisterEntry\s*\([^,)]*,\s*\{([\s\S]{0,2000}?)\}/gu;

/** `root: "./frontend"` dans un bloc d'options. */
const ENTRY_ROOT_RE = /\broot\s*:\s*["'`]([^"'`\n]+)["'`]/u;

/** `outDir: "./public/dist"` dans un bloc d'options. */
const ENTRY_OUT_DIR_RE = /\boutDir\s*:\s*["'`]([^"'`\n]+)["'`]/u;

/** Extensions qui composent un bundle front — bien au-delà du TypeScript. */
const FRONT_SOURCE_RE =
  /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|sass|less|html)$/u;

/**
 * Les entrées frontend que l'application DÉCLARE, lues dans ses sources.
 *
 * Lecture textuelle et SANS les commentaires, comme partout dans `doctor` :
 * le fichier écrit par le générateur documente `root` et `outDir` dans son
 * TSDoc avant de les employer, et une lecture brute y verrait deux
 * déclarations de plus qui n'existent pas.
 *
 * @param projectRoot - racine de l'application.
 * @returns une entrée par `registerEntry` complet trouvé.
 */
function declaredFrontendEntries(projectRoot: string): IFrontendEntry[] {
  const entries: IFrontendEntry[] = [];
  for (const rel of SOURCES) {
    const target = path.join(projectRoot, rel);
    const stat = statSync(target, { throwIfNoEntry: false });
    if (!stat) continue;
    const files: string[] = stat.isFile()
      ? [rel]
      : readdirSync(target, { recursive: true, encoding: "utf8" })
          .map((entry) => `${rel}/${entry.split(path.sep).join("/")}`)
          .filter(
            (f) =>
              f.endsWith(".ts") &&
              !f.split("/").some((segment) => isSkippedDir(segment)),
          );
    for (const file of files) {
      const full = path.join(projectRoot, file);
      // On OUVRE, on ne demande pas d'abord « est-ce un fichier ? » : entre la
      // question et l'ouverture la réponse peut changer (CodeQL
      // js/file-system-race), et c'était une syscall de plus par fichier
      // exploré. L'échec de lecture trie aussi bien — un répertoire lève
      // EISDIR, un fichier disparu ENOENT —, et il tranche sur l'état RÉEL au
      // moment où l'on s'en sert.
      let code: string;
      try {
        code = withoutComments(readFileSync(full, "utf8"));
      } catch {
        continue;
      }
      REGISTER_ENTRY_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = REGISTER_ENTRY_RE.exec(code)) !== null) {
        const options = m[1] ?? "";
        const root = ENTRY_ROOT_RE.exec(options)?.[1];
        const outDir = ENTRY_OUT_DIR_RE.exec(options)?.[1];
        if (!root || !outDir) continue;
        entries.push({ root, outDir, file });
      }
    }
  }
  return entries;
}

/** La date du fichier le plus récent sous un dossier, 0 s'il n'y en a aucun. */
function newestFileUnder(dir: string, keep: (f: string) => boolean): number {
  const stat = statSync(dir, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const filePath = entry.split(path.sep).join("/");
    if (filePath.split("/").some((segment) => isSkippedDir(segment))) continue;
    if (!keep(filePath)) continue;
    const s = statSync(path.join(dir, entry), { throwIfNoEntry: false });
    if (s?.isFile() && s.mtimeMs > newest) newest = s.mtimeMs;
  }
  return newest;
}

/**
 * Le frontend DÉCLARÉ est-il construit, et l'est-il APRÈS ses sources ?
 *
 * 🔴 Le contrôle de fraîcheur ne regardait que le `dist/` du backend. Une
 * application dont le build frontend avait échoué — `public/dist` ABSENT,
 * donc aucune page servie — s'entendait répondre « sources et build
 * alignés », et `doctor` sortait en 0. Un contrôle qui rassure à tort est pire
 * qu'un contrôle absent : lancé en fin de génération, il SIGNERAIT l'échec au
 * lieu de le montrer.
 *
 * N'accuse que dans le sens sûr, comme le reste de ce fichier : sources plus
 * récentes que la sortie. Une application qui ne déclare aucun frontend ne
 * produit rien ici — le silence est alors la bonne réponse, pas un oubli.
 *
 * @param projectRoot - racine de l'application.
 * @returns un constat par entrée dont la sortie manque ou date d'avant.
 */
export function checkFrontendBuild(projectRoot: string): IFreshnessFinding[] {
  const findings: IFreshnessFinding[] = [];
  for (const entry of declaredFrontendEntries(projectRoot)) {
    const rootDir = path.join(projectRoot, entry.root);
    const newestSource = newestFileUnder(rootDir, (f) =>
      FRONT_SOURCE_RE.test(f),
    );
    // Une racine vide n'est pas un manquement : il n'y a rien à construire, et
    // crier dessus enverrait chercher un build qui n'a pas lieu d'être.
    if (newestSource === 0) continue;
    const outPath = path.join(projectRoot, entry.outDir);
    const newestBuilt = newestFileUnder(outPath, () => true);
    if (newestBuilt === 0) {
      findings.push({
        kind: "frontend-missing",
        message:
          `le frontend déclaré (\`${entry.root}\`) n'est pas construit ` +
          `(\`${entry.outDir}\` est absent ou vide) : le framework monte cette ` +
          "sortie en statique — sans elle, la page ne sera pas servie et le " +
          "navigateur recevra un 404 sur ses assets. → `npm run build`",
        file: entry.file,
      });
      continue;
    }
    if (newestSource > newestBuilt) {
      const gap = formatDuration((newestSource - newestBuilt) / 1000);
      findings.push({
        kind: "frontend-stale",
        message:
          `le frontend a changé APRÈS son dernier build (\`${entry.root}\` est ` +
          `plus récent de ${gap} que \`${entry.outDir}\`) : c'est l'ancien ` +
          "bundle qui est servi, et rien ne le dit — la modification paraît " +
          "simplement sans effet. → `npm run build`",
        file: entry.file,
      });
    }
  }
  return findings;
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
    const when = newestUnder(projectRoot, rel);
    if (when.mtime > plusRecente) {
      plusRecente = when.mtime;
      porteuse = when.file;
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
    const gap = formatDuration((plusRecente - distStat.mtimeMs) / 1000);
    findings.push({
      kind: "dist-stale",
      message:
        `des sources ont changé APRÈS le dernier build (\`${porteuse}\` est ` +
        `plus récent de ${gap} que \`dist/index.js\`) : le runtime sert ` +
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
      const current = Number.parseInt(nodeVersion.replace(/^v/u, ""), 10);
      if (exige !== null && Number.isFinite(current) && current < exige) {
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

  // Le frontend est une SECONDE chaîne de build, avec sa propre sortie : la
  // ranger sous le même contrôle est ce qui empêche « sources et build
  // alignés » de ne parler que de la moitié de l'application.
  findings.push(...checkFrontendBuild(projectRoot));

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
 * @param filePath - le chemin du paquet sous `node_modules`.
 * @returns `true` si c'est un lien vers un dossier de travail.
 */
function estLie(filePath: string): boolean {
  try {
    return lstatSync(filePath).isSymbolicLink();
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
  let names: string[];
  try {
    names = readdirSync(scope);
  } catch {
    // Ni `node_modules`, ni portée `@nodefony` : rien à dire. Une application
    // qui n'a pas encore installé ses dépendances a d'autres contrôles qui la
    // renseignent, et celui-ci n'a rien constaté.
    return [];
  }
  const findings: IFreshnessFinding[] = [];
  for (const name of names.sort()) {
    const pkg = path.join(scope, name);
    if (!estLie(pkg)) continue;
    const fullName = `${PREFIXE_FRAMEWORK}${name}`;
    // Le lien est suivi une fois : tout ce qui suit porte sur le dossier de
    // travail réel, jamais sur le lien lui-même (dont la date ne dit rien).
    let actual: string;
    try {
      actual = realpathSync(pkg);
    } catch {
      continue;
    }
    const dist = statSync(path.join(actual, "dist", "index.js"), {
      throwIfNoEntry: false,
    });
    let plusRecente = 0;
    let porteuse = "";
    for (const rel of SOURCES) {
      const when = newestUnder(actual, rel);
      if (when.mtime > plusRecente) {
        plusRecente = when.mtime;
        porteuse = when.file;
      }
    }
    if (plusRecente === 0) continue; // aucune source : rien à comparer
    if (!dist) {
      findings.push({
        kind: "framework-missing",
        message:
          `\`${fullName}\` est LIÉ à un dossier de travail qui n'est pas ` +
          "construit (`dist/index.js` absent) : le runtime charge le build, " +
          "donc ce paquet n'apporte rien — routes en 404, exports " +
          "introuvables au démarrage. → `npm run build` dans le dépôt du " +
          "framework (bâtir l'application ne construit PAS ses paquets liés)",
        file: path.join("node_modules", fullName, "dist", "index.js"),
      });
      continue;
    }
    if (plusRecente > dist.mtimeMs) {
      const gap = formatDuration((plusRecente - dist.mtimeMs) / 1000);
      findings.push({
        kind: "framework-stale",
        message:
          `\`${fullName}\` est LIÉ, et ses sources ont changé APRÈS son build ` +
          `(\`${porteuse}\` est plus récent de ${gap} que son ` +
          "`dist/index.js`) : c'est l'ANCIEN code du framework qui s'exécute. " +
          "→ `npm run build` dans le dépôt du framework",
        file: path.join("node_modules", fullName, "dist", "index.js"),
      });
    }
  }
  return findings;
}
