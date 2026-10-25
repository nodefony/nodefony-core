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
  Idempotent,
<% if (it.hasSecurity) { %>  IsGranted,
  CsrfProtect,
<% } %>} from "@nodefony/framework";
import type { RouteInput } from "@nodefony/framework";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import { z } from "zod";

/** Forme d'un item — remplace par ton entité (`nodefony create entity`). */
interface IItem {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
}

/**
 * Le CONTRAT d'entrée de chaque route — un schéma Zod par partie (`params`,
 * `query`, `body`). Le framework valide AVANT l'action : une entrée invalide
 * est un **422** qui nomme le champ et sa partie, et l'action reçoit UN
 * argument, `input`, typé par le schéma. Aucun `schema.parse` à écrire.
 */
const idParams = z.object({ id: z.string().min(1) });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const itemBody = z.object({ name: z.string().min(1) });
const itemPatch = itemBody.partial();

/**
 * <%= it.nameClass %> — resource **REST pure** (squelette de production) :
 * CRUD complet, erreurs HTTP typées, création idempotente. Une action RETOURNE
 * sa valeur (objet brut) — le Resolver la sérialise en JSON ; `renderJson()`
 * n'est utile que pour affiner status/headers à la main.
 *
 * Pour la démo de TOUS les décorateurs → `--kind example` ; pour consommer la
 * même ressource par la socket Nodefony → `--kind duplex`.
 *
<% if (it.hasSecurity) { %> * Essais rapides (zone `^/api` du manifeste : identité résolue, jamais bloquante).
 * Chaque ÉCRITURE porte `@CsrfProtect()` : sans le jeton anti-CSRF, elle rend
 * `403`. Il est semé par `GET /nodefony/security/api/auth/me` (cookie
 * `csrf-token`) et se rejoue dans l'en-tête `x-csrf-token` :
 * ```bash
 * curl -k "https://127.0.0.1:5152<%= it.route %>?limit=10"
 * curl -k -c /tmp/nf.jar https://127.0.0.1:5152/nodefony/security/api/auth/me
 * TOKEN=$(awk '$6 == "csrf-token" { print $7 }' /tmp/nf.jar)
 * curl -k -b /tmp/nf.jar -H "x-csrf-token: $TOKEN" -X POST \
 *   -H "content-type: application/json" -H "idempotency-key: demo-1" \
 *   -d '{"name":"premier"}' https://127.0.0.1:5152<%= it.route %>
 * # rejoue la MÊME clé → réponse mémorisée (aucun doublon créé)
 * curl -k https://127.0.0.1:5152<%= it.route %>/{id}
 * curl -k -b /tmp/nf.jar -H "x-csrf-token: $TOKEN" -X PATCH \
 *   -H "content-type: application/json" \
 *   -d '{"name":"renommé"}' https://127.0.0.1:5152<%= it.route %>/{id}
 * ```
<% } else { %> * Essais rapides (zone `^/api` du manifeste : identité résolue, jamais bloquante) :
 * ```bash
 * curl -k "https://127.0.0.1:5152<%= it.route %>?limit=10"
 * curl -k -X POST -H "content-type: application/json" \
 *   -H "idempotency-key: demo-1" -d '{"name":"premier"}' https://127.0.0.1:5152<%= it.route %>
 * # rejoue la MÊME clé → réponse mémorisée (aucun doublon créé)
 * curl -k https://127.0.0.1:5152<%= it.route %>/{id}
 * curl -k -X PATCH -H "content-type: application/json" \
 *   -d '{"name":"renommé"}' https://127.0.0.1:5152<%= it.route %>/{id}
 * ```
<% } %>
 */
@controller("<%= it.route %>")
<% if (it.roleGuard) { %>// Habilitation exigée pour TOUT ce controller.
//
// Posée sur la CLASSE : chaque action en hérite, y compris celles qu'on
// ajoutera demain — c'est ce qui distingue une règle d'un rappel. Le refus est
// rendu par le framework AVANT que le controller ne soit instancié (403), donc
// aucune ligne de contrôle d'accès n'a sa place dans une action.
//
// L'administrateur y a accès sans porter ce rôle : `nodefony.config.ts` le
// déclare sous `ROLE_ADMIN` dans `roleHierarchy` — administrer, c'est déjà
// pouvoir tout consulter. Une hiérarchie vaut pour TOUTES les routes gardées par
// ce rôle, présentes et futures ; lister les rôles un par un sur chaque action ne
// généralise pas.
@IsGranted("<%= it.role %>")
<% } %>class <%= it.nameClass %> extends Controller {
  /** Store démo en mémoire — remplace par un repository (`create entity`). */
  static items = new Map<string, IItem>();

  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  /** `GET <%= it.route %>?limit=N` — liste (`limit` de 1 à 200, défaut 50). */
  @Get("", { schema: { query: listQuery } })
  list(input: RouteInput<{ query: typeof listQuery }>) {
    return [...<%= it.nameClass %>.items.values()].slice(0, input.query.limit);
  }

  /** `GET <%= it.route %>/{id}` — 404 typée si inconnu. */
  @Get("/{id}", { schema: { params: idParams } })
  detail(input: RouteInput<{ params: typeof idParams }>) {
    const { id } = input.params;
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
   * c'est LUI qui est mémorisé puis rejoué. `this.user` est l'identité posée
   * par le pare-feu (`null` hors zone ou pour un anonyme), sans appel de plus.
   */
  @Post("", { schema: { body: itemBody } })
<% if (it.hasSecurity) { %>  @CsrfProtect()
<% } %>  @HttpCode(201)
  @Idempotent()
  create(input: RouteInput<{ body: typeof itemBody }>) {
    const item: IItem = {
      id: randomUUID(),
      name: input.body.name,
      createdAt: Date.now(),
      createdBy: this.user?.identifier ?? "anon.",
    };
    <%= it.nameClass %>.items.set(item.id, item);
    return item;
  }

  /** `PUT <%= it.route %>/{id}` — remplacement COMPLET de la ressource. */
  @Put("/{id}", { schema: { params: idParams, body: itemBody } })
<% if (it.hasSecurity) { %>  @CsrfProtect()
<% } %>  replace(
    input: RouteInput<{ params: typeof idParams; body: typeof itemBody }>,
  ) {
    const { id } = input.params;
    const current = <%= it.nameClass %>.items.get(id);
    if (!current) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    const item: IItem = { ...current, name: input.body.name };
    <%= it.nameClass %>.items.set(id, item);
    return item;
  }

  /** `PATCH <%= it.route %>/{id}` — mise à jour PARTIELLE (merge). */
  @Patch("/{id}", { schema: { params: idParams, body: itemPatch } })
<% if (it.hasSecurity) { %>  @CsrfProtect()
<% } %>  update(
    input: RouteInput<{ params: typeof idParams; body: typeof itemPatch }>,
  ) {
    const { id } = input.params;
    const current = <%= it.nameClass %>.items.get(id);
    if (!current) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    // Deny-by-default : le schéma ne connaît que les champs ÉDITABLES — un `id`
    // ou un `createdBy` envoyé est retiré avant d'arriver ici.
    const item: IItem = { ...current, name: input.body.name ?? current.name };
    <%= it.nameClass %>.items.set(id, item);
    return item;
  }

<% if (it.hasSecurity) { %>  /**
   * `DELETE <%= it.route %>/{id}` — protégée par rôle : `@IsGranted` refuse
   * (403) AVANT d'entrer dans l'action. En dev, `admin/<%= it.devAdminPassword %>` a le rôle.
   */
  @Delete("/{id}", { schema: { params: idParams } })
  @IsGranted("ROLE_ADMIN")
  @CsrfProtect()
  destroy(input: RouteInput<{ params: typeof idParams }>) {
    const { id } = input.params;
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    return { deleted: id, by: this.user?.identifier ?? null };
  }
<% } else { %>  /** `DELETE <%= it.route %>/{id}` (ajoute `@nodefony/security` pour la protéger par rôle). */
  @Delete("/{id}", { schema: { params: idParams } })
  destroy(input: RouteInput<{ params: typeof idParams }>) {
    const { id } = input.params;
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    return { deleted: id };
  }
<% } %>}

export default <%= it.nameClass %>;
