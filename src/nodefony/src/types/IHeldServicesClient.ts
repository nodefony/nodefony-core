/**
 * Le contrat du client des services portés, côté module (ADR-0030) — isolé
 * dans un fichier qui n'importe que le protocole `nf-held` (une feuille) :
 * `IKernel` le référence, et tout ce que `IKernel` importe entre dans le
 * graphe de types du code NAVIGATEUR (`tsconfigClient.json`). Le canal
 * `nf-dev` y aurait fait entrer le noyau entier.
 *
 * Implémentation : `kernel/heldServicesClient.ts#HeldServicesClient`.
 */
import type {
  IHeldHostStatus,
  IHeldServiceDeclaration,
} from "../service/dev/heldChannel";

/**
 * Le client des services portés d'UN propriétaire — ce qu'un module voit.
 *
 * Un plan se compose en trois gestes : {@link expect} annonce les clés du plan,
 * chaque service s'y {@link submit} (ou s'en {@link withdraw} s'il n'a pas pu se
 * préparer), et le plan part quand plus aucune clé n'est attendue. Il part
 * donc COMPLET, en un seul message : envoyé par morceaux, chaque plan partiel
 * arrêterait les services que le suivant redemande (le registre réconcilie sur
 * la liste complète).
 */
export interface IHeldServicesClient {
  /** Le propriétaire (`frontend`, `ai`). */
  readonly owner: string;
  /**
   * Annonce les clés du prochain plan. Une liste vide part aussitôt, en plan
   * vide : le superviseur arrête alors tous les services de ce propriétaire.
   *
   * @throws si un plan est déjà en cours de composition.
   */
  expect(keys: Iterable<string>): void;
  /**
   * Apporte la déclaration d'une clé attendue.
   *
   * @returns tenue quand le plan est ACCEPTÉ ; rejetée s'il est refusé (la
   *   cause nommée par le superviseur), sans acquittement à l'heure, ou faute
   *   de canal.
   */
  submit(declaration: IHeldServiceDeclaration): Promise<void>;
  /** Retire une clé attendue qui ne sera pas déclarée (préparation en échec). */
  withdraw(key: string): void;
  /**
   * Reçoit les états poussés d'une clé — à poser AVANT {@link submit} : un
   * service gardé voit son état rejoué avant même l'acquittement.
   *
   * @returns la désinscription.
   */
  watch(key: string, onStatus: (status: IHeldHostStatus) => void): () => void;
  /** Cesse d'écouter ; un plan en attente d'acquittement est rejeté. */
  close(): void;
}
