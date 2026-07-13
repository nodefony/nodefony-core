import { randomUUID } from "node:crypto";
import {
  controller,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  HttpCode,
  Param,
  Body,
  Query,
  Idempotent,
  CurrentUser,
<% if (it.hasSecurity) { %>  IsGranted,
<% } %>} from "@nodefony/framework";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
<% if (it.hasSecurity) { %>import type { IUser } from "@nodefony/user";
<% } %>
/** Forme d'un item — remplace par ton entité (`nodefony create entity`). */
interface IItem {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
}

/**
 * <%= it.nameClass %> — resource **REST pure** (squelette de production) :
 * CRUD complet, erreurs HTTP typées, création idempotente. Une action RETOURNE
 * sa valeur (objet brut) — le Resolver la sérialise en JSON ; `renderJson()`
 * n'est utile que pour affiner status/headers à la main.
 *
 * Pour la démo de TOUS les décorateurs → `--kind example` ; pour consommer la
 * même ressource par la socket Nodefony → `--kind duplex`.
 *
 * Essais rapides (zone `^/api` du manifeste : identité résolue, jamais bloquante) :
 * ```bash
 * curl -k "https://127.0.0.1:5152<%= it.route %>?limit=10"
 * curl -k -X POST -H "content-type: application/json" \
 *   -H "idempotency-key: demo-1" -d '{"name":"premier"}' https://127.0.0.1:5152<%= it.route %>
 * # rejoue la MÊME clé → réponse mémorisée (aucun doublon créé)
 * curl -k https://127.0.0.1:5152<%= it.route %>/{id}
 * curl -k -X PATCH -H "content-type: application/json" \
 *   -d '{"name":"renommé"}' https://127.0.0.1:5152<%= it.route %>/{id}
 * ```
 */
@controller("<%= it.route %>")
class <%= it.nameClass %> extends Controller {
  /** Store démo en mémoire — remplace par un repository (`create entity`). */
  static items = new Map<string, IItem>();

  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  /** `GET <%= it.route %>?limit=N` — liste (borne `limit`, défaut 50). */
  @Get("")
  list(@Query("limit") limit?: string) {
    const max = Math.min(Number(limit) || 50, 200);
    return [...<%= it.nameClass %>.items.values()].slice(0, max);
  }

  /** `GET <%= it.route %>/{id}` — 404 typée si inconnu. */
  @Get("/{id}")
  detail(@Param("id") id: string) {
    const item = <%= it.nameClass %>.items.get(id);
    if (!item) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    return item;
  }

  /**
   * `POST <%= it.route %>` — création idempotente (header `Idempotency-Key`) :
   * un client qui rejoue (retry réseau) reçoit la réponse MÉMORISÉE, aucun
   * doublon. ⚠ Une action `@Idempotent` doit RETOURNER son payload BRUT :
   * c'est LUI qui est mémorisé puis rejoué.
   */
  @Post("")
  @HttpCode(201)
  @Idempotent()
  create(
    @Body() payload: { name?: string },
    @CurrentUser() user?: { identifier?: string },
  ) {
    const item: IItem = {
      id: randomUUID(),
      name: payload?.name ?? "sans nom",
      createdAt: Date.now(),
      createdBy: user?.identifier ?? "anon.",
    };
    <%= it.nameClass %>.items.set(item.id, item);
    return item;
  }

  /** `PUT <%= it.route %>/{id}` — remplacement COMPLET de la ressource. */
  @Put("/{id}")
  replace(@Param("id") id: string, @Body() payload: { name?: string }) {
    const current = <%= it.nameClass %>.items.get(id);
    if (!current) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    const item: IItem = { ...current, name: payload?.name ?? "sans nom" };
    <%= it.nameClass %>.items.set(id, item);
    return item;
  }

  /** `PATCH <%= it.route %>/{id}` — mise à jour PARTIELLE (merge). */
  @Patch("/{id}")
  update(@Param("id") id: string, @Body() payload: Partial<IItem>) {
    const current = <%= it.nameClass %>.items.get(id);
    if (!current) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    // Deny-by-default : seuls les champs ÉDITABLES passent (jamais id/createdBy).
    const item: IItem = { ...current, name: payload?.name ?? current.name };
    <%= it.nameClass %>.items.set(id, item);
    return item;
  }

<% if (it.hasSecurity) { %>  /**
   * `DELETE <%= it.route %>/{id}` — protégée par rôle : `@IsGranted` refuse
   * (403) AVANT d'entrer dans l'action. En dev, `admin/admin` a le rôle.
   */
  @Delete("/{id}")
  @IsGranted("ROLE_ADMIN")
  destroy(@Param("id") id: string, @CurrentUser() user: IUser) {
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    return { deleted: id, by: user.identifier };
  }
<% } else { %>  /** `DELETE <%= it.route %>/{id}` (ajoute `@nodefony/security` pour la protéger par rôle). */
  @Delete("/{id}")
  destroy(@Param("id") id: string) {
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    return { deleted: id };
  }
<% } %>}

export default <%= it.nameClass %>;
