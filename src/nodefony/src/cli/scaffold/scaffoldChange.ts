/**
 * Formes d’un PLAN de génération — module FEUILLE, sans import, isomorphe :
 * le moteur les produit côté serveur, un écran (préview de Studio) les lit
 * dans le navigateur.
 */

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
