/**
 * API publique de `DevkitService` (injectable, nom `devkit`).
 *
 * L'interface est le CONTRAT : ce que les autres modules (et Studio) peuvent
 * appeler. Tout ce qui n'est pas ici est un détail d'implémentation, libre de
 * changer.
 */
export interface IDevkitService {
  /** Snapshot de lecture — état courant du service. */
  status(): { ready: boolean };

  /** Exemple de méthode métier — à remplacer par la vôtre. */
  greet(who?: string): string;
}
