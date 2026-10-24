import { randomUUID } from "node:crypto";
import {
  route,
  controller,
  HttpCode,
  Idempotent,
<% if (it.hasSecurity) { %>  IsGranted,
<% } %>} from "@nodefony/framework";
import type { RouteInput } from "@nodefony/framework";
import { RealtimeController } from "@nodefony/realtime";
import { HttpError } from "@nodefony/http";
import type { ContextType } from "@nodefony/http";
import { z } from "zod";

/**
 * Le CONTRAT d'entrée de chaque route, VALIDÉ par le framework avant l'action —
 * par les DEUX portes : le corps et la query d'un `socket.mutate` /
 * `socket.request` passent le même schéma qu'un appel HTTP, et un échec est le
 * même 422 (`data.status` et `data.fields` côté socket).
 */
const idParams = z.object({ id: z.string().min(1) });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const itemBody = z.object({ name: z.string().min(1) });

/** Forme d'un item — remplace par ton entité (`nodefony create entity`). */
interface IItem {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
}

/**
 * <%= it.nameClass %> — resource **DUPLEX** : les MÊMES actions répondent en
 * REST (curl/fetch) ET par la **socket Nodefony** via le pont `api.request`
 * (une action, N transports, même pipeline — firewall,
 * idempotence, audit). Deux ingrédients :
 *
 *  1. chaque route déclare ses transports — `methods: ["GET", "WEBSOCKET"]`
 *     (zéro bypass : une action dit à quelles portes elle répond) ;
 *  2. `realtimeApiRequest()` → `true` (opt-in) : la connexion socket expose la
 *     méthode RPC `api.request {path}` qui re-route vers l'action.
 *
 * ⚠ Zero Trust : dans une zone firewall `security` (ex. `^/api` du manifeste),
 * le pont exige une identité NON-anonyme — même si la zone accepte l'anonyme en
 * HTTP (une surface d'invocation WS ne s'ouvre jamais par défaut). Connecte-toi
 * d'abord (le cookie de session voyage avec le handshake), ou place la route
 * hors zone pour un accès anonyme assumé.
 *
 * Côté client (navigateur OU script Node — la façade est isomorphe, le
 * subpath `nodefony/client` est sa porte explicite) :
 * ```ts
 * import { NodefonySocket } from "nodefony/client";
 * // URL RELATIVE, résolue contre la page (https → wss automatique) ;
 * // `.shared()` = UNE socket par URL, partagée par toute la page.
 * const socket = NodefonySocket.shared({ url: "<%= it.route %>/realtime" });
 * await socket.connect();
 * // LECTURE — la même action que `GET <%= it.route %>` :
 * const items = await socket.request("<%= it.route %>?limit=10");
 * // MUTATION — méthode HTTP logique + clé d'idempotence OBLIGATOIRE (une
 * // socket qui reconnecte peut rejouer une frame → la clé dédoublonne) :
 * const created = await socket.mutate("<%= it.route %>", {
 *   method: "POST",
 *   body: { name: "premier" },
 *   idempotencyKey: crypto.randomUUID(),
 * });
 * ```
 * Et les MÊMES actions au curl :
 * ```bash
 * curl -k "https://127.0.0.1:5152<%= it.route %>?limit=10"
 * curl -k -X POST -H "content-type: application/json" \
 *   -H "idempotency-key: demo-1" -d '{"name":"premier"}' https://127.0.0.1:5152<%= it.route %>
 * ```
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
<% } %>class <%= it.nameClass %> extends RealtimeController {
  /** Store démo en mémoire — remplace par un repository (`create entity`). */
  static items = new Map<string, IItem>();

  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  /**
   * Le PONT (opt-in, défaut `false`) : expose `api.request` sur chaque
   * connexion socket de ce controller. N'atteint QUE les routes déclarant le
   * transport `WEBSOCKET` dans leurs `methods`.
   */
  protected override realtimeApiRequest(): boolean {
    return true;
  }

  /** Handshake de la socket Nodefony (JSON-RPC 2.0) — la porte du pont. */
  @route("<%= it.kebab %>-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Liste — `GET <%= it.route %>` OU `socket.request("<%= it.route %>")`. */
  @route("<%= it.kebab %>-list", {
    path: "",
    requirements: { methods: ["GET", "WEBSOCKET"] },
    schema: { query: listQuery },
  })
  list(input: RouteInput<{ query: typeof listQuery }>) {
    return [...<%= it.nameClass %>.items.values()].slice(0, input.query.limit);
  }

  /** Détail — 404 typée si inconnu (RpcError `data.status: 404` côté socket). */
  @route("<%= it.kebab %>-get", {
    path: "/{id}",
    requirements: { methods: ["GET", "WEBSOCKET"] },
    schema: { params: idParams },
  })
  detail(input: RouteInput<{ params: typeof idParams }>) {
    const { id } = input.params;
    const item = <%= it.nameClass %>.items.get(id);
    if (!item) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    return item;
  }

  /**
   * Création idempotente par les DEUX portes : en HTTP la clé vient de
   * l'en-tête `Idempotency-Key`, par la socket elle voyage dans la frame
   * (`socket.mutate` l'exige) — même dédup, même cache de rejeu. ⚠ Une action
   * `@Idempotent` RETOURNE son payload BRUT (c'est LUI qui est mémorisé).
   */
  @route("<%= it.kebab %>-create", {
    path: "",
    requirements: { methods: ["POST", "WEBSOCKET"] },
    schema: { body: itemBody },
  })
  @HttpCode(201)
  @Idempotent()
  create(input: RouteInput<{ body: typeof itemBody }>) {
    const item: IItem = {
      id: randomUUID(),
      name: input.body.name,
      createdAt: Date.now(),
      // L'identité posée par le pare-feu — par la socket, celle du handshake.
      createdBy: this.user?.identifier ?? "anon.",
    };
    <%= it.nameClass %>.items.set(item.id, item);
    return item;
  }

<% if (it.hasSecurity) { %>  /**
   * Suppression PROTÉGÉE par rôle — la MÊME garde pour les DEUX portes : en
   * HTTP `@IsGranted` refuse (403) AVANT l'action ; par la socket, le pont
   * `api.request` re-traverse le MÊME pipeline (le token du handshake voyage
   * dans l'ALS) → même refus. En dev, `admin/<%= it.devAdminPassword %>` a le rôle.
   */
  @route("<%= it.kebab %>-delete", {
    path: "/{id}",
    requirements: { methods: ["DELETE", "WEBSOCKET"] },
    schema: { params: idParams },
  })
  @IsGranted("ROLE_ADMIN")
  destroy(input: RouteInput<{ params: typeof idParams }>) {
    const { id } = input.params;
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    return { deleted: id, by: this.user?.identifier ?? null };
  }
<% } else { %>  /** Suppression — `DELETE` HTTP ou `socket.mutate(path, { method: "DELETE", … })`. */
  @route("<%= it.kebab %>-delete", {
    path: "/{id}",
    requirements: { methods: ["DELETE", "WEBSOCKET"] },
    schema: { params: idParams },
  })
  destroy(input: RouteInput<{ params: typeof idParams }>) {
    const { id } = input.params;
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`item ${id} introuvable`, 404);
    }
    return { deleted: id };
  }
<% } %>}

export default <%= it.nameClass %>;
