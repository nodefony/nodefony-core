import { AbstractCrudService, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { <%= it.pascal %>Row } from "../entity/<%= it.pascal %>";
import {
  create<%= it.pascal %>Schema,
  update<%= it.pascal %>Schema,
} from "../entity/<%= it.pascal %>.schema";

/**
 * Logique métier de `<%= it.pascal %>` — **la** source de vérité.
 *
 * Elle vit ici, et pas dans le controller, parce qu'elle doit servir tous les
 * transports : la même méthode alimente la route REST, l'appel WebSocket, un futur
 * résolveur GraphQL et une commande CLI. Écrire le CRUD dans un controller
 * obligerait à le réécrire pour chacun d'eux.
 *
 * `AbstractCrudService` fournit `find` / `findById` / `count` (délégation directe, sans
 * surcoût) et `create` / `updateOne` / `delete` (encadrés par des points d'extension et
 * suivis d'événements `onCreated` / `onUpdated` / `onDeleted`).
 *
 * **Sans état par requête** : ce service est un singleton partagé. Ne jamais écrire
 * `this.quelqueChose = …` pendant le traitement d'une requête — l'utilisateur courant
 * ou la transaction voyagent dans le contexte, jamais sur l'instance.
 */
export class <%= it.pascal %>Service extends AbstractCrudService<<%= it.pascal %>Row> {
  constructor(repository: IRepository<<%= it.pascal %>Row>) {
    super("<%= it.camel %>Service", repository);
  }

  /**
   * Valide les données **avant** l'insertion. Un rejet devient un `422` accompagné de
   * la liste des champs fautifs, quel que soit le transport d'origine.
   *
   * `parse` retire au passage tout champ inconnu : un client ne peut pas écrire une
   * colonne qu'on ne lui a pas ouverte.
   */
  protected override beforeCreate(
    data: Partial<<%= it.pascal %>Row>,
  ): Partial<<%= it.pascal %>Row> {
    return create<%= it.pascal %>Schema.parse(data) as Partial<<%= it.pascal %>Row>;
  }

  /** Même contrat qu'à la création, mais tous les champs sont facultatifs. */
  protected override beforeUpdate(
    _criteria: Record<string, unknown>,
    data: Partial<<%= it.pascal %>Row>,
  ): Partial<<%= it.pascal %>Row> {
    return update<%= it.pascal %>Schema.parse(data) as Partial<<%= it.pascal %>Row>;
  }
}

/**
 * Instance partagée, construite au **premier usage**.
 *
 * Pourquoi paresseusement : le connecteur ne s'ouvre qu'à la phase `onBoot`, et son
 * repository n'existe pas avant. Construire le service au démarrage du module le
 * ferait dépendre de l'ordre des écouteurs — une panne intermittente, de celles qui ne
 * se reproduisent pas en test. Au premier appel entrant, tout est démarré : plus
 * aucune question d'ordre.
 */
let instance: <%= it.pascal %>Service | null = null;

/** Récupère le service (le construit au premier appel). */
export function get<%= it.pascal %>Service(): <%= it.pascal %>Service {
  if (instance === null) {
    const orm = ormRegistry.get("<%= it.connector %>");
    if (!orm) {
      throw new Error(
        `<%= it.pascal %>Service : aucun connecteur « <%= it.connector %> » — vérifie que @nodefony/drizzle est dans le manifeste modules de nodefony.config.ts`,
      );
    }
    instance = new <%= it.pascal %>Service(
      orm.getRepository<<%= it.pascal %>Row>("<%= it.pascal %>"),
    );
  }
  return instance;
}
