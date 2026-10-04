import { describe, it, expect } from "vitest";
import { summarizeFrontendBoot } from "../../service/bootSummary";
import type { IViteSupervisorStatus } from "../../interfaces/IViteSupervisor";

/**
 * Ce que le frontend dit au bilan de démarrage (#533).
 *
 * Vite passe DERRIÈRE Nodefony : son port est interne, on ouvre l'application.
 * L'ancien bilan poussait l'origine de Vite comme « l'URL que le dev ouvre » —
 * le premier lien cliqué menait à côté. Le port reste au détail, nommé interne.
 */
const status = (
  state: IViteSupervisorStatus["state"],
  port: number | null,
  names: string[],
  lastError: string | null = null,
): IViteSupervisorStatus =>
  ({
    state,
    host: "127.0.0.1",
    port,
    origin: port === null ? null : `http://127.0.0.1:${port}`,
    pid: null,
    lastError,
    entries: names.map((entryName) => ({ entryName, type: "react19" })),
    https: false,
    restartCount: 0,
  }) as unknown as IViteSupervisorStatus;

describe("summarizeFrontendBoot", () => {
  it("une ligne par instance, port marqué INTERNE, jamais une URL", () => {
    const s = summarizeFrontendBoot([
      status("ready", 5173, ["react", "studio"]),
      status("ready", 5181, ["vue"]),
    ]);
    expect(s.ready).toBe(2);
    expect(s.lines).toEqual([
      "react, studio · Vite interne :5173",
      "vue · Vite interne :5181",
    ]);
    expect(s.lines.join(" ")).not.toMatch(/https?:\/\//);
    expect(s.notice).toBe(null);
  });

  it("échec total → point BLOQUANT FRONTEND_BUILD_FAILED", () => {
    const s = summarizeFrontendBoot([
      status("errored", null, ["react"], "boom"),
    ]);
    expect(s.ready).toBe(0);
    expect(s.notice?.code).toBe("FRONTEND_BUILD_FAILED");
    expect(s.notice?.level).toBe("error");
    expect(s.lines).toEqual(["react · Vite en échec — boom"]);
  });

  it("échec partiel → FRONTEND_PARTIAL qui nomme les bundles perdus", () => {
    const s = summarizeFrontendBoot([
      status("ready", 5173, ["react"]),
      status("compiling", null, ["angular"]),
    ]);
    expect(s.notice?.code).toBe("FRONTEND_PARTIAL");
    expect(s.notice?.message).toContain("angular");
    // Transitoire : nommé, jamais présenté comme une panne.
    expect(s.lines[1]).toBe("angular · Vite pas prêt (compiling)");
  });

  it("aucun frontend → rien à dire", () => {
    expect(summarizeFrontendBoot([])).toEqual({
      ready: 0,
      lines: [],
      notice: null,
    });
  });
});
