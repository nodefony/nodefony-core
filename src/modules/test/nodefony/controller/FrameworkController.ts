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
} from "@nodefony/framework";
import { Context, HttpContext, HttpError } from "@nodefony/http";

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
