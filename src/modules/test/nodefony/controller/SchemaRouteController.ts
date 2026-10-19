import { Controller, controller, Get, Post } from "@nodefony/framework";
import type { RouteInput } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import { z } from "zod";

const postParams = z.object({ id: z.coerce.number().int().positive() });
const postQuery = z.object({ draft: z.enum(["0", "1"]).default("0") });
const postBody = z.object({ title: z.string().min(3) });
const searchQuery = z.object({
  q: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
});
const slugBody = z.object({
  slug: z.string().refine(async (slug) => slug !== "pris", "déjà pris"),
});
const uploadQuery = z.object({ name: z.string() });
const bytesBody = z.instanceof(Uint8Array);
const textBody = z.string().min(1);

/**
 * Routes d'intégration des actions à schéma (ADR-0018) : validation AVANT
 * l'action, 422 unique, mêmes sources sur HTTP et sur le pont WebSocket
 * `api.request` (transport `WEBSOCKET` ajouté aux routes duplex).
 */
@controller("/nodefony/test/schema")
class SchemaRouteController extends Controller {
  constructor(context: ContextType) {
    super("SchemaRouteController", context);
  }

  /** Les quatre parties, validées ou brutes, renvoyées telles que l'action les reçoit. */
  @Post("/posts/{id}", {
    schema: { params: postParams, query: postQuery, body: postBody },
    requirements: { methods: ["WEBSOCKET"] },
  })
  update(
    input: RouteInput<{
      params: typeof postParams;
      query: typeof postQuery;
      body: typeof postBody;
    }>,
  ) {
    return {
      id: input.params.id,
      draft: input.query.draft,
      title: input.body.title,
      // Partie sans schéma : servie brute.
      hasHeaders: typeof input.headers === "object",
    };
  }

  /** Lecture : query coercée et valeurs par défaut. */
  @Get("/search", {
    schema: { query: searchQuery },
    requirements: { methods: ["WEBSOCKET"] },
  })
  search(input: RouteInput<{ query: typeof searchQuery }>) {
    return input.query;
  }

  /** Validateur ASYNCHRONE (raffinement) : la route attend, puis répond. */
  @Post("/slug", { schema: { body: slugBody } })
  slug(input: RouteInput<{ body: typeof slugBody }>) {
    return { slug: input.body.slug };
  }

  /**
   * Corps BINAIRE (`application/octet-stream`) : le schéma reçoit les octets
   * tels quels — le même `Uint8Array` que livrera la socket binaire.
   */
  @Post("/bytes", { schema: { body: bytesBody } })
  bytes(input: RouteInput<{ body: typeof bytesBody }>) {
    return { length: input.body.length, first: input.body[0] ?? null };
  }

  /** Corps TEXTE (`text/plain`) : une chaîne, décodée au charset déclaré. */
  @Post("/text", { schema: { body: textBody } })
  text(input: RouteInput<{ body: typeof textBody }>) {
    return { text: input.body };
  }

  /** `bodyStream: true` : le corps arrive en flux, jamais lu par le pipeline. */
  @Post("/upload", { schema: { query: uploadQuery }, bodyStream: true })
  async upload(input: RouteInput<{ query: typeof uploadQuery }, true>) {
    let bytes = 0;
    const stream = input.body;
    if (stream !== undefined) {
      for await (const chunk of stream) {
        // Un flux sans encodage rend des octets ; une chaîne n'arrive que si
        // quelqu'un en a posé un.
        if (chunk instanceof Uint8Array) bytes += chunk.length;
        else if (typeof chunk === "string") bytes += Buffer.byteLength(chunk);
      }
    }
    return { name: input.query.name, bytes };
  }
}

export default SchemaRouteController;
