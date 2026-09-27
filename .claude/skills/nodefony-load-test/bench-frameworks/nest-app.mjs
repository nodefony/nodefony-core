// Socle commun des camps NestJS (#489) — `nest-express`, `nest-fastify`,
// `nest-request-scope`. Même charge utile que les autres camps : `payload.mjs`,
// 185 routes paramétrées, route de banc en position 31.
//
// Les décorateurs sont APPLIQUÉS PAR APPEL, sans TypeScript ni chargeur à la
// volée. C'est exactement ce que `tsc` émet : `__decorate` n'est qu'un
// `Reflect.decorate`, et `emitDecoratorMetadata` ne pose que
// `design:paramtypes` — remplacé ici par `@Inject(Token)` explicite, que Nest
// lit en priorité. Le runtime mesuré est donc celui d'une application NestJS
// compilée, sans étape de build à oublier avant le banc.
import "reflect-metadata";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Scope,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { state, BENCH_PATH, dummyRoutes } from "./payload.mjs";

/** Exemplaires construits — relu par le contrôle de validité du camp scope. */
export const counters = { services: 0, controllers: 0 };

/**
 * Pose `@Get(path)` sur une méthode du prototype, comme le ferait un décorateur
 * de méthode compilé.
 *
 * @param proto - prototype du contrôleur
 * @param key - nom de la méthode
 * @param path - chemin de la route
 * @param withId - pose aussi `@Param("id")` sur le 1er argument
 */
function route(proto, key, path, withId) {
  if (withId) Param("id")(proto, key, 0);
  const desc = Object.getOwnPropertyDescriptor(proto, key);
  const out = Get(path)(proto, key, desc) ?? desc;
  Object.defineProperty(proto, key, out);
}

/**
 * Construit le module applicatif : un contrôleur, 186 routes dans l'ordre de
 * l'app Nodefony de dev.
 *
 * @param requestScope - injecte un service `Scope.REQUEST` dans le contrôleur,
 *   qui devient alors lui-même recréé à chaque requête (volet 3 de #489)
 * @returns la classe du module racine
 */
export function buildModule(requestScope = false) {
  class RequestService {
    constructor() {
      this.createdAt = 0;
      counters.services++;
    }
  }
  Injectable({ scope: Scope.REQUEST })(RequestService);

  class BenchController {
    constructor(svc) {
      this.svc = svc;
      counters.controllers++;
    }
  }
  const proto = BenchController.prototype;
  const { before, after } = dummyRoutes();
  let n = 0;
  const addDummy = (p) => {
    const key = `d${n++}`;
    proto[key] = function (id) {
      return { id };
    };
    route(proto, key, p, true);
  };
  for (const p of before) addDummy(p);
  proto.state = requestScope
    ? function () {
        // Le service est LU : un service injecté mais jamais touché laisserait
        // un optimiseur le traiter comme mort, et on ne mesurerait plus rien.
        this.svc.createdAt++;
        return state;
      }
    : function () {
        return state;
      };
  route(proto, "state", BENCH_PATH, false);
  for (const p of after) addDummy(p);

  if (requestScope) Inject(RequestService)(BenchController, undefined, 0);
  Controller()(BenchController);

  class AppModule {}
  Module({
    controllers: [BenchController],
    providers: requestScope ? [RequestService] : [],
  })(AppModule);
  return AppModule;
}

/**
 * Démarre l'application sur `PORT`, journal coupé.
 *
 * @param adapter - adaptateur HTTP (`undefined` = Express, le défaut de Nest)
 * @param label - nom du camp, affiché au démarrage
 * @param requestScope - voir {@link buildModule}
 * @param setup - réglages de l'application AVANT l'écoute (plugins, hooks)
 */
export async function start(adapter, label, requestScope = false, setup) {
  const app = adapter
    ? await NestFactory.create(buildModule(requestScope), adapter, {
        logger: false,
      })
    : await NestFactory.create(buildModule(requestScope), { logger: false });
  if (setup) await setup(app);
  const port = Number(process.env.PORT ?? 5164);
  await app.listen(port, "127.0.0.1");
  console.log(`${label} :${port}`);
  process.on("SIGINT", () => process.exit(0));
}
