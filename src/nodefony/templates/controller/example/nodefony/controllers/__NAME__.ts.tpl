import { randomUUID } from "node:crypto";
import {
  route,
  controller,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
  Headers,
  Cookie,
  UseSession,
  Session,
  Idempotent,
  UploadedFile,
  UploadedFiles,
  // Identité ALS posée par le firewall — marche AUSSI sans @nodefony/security
  // (injecte alors `undefined`) : le décorateur vient du framework, pas de security.
  CurrentUser,
<% if (it.hasSecurity) { %>  IsGranted,
  RequireScope,
  CsrfProtect,
<% } %>} from "@nodefony/framework";
import { HttpError } from "@nodefony/http";
import type { ContextType, ICookie, IUploadedFile } from "@nodefony/http";
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
 * <%= it.nameClass %> — **vitrine des décorateurs Nodefony** (saveur `example`) :
 * chaque action montre une capacité du pipeline, commentée et testable au curl.
 * Pour un squelette de PRODUCTION, préfère `--kind rest` (CRUD pur) ou
 * `--kind duplex` (la même ressource en HTTP ET par la socket Nodefony).
 *
 *  - CRUD complet : `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete` + `@Param`/`@Body`/`@Query`
 *  - Réponse : `@HttpCode`, `@Header`, `@Redirect`
 *  - Anti double-effet : `@Idempotent` (header `Idempotency-Key`)
 *  - Session : `@UseSession` + `@Session` (compteur de visites)
 *  - Requête brute : `@Headers`, `@Cookie`, upload `@UploadedFile(s)`
 *  - Identité : `@CurrentUser` (utilisateur ALS posé par le firewall)
<% if (it.hasSecurity) { %> *  - Sécurité : `@IsGranted` (rôles), `@RequireScope` (API keys M2M),
 *    `@CsrfProtect` (mutations pilotées session)
<% } else { %> *  - (ajoute `@nodefony/security` pour débloquer `@IsGranted`, `@RequireScope`,
 *    `@CsrfProtect` — régénère alors cette saveur pour voir les exemples)
<% } %> *  - WebSocket : echo dans la MÊME classe (un seul pipeline)
 *
 *  - Flux BRUT : `@Body({ stream: true })` (gros uploads sans parse en RAM)
 *
 * Existent aussi (non générés ici) : `@All`/`@Options`/`@Head`, `@Req`/`@Res`
 * (objets requête/réponse bruts), `@Anonymous`, `@BypassFirewall` (⚠ réfléchis
 * avant), `@Domain` (routage par vhost), `@Csp`, `@CsrfExempt`, `@Scope`
 * (scope DI du controller).
 *
 * Essais rapides (zone `^/api` du manifeste : identité résolue, jamais bloquante) :
 * ```bash
 * curl -k "https://127.0.0.1:5152<%= it.route %>?page=1&limit=10"
 * curl -k -X POST -H "content-type: application/json" \
 *   -H "idempotency-key: demo-1" -d '{"name":"premier"}' https://127.0.0.1:5152<%= it.route %>
 * # rejoue la MÊME clé → réponse mémorisée (aucun doublon créé)
 * curl -k -c /tmp/jar -b /tmp/jar https://127.0.0.1:5152<%= it.route %>/session   # ×2 → visits: 2
 * ```
 */
@controller("<%= it.route %>")
class <%= it.nameClass %> extends Controller {
  /** Stub EN MÉMOIRE volontairement naïf (par process, perdu au restart) —
   *  branche un repository dès que tu crées ton entité. */
  static readonly items = new Map<string, IItem>();

  constructor(context: ContextType) {
    super("<%= it.kebab %>", context);
  }

  // ── Lecture ────────────────────────────────────────────────────────────────

  /**
   * `@Query` = querystring typée à la carte ; `@Header` fixe un header de
   * RÉPONSE déclarativement (ici : cache court côté client).
   */
  @Get("")
  @Header("cache-control", "private, max-age=5")
  list(@Query("page") page: string, @Query("limit") limit: string) {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 20));
    const all = [...<%= it.nameClass %>.items.values()];
    return this.renderJson({
      page: p,
      limit: l,
      total: all.length,
      items: all.slice((p - 1) * l, p * l),
    });
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  /**
   * `@Idempotent()` (strict) : la mutation EXIGE un header `Idempotency-Key` —
   * sans clé → 400 ; rejeu de la MÊME clé → la réponse mémorisée est renvoyée
   * SANS ré-exécuter (anti double-clic / retry réseau / réplique cross-pod avec
   * le store redis `NF_IDEMPOTENCY_STORE=redis`) ; même clé + payload différent
   * → 422. `@HttpCode(201)` force le status de création.
   *
   * ⚠ Une action `@Idempotent` doit RETOURNER son payload BRUT (`return item`) :
   * c'est LUI qui est mémorisé puis rejoué. `renderJson()` enverrait la Response
   * (structure circulaire) au cache → la mémorisation échouerait.
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

  /** `@Body("name")` = UN champ du body (le reste est ignoré). */
  @Put("/{id}")
  update(@Param("id") id: string, @Body("name") name: string) {
    const item = <%= it.nameClass %>.items.get(id);
    if (!item) {
      throw new HttpError(`<%= it.kebab %> ${id} introuvable`, 404, this.context);
    }
    if (name !== undefined) {
      item.name = name;
    }
    return this.renderJson(item);
  }

  /**
   * `@Patch` = mise à jour PARTIELLE (vs `@Put` remplacement) : seuls les
   * champs présents dans le body sont appliqués.
   */
  @Patch("/{id}")
  patchItem(@Param("id") id: string, @Body() changes: Partial<Pick<IItem, "name">>) {
    const item = <%= it.nameClass %>.items.get(id);
    if (!item) {
      throw new HttpError(`<%= it.kebab %> ${id} introuvable`, 404, this.context);
    }
    Object.assign(item, { name: changes?.name ?? item.name });
    return this.renderJson(item);
  }

<% if (it.hasSecurity) { %>  /**
   * AUTORISATION déclarative — la zone firewall AUTHENTIFIE, `@IsGranted`
   * DÉCIDE ensuite : anonyme ou simple user → **403** (pas 401), porteur du
   * rôle → l'action s'exécute. `@CurrentUser()` injecte l'utilisateur de l'ALS
   * (jamais le credential). Teste : DELETE anonyme → 403 ; loggé `admin` → 200.
   */
  @Delete("/{id}")
  @IsGranted("ROLE_ADMIN")
  destroy(@Param("id") id: string, @CurrentUser() user: IUser) {
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`<%= it.kebab %> ${id} introuvable`, 404, this.context);
    }
    return this.renderJson({ deleted: id, by: user.identifier });
  }

  /**
   * `@RequireScope` = autorisation MACHINE-À-MACHINE par scope d'API key
   * (`Authorization: ApiKey <clé>` — la clé porte ses scopes, cf commande
   * `nodefony security:apikey:*` et la page API Keys de /nodefony).
   *
   * ⚠ Un scope ne bride QUE les jetons machine (clé API / JWT délégué / OAuth) :
   * une clé sans le scope → 403, mais un HUMAIN (session) ou l'anonyme PASSE —
   * son autorisation à lui se décide par rôles (`@IsGranted`). Pour une route
   * exigeante sur les DEUX axes, combine les deux décorateurs.
   */
  @Get("/export/all")
  @RequireScope("<%= it.kebab %>:export")
  exportAll() {
    return this.renderJson({
      exportedAt: Date.now(),
      items: [...<%= it.nameClass %>.items.values()],
    });
  }

  /**
   * `@CsrfProtect` = anti-CSRF sur mutation pilotée par SESSION (cookie) :
   * le double-submit est exigé — cookie `csrf-token` (posé par le serveur,
   * non HttpOnly) REJOUÉ dans l'en-tête `x-csrf-token` — un POST forgé
   * cross-site sans token → 403. Inutile pour du M2M sans cookie
   * (`@CsrfExempt` existe pour l'inverse).
   */
  @Post("/reset")
  @UseSession()
  @CsrfProtect()
  reset(@Session() session: unknown) {
    const count = <%= it.nameClass %>.items.size;
    <%= it.nameClass %>.items.clear();
    void session; // la session prouve le contexte BFF (cookie) de la mutation
    return this.renderJson({ cleared: count });
  }

<% } else { %>  /** DELETE sans garde — ajoute @nodefony/security pour la version gardée par rôle. */
  @Delete("/{id}")
  destroy(@Param("id") id: string) {
    if (!<%= it.nameClass %>.items.delete(id)) {
      throw new HttpError(`<%= it.kebab %> ${id} introuvable`, 404, this.context);
    }
    return this.renderJson({ deleted: id });
  }

<% } %>  // ── Session / requête brute ───────────────────────────────────────────────

  /**
   * `@UseSession()` ACTIVE la session sur CETTE action (granularité méthode —
   * possible aussi au niveau classe) ; `@Session()` injecte l'objet session.
   * Recharge la page : `visits` s'incrémente, porté par le cookie de session.
   */
  @Get("/session")
  @UseSession()
  sessionVisits(
    @Session() session: { get: (k: string) => unknown; set: (k: string, v: unknown) => void },
  ) {
    const visits = (Number(session.get("visits")) || 0) + 1;
    session.set("visits", visits);
    return this.renderJson({ visits, sessionActive: true });
  }

  /**
   * `@Headers("x")` = UN header de requête ; `@Cookie()` = map des cookies
   * (`@Cookie("nom")` = un seul, objet `{ value }`). Diagnostic sans toucher
   * aux objets bruts (`@Req()`/`@Res()` existent pour ça).
   */
  @Get("/whoami")
  whoami(
    @Headers("user-agent") ua: string,
    @Cookie() cookies: Record<string, ICookie> | undefined,
    // Identité posée dans l'ALS par le firewall (anonyme = identifier "anon.").
    @CurrentUser() user?: { identifier?: string; roles?: string[] },
  ) {
    return this.renderJson({
      identifier: user?.identifier ?? null,
      roles: user?.roles ?? [],
      userAgent: ua ?? null,
      cookies: cookies ? Object.keys(cookies) : [],
    });
  }

  /** `@UploadedFile()` = 1ᵉʳ fichier multipart ; `@UploadedFiles()` = tous. */
  @Post("/upload")
  upload(
    @UploadedFile() file: IUploadedFile | undefined,
    @UploadedFiles() files: IUploadedFile[] | undefined,
  ) {
    return this.renderJson({
      received: file?.filename ?? null,
      count: files?.length ?? 0,
    });
  }

  /**
   * `@Body({ stream: true })` = le pipeline SAUTE le parse (JSON/busboy) et
   * injecte le FLUX brut (`Readable`) : gros fichiers, proxys, ingestion —
   * zéro copie en RAM. Ici on compte les octets :
   * `curl -k -X POST --data-binary @gros.bin https://…<%= it.route %>/ingest`
   */
  @Post("/ingest")
  async ingest(@Body({ stream: true }) body: NodeJS.ReadableStream) {
    let bytes = 0;
    await new Promise<void>((resolve, reject) => {
      body.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
      });
      body.once("end", () => resolve());
      body.once("error", reject);
    });
    return this.renderJson({ ingested: bytes });
  }

  /** `@Redirect(url, code)` — le retour `{ url }` peut surcharger la cible. */
  @Get("/latest")
  @Redirect("/unused", 302)
  latest() {
    const last = [...<%= it.nameClass %>.items.keys()].at(-1);
    return { url: last ? `<%= it.route %>/${last}` : "<%= it.route %>" };
  }

  /**
   * `@Param("id")` = segment d'URL `{id}` injecté. Déclarée EN DERNIER des GET :
   * une route paramétrique déclarée avant capturerait `/session`, `/latest`…
   */
  @Get("/{id}")
  read(@Param("id") id: string) {
    const item = <%= it.nameClass %>.items.get(id);
    if (!item) {
      throw new HttpError(`<%= it.kebab %> ${id} introuvable`, 404, this.context);
    }
    return this.renderJson(item);
  }

  // ── WebSocket — MÊME classe, même pipeline ────────────────────────────────

  /**
   * Echo WS : `wscat -c wss://127.0.0.1:5152<%= it.route %>/echo`.
   *
   * ⚠ WS BRUT = démo du pipeline partagé, pas un modèle. Pour du WS métier
   * (canaux pub/sub, actions RPC, policies), la bonne couche est la socket
   * Nodefony : `nodefony create controller <nom> --kind realtime` — ou
   * `--kind duplex` pour les MÊMES actions REST par la socket.
   */
  @route("<%= it.kebab %>-echo", {
    path: "/echo",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async echo(message: string | Buffer | null) {
    if (!message) {
      return this.renderJson({ handshake: true });
    }
    return this.renderJson({ echo: message.toString() });
  }
}

export default <%= it.nameClass %>;
