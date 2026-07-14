import {
  controller,
  route,
  ResourceController,
  Post,
  Put,
  Delete,
  HttpCode,
  Param,
  Body,
  Query,
  Idempotent,
} from "@nodefony/framework";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import type { <%= it.pascal %>Row } from "../entity/<%= it.pascal %>";
import { get<%= it.pascal %>Service } from "../service/<%= it.pascal %>Service";

/** Taille de page par défaut, et plafond au-delà duquel on refuse d'aller. */
const PAGE_SIZE = 25;
const PAGE_MAX = 100;

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
   * La pagination est **plafonnée** plutôt que refusée : un `limit=10000` rend 100
   * lignes, il ne rend pas une erreur. Ce plafond est ce qui empêche un client d'user
   * de charger la table entière en mémoire.
   *
   * ⚠️ `offset` se dégrade sur les grandes tables (la base doit compter les lignes
   * sautées) et peut sauter des enregistrements si des insertions ont lieu pendant la
   * pagination. Un curseur opaque viendra le remplacer.
   */
  @route("<%= it.kebab %>-list", {
    path: "",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
  list(@Query("limit") limit?: string, @Query("offset") offset?: string) {
    const take = Math.min(Number(limit) || PAGE_SIZE, PAGE_MAX);
    const skip = Math.max(Number(offset) || 0, 0);
    // Aucun filtre de la requête n'est transmis au service automatiquement : exposer
    // un critère de recherche est une décision, jamais un effet de bord.
    return this.listResource(undefined, { limit: take, offset: skip });
  }

  /** `GET <%= it.route %>/{id}` — 404 si l'enregistrement n'existe pas. */
  @route("<%= it.kebab %>-get", {
    path: "/{id}",
    requirements: { methods: ["GET", "WEBSOCKET"] },
  })
  async detail(@Param("id") id: string) {
    const found = await this.getResource(id);
    if (!found) {
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
  async create(@Body() payload: Partial<<%= it.pascal %>Row>) {
    const created = await this.createResource(payload);
    this.context?.response?.setHeader(
      "Location",
      `<%= it.route %>/${(created as { id: unknown }).id}`,
    );
    return created;
  }

  /** `PUT <%= it.route %>/{id}` — mise à jour. 404 si la ressource n'existe pas. */
  @Put("/{id}")
  async replace(
    @Param("id") id: string,
    @Body() payload: Partial<<%= it.pascal %>Row>,
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
   */
  @Delete("/{id}")
  @HttpCode(204)
  async destroy(@Param("id") id: string) {
    const removed = await this.removeResource({ id });
    if (removed === 0) {
      throw new HttpError(`<%= it.pascal %> ${id} introuvable`, 404);
    }
    return null;
  }
}

export default <%= it.pascal %>Controller;
