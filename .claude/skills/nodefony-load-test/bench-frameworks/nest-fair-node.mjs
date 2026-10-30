/**
 * NestJS 12.3 — « ÉQUITABLE » sur l'adaptateur `node:http` natif
 * (`@nestjs/platform-node`) : le MÊME travail par requête que `nest-fair`
 * (relevé et choix de performance écrits en tête de `nest-fair.mjs`), sans
 * Fastify dessous. C'est le camp qui compare Nest à Nodefony sur le même
 * serveur HTTP : tous deux servent sur `node:http` sans couche intermédiaire.
 *
 * Le travail est posé par `fair-nest-node.mjs`, sur `fair-common.mjs` — la même
 * implémentation que les camps Express et Fastify.
 *
 * Usage : NODE_ENV=production PORT=5164 node nest-fair-node.mjs
 */
import { NodeAdapter } from "@nestjs/platform-node";
import { installNestFairNode } from "./fair-nest-node.mjs";
import { start } from "./nest-app.mjs";

const port = Number(process.env.PORT ?? 5164);

start(new NodeAdapter(), "nest-fair-node", false, (app) =>
  installNestFairNode(app, port),
).catch((/** @type {unknown} */ e) => {
  console.error(e);
  process.exit(1);
});
