<% if (it.mongo) { %>import { defineEntity } from "@nodefony/orm-core";

/**
 * Schéma Mongoose de `<%= it.pascal %>` — un document, pas une table.
 *
 * C'est une définition Mongoose ordinaire : tout ce que Mongoose accepte
 * (`validate`, `get`/`set`, sous-documents) s'écrit ici. Les types sont donnés
 * par leur nom (`"ObjectId"`, `"Mixed"`) pour ne pas importer `mongoose`, que
 * l'application reçoit par `@nodefony/mongoose` sans le déclarer.
 *
 * Ce qui n'y figure pas, et c'est voulu :
 * - la clé : `_id` (ObjectId natif), servie au contrat sous le nom `id` par le
 *   virtuel que l'ORM active à la sérialisation — comme l'entité `User` ;
<% if (it.timestamps) { %> * - les horodatages : l'option `timestamps` du descripteur, gérée par Mongoose.
<% } %> *
 * Pas de migration : la collection naît à la première écriture. Les index
 * (`index`, `unique`) sont posés à la connexion ; un index DÉCLARÉ et absent
 * de la base est journalisé en CRITIC au démarrage — la contrainte que le code
 * croit tenir ne l'est pas tant qu'il manque.
 */
export const <%= it.camel %>Schema = {
  <%= it.schemaFields %>
};

/** Un document `<%= it.pascal %>`, tel que le rend le repository (virtuel `id` compris). */
export interface <%= it.pascal %>Row {
  <%= it.rowProps %>
}

/**
 * Descripteur de l'entité — déclaré au module via `@entities([<%= it.pascal %>Entity])`.
 *
 * `connector` est fixé sur **`<%= it.connector %>`** : c'est le connecteur de
 * `@nodefony/mongoose`. Sans cette ligne, le décorateur poserait l'entité sur
 * `default` — un nom qui n'existe que chez Drizzle.
<% if (it.relations.length) { %> *
 * `relations` n'est pas de la documentation : le graphe d'entités de Studio (ERD)
 * s'en sert pour dessiner les liens, et le repository pour charger une association
 * (`populate`) — exposé par le controller en `?include=<%= it.relations[0].field %>`.
<% } %> */
export const <%= it.pascal %>Entity = defineEntity({
  name: "<%= it.pascal %>",
  module: "<%= it.moduleName %>",
  connector: "<%= it.connector %>",
  schema: <%= it.camel %>Schema,
<% if (it.timestamps) { %>  timestamps: true,
<% } %><% if (it.relations.length) { %>  relations: [
<% it.relations.forEach(function (rel) { %>    {
      type: "<%= rel.type %>",
      target: "<%= rel.target %>",
      field: "<%= rel.field %>",
      foreignKey: "<%= rel.foreignKey %>",
    },
<% }) %>  ],
<% } %>});

<% } else { %>import { defineEntity } from "@nodefony/orm-core";
<% if (it.needsNodefony) { %>import { Nodefony } from "nodefony";
<% } %><%= it.drizzleImport %>
<% if (it.entityImports) { %><%= it.entityImports %>
<% } %>
/**
 * Table `<%= it.table %>` — schéma Drizzle **natif** du dialecte `<%= it.dialect %>`.
 *
 * C'est du Drizzle ordinaire : tous les types et options du moteur sont à ta
 * disposition, il n'y a aucune couche à contourner. Un besoin non couvert par le
 * générateur (colonne `numeric(12,4)`, longueur de chaîne sur mesure, effacement
 * en cascade sur une relation) s'écrit directement ici.
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
<% if (it.relations.length) { %> *
 * Les contraintes d'intégrité (`.references(…)`), elles, se déclarent DANS le
 * `CREATE TABLE` : une base de développement déjà créée ne les recevra pas — seule
 * une migration (`nodefony orm:generate --apply`) les ajoute après coup. La
 * politique d'effacement suit la colonne : obligatoire → `restrict` (le parent ne
 * peut pas partir), facultative → `set null` (l'enfant survit, orphelin explicite).
 * Un effacement en cascade s'écrit ici, à la main : rien dans `ref:` ne le demande.
<% } %> */
export const <%= it.tableSymbol %> = <%= it.tableFn %>("<%= it.table %>", {
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
<% } %>  schema: <%= it.tableSymbol %>,
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

<% } %>/**
 * Échantillon **variable** de `<%= it.pascal %>` — paramétré par un entier.
 *
 * Il vit ICI, et non dans les tests, parce que trois lecteurs en ont besoin : le
 * test de la couche donnée, le test de bout en bout, et toute amorce de données
 * ou démonstration. Trois copies divergeraient au premier champ ajouté, et
 * chacune passerait ses propres contrôles sans rien dire.
 *
 * `n` fait varier les valeurs : deux insertions du même objet violeraient une
 * contrainte d'unicité, et le test échouerait sur lui-même.
<% if (it.sampleReadsRefs) { %> *
<% if (it.mongo) { %> * ⚠️ `refs` porte les identifiants des documents **parents**. MongoDB ne tient
 * AUCUNE clé étrangère : un identifiant qui ne désigne rien est accepté, et
 * `?include=` rend alors `null` à sa place. L'appelant crée donc le parent
 * d'abord et passe son identifiant — sinon le lien n'est éprouvé par personne.
 * À défaut, on retombe sur un ObjectId inventé, qui suffit au seul contrat de
 * validation.
<% } else { %> * ⚠️ `refs` porte les identifiants des lignes **parentes**. Une relation est une
 * vraie clé étrangère : un identifiant qui ne désigne rien est REFUSÉ par la base
 * — « FOREIGN KEY constraint failed » en direct, 500 à travers la ressource HTTP.
 * L'appelant crée donc le parent d'abord et passe son identifiant. À défaut, on
 * retombe sur une valeur inventée, qui suffit au seul contrat de validation.
<% } %><% } %> */
export const <%= it.camel %>Sample = (
  n: number,<% if (it.sampleReadsRefs) { %>
  refs: Partial<Record<string, string | number>> = {},<% } %>
): Partial<<%= it.pascal %>Row> => (<%= it.sampleFactory %>);
