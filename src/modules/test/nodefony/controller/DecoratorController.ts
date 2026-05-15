import { Controller, controller, Get, Post, Param, Body, Query } from "@nodefony/framework";
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
    @Query("v") v: string
  ) {
    return this.renderJson({ id, name: name ?? null, v: v ?? null });
  }
}

export default DecoratorController;
