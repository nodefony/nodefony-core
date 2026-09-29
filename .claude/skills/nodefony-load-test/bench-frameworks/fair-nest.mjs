/**
 * Pose sur une application NestJS (adaptateur Fastify) le travail par requête de
 * Nodefony (`fair-common.mjs`) — partagé par `nest-fair` et `nest-fair-sqlite`
 * (#489, #507). Le POURQUOI de chaque choix (hook `onRequest` natif plutôt
 * qu'un middleware Nest, `@fastify/helmet` réglé sur l'ensemble exact de
 * Nodefony, CORS par liste blanche) est écrit en tête de `nest-fair.mjs`.
 */
import helmet from "@fastify/helmet";
import { HELMET_OPTIONS, als, perRequest } from "./fair-common.mjs";

/**
 * @param app - application Nest créée sur `FastifyAdapter`, avant l'écoute
 * @param port - port d'écoute, pour la liste blanche CORS
 */
export async function installNestFair(app, port) {
  await app.register(helmet, HELMET_OPTIONS);
  app.enableCors({ origin: [`http://127.0.0.1:${port}`] });

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", (req, reply, done) => {
    const work = perRequest(req.method, req.url, req.headers);
    reply.headers(work.headers);
    if (work.status) return reply.code(work.status).send();
    als.run(work.store, done);
  });
}
