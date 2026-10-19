import { expect, expectTypeOf } from "vitest";
import "reflect-metadata";
import { z } from "zod";
import {
  BootConfigurationError,
  RequestContext,
  SchemaValidationError,
} from "nodefony";
import type { IStandardSchemaV1, MaybePromise } from "nodefony";
import {
  Body,
  Get,
  Post,
  assertRouteSchemaDeclaration,
  computeActionMeta,
  readRouteInput,
  routeExpectsBodyStream,
} from "../../decorators/routerDecorators.js";
import { validateRouteInput } from "../../src/routeSchema.js";
import Router from "../../service/router.js";
import { Readable } from "node:stream";
import type { RawRouteInput, RouteInput } from "../../src/routeSchema.js";

const raw = (partial: Partial<RawRouteInput>): RawRouteInput => ({
  params: {},
  query: {},
  body: undefined,
  headers: {},
  ...partial,
});

/** Un schéma dont la validation attend — Zod ne l'est qu'avec un raffinement asynchrone. */
function asyncSchema(fail: boolean): IStandardSchemaV1<unknown, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) =>
        Promise.resolve(
          fail
            ? { issues: [{ message: "refusé", path: [{ key: "x" }] }] }
            : { value: `ok:${String(value)}` },
        ),
    },
  };
}

/** L'entrée d'une validation attendue SYNCHRONE — une promesse est un échec du test. */
function sync(result: MaybePromise<RawRouteInput>): RawRouteInput {
  if (result instanceof Promise)
    throw new Error("validation synchrone attendue");
  return result;
}

const createPost = z.object({ title: z.string().min(3) });
const pageQuery = z.object({ page: z.coerce.number().int().default(1) });

describe("validateRouteInput", () => {
  it("valide en SYNCHRONE et rend la sortie du schéma (coercition, défaut)", () => {
    const result = sync(
      validateRouteInput(
        { body: createPost, query: pageQuery },
        raw({ body: { title: "Bonjour" }, query: { page: "2" } }),
      ),
    );
    expect(result.query).to.deep.equal({ page: 2 });
    expect(result.body).to.deep.equal({ title: "Bonjour" });
  });

  it("sert brute une partie sans schéma", () => {
    const headers = { "x-a": "1" };
    const result = sync(
      validateRouteInput(
        { body: createPost },
        raw({ body: { title: "abc" }, headers }),
      ),
    );
    expect(result.headers).to.equal(headers);
  });

  it("un échec lève UNE erreur 422 qui porte les anomalies de TOUTES les parties", () => {
    let caught: unknown;
    try {
      // Validateurs synchrones : l'échec lève ICI, aucune promesse n'est rendue.
      void validateRouteInput(
        { query: pageQuery, body: createPost },
        raw({ body: { title: "x" }, query: { page: "abc" } }),
      );
    } catch (error) {
      caught = error;
    }
    if (!(caught instanceof SchemaValidationError)) {
      throw new Error("SchemaValidationError attendue");
    }
    const error = caught;
    expect(error.code).to.equal(422);
    // Ordre des parties : query avant body.
    expect(error.issues.map((i) => [i.in, i.path.join(".")])).to.deep.equal([
      ["query", "page"],
      ["body", "title"],
    ]);
  });

  it("ne passe en ASYNCHRONE que si un validateur rend une promesse", async () => {
    const pending = validateRouteInput(
      { params: asyncSchema(false) },
      raw({ params: "42" }),
    );
    expect(pending).to.be.instanceOf(Promise);
    expect((await pending).params).to.equal("ok:42");
  });

  it("garde l'ordre des parties quand une partie asynchrone échoue avant une synchrone", async () => {
    const pending = validateRouteInput(
      { params: asyncSchema(true), body: createPost },
      raw({ params: "1", body: { title: "x" } }),
    );
    const error = await Promise.resolve(pending).then(
      () => null,
      (e: unknown) => e,
    );
    if (!(error instanceof SchemaValidationError)) {
      throw new Error("SchemaValidationError attendue");
    }
    expect(error.issues.map((i) => i.in)).to.deep.equal(["params", "body"]);
  });

  it("valide des OCTETS tels quels, sans copie ni sérialisation (codec binaire)", () => {
    const bytes = new Uint8Array([0, 255, 7]);
    const result = sync(
      validateRouteInput(
        { body: z.instanceof(Uint8Array) },
        raw({ body: bytes }),
      ),
    );
    expect(result.body).to.equal(bytes);
  });
});

describe("readRouteInput — mêmes sources que les décorateurs de paramètre", () => {
  const request = {
    query: { page: "1" },
    body: { title: "http" },
    headers: { "x-a": "1" },
  };

  it("lit params, query, corps et en-têtes de la requête", () => {
    expect(
      readRouteInput({ id: "7" }, request, undefined, false),
    ).to.deep.equal({
      params: { id: "7" },
      query: { page: "1" },
      body: { title: "http" },
      headers: { "x-a": "1" },
    });
  });

  it("pont WebSocket : la query du chemin invoqué et le corps de l'ALS priment", () => {
    const bytes = new Uint8Array([1, 2]);
    const input = RequestContext.run({ requestId: "t", body: bytes }, () =>
      readRouteInput({}, request, { page: "9" }, false),
    );
    expect(input.query).to.deep.equal({ page: "9" });
    // Un codec binaire (#618) posera des octets : rien ne les transforme.
    expect(input.body).to.equal(bytes);
  });

  it("bodyStream : le corps est le flux brut, jamais lu", () => {
    const stream = Readable.from([]);
    const input = readRouteInput(
      {},
      { ...request, request: stream },
      undefined,
      true,
    );
    expect(input.body).to.equal(stream);
  });

  it("une partie absente rend un objet vide partagé, sans allocation", () => {
    const a = readRouteInput({}, null, undefined, false);
    const b = readRouteInput({}, null, undefined, false);
    expect(a.query).to.equal(b.query);
    expect(Object.isFrozen(a.headers)).to.equal(true);
  });
});

describe("déclaration d'une route à schéma", () => {
  class Ctrl {
    @Post("/posts", { schema: { body: createPost } })
    create(input: RouteInput<{ body: typeof createPost }>) {
      return input.body.title;
    }

    @Post("/upload", { schema: { query: pageQuery }, bodyStream: true })
    upload(input: RouteInput<{ query: typeof pageQuery }, true>) {
      return input.body;
    }

    @Get("/plain")
    plain(@Body() body: unknown) {
      return body;
    }
  }

  it("range le schéma sur la MÉTHODE et l'expose dans la méta d'action", () => {
    const meta = computeActionMeta(Ctrl, "create");
    expect(meta.schema?.body).to.equal(createPost);
    expect(meta.bodyStream).to.equal(false);
    expect(computeActionMeta(Ctrl, "plain").schema).to.equal(null);
  });

  it("bodyStream en option de route saute la lecture du corps", () => {
    expect(computeActionMeta(Ctrl, "upload").bodyStream).to.equal(true);
    expect(
      routeExpectsBodyStream({ controller: Ctrl, classMethod: "upload" }),
    ).to.equal(true);
    expect(
      routeExpectsBodyStream({ controller: Ctrl, classMethod: "create" }),
    ).to.equal(false);
  });

  it("une déclaration correcte passe le contrôle de démarrage", () => {
    expect(() =>
      assertRouteSchemaDeclaration({
        name: "create",
        controller: Ctrl,
        classMethod: "create",
      }),
    ).to.not.throw();
  });

  it("schéma ET décorateur de paramètre : refus au démarrage, qui nomme la route", () => {
    class Mixed {
      // @ts-expect-error — une action à schéma ne prend qu'un argument
      @Post("/m", { schema: { body: createPost } })
      mixed(
        input: RouteInput<{ body: typeof createPost }>,
        @Body() b: unknown,
      ) {
        return [input, b];
      }
    }
    expect(() =>
      assertRouteSchemaDeclaration({
        name: "mixed-route",
        controller: Mixed,
        classMethod: "mixed",
      }),
    )
      .to.throw(BootConfigurationError)
      .with.property("message")
      .that.contains('Route "mixed-route"');
  });

  it("bodyStream ET schema.body : refus au démarrage", () => {
    // Forme refusée à la compilation ; un appelant JavaScript peut l'écrire.
    const options: Record<string, unknown> = {
      schema: { body: createPost },
      bodyStream: true,
    };
    class Streamed {
      @Post("/s", options)
      streamed() {
        return null;
      }
    }
    expect(() =>
      assertRouteSchemaDeclaration({
        name: "streamed",
        controller: Streamed,
        classMethod: "streamed",
      }),
    ).to.throw(BootConfigurationError, /bodyStream/);
  });

  it("bodyStream SANS schéma : refus à la compilation et au démarrage", () => {
    class NoSchema {
      // @ts-expect-error — le flux d'une action sans schéma se demande par @Body({ stream: true })
      @Post("/n", { bodyStream: true })
      raw() {
        return null;
      }
    }
    expect(() =>
      assertRouteSchemaDeclaration({
        name: "no-schema",
        controller: NoSchema,
        classMethod: "raw",
      }),
    ).to.throw(BootConfigurationError, /exige un « schema »/);
  });

  it("partie inconnue ou valeur hors Standard Schema : refus au démarrage", () => {
    const typo: Record<string, unknown> = { schema: { bodies: createPost } };
    const notSchema: Record<string, unknown> = { schema: { body: {} } };
    class Bad {
      @Post("/a", typo)
      a() {
        return null;
      }
      @Post("/b", notSchema)
      b() {
        return null;
      }
    }
    expect(() =>
      assertRouteSchemaDeclaration({
        name: "a",
        controller: Bad,
        classMethod: "a",
      }),
    ).to.throw(BootConfigurationError, /bodies/);
    expect(() =>
      assertRouteSchemaDeclaration({
        name: "b",
        controller: Bad,
        classMethod: "b",
      }),
    ).to.throw(BootConfigurationError, /Standard Schema/);
  });

  it("une route créée par programme refuse schema/bodyStream au lieu de les ignorer", () => {
    const options: Record<string, unknown> = {
      path: "/x",
      schema: { body: createPost },
    };
    // Appel JavaScript, hors du typage : `Reflect.apply` le simule sans conversion.
    expect(() =>
      Reflect.apply(Router.createRoute, Router, [
        "schema.programmatic",
        options,
      ]),
    ).to.throw(BootConfigurationError, /createRoute/);
    expect(
      Router.routes.some((r) => r.name === "schema.programmatic"),
    ).to.equal(false);
  });

  it("deux routes de la même action avec deux schémas différents : refus à la déclaration", () => {
    expect(() => {
      class Twice {
        @Get("/a", { schema: { query: pageQuery } })
        @Post("/b", { schema: { body: createPost } })
        both() {
          return null;
        }
      }
      return Twice;
    }).to.throw(BootConfigurationError, /schémas différents/);
  });
});

describe("typage — la signature d'une action à schéma est vérifiée", () => {
  it("RouteInput porte les sorties du schéma, et les parties brutes sinon", () => {
    type Input = RouteInput<{
      body: typeof createPost;
      query: typeof pageQuery;
    }>;
    expectTypeOf<Input["body"]>().toEqualTypeOf<{ title: string }>();
    expectTypeOf<Input["query"]>().toEqualTypeOf<{ page: number }>();
    expectTypeOf<Input["params"]>().toEqualTypeOf<
      Readonly<Record<string, unknown>>
    >();
    expectTypeOf<
      RouteInput<{ query: typeof pageQuery }, true>["body"]
    >().toEqualTypeOf<import("node:stream").Readable | undefined>();
  });

  it("une action dont l'entrée diverge du schéma ne compile pas", () => {
    class Typed {
      @Post("/ok", { schema: { body: createPost } })
      ok(input: RouteInput<{ body: typeof createPost }>) {
        return input;
      }

      @Post("/none", { schema: { body: createPost } })
      none() {
        return null;
      }

      // @ts-expect-error — `title` est une chaîne, pas un nombre
      @Post("/wrong", { schema: { body: createPost } })
      wrong(input: { body: { title: number } }) {
        return input;
      }

      // @ts-expect-error — champ absent du schéma
      @Post("/missing", { schema: { body: createPost } })
      missing(input: { body: { slug: string } }) {
        return input;
      }

      // @ts-expect-error — `bodyStream: true` et `schema.body` s'excluent
      @Post("/stream", { schema: { body: createPost }, bodyStream: true })
      stream() {
        return null;
      }

      @Get("/legacy")
      legacy(id: string, page: number) {
        return [id, page];
      }
    }
    expect(Typed).to.be.a("function");
  });
});
