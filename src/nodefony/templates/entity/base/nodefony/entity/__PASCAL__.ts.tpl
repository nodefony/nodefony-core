import { defineEntity } from "@nodefony/orm-core";
<% if (it.needsNodefony) { %>import { Nodefony } from "nodefony";
<% } %><%= it.drizzleImport %>

/**
 * Table `<%= it.table %>` — schéma Drizzle **natif** du dialecte `<%= it.dialect %>`.
 *
 * C'est du Drizzle ordinaire : tous les types et options du moteur sont à ta
 * disposition, il n'y a aucune couche à contourner. Un besoin non couvert par le
 * générateur (colonne `numeric(12,4)`, longueur de chaîne sur mesure, contrainte de
 * clé étrangère) s'écrit directement ici.
 *
 * Les index de table, eux, sont couverts : `--index "colA,colB"` et
 * `--unique "colA,colB"` à la création, répétables autant de fois que la table
 * porte d'index.
 *
 * ⚠️ En développement, la table est créée au boot par un `CREATE TABLE IF NOT EXISTS`
 * dérivé de ce schéma. Deux conséquences à connaître :
 * - **modifier** ce fichier n'altère PAS une table déjà créée (aucun `ALTER`) — il faut
 *   supprimer la base de développement, ou passer par une migration ;
 * - les `DEFAULT` **SQL** ne sont pas émis par ce DDL dérivé. C'est pourquoi les
 *   valeurs par défaut ci-dessous sont posées **côté JS** (`$defaultFn`) : elles
 *   s'appliquent quoi qu'il arrive, y compris sur une base créée à la main.
 */
export const <%= it.camel %>Table = <%= it.tableFn %>("<%= it.table %>", {
  <%= it.columns %>}<%= it.tableExtras %>);

/** Une ligne de `<%= it.table %>`, telle que la rend le repository. */
export interface <%= it.pascal %>Row {
  <%= it.rowProps %>
}

/**
 * Descripteur de l'entité — déclaré au module via `@entities([<%= it.pascal %>Entity])`.
<% if (it.connector === "default") { %> *
 * Le `connector` n'est **pas** figé ici : c'est une donnée de configuration,
 * résolue au démarrage par le décorateur (défaut : `default`).
<% } else { %> *
 * `connector` est fixé sur **`<%= it.connector %>`** : cette entité vit sur sa
 * propre base, distincte de celle de l'application. Sans cette ligne, le décorateur la
 * poserait sur `default` — et sa table serait créée dans la mauvaise base pendant que
 * le service la chercherait dans la bonne.
<% } %><% if (it.relations.length) { %> *
 * `relations` n'est pas de la documentation : le graphe d'entités de Studio (ERD)
 * s'en sert pour dessiner les liens, et le repository pour charger une association
 * en une requête (`findById(id, { relations: ["<%= it.relations[0].field %>"] })`,
 * exposé par le controller en `?include=<%= it.relations[0].field %>`). Sans cette
 * déclaration, la colonne existe mais le lien reste invisible.
<% } %> */
export const <%= it.pascal %>Entity = defineEntity({
  name: "<%= it.pascal %>",
  module: "<%= it.moduleName %>",
<% if (it.connector !== "default") { %>  connector: "<%= it.connector %>",
<% } %>  schema: <%= it.camel %>Table,
<% if (it.relations.length) { %>  relations: [
<% it.relations.forEach(function (rel) { %>    {
      // `field` = le nom sous lequel on demande la relation (`?include=<%= rel.field %>`)
      // et sous lequel l'objet chargé remplace l'identifiant sur la ligne.
      // `foreignKey` = la colonne qui porte l'identifiant. Ils coïncident ici
      // parce que la colonne s'appelle comme le champ ; l'écrire évite que
      // l'adapter le devine (il chercherait `<%= rel.target.charAt(0).toLowerCase() + rel.target.slice(1) %>Id`).
      type: "<%= rel.type %>",
      target: "<%= rel.target %>",
      field: "<%= rel.field %>",
      foreignKey: "<%= rel.foreignKey %>",
    },
<% }) %>  ],
<% } %>});
