/**
 * NestJS 12 — « ÉQUITABLE » : le MÊME travail par requête que Nodefony en
 * production, écrit comme une équipe NestJS l'écrirait pour aller le plus vite
 * possible (#489).
 *
 * Ce que Nodefony fait sur la route de banc — relevé sur un serveur `production`
 * au décor du banc, pas déduit du code :
 *   - une portée AsyncLocalStorage et un `X-Request-Id` (UUID) par requête ;
 *   - un `traceparent` ÉMIS en réponse : trace du client prolongée d'un span
 *     neuf, ou trace neuve (W3C Trace Context) ;
 *   - une CSP dont le nonce est tiré À CHAQUE requête, plus nosniff, DENY,
 *     `no-referrer`, COOP et CORP `same-origin`, `Permissions-Policy`, `Server` ;
 *   - CORS par liste blanche : aucun en-tête pour une origine inconnue ;
 *   - le contrôle CSRF (Fetch Metadata, repli Origin) et le matching des zones
 *     du pare-feu, fail-closed ;
 *   - AUCUN ETag (pas de hachage du corps).
 *
 * Les choix de performance, pris dans la doc NestJS (`http/performance.md`,
 * `fundamentals/provider-scopes.md`) :
 *   - adaptateur Fastify — « nearly twice the benchmark results » d'Express ;
 *   - providers singletons (le défaut, « recommended ») et contexte de requête
 *     par AsyncLocalStorage plutôt que `Scope.REQUEST` ;
 *   - le travail par requête dans UN hook `onRequest` natif de Fastify : un
 *     middleware Nest passerait par la couche `@fastify/middie` en plus ;
 *   - en-têtes statiques par `@fastify/helmet`, réglé pour émettre EXACTEMENT
 *     l'ensemble de Nodefony (ses défauts ajoutent HSTS, X-XSS-Protection…) ;
 *   - CORS par `app.enableCors()` (`@fastify/cors`, dépendance de l'adaptateur) ;
 *   - nonce et identifiants de trace tirés d'un pool CSPRNG amorti — la
 *     technique de Nodefony, et celle de `randomUUID` : même garantie, moins
 *     d'appels système. Ne pas l'offrir au camp témoin le ferait perdre sur
 *     un détail d'implémentation, pas sur le framework.
 * Le travail lui-même vit dans `fair-common.mjs`, partagé avec `express-fair`.
 *
 * Ce qui n'est PAS ajouté, pour la même raison que dans `express-fair.mjs` :
 * session (paresseuse), audit (coupé avec le journal), profiler (dev-only).
 *
 * Usage : NODE_ENV=production PORT=5164 node nest-fair.mjs
 */
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { installNestFair } from "./fair-nest.mjs";
import { start } from "./nest-app.mjs";

const port = Number(process.env.PORT ?? 5164);

start(new FastifyAdapter({ logger: false }), "nest-fair", false, (app) =>
  installNestFair(app, port),
).catch((/** @type {unknown} */ e) => {
  console.error(e);
  process.exit(1);
});
