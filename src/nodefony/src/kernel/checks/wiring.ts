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
  kind: "orphan-entity" | "orphan-controller" | "reserved-entity";
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
}

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
  return ["entity", "controllers"].some((sub) =>
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
  const { roots, cwd = process.cwd() } = options;
  const findings: IWiringFinding[] = [];
  let scanned = 0;

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

    for (const [file, content] of sources) {
      const dir = path.dirname(file);
      const inEntities = dir.endsWith(path.join("nodefony", "entity"));
      const inControllers = dir.endsWith(path.join("nodefony", "controllers"));
      if (!inEntities && !inControllers) continue;
      scanned += 1;

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
          const declared = ENTITY_NAME_RE.exec(
            content.slice(content.indexOf(symbol)),
          )?.[1];
          const reserved = declared ? findReservedEntity(declared) : undefined;
          if (reserved) {
            findings.push({
              kind: "reserved-entity",
              file: rel(file),
              message:
                `${symbol} déclare name: "${declared}", qui appartient au module « ${reserved.module} » — ` +
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
