/**
 * Erreur levée par le codec CBOR, à l'encodage comme au décodage.
 *
 * Étend `TypeError` — la classe que lèvent `JSON.stringify` (`bigint`, cycle)
 * et `TextDecoder` en mode strict : la valeur, ou les octets reçus, n'ont pas
 * la forme attendue. `RangeError` aurait convenu aux seules bornes (profondeur,
 * longueur) ; une classe unique vaut mieux qu'une classe par faute, et c'est
 * `TypeError` que l'appelant attrape déjà pour le codec JSON.
 */
export class CborError extends TypeError {
  override readonly name: string = "CborError";

  /**
   * Décalage, en octets depuis le début de l'entrée, de l'élément refusé ;
   * `null` quand la faute vient de la valeur à encoder.
   */
  readonly position: number | null;

  constructor(message: string, position: number | null = null) {
    super(message);
    this.position = position;
  }
}
