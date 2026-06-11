/**
 * Payload identique à AlsController.state (la route de bench Nodefony
 * /nodefony/test/als-test/state) — pour comparer à conditions égales.
 */
export const state = {
  byContext: {},
  lastHookRequestId: null,
  hookUser: null,
  lateHookRequestId: null,
  wsHookRequestId: null,
  wsHookHandshakeId: null,
  wsHookFireCount: 0,
  hookCount: 0,
};

/**
 * Mêmes conditions de routing que l'app Nodefony de dev : 186 routes,
 * route de bench en position #31 (cf project_request_cycle_perf_plan_kit).
 * before = 30 routes paramétrées AVANT, after = 155 APRÈS.
 */
export const BENCH_PATH = "/nodefony/test/als-test/state";
export function dummyRoutes() {
  const before = [];
  const after = [];
  for (let i = 0; i < 30; i++) before.push(`/nodefony/test/dummy-a${i}/:id`);
  for (let i = 0; i < 155; i++) after.push(`/nodefony/test/dummy-b${i}/:id`);
  return { before, after };
}
