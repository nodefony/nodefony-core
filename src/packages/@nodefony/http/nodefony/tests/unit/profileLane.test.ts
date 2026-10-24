/// <reference types="node" />
/**
 * Ce que le profileur mesure : l'application, pas la façon dont on la
 * regarde. L'outillage (console, profileur, journaux, Vite) se reconnaît par
 * la règle du cœur `isConsolePath` — la même que les Journaux, la barre de
 * débogage et le Studio — et ne se profile que sous `timing.tooling`.
 */
import { describe, expect, it } from "vitest";
import { isProfiledUrl, profileLane } from "../../src/profiler/aggregate.js";

describe("profileLane / isProfiledUrl", () => {
  it("🔴 la console, ses données, le profileur et les journaux : de l'outillage", () => {
    for (const path of [
      "/nodefony",
      "/nodefony/supervision",
      "/nodefony/logs/trace/192c78c9",
      "/nodefony/kernel/api/info",
      "/nodefony/profiler/api/recent",
      "/nodefony/syslog/api/logs/search",
      "/nodefony/studio/api/realtime",
    ])
      expect(profileLane(`https://h${path}`), path).toBe("tooling");
  });

  it("🔴 une connexion d'utilisateur et une route d'application restent de l'application", () => {
    expect(profileLane("/nodefony/security/api/auth/login")).toBe("app");
    expect(profileLane("/nodefony/test/index")).toBe("app");
    expect(profileLane("/api/articles")).toBe("app");
  });

  it("un asset relayé par Vite reste un asset", () => {
    expect(profileLane("/_vite/studio/@vite/client")).toBe("asset");
  });

  it("🔴 seule l'application se profile, sauf timing.tooling", () => {
    expect(isProfiledUrl("/api/articles", false)).toBe(true);
    expect(isProfiledUrl("/nodefony/kernel/api/info", false)).toBe(false);
    expect(isProfiledUrl("/_vite/studio/@vite/client", false)).toBe(false);
    expect(isProfiledUrl("/nodefony/kernel/api/info", true)).toBe(true);
  });
});
