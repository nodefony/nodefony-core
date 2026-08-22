import type { IAdminApi, IAdminEndpoint, IAdminDescriptor } from "nodefony";
import type { Profiler } from "../src/profiler/Profiler";

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
        return { count: profiler.size, entries: profiler.recent(limit) };
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
      path: "{id}",
      summary: "Full profile (phase timeline) for a requestId",
      handler: ({ params }) => {
        const entry = profiler.get(params.id);
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
