import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Écriture prévue par un scaffold, telle qu'un dry-run la restitue.
 *
 * `previous` n'est renseigné que pour un `overwrite` : c'est ce qui permet à un
 * front (CLI `--dry-run`, préview Studio) de montrer un vrai diff plutôt qu'une
 * liste de chemins.
 */
export interface IScaffoldChange {
  /** Chemin absolu du fichier. */
  path: string;
  /** Le fichier n'existait pas (`create`) ou sera réécrit (`overwrite`). */
  kind: "create" | "overwrite";
  /** Contenu qui sera écrit — en base64 quand `encoding` vaut `"base64"`. */
  content: string;
  /** Contenu actuel sur disque — seulement si `kind === "overwrite"`. */
  previous?: string;
  /**
   * `"base64"` pour un fichier BINAIRE (image) : `content` et `previous` sont
   * alors encodés, et ne se comparent pas ligne à ligne. Absent = texte UTF-8.
   * Le plan reste ainsi entièrement sérialisable en JSON, ce que Studio exige.
   */
  encoding?: "base64";
}

/** Une ligne d'un diff, telle que {@link diffLines} la classe. */
export interface IDiffLine {
  /** `keep` = inchangée, `add` = ajoutée, `remove` = retirée. */
  kind: "keep" | "add" | "remove";
  text: string;
}

/**
 * Au-delà de cette taille, le diff ligne à ligne n'est plus calculé (la matrice
 * de programmation dynamique est quadratique). Les fichiers qu'un scaffold
 * RÉÉCRIT sont des `index.ts`, des `package.json`, une config — deux ordres de
 * grandeur en dessous ; la borne n'existe que pour qu'un cas aberrant dégrade
 * l'affichage au lieu de figer le terminal.
 */
const DIFF_MAX_LINES = 1000;

/**
 * Diff ligne à ligne de deux contenus (plus longue sous-séquence commune).
 *
 * Calculé au MOTEUR, et non dans chaque front : le CLI (`--dry-run`) et la
 * préview Studio montrent le même changement, et un rendu qui diverge du plan
 * réellement exécuté serait pire que pas de préview du tout.
 *
 * Au-delà de {@link DIFF_MAX_LINES} lignes, rend le remplacement en bloc —
 * exact, mais sans détail.
 */
export function diffLines(before: string, after: string): IDiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return [
      ...a.map((text): IDiffLine => ({ kind: "remove", text })),
      ...b.map((text): IDiffLine => ({ kind: "add", text })),
    ];
  }
  // lcs[i][j] = longueur de la plus longue sous-séquence commune de a[i…] et b[j…].
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  // Hors bornes, la table vaut 0 : c'est la ligne/colonne sentinelle.
  const cell = (k: number): number => lcs[k] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? cell((i + 1) * width + j + 1) + 1
          : Math.max(cell((i + 1) * width + j), cell(i * width + j + 1));
    }
  }
  const diff: IDiffLine[] = [];
  let i = 0;
  let j = 0;
  for (;;) {
    const x = a[i];
    const y = b[j];
    if (x === undefined || y === undefined) break;
    if (x === y) {
      diff.push({ kind: "keep", text: x });
      i++;
      j++;
    } else if (cell((i + 1) * width + j) >= cell(i * width + j + 1)) {
      diff.push({ kind: "remove", text: x });
      i++;
    } else {
      diff.push({ kind: "add", text: y });
      j++;
    }
  }
  for (const text of a.slice(i)) {
    diff.push({ kind: "remove", text });
  }
  for (const text of b.slice(j)) {
    diff.push({ kind: "add", text });
  }
  return diff;
}

/**
 * Système de fichiers TRANSACTIONNEL du scaffold : toutes les écritures sont
 * retenues en mémoire, et ne touchent le disque qu'au {@link ScaffoldWriter.commit}
 * final.
 *
 * POURQUOI le moteur ne peut pas écrire au fil de l'eau : un scaffold est une
 * suite d'étapes dont plusieurs peuvent REFUSER *après* les premières écritures
 * — nom de classe déjà pris, `@controllers([...])` introuvable, tag eta résiduel,
 * workspace de link manquant. Écrire puis lever laisse un projet à moitié
 * modifié, alors que l'utilisateur lit un message d'erreur et croit
 * légitimement que rien n'a bougé (il a perdu son fichier). En différant le
 * disque, « refuser » redevient un non-événement : aucune garde n'a besoin
 * d'être placée avant les rendus, et une garde ajoutée demain est
 * automatiquement sûre.
 *
 * La transaction sert AUSSI de source du dry-run : ne pas committer, c'est
 * exactement simuler — sans une seconde implémentation du moteur qui dériverait.
 *
 * Les LECTURES passent par la transaction (`read`/`exists`/`listDir`) : une
 * étape doit voir ce que les précédentes ont produit. Sans cela, câbler deux
 * décorateurs dans le même `index.ts` perdrait la première insertion, et le
 * controller d'un module tout juste rendu ne trouverait pas sa cible.
 *
 * Portée : les fichiers du PROJET. Les templates et le paquet `nodefony`
 * lui-même se lisent directement — ils sont en lecture seule.
 */
export class ScaffoldWriter {
  /**
   * Chemin absolu → contenu en attente, dans l'ordre d'écriture. Un
   * `Uint8Array` est un fichier binaire ({@link writeBinary}).
   */
  readonly #pending = new Map<string, string | Uint8Array>();

  /**
   * Contenu TEXTE à jour du fichier — écriture en attente d'abord, sinon disque.
   *
   * @throws Si le fichier en attente est binaire : le relire comme du texte
   *   le corromprait sans le dire.
   */
  read(file: string): string {
    const pending = this.#pending.get(file);
    if (pending instanceof Uint8Array) {
      throw new Error(`fichier binaire, illisible comme du texte : ${file}`);
    }
    return pending ?? readFileSync(file, "utf8");
  }

  /**
   * Le chemin existe-t-il, une fois la transaction appliquée ? Vrai aussi pour
   * un DOSSIER qui n'existe encore que par les fichiers en attente qu'il
   * contient (`modules/blog/` pendant `create module`).
   */
  exists(file: string): boolean {
    if (this.#pending.has(file) || existsSync(file)) {
      return true;
    }
    const prefix = `${file}${path.sep}`;
    for (const pending of this.#pending.keys()) {
      if (pending.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Entrées d'un dossier, disque et transaction fusionnés — la vue dont
   * `listTargets` a besoin pour voir un module qui n'est pas encore committé.
   */
  listDir(dir: string): { name: string; isDirectory: boolean }[] {
    const entries = new Map<string, boolean>();
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        entries.set(entry.name, entry.isDirectory());
      }
    }
    const prefix = `${dir}${path.sep}`;
    for (const pending of this.#pending.keys()) {
      if (!pending.startsWith(prefix)) {
        continue;
      }
      const rest = pending.slice(prefix.length);
      const sep = rest.indexOf(path.sep);
      entries.set(sep === -1 ? rest : rest.slice(0, sep), sep !== -1);
    }
    return [...entries].map(([name, isDirectory]) => ({ name, isDirectory }));
  }

  /** Retient une écriture. Rien ne touche le disque avant {@link commit}. */
  write(file: string, content: string): void {
    this.#pending.set(file, content);
  }

  /**
   * Retient l'écriture d'un fichier BINAIRE (image), octet pour octet.
   *
   * Distincte de {@link write} : une image passée par une chaîne UTF-8 est
   * corrompue sans erreur — chaque octet invalide devient U+FFFD.
   */
  writeBinary(file: string, content: Uint8Array): void {
    this.#pending.set(file, content);
  }

  /**
   * Écritures prévues, dans l'ordre — matière du dry-run et de la préview.
   *
   * L'état « existait déjà » est relu ICI (et non à `write`) : entre les deux,
   * seule la transaction a pu changer, et elle est justement ce qu'on décrit.
   */
  changes(): IScaffoldChange[] {
    const changes: IScaffoldChange[] = [];
    for (const [file, content] of this.#pending) {
      const binary = content instanceof Uint8Array;
      const encoded = binary
        ? Buffer.from(content).toString("base64")
        : content;
      const extra = binary ? { encoding: "base64" as const } : {};
      if (existsSync(file)) {
        changes.push({
          path: file,
          kind: "overwrite",
          content: encoded,
          previous: binary
            ? readFileSync(file).toString("base64")
            : readFileSync(file, "utf8"),
          ...extra,
        });
      } else {
        changes.push({
          path: file,
          kind: "create",
          content: encoded,
          ...extra,
        });
      }
    }
    return changes;
  }

  /** Nombre d'écritures en attente. */
  get size(): number {
    return this.#pending.size;
  }

  /**
   * Applique la transaction sur le disque, dans l'ordre d'écriture.
   *
   * Ce n'est PAS atomique au sens du système de fichiers (aucune API portable
   * ne l'offre pour un arbre) : une panne disque en cours de vidage laisse un
   * résultat partiel. Ce que la transaction garantit, c'est qu'aucune décision
   * du moteur — garde, validation, rendu cassé — ne peut plus produire ce
   * résultat partiel, ce qui était le seul cas observé en pratique.
   */
  commit(): void {
    for (const [file, content] of this.#pending) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    this.#pending.clear();
  }
}
