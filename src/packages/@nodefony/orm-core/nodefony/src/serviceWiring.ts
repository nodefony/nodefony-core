import type { Container, Event, DefaultOptionsService } from "nodefony";

/**
 * Câblage d'un {@link Service} (DI / bus d'événements / options) sous forme de
 * **tuple** — évite de redéclarer `container` / `notificationsCenter` / `options`
 * dans le constructeur de chaque service juste pour les tunneler jusqu'à `super`.
 *
 * À capter en rest-param et forwarder par spread :
 *
 * ```ts
 * constructor(repository: R, ...wiring: ServiceWiring) {
 *   super("name", repository, ...wiring);
 * }
 * ```
 *
 * Reflète l'ordre positionnel du constructeur de `Service` :
 * `(name, container?, notificationsCenter?, options?)`. Ces trois arguments sont
 * quasi toujours **omis** (le container DI les fournit à l'instanciation) ; le
 * tuple sert surtout à ne plus les recopier à la main dans chaque sous-classe.
 */
export type ServiceWiring = [
  container?: Container,
  notificationsCenter?: Event | false | null,
  options?: DefaultOptionsService,
];
