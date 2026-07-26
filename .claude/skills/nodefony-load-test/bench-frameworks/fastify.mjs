// oxlint-disable no-async-endpoint-handlers -- dérogation de FICHIER : la règle vise Express,
// où une promesse rejetée échappe au gestionnaire d'erreurs. Ici c'est Fastify, dont l'API
// NORMALE est le gestionnaire `async` : la valeur retournée devient la réponse, et un rejet
// est capté par le framework. Comparer les deux à armes égales suppose d'écrire chacun dans
// son idiome — c'est tout l'objet de ce banc.
// Fastify 5 — index radix (find-my-way) = ce que viserait le fast path P2/P3b.
// Deux modes : par défaut sans schéma (JSON.stringify, comme les autres) ;
// FASTIFY_SCHEMA=1 active fast-json-stringify (le "plein potentiel" Fastify).
import Fastify from "fastify";
import { state, BENCH_PATH, dummyRoutes } from "./payload.mjs";

const app = Fastify({ logger: false });

const { before, after } = dummyRoutes();
for (const p of before) app.get(p, async (req) => ({ id: req.params.id }));

if (process.env.FASTIFY_SCHEMA === "1") {
  const schema = {
    response: {
      200: {
        type: "object",
        properties: {
          byContext: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          lastHookRequestId: { type: ["string", "null"] },
          hookUser: { type: ["string", "null"] },
          lateHookRequestId: { type: ["string", "null"] },
          wsHookRequestId: { type: ["string", "null"] },
          wsHookHandshakeId: { type: ["string", "null"] },
          wsHookFireCount: { type: "number" },
          hookCount: { type: "number" },
        },
      },
    },
  };
  app.get(BENCH_PATH, { schema }, async () => state);
} else {
  app.get(BENCH_PATH, async () => state);
}
for (const p of after) app.get(p, async (req) => ({ id: req.params.id }));

const port = Number(process.env.PORT ?? 5163);
app
  .listen({ port, host: "127.0.0.1" })
  .then(() => console.log(`fastify :${port}`));
// Sortie propre sur SIGINT (flush du log V8 --prof).
process.on("SIGINT", () => process.exit(0));
