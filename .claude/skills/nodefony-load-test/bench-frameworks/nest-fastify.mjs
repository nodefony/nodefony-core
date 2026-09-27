// NestJS 12, adaptateur Fastify (`@nestjs/platform-fastify`) — camp de #489.
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { start } from "./nest-app.mjs";

start(new FastifyAdapter({ logger: false }), "nest-fastify").catch(
  (/** @type {unknown} */ e) => {
    console.error(e);
    process.exit(1);
  },
);
