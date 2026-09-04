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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { duree } from "./report";

/** Un écart entre ce qui est écrit et ce qui s'exécutera. */
export interface IFreshnessFinding {
  kind: "dist-stale" | "dist-missing" | "node-below-engines";
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
  if (!chemin.endsWith(".ts") || chemin.endsWith(".d.ts")) return false;
  if (chemin.includes("/dist/") || chemin.includes("/node_modules/"))
    return false;
  if (/\.(test|spec)\.[cm]?tsx?$/u.test(chemin)) return false;
  return !/(^|\/)(tests?|__tests__)\//u.test(chemin);
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
    const ecart = duree((plusRecente - distStat.mtimeMs) / 1000);
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
