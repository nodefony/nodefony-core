/**
 * API publique de `<%= it.pascal %>Service` (injectable, clé de conteneur
 * `<%= it.camel %>`).
 *
 * L'interface est le CONTRAT : ce que les autres services, controllers et
 * commandes peuvent appeler. Tout ce qui n'est pas ici est un détail
 * d'implémentation, libre de changer.
 */
export interface I<%= it.pascal %>Service {
  /** Snapshot de lecture — état courant du service. */
  status(): { ready: boolean };

  /** Exemple de méthode métier — à remplacer par la vôtre. */
  greet(who?: string): string;
<% if (it.inject) { %>

  /** Délègue à `<%= it.inject.pascal %>`, injecté par le constructeur. */
  depuis<%= it.inject.pascal %>(): Promise<unknown>;
<% } %>}
