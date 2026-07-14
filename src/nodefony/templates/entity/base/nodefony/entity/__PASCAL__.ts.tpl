import { defineEntity } from "@nodefony/orm-core";
<% if (it.needsNodefony) { %>import { Nodefony } from "nodefony";
<% } %><%= it.drizzleImport %>

/**
 * Table `<%= it.table %>` — schéma Drizzle **natif** du dialecte `<%= it.dialect %>`.
 *
 * C'est du Drizzle ordinaire : tous les types et options du moteur sont à ta
 * disposition, il n'y a aucune couche à contourner. Un besoin non couvert par le
 * générateur (colonne `numeric(12,4)`, index composite, contrainte de clé étrangère)
 * s'écrit directement ici.
 *
 * ⚠️ En développement, la table est créée au boot par un `CREATE TABLE IF NOT EXISTS`
 * dérivé de ce schéma. Deux conséquences à connaître :
 * - **modifier** ce fichier n'altère PAS une table déjà créée (aucun `ALTER`) — il faut
 *   supprimer la base de développement, ou passer par une migration ;
 * - les **index** déclarés et les `DEFAULT` **SQL** ne sont pas émis par ce DDL dérivé.
 *   C'est pourquoi les valeurs par défaut ci-dessous sont posées **côté JS**
 *   (`$defaultFn`) : elles s'appliquent quoi qu'il arrive.
 */
export const <%= it.camel %>Table = <%= it.tableFn %>("<%= it.table %>", {
  <%= it.columns %>
});

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
<% } %> */
export const <%= it.pascal %>Entity = defineEntity({
  name: "<%= it.pascal %>",
  module: "<%= it.moduleName %>",
<% if (it.connector !== "default") { %>  connector: "<%= it.connector %>",
<% } %>  schema: <%= it.camel %>Table,
});
