/**
 * NestJS 12 « ÉQUITABLE » + Drizzle **SQLite** — le cas APPLICATIF face à
 * NestJS (#507) : les routes du banc ORM, et un POST dont le corps est VALIDÉ.
 *
 * Même travail par requête que `nest-fair` (`fair-nest.mjs`) et même décor
 * SQLite qu'`express-fair-sqlite` (`orm-sqlite-common.mjs` : base séparée,
 * schéma importé, une seule instance de drizzle, lecture préparée, UPDATE …
 * RETURNING de la ligne lue). Seul le framework change.
 *
 * La validation est celle qu'une équipe NestJS écrit : un DTO décoré par
 * `class-validator`, contrôlé par un `ValidationPipe` réglé pour rendre 422.
 * Le pipe est posé SUR LE PARAMÈTRE de la seule route validée, pas en global :
 * un pipe global passerait sur chacune des 185 routes et coûterait au camp
 * témoin un travail que Nodefony ne fait pas. Les règles et les messages sont
 * ceux de `validateInvoice` (Nodefony et Express) — `fair-parity` les compare.
 *
 * ⚠️ `HttpCode(200)` sur les POST : Nest rend 201 par défaut, Nodefony et
 * Express 200. Laisser 201 ferait échouer la parité sans rien changer au coût.
 *
 * Les décorateurs sont appliqués par appel, comme dans `nest-app.mjs` ; le
 * type du corps (`design:paramtypes`, que `tsc` émettrait) est posé à la main :
 * c'est lui que lit le `ValidationPipe`.
 *
 * Usage : NF_BENCH_SQLITE_DB=/chemin/bench-nest.db NODE_ENV=production PORT=5164 node nest-fair-sqlite.mjs
 */
import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  ValidationPipe,
} from "@nestjs/common";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
} from "class-validator";
import { installNestFair } from "./fair-nest.mjs";
import { start } from "./nest-app.mjs";
import {
  DB_FILE,
  ORM_PATHS,
  readRows,
  readWrite,
} from "./orm-sqlite-common.mjs";
import { dummyRoutes } from "./payload.mjs";

const port = Number(process.env.PORT ?? 5164);

/** `total_ttc ≥ total_ht` — règle croisée, hors du catalogue de `class-validator`. */
class TtcGteHt {
  validate(value, args) {
    const ht = args.object.total_ht;
    return (
      typeof value === "number" &&
      typeof ht === "number" &&
      Number.isFinite(ht) &&
      value >= ht
    );
  }
  defaultMessage() {
    return "total_ttc must be greater than or equal to total_ht";
  }
}
ValidatorConstraint({ name: "ttcGteHt" })(TtcGteHt);

class InvoiceDto {}
const dto = InvoiceDto.prototype;
IsNumber()(dto, "total_ht");
Min(0)(dto, "total_ht");
IsNumber()(dto, "total_ttc");
Validate(TtcGteHt)(dto, "total_ttc");
IsOptional()(dto, "ref");
IsString()(dto, "ref");
MaxLength(30)(dto, "ref");

/**
 * Pose un décorateur de méthode compilé (`@Get`/`@Post`…) et ses décorateurs de
 * paramètre.
 */
function method(proto, key, decorators, params = []) {
  for (const [i, d] of params.entries()) d(proto, key, i);
  let desc = Object.getOwnPropertyDescriptor(proto, key);
  for (const d of decorators) desc = d(proto, key, desc) ?? desc;
  Object.defineProperty(proto, key, desc);
}

class BenchOrmController {}
const proto = BenchOrmController.prototype;
const { before, after } = dummyRoutes();
let n = 0;
const addDummy = (p) => {
  const key = `d${n++}`;
  proto[key] = function (id) {
    return { id };
  };
  method(proto, key, [Get(p)], [Param("id")]);
};
for (const p of before) addDummy(p);

proto.read = function () {
  const rows = readRows();
  return { n: rows.length, rows };
};
method(proto, "read", [Get(ORM_PATHS.read)]);

proto.readLean = function () {
  return { n: readRows().length };
};
method(proto, "readLean", [Get(ORM_PATHS.readLean)]);

proto.readWrite = function () {
  return readWrite(100, 120);
};
method(proto, "readWrite", [Get(ORM_PATHS.readWrite)]);

proto.readWriteBody = function (body) {
  return readWrite(body?.total_ht ?? 100, body?.total_ttc ?? 120);
};
method(
  proto,
  "readWriteBody",
  [Post(ORM_PATHS.readWriteBody), HttpCode(200)],
  [Body()],
);

proto.readWriteValid = function (body) {
  return readWrite(body.total_ht, body.total_ttc);
};
Reflect.defineMetadata(
  "design:paramtypes",
  [InvoiceDto],
  proto,
  "readWriteValid",
);
method(
  proto,
  "readWriteValid",
  [Post(ORM_PATHS.readWriteValid), HttpCode(200)],
  [Body(new ValidationPipe({ errorHttpStatusCode: 422 }))],
);

for (const p of after) addDummy(p);
Controller()(BenchOrmController);

class AppModule {}
Module({ controllers: [BenchOrmController] })(AppModule);

start(
  new FastifyAdapter({ logger: false }),
  `nest-fair-sqlite · base ${DB_FILE}`,
  false,
  (app) => installNestFair(app, port),
  AppModule,
).catch((/** @type {unknown} */ e) => {
  console.error(e);
  process.exit(1);
});
