import { AbstractCrudService, ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import type { <%= it.pascal %>Row } from "../entity/<%= it.pascal %>";
import {
  create<%= it.pascal %>Schema,
  update<%= it.pascal %>Schema,
} from "../entity/<%= it.pascal %>.schema";

/**
 * ⚡ **Tu veux un service ? Ne recopie pas ce fichier — génère-le :**
 *
 * ```bash
 * npx nodefony create service <Nom>                  # la classe + sa déclaration
 * npx nodefony create service <Nom> --inject <Autre> # + la dépendance écrite
 * ```
 *
 * Le générateur écrit la version COURANTE du framework et déclare le service sur
 * le module ; recopié à la main, il naît déjà décalé et personne ne le signale.
 * Ce fichier reste là pour se LIRE — comprendre ce qu'est un service — pas pour
 * se dupliquer.
 *
 *
 * Logique métier de `<%= it.pascal %>` — **la** source de vérité.
 *
 * Elle vit ici, et pas dans le controller, parce qu'elle doit servir tous les
 * transports : la même méthode alimente la route REST, l'appel WebSocket, un futur
 * résolveur GraphQL et une commande CLI. Écrire le CRUD dans un controller
 * obligerait à le réécrire pour chacun d'eux.
 *
 * `AbstractCrudService` fournit `find` / `findOne` / `findById` / `count` (délégation
 * directe, sans surcoût), `findPage` (une page — `limit` obligatoire) et `create` /
 * `updateOne` / `delete` (encadrés par des points d'extension et suivis d'événements
 * `onCreated` / `onUpdated` / `onDeleted`).
 *
 * **Toute méthode qui rend une liste se borne** — `findPage`, ou `find` avec un `limit`.
 * Un `find` sans borne matérialise la table entière en mémoire : indolore sur les
 * quelques lignes du poste de développement, fatal sur celles de production.
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

  /**
   * Même contrat qu'à la création, mais tous les champs sont facultatifs.
   *
   * C'est la validation de la **retouche** (`PATCH`) : on ne peut pas exiger un
   * champ que le client n'a pas voulu changer.
   */
  protected override beforeUpdate(
    _criteria: Record<string, unknown>,
    data: Partial<<%= it.pascal %>Row>,
  ): Partial<<%= it.pascal %>Row> {
    return update<%= it.pascal %>Schema.parse(data) as Partial<<%= it.pascal %>Row>;
  }

  /**
   * Remplace un enregistrement — le corps doit être **complet** (`PUT`).
   *
   * C'est ce qui distingue `PUT` de `PATCH`, et la distinction est réelle : ici
   * le corps est validé contre le schéma de CRÉATION, donc un champ requis
   * manquant est un `422`. En `PATCH`, le même corps passerait. Sans cette
   * méthode, les deux verbes feraient exactement la même chose et le `PUT`
   * mentirait sur son contrat (RFC 9110 §9.3.4).
   *
   * @param id - identifiant de l'enregistrement à remplacer.
   * @param data - représentation COMPLÈTE de la ressource.
   * @returns l'enregistrement remplacé, ou `null` s'il n'existe pas.
   */
  async replace(
    id: string,
    data: Partial<<%= it.pascal %>Row>,
  ): Promise<<%= it.pascal %>Row | null> {
    const complete = create<%= it.pascal %>Schema.parse(
      data,
    ) as Partial<<%= it.pascal %>Row>;
    return this.updateOne({ id }, complete);
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
    // `ormRegistry.get()` LÈVE quand le nom est inconnu — un `if (!orm)` posé
    // après lui ne s'exécute jamais. On demande donc d'abord, pour que le
    // message qui suit (celui qui dit QUOI FAIRE) soit bien celui qu'on lit.
    if (!ormRegistry.has("<%= it.connector %>")) {
      throw new Error(
        `<%= it.pascal %>Service : aucun connecteur « <%= it.connector %> » — vérifie que @nodefony/drizzle est dans le manifeste modules de nodefony.config.ts`,
      );
    }
    const orm = ormRegistry.get("<%= it.connector %>");
    instance = new <%= it.pascal %>Service(
      orm.getRepository<<%= it.pascal %>Row>("<%= it.pascal %>"),
    );
  }
  return instance;
}
