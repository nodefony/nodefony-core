import {
  Controller,
  controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  Header,
  Redirect,
  Headers,
  Cookie,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
} from "@nodefony/framework";
import type {
  ContextType,
  IHttpRequest,
  HttpResponse,
  ICookie,
  IUploadedFile,
} from "@nodefony/http";

@controller("/nodefony/test/decorators")
class DecoratorController extends Controller {
  constructor(context: ContextType) {
    super("DecoratorController", context);
  }

  @Get("/param/{id}")
  getById(@Param("id") id: string) {
    return this.renderJson({ id });
  }

  @Get("/params/{name}/{age}")
  getMultiParams(@Param("name") name: string, @Param("age") age: string) {
    return this.renderJson({ name, age });
  }

  @Get("/params-all/{name}/{age}")
  getAllParams(@Param() params: Record<string, unknown>) {
    return this.renderJson(params);
  }

  @Get("/query")
  getQuery(@Query("q") q: string, @Query("page") page: string) {
    return this.renderJson({ q: q ?? null, page: page ?? null });
  }

  @Post("/body")
  postBody(@Body() body: Record<string, unknown>) {
    return this.renderJson(body ?? {});
  }

  @Post("/body-field")
  postBodyField(@Body("name") name: string) {
    return this.renderJson({ name: name ?? null });
  }

  // P2.9 — `@Body({ stream:true })` : le pipeline saute le parse busboy/JSON et
  // injecte le flux brut (Readable). On le consomme en comptant les octets, et on
  // prouve que le body n'a PAS été parsé (`queryPost` vide).
  @Post("/body-stream")
  async postBodyStream(@Body({ stream: true }) body: NodeJS.ReadableStream) {
    const isReadable =
      body != null && typeof (body as { pipe?: unknown }).pipe === "function";
    let bytes = 0;
    if (isReadable) {
      await new Promise<void>((resolve, reject) => {
        body.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
        });
        body.once("end", () => resolve());
        body.once("error", reject);
      });
    }
    const req = this.context.request as { queryPost?: Record<string, unknown> };
    const parsedKeys = Object.keys(req.queryPost ?? {}).length;
    return this.renderJson({ isReadable, bytes, parsedKeys });
  }

  @Post("/mix/{id}")
  mix(
    @Param("id") id: string,
    @Body("name") name: string,
    @Query("v") v: string,
  ) {
    return this.renderJson({ id, name: name ?? null, v: v ?? null });
  }

  // ── P4.2 — décorateurs réponse × param combinés (vrai pipeline HTTP) ─────────
  // @HttpCode + @Header (×2) + @Param + @Body + @Query sur UNE action : vérifie
  // que le status forcé + les headers s'appliquent ET que les trois sources de
  // paramètres sont injectées dans la même requête. `renderJson` sans argument
  // status → @HttpCode(201) doit primer (pas écrasé par un 200 par défaut).
  @Post("/combined/{id}")
  @HttpCode(201)
  @Header("x-combined", "yes")
  @Header("x-source", "decorator")
  combined(
    @Param("id") id: string,
    @Body("name") name: string,
    @Query("v") v: string,
  ) {
    return this.renderJson({ id, name: name ?? null, v: v ?? null });
  }

  // @Redirect + @Param : le param construit la cible (override `{ url }`), le
  // statusCode vient de @Redirect → prouve injection + redirection combinées.
  @Get("/redirect/{slug}")
  @Redirect("/unused", 301)
  redirectWithParam(@Param("slug") slug: string) {
    return { url: `/nodefony/test/${slug}` };
  }

  // ── Décorateurs param étendus — câblage runtime (Context réel) ───────────────
  // Valide que le vrai HttpContext satisfait IParamArgContext : les noms
  // request.headers / getRequestCookies / request / response résolvent bien.

  // @Headers(name) → valeur d'un header ; @Headers() → objet complet.
  @Get("/headers")
  getHeaders(
    @Headers("user-agent") ua: string,
    @Headers() all: Record<string, unknown>,
  ) {
    // `host` n'existe pas en HTTP/2 (pseudo-header `:authority`) → on teste
    // `user-agent`, présent quel que soit le transport.
    return this.renderJson({
      ua: ua ?? null,
      hasUa: typeof all === "object" && all !== null && "user-agent" in all,
    });
  }

  // @Cookie(name) → objet Cookie (a `.value`) ; @Cookie() → map des cookies.
  @Get("/cookie")
  getCookie(@Cookie("sid") sid: ICookie | null, @Cookie() all: unknown) {
    return this.renderJson({
      sid: sid ? sid.value : null,
      count:
        all && typeof all === "object" ? Object.keys(all as object).length : 0,
    });
  }

  // @Req() → la requête injectée (preuve : on lit method/pathname depuis l'objet).
  @Get("/req")
  getReq(@Req() req: IHttpRequest) {
    return this.renderJson({
      method: req?.method ?? null,
      hasUrl: req?.url != null,
    });
  }

  // @Res() → la réponse injectée (preuve : on la mute, le header doit sortir).
  @Get("/res")
  getRes(@Res() res: HttpResponse) {
    res?.setHeader("x-from-res", "ok");
    return this.renderJson({ injected: res != null });
  }

  // @UploadedFile() → 1er fichier ; @UploadedFiles() → tableau complet.
  @Post("/upload")
  uploadDeco(
    @UploadedFile() file: IUploadedFile | undefined,
    @UploadedFiles() files: IUploadedFile[] | undefined,
  ) {
    return this.renderJson({
      has: file != null,
      name: file?.filename ?? null,
      count: files?.length ?? 0,
    });
  }
}

export default DecoratorController;
