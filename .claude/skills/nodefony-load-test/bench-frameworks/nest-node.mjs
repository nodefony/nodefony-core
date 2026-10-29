// NestJS 12.3, adaptateur `node:http` natif (`@nestjs/platform-node`) — ni
// Express ni Fastify sous Nest : le camp le plus proche de Nodefony, qui sert
// lui aussi sur `node:http` sans couche intermédiaire.
import { NodeAdapter } from "@nestjs/platform-node";
import { start } from "./nest-app.mjs";

start(new NodeAdapter(), "nest-node").catch((/** @type {unknown} */ e) => {
  console.error(e);
  process.exit(1);
});
