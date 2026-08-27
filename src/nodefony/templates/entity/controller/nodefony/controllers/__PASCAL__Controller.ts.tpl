import {
  controller,
  route,
  ResourceController,
  Post,
  Put,
  Patch,
  Delete,
  HttpCode,
  Param,
  Body,
  Query,
  Idempotent,
<% if (it.hasSecurity) { %>  IsGranted,
<% } %>} from "@nodefony/framework";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
// LES deux lecteurs de requête du framework — jamais un parseur maison : deux
// dialectes de pagination dans une même application finissent par diverger, et
// c'est le client qui l'apprend.
import { parsePageQuery, parseFilters } from "nodefony";
import type { IFilterSpec } from "nodefony";
import type { <%= it.pascal %>Row } from "../entity/<%= it.pascal %>";
// Le CONTRAT D'ENTRÉE, pas la ligne de table : `<%= it.pascal %>Row` porte `id` et
// les horodatages, que le client n'a pas le droit d'envoyer et que le schéma
// retire. Typer le corps avec ces types-là, c'est promettre exactement ce qui
// est validé — les deux dérivent du même schéma, ils ne peuvent pas diverger.
import type {
  Create<%= it.pascal %>,
  Update<%= it.pascal %>,
} from "../entity/<%= it.pascal %>.schema";
import { get<%= it.pascal %>Service } from "../service/<%= it.pascal %>Service";

/** Taille de page par défaut, et plafond au-delà duquel on refuse d'aller. */
const PAGE_SIZE = 25;
const PAGE_MAX = 100;

/**
 * Colonnes qu'un client a le droit de trier — **la capacité de cette route**.
 *
 * Une allowlist, pas la liste des colonnes : sans elle, le client nomme
 * n'importe quoi et l'ORM lève sur un nom inconnu — un 500 offert à qui tape au
 * hasard. Elle est passée à `parsePageQuery`, qui refuse un champ hors liste par
 * un **400** explicite. Refuser plutôt qu'ignorer : une page rendue dans un
 * ordre qui n'est pas celui demandé, sans un mot, est un mensonge que personne
 * ne voit — ni le client, ni les journaux.
 */
const SORTABLE = <%= JSON.stringify(it.sortable) %> as const;

/**
 * Ce que cette route sait FILTRER — nom public → nature, et rien d'autre.
 *
 * C'est le frère de `SORTABLE`, avec une règle inverse : un tri est une capacité
 * (le backend sait-il ordonner ?), un filtre déclaré ici est une **obligation** —
 * la route promet de l'honorer, et `parseFilters` la tient.
 *
 * Trois refus, tous en **400** : une valeur mal formée (`?<%= it.filters.length ? it.filters[0].name : "actif" %>=oui`),
 * une valeur hors énumération, et — le plus important — un paramètre que
 * **personne** ne reconnaît (`?titre=x` au lieu de `?title=x`). Sans ce dernier,
 * une faute de frappe dans une URL rend la collection ENTIÈRE, que le client lit
 * comme le résultat de son filtre : c'est la façon la plus discrète de mentir.
 *
 * Une valeur est une liste ⇒ elle vaut allowlist. Ajouter un filtre ici, c'est
 * ajouter une ligne — et le TYPE des filtres lus suit tout seul.
<% if (!it.filters.length) { %> *
 * Aucun champ de cette entité ne se prête à l'égalité (ni booléen, ni
 * énumération, ni référence) : la spec est vide, et elle sert quand même — elle
 * refuse tout paramètre inventé. Déclare ici ce que tu veux filtrer.
<% } %> */
const FILTERS = {
<% for (const f of it.filters) { %>  <%= f.name %>: <%= f.def %>,
<% } %>} as const satisfies IFilterSpec;

/**
 * Ordre par défaut — **il n'est pas décoratif**.
 *
 * Sans ordre déterministe, la base rend les lignes dans l'ordre qui l'arrange, et
 * il peut changer entre deux requêtes : la page 2 remontre alors une ligne déjà
 * vue, ou en saute une, sans que rien ne le signale. L'`id` départage les ex æquo.
 */
const DEFAULT_ORDER: Array<[string, "ASC" | "DESC"]> = <%= it.defaultOrder %>;
<% if (it.relations.length) { %>
/**
 * Relations chargeables par `?include=` — **allowlist**, comme le tri.
 *
 * Un `include` libre laisserait le client nommer n'importe quelle association et
 * lire, par ricochet, des données qu'aucune route ne lui ouvre. Ici, seules les
 * relations déclarées sur l'entité sont chargeables.
 */
const INCLUDABLE = new Set<string>(<%= JSON.stringify(it.relations.map((r) => r.field)) %>);

/**
 * Traduit `?include=<%= it.relations[0].field %>` en liste de relations à charger.
 *
 * Une relation inconnue est **refusée**, jamais ignorée : rendre l'enregistrement
 * sans la relation demandée, avec un `200`, laisse le client croire que la
 * relation est vide alors qu'il a simplement mal écrit son nom. Le tri et les
 * filtres refusent pour la même raison — une seule doctrine dans cette route.
 */
function parseInclude(include?: string): string[] {
  if (!include) return [];
  const names = include
    .split(",")
    .map((raw) => raw.trim())
    .filter((name) => name !== "");
  for (const name of names) {
    if (!INCLUDABLE.has(name)) {
      throw new HttpError(
        `Relation « ${name} » inconnue. Relations chargeables : ${[...INCLUDABLE].join(", ")}.`,
        400,
      );
    }
  }
  return names;
}
<% } %>

/**
 * `<%= it.pascal %>` exposée en HTTP **et** par la socket Nodefony — une seule classe.
 *
 * Les deux actions de lecture déclarent `methods: ["GET", "WEBSOCKET"]` : la même
 * méthode répond à `GET <%= it.route %>` et à un appel de la socket. Il n'y a rien à
 * réécrire pour le temps réel, et les deux chemins ne peuvent pas diverger.
 *
 * Le controller ne contient **aucune logique** : il traduit une requête en appel de
 * service, et une erreur en statut. Tout le métier (validation comprise) vit dans
 * `<%= it.pascal %>Service`.
 *
 * ```bash
 * curl -k "https://127.0.0.1:5152<%= it.route %>?limit=10"
 * curl -k -X POST -H "content-type: application/json" \
 *   -H "idempotency-key: essai-1" -d '<%= it.curlBody %>' https://127.0.0.1:5152<%= it.route %>
 * ```
 */
@controller("<%= it.route %>")
class <%= it.pascal %>Controller extends ResourceController<<%= it.pascal %>Row> {
  constructor(context: ContextType) {
    super("<%= it.pascal %>Controller", context, get<%= it.pascal %>Service());
  }

  /**
   * `GET <%= it.route %>` — liste paginée (et le même appel par la socket).
   *
   * Rend une **page**, pas un tableau nu : `{ items, limit, offset, hasNext, total }`.
   * Un tableau ne dit pas s'il en reste — le client qui reçoit 25 lignes ne peut pas
   * distinguer « c'est tout » de « demande la suite ».
   *
   * La pagination est **plafonnée** plutôt que refusée : un `limit=10000` rend 100
   * lignes, il ne rend pas une erreur. Ce plafond est ce qui empêche un client d'user
   * de charger la table entière en mémoire.
   *
   * `?order=<%= it.timestamps ? "createdAt" : "id" %>:DESC` trie — c'est **le** dialecte
   * de pagination de Nodefony, le même pour toutes les routes du framework et de ta
   * propre application. Un champ absent de `SORTABLE` est refusé par un **400**, jamais
   * accepté puis ignoré. `?withTotal=false` économise le `COUNT(*)` quand le client
   * n'affiche pas de numéros de page.
   *
   * Deux lecteurs, deux domaines qui ne se recouvrent pas : `parsePageQuery` lit le
   * contrat de page (`limit`, `offset`, `order`, `withTotal`, `q`), `parseFilters` lit
   * ce que `FILTERS` déclare — et refuse tout le reste. N'écris jamais un troisième
   * parseur dans cette méthode : deux traducteurs du MÊME paramètre, dont un seul
   * connaît l'allowlist, font refuser en 400 ce que l'autre vient d'accepter, et aucun
   * test unitaire ne le voit.
   *
<% if (it.filters.length) { %>   * Les filtres traversent jusqu'à la base (`criteria` → `WHERE`), ils ne sont pas
   * appliqués après découpage : filtrer une page déjà tranchée rendrait des pages
   * incomplètes, et un `total` qui ne correspond à rien.
   *
<% } %>
   * ⚠️ `offset` se dégrade sur les grandes tables (la base doit compter les lignes
   * sautées) et peut sauter des enregistrements si des insertions ont lieu pendant la
   * pagination. Un curseur opaque viendra le remplacer.
   *
   * ```bash
   * curl -k "https://127.0.0.1:5152<%= it.route %>?limit=10&order=<%= it.timestamps ? "createdAt" : "id" %>:DESC"
   * ```
   */
  @route("<%= it.kebab %>-list", {
    path: "",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
  list(@Query() query: Record<string, string | string[] | undefined> = {}) {
    const page = parsePageQuery(query, {
      defaultLimit: PAGE_SIZE,
      maxLimit: PAGE_MAX,
      sortable: SORTABLE,
    });
    // Les filtres DÉCLARÉS, et eux seuls. Ce que `FILTERS` ne nomme pas est refusé
    // en 400 plutôt que rendu non filtré : un critère accepté puis jeté produit une
    // réponse que le client prend pour le résultat de sa demande.
    const filters = parseFilters(query, FILTERS);
    return this.listPageResource({
      limit: page.limit,
      offset: page.offset ?? 0,
      order: page.order?.length ? page.order : DEFAULT_ORDER,
      withTotal: page.withTotal !== false,
      // Les filtres deviennent les critères du store : `?<%= it.filters.length ? it.filters[0].name + "=" : "" %>…` se
      // traduit en `WHERE`, il n'est pas appliqué après coup sur une page déjà
      // découpée — filtrer APRÈS avoir paginé rend des pages incomplètes.
      criteria: filters,
    });
  }

  /**
   * `GET <%= it.route %>/{id}` — 404 si l'enregistrement n'existe pas.
<% if (it.relations.length) { %>   *
   * `?include=<%= it.relations[0].field %>` charge la relation dans la même requête,
   * au lieu de laisser le client enchaîner un second appel par ligne. Seules les
   * relations déclarées sur l'entité sont acceptées.
   *
   * ```bash
   * curl -k "https://127.0.0.1:5152<%= it.route %>/<id>?include=<%= it.relations[0].field %>"
   * ```
<% } %>   */
  @route("<%= it.kebab %>-get", {
    path: "/{id}",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
<% if (it.relations.length) { %>  async detail(
    @Param("id") id: string,
    @Query("include") include?: string,
  ) {
    const relations = parseInclude(include);
    const found = await this.getResource(
      id,
      relations.length > 0 ? { relations } : undefined,
    );
<% } else { %>  async detail(@Param("id") id: string) {
    const found = await this.getResource(id);
<% } %>    if (!found) {
      throw new HttpError(`<%= it.pascal %> ${id} introuvable`, 404);
    }
    return found;
  }

  /**
   * `POST <%= it.route %>` — création. Rend **201** et l'en-tête `Location` de la
   * ressource créée (le client sait où la relire sans deviner l'URL).
   *
   * `@Idempotent({ required: false })` — mode **souple** : un client qui envoie un
   * en-tête `Idempotency-Key` et rejoue sa requête (coupure réseau, bouton pressé deux
   * fois) reçoit la réponse mémorisée, sans créer de doublon ; un client qui n'en
   * envoie pas est servi normalement. Passe à `@Idempotent()` pour **exiger** la clé —
   * une API de paiement le doit, un blog n'en a pas besoin.
   *
   * Un corps invalide devient un **422** qui nomme les champs fautifs.
   */
  @Post("")
  @HttpCode(201)
  @Idempotent({ required: false })
  async create(@Body() payload: Create<%= it.pascal %>) {
    const created = await this.createResource(payload);
    this.context?.response?.setHeader(
      "Location",
      `<%= it.route %>/${(created as { id: unknown }).id}`,
    );
    return created;
  }

  /**
   * `PUT <%= it.route %>/{id}` — **remplacement**. 404 si la ressource n'existe pas.
   *
   * Le corps doit être COMPLET : un champ requis manquant est un `422`. C'est la
   * sémantique de `PUT` (RFC 9110 §9.3.4) — pour ne changer qu'un champ, voir
   * `PATCH` juste en dessous.
   *
   * Le service est demandé ici plutôt qu'appelé par `this.updateResource` parce
   * que la distinction remplacer/retoucher est une règle MÉTIER : elle vit dans
   * le service (qui choisit le schéma de validation), pas dans la porte.
   */
  @Put("/{id}")
  async replace(
    @Param("id") id: string,
    @Body() payload: Create<%= it.pascal %>,
  ) {
    const updated = await get<%= it.pascal %>Service().replace(id, payload);
    if (!updated) {
      throw new HttpError(`<%= it.pascal %> ${id} introuvable`, 404);
    }
    return updated;
  }

  /**
   * `PATCH <%= it.route %>/{id}` — **retouche partielle**. 404 si absente.
   *
   * N'envoie que les champs à changer : ils sont validés contre
   * `update<%= it.pascal %>Schema` (le schéma de création rendu facultatif), donc
   * un corps `{ "<%= it.sortable[1] ?? "champ" %>": … }` suffit. Les champs absents
   * ne sont pas touchés.
   */
  @Patch("/{id}")
  async patch(
    @Param("id") id: string,
    @Body() payload: Update<%= it.pascal %>,
  ) {
    const updated = await this.updateResource({ id }, payload);
    if (!updated) {
      throw new HttpError(`<%= it.pascal %> ${id} introuvable`, 404);
    }
    return updated;
  }

  /**
   * `DELETE <%= it.route %>/{id}` — rend **204** (pas de corps : il n'y a plus rien à
   * décrire). 404 si la ressource n'existait pas, pour que le client distingue
   * « supprimée » de « jamais vue ».
   *
<% if (it.hasSecurity) { %>   * **Réservée à `ROLE_ADMIN`** : `@IsGranted` refuse AVANT même d'entrer dans
   * l'action. C'est la seule route de ce contrôleur qui DÉTRUISE — la laisser
   * ouverte reviendrait à livrer une application où n'importe qui efface les
   * données d'autrui. En développement, `admin/admin` porte ce rôle.
   *
   * Pour ouvrir davantage (une équipe, un rôle métier), change le rôle ici, ou
   * déclare une zone dans `security.areas` qui couvre `<%= it.route %>` — les
   * deux voies sont du framework. Ce qu'il ne faut PAS faire, c'est lire
   * `user.roles` à la main dans l'action : la garde s'exécute avant elle, et un
   * contrôle écrit à la main est celui qu'on oublie de reporter ailleurs.
<% } else { %>   * ⚠️ **Cette route n'est protégée par RIEN.** Aucun module de sécurité n'est
   * installé, donc n'importe qui peut supprimer. Ajoute `@nodefony/security`,
   * puis un `@IsGranted("ROLE_ADMIN")` juste au-dessus de `@Delete` — ou une
   * zone dans `security.areas` qui couvre `<%= it.route %>`.
<% } %>   */
  @Delete("/{id}")
<% if (it.hasSecurity) { %>  @IsGranted("ROLE_ADMIN")
<% } %>  @HttpCode(204)
  async destroy(@Param("id") id: string) {
    const removed = await this.removeResource({ id });
    if (removed === 0) {
      throw new HttpError(`<%= it.pascal %> ${id} introuvable`, 404);
    }
    return null;
  }
}

export default <%= it.pascal %>Controller;
