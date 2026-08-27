import {
  Controller,
  controller,
  UseSession,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  HttpCode,
  Header,
  Redirect,
  Param,
  Body,
  Query,
  CsrfProtect,
  CsrfExempt,
} from "@nodefony/framework";
import { Context, HttpContext, HttpError } from "@nodefony/http";
import { z } from "zod";

/**
 * Schéma de démonstration du trajet documenté dans `framework/docs/decorateurs.md`
 * (« Le corps n'est pas validé — et c'est un choix ») : le décorateur `@Body` livre
 * le corps brut, l'action le confronte au schéma, et le pipeline transforme le rejet
 * en 422. Le contrat public tient à ce que ces trois maillons restent branchés.
 */
const demoBodySchema = z.object({
  title: z.string().min(3),
  views: z.number().int(),
});

@controller("/nodefony/test/fw")
class FrameworkController extends Controller {
  constructor(context: Context) {
    super("FrameworkController", context);
  }

  // ── renderJson ──────────────────────────────────────────────────────────────
  @Get("/json")
  json() {
    return this.renderJson({ ok: true });
  }

  // ── @HttpCode(201) + @Post ──────────────────────────────────────────────────
  @HttpCode(201)
  @Post("/created")
  created() {
    return this.renderJson({ created: true });
  }

  // ── @Header decorator ───────────────────────────────────────────────────────
  @Header("X-Framework", "nodefony")
  @Get("/with-header")
  withHeader() {
    return this.renderJson({ ok: true });
  }

  // ── multiple @Header ────────────────────────────────────────────────────────
  @Header("X-Version", "10")
  @Header("X-Powered-By", "nodefony")
  @Get("/multi-header")
  multiHeader() {
    return this.renderJson({ ok: true });
  }

  // ── redirect via Controller.redirect() ─────────────────────────────────────
  @Get("/redirect-302")
  redirectTo302() {
    return this.redirect("/nodefony/test/fw/json", 302);
  }

  @Get("/redirect-301")
  redirectTo301() {
    return this.redirect("/nodefony/test/fw/json", 301);
  }

  // ── @Redirect decorator ─────────────────────────────────────────────────────
  @Redirect("/nodefony/test/fw/json")
  @Get("/deco-redirect")
  decoRedirect() {
    // void — redirect applied by Resolver
  }

  @Redirect("/nodefony/test/fw/json", 301)
  @Get("/deco-redirect-301")
  decoRedirect301() {
    // void — redirect 301 applied by Resolver
  }

  // ── errors ──────────────────────────────────────────────────────────────────
  @Get("/error/sync")
  errorSync() {
    throw new Error("fw sync crash");
  }

  @Get("/error/http-422")
  errorHttp422() {
    throw new HttpError(undefined, 422, this.context);
  }

  /**
   * Le corps est refusé par un schéma — pas par un `HttpError` écrit à la main.
   * C'est le geste que la documentation enseigne à l'utilisateur : `schema.parse()`
   * en tête d'action, et rien d'autre. La réponse attendue est un **422** portant
   * `error.fields`, produit par `toValidationFields()` côté renderer.
   */
  @Post("/validate/body")
  validateBody(@Body() body: unknown) {
    const dto = demoBodySchema.parse(body);
    return this.renderJson({ ok: true, title: dto.title });
  }

  @Get("/error/http-400")
  errorHttp400() {
    throw new HttpError({ reason: "bad request" }, 400, this.context);
  }

  // ── queryGet echo ───────────────────────────────────────────────────────────
  @Get("/echo")
  echo() {
    return this.renderJson({
      name: this.queryGet?.["name"] ?? null,
      page: this.queryGet?.["page"] ?? null,
    });
  }

  // ── session ─────────────────────────────────────────────────────────────────
  @Get("/session")
  @UseSession()
  sessionInfo() {
    return this.renderJson({
      sessionStarted: true,
      sessionId: (this.context as HttpContext).session?.id ?? null,
    });
  }

  // ── HTTP method constraints ─────────────────────────────────────────────────
  @Post("/post-only")
  postOnly() {
    return this.renderJson({ method: "POST" });
  }

  @Put("/put-only")
  putOnly() {
    return this.renderJson({ method: "PUT" });
  }

  @Delete("/delete-only")
  deleteOnly() {
    return this.renderJson({ method: "DELETE" });
  }

  @Patch("/patch-only")
  patchOnly() {
    return this.renderJson({ method: "PATCH" });
  }

  // ── CSRF étape 2 (@CsrfProtect synchronizer token / @CsrfExempt) ─────────────
  // GET protégé : le firewall mint le token sur cette requête sûre → cookie lisible
  // `csrf-token` + `context.csrfToken`. @UseSession force AUSSI un cookie de session
  // → la réponse porte 2 Set-Cookie (preuve e2e du flush multi-cookie).
  @CsrfProtect()
  @UseSession()
  @Get("/csrf/token")
  csrfToken() {
    return this.renderJson({
      token: (this.context as { csrfToken?: string | null }).csrfToken ?? null,
    });
  }

  // POST protégé : exige `x-csrf-token` ≡ cookie `csrf-token` + HMAC valide (sinon 403).
  @CsrfProtect()
  @Post("/csrf/submit")
  csrfSubmit() {
    return this.renderJson({ ok: true });
  }

  // POST exempté : hors défense CSRF (webhook authentifié autrement) → un POST
  // cross-site n'est PAS bloqué ici (contraste avec /post-only qui, lui, l'est).
  @CsrfExempt()
  @Post("/csrf/webhook")
  csrfWebhook() {
    return this.renderJson({ received: true });
  }

  // ── context info ─────────────────────────────────────────────────────────────
  @Get("/context")
  contextInfo() {
    const ctx = this.context as HttpContext;
    return this.renderJson({
      type: ctx.type,
      method: this.method,
      scheme: ctx.scheme,
    });
  }

  // ── @Param ────────────────────────────────────────────────────────────────
  @Get("/item/{id}")
  getItem(@Param("id") id: string) {
    return this.renderJson({ id });
  }

  @Get("/items/{cat}/{page}")
  getItems(@Param("cat") cat: string, @Param("page") page: string) {
    return this.renderJson({ cat, page });
  }

  @Get("/params-all/{x}/{y}")
  getAllParams(@Param() params: Record<string, unknown>) {
    return this.renderJson(params);
  }

  // ── @Query ────────────────────────────────────────────────────────────────
  @Get("/search")
  search(@Query("q") q: string, @Query("page") page: string) {
    return this.renderJson({ q: q ?? null, page: page ?? null });
  }

  // ── @Body ─────────────────────────────────────────────────────────────────
  @Post("/submit")
  submit(@Body() payload: Record<string, unknown>) {
    return this.renderJson(payload ?? {});
  }

  @Post("/submit/{type}")
  submitTyped(@Param("type") type: string, @Body("value") value: unknown) {
    return this.renderJson({ type, value: value ?? null });
  }

  // ── queryGet (first param, bug fixé slice(1)) ─────────────────────────────
  @Get("/qs")
  queryStringTest() {
    return this.renderJson({
      first: this.queryGet?.["first"] ?? null,
      second: this.queryGet?.["second"] ?? null,
    });
  }

  // ── route variable positionnelle (ancien style sans @Param) ──────────────
  @Get("/pos/{name}")
  positional(name: string) {
    return this.renderJson({ name });
  }

  // ── body form-urlencoded ──────────────────────────────────────────────────
  @Post("/form")
  form(@Body() body: Record<string, unknown>) {
    return this.renderJson(body ?? {});
  }
}

export default FrameworkController;
