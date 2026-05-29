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
} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

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
}

export default DecoratorController;
