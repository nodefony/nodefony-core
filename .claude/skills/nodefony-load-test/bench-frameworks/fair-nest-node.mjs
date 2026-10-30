/**
 * Pose sur une application NestJS (adaptateur `node:http` natif,
 * `@nestjs/platform-node`) le travail par requête de Nodefony
 * (`fair-common.mjs`) — pendant de `fair-nest.mjs`, qui le pose sur Fastify.
 *
 * Tout passe par UN hook natif (`setOnRequestHook`), dans l'ordre où le camp
 * Fastify enchaîne ses hooks `onRequest` : en-têtes statiques (`helmet`), puis
 * CORS, puis le travail par requête. `app.enableCors()` n'est PAS employé : il
 * monte `cors` dans le routeur, donc APRÈS le hook — un refus 401/403 partirait
 * sans en-têtes de sécurité ni CORS, et une pré-vérification OPTIONS atteindrait
 * le pare-feu, là où le camp Fastify y répond avant lui.
 *
 * `helmet` et `cors` sont les paquets d'Express, déjà épinglés pour
 * `express-fair` : écrits sur `node:http` (`setHeader`, `end`), ils servent tels
 * quels un `ServerResponse` nu.
 */
import cors from "cors";
import helmet from "helmet";
import { HELMET_OPTIONS, als, perRequest } from "./fair-common.mjs";

/**
 * @param app - application Nest créée sur `NodeAdapter`, avant l'écoute
 * @param port - port d'écoute, pour la liste blanche CORS
 */
export function installNestFairNode(app, port) {
  const securityHeaders = helmet(HELMET_OPTIONS);
  const corsHeaders = cors({ origin: [`http://127.0.0.1:${port}`] });

  app.getHttpAdapter().setOnRequestHook((req, res, done) => {
    securityHeaders(req, res, () => {
      // Une pré-vérification acceptée se termine dans `cors` (204), sans
      // rappeler la suite — comme `@fastify/cors` côté Fastify.
      corsHeaders(req, res, () => {
        const work = perRequest(req.method, req.url, req.headers);
        for (const name in work.headers)
          res.setHeader(name, work.headers[name]);
        if (work.status) {
          res.statusCode = work.status;
          return res.end();
        }
        als.run(work.store, done);
      });
    });
  });
}
