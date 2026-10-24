import type { IAdminApi, IAdminEndpoint, IAdminDescriptor } from "nodefony";
import type { Profiler } from "../src/profiler/Profiler";
import { aggregateProfiles } from "../src/profiler/aggregate";

/**
 * Producteur `IAdminApi` du **profiler** — exposé sous `/nodefony/profiler/api/*`.
 *
 * Namespace dédié (≠ replié dans `http`) car le profiling par requête est un
 * concern transverse : timing par phase, route, user, futur SQL/audit. Il a sa
 * propre entrée Studio et n'est monté qu'en **dev** (le module n'instancie le
 * {@link Profiler} qu'hors prod).
 *
 * Endpoints :
 *  - `GET /nodefony/profiler/api/recent`  → derniers profils (résumés, récent → ancien)
 *    `?connection=<requestId>` : les seules frames de cette socket WebSocket
 *  - `GET /nodefony/profiler/api/summary` → les profils de l'anneau agrégés par
 *    route (percentiles, phases, formes SQL, N+1, erreurs — `aggregateProfiles`)
 *  - `GET /nodefony/profiler/api/{id}`    → profil complet (phases) d'un requestId
 *  - `DELETE /nodefony/profiler/api/recent` → vide le ring buffer
 *
 * La debug bar (toute page, dev) lit `X-Request-Id` de SON appel AJAX puis
 * fetch `/{id}` — corrélation client↔serveur gratuite.
 *
 * @param profiler - l'instance partagée du ring buffer (même que le hook kernel).
 * @returns le contrat admin du profiler, prêt à `registry.register()`.
 */
export function createProfilerAdminApi(profiler: Profiler): IAdminApi {
  const descriptor: IAdminDescriptor = {
    label: "Profiler",
    icon: "bug",
    order: 9,
  };

  const endpoints: IAdminEndpoint[] = [
    {
      path: "recent",
      summary: "Recent request profiles (summaries, newest first)",
      handler: ({ query }) => {
        const raw = query.limit;
        const n = typeof raw === "string" ? parseInt(raw, 10) : NaN;
        const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 60;
        // `connection` : les seules frames de CETTE socket, cherchées sur tout
        // l'anneau — filtrer côté client les 200 derniers profils transférait
        // tout pour en garder quelques-uns, et ratait les plus anciens.
        const of = query.connection;
        const connection =
          typeof of === "string" && of.length > 0 && of.length <= 200
            ? of
            : undefined;
        return {
          count: profiler.size,
          entries: profiler.recent(limit, connection),
        };
      },
    },
    {
      path: "recent",
      method: "DELETE",
      summary: "Clear the profiler ring buffer",
      handler: () => {
        profiler.clear();
        return { cleared: true };
      },
    },
    {
      path: "summary",
      summary: "Profiles aggregated by route: percentiles, SQL, N+1, errors",
      // Calculé à la demande sur l'anneau entier — jamais par requête servie.
      // Même règle que l'outil `nodefony_profile_route` : un seul calcul.
      handler: () => aggregateProfiles(profiler.since(0).entries),
    },
    {
      path: "{id}",
      summary: "Full profile (phase timeline) for a requestId",
      handler: ({ params }) => {
        const { id = "" } = params;
        const entry = profiler.get(id);
        if (!entry) {
          return {
            status: 404,
            body: { error: "Profile not found", requestId: params.id },
          };
        }
        return entry;
      },
    },
  ];

  return {
    adminNamespace: "profiler",
    adminDescriptor: () => descriptor,
    adminEndpoints: () => endpoints,
  };
}

export default createProfilerAdminApi;
