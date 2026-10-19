import { describe, expect, it } from "vitest";
import { replayedTasks } from "./turbo-replay.mjs";

// Lignes RÉELLES d'une passe `test:all` (#472), couleurs comprises.
const OUTPUT = [
  "\x1b[0;33mnodefony:build: \x1b[0mcache hit, replaying logs 1a2b3c4d5e6f7a8b",
  "\x1b[0;36mnodefony:test: \x1b[0mcache hit, replaying logs 409131156f18d7db",
  "@nodefony/http:test: cache hit, replaying logs 9f5e8be44b56d831",
  "@nodefony/http:test:integration: cache bypass, force executing 0123456789abcdef",
  "@nodefony/drizzle:test: cache miss, executing 5d1c0a2b3e4f5a6b",
  "nodefony:test: cache hit, replaying logs 409131156f18d7db",
].join("\n");

describe("replayedTasks — quelles suites turbo a-t-il rejouées sans les lancer ?", () => {
  it("🔴 nomme les tâches `test` rejouées, couleurs ôtées, sans doublon", () => {
    expect(replayedTasks(OUTPUT, "test")).toEqual([
      "nodefony",
      "@nodefony/http",
    ]);
  });

  it("une tâche exécutée (cache miss, bypass) n'est pas comptée", () => {
    expect(replayedTasks(OUTPUT, "test")).not.toContain("@nodefony/drizzle");
    expect(replayedTasks(OUTPUT, "test:integration")).toEqual([]);
  });

  it("une tâche à deux-points (`test:integration`) se lit entière", () => {
    const line =
      "@nodefony/http:test:integration: cache hit, replaying logs ab";
    expect(replayedTasks(line, "test:integration")).toEqual(["@nodefony/http"]);
    expect(replayedTasks(line, "test")).toEqual([]);
  });

  it("le rejeu des `build` dont la suite dépend ne compte pas pour elle", () => {
    expect(replayedTasks(OUTPUT, "build")).toEqual(["nodefony"]);
    expect(
      replayedTasks("nodefony:build: cache hit, replaying logs ab", "test"),
    ).toEqual([]);
  });
});
