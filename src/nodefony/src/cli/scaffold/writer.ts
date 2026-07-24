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
  /** Contenu qui sera écrit. */
  content: string;
  /** Contenu actuel sur disque — seulement si `kind === "overwrite"`. */
  previous?: string;
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
  /** Chemin absolu → contenu en attente, dans l'ordre d'écriture. */
  readonly #pending = new Map<string, string>();

  /** Contenu à jour du fichier — écriture en attente d'abord, sinon disque. */
  read(file: string): string {
    const pending = this.#pending.get(file);
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
   * Écritures prévues, dans l'ordre — matière du dry-run et de la préview.
   *
   * L'état « existait déjà » est relu ICI (et non à `write`) : entre les deux,
   * seule la transaction a pu changer, et elle est justement ce qu'on décrit.
   */
  changes(): IScaffoldChange[] {
    const changes: IScaffoldChange[] = [];
    for (const [file, content] of this.#pending) {
      if (existsSync(file)) {
        changes.push({
          path: file,
          kind: "overwrite",
          content,
          previous: readFileSync(file, "utf8"),
        });
      } else {
        changes.push({ path: file, kind: "create", content });
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
