import { describe, it, expect, afterEach, vi } from "vitest";
import { applyEnvShortcuts, collectEnvShortcuts } from "nodefony";
import { defineDocumentationConfig } from "../../config/defineModuleConfig";
import { configJsonSchema } from "../../config/configSchema";

/** Pose les variables comme le Kernel les pose, puis valide. */
function posees(
  app: Record<string, unknown>,
  env: Record<string, string>,
): ReturnType<typeof defineDocumentationConfig> {
  applyEnvShortcuts(app, configJsonSchema(), env);
  return defineDocumentationConfig(app);
}

describe("@nodefony/documentation — noms courts d'environnement (ADR-0016)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sont DÉCLARÉS dans le schéma, sur le champ qu'ils règlent", () => {
    const found = collectEnvShortcuts(configJsonSchema());
    expect(
      Object.fromEntries(found.map((s) => [s.env, s.path.join(".")])),
    ).toEqual({
      NF_DOCS_REPO_URL: "repo.url",
      NF_DOCS_REPO_BRANCH: "repo.branch",
    });
    expect(found.some((s) => s.secret)).toBe(false);
  });

  it("NF_DOCS_REPO_URL et NF_DOCS_REPO_BRANCH l'emportent sur la config de l'application", () => {
    const config = posees(
      { repo: { url: "https://example.test/fichier", branch: "main" } },
      {
        NF_DOCS_REPO_URL: "https://example.test/repo",
        NF_DOCS_REPO_BRANCH: "release",
      },
    );
    expect(config.repo.url).toBe("https://example.test/repo");
    expect(config.repo.branch).toBe("release");
  });

  it("le builder ne les lit PLUS lui-même — le Kernel les pose", () => {
    vi.stubEnv("NF_DOCS_REPO_URL", "https://example.test/repo");
    vi.stubEnv("NF_DOCS_REPO_BRANCH", "release");
    const config = defineDocumentationConfig({});
    expect(config.repo.url).toBe("https://github.com/nodefony/nodefony-core");
    expect(config.repo.branch).toBeUndefined();
  });

  it("une variable vide vaut absente", () => {
    const config = posees(
      {},
      { NF_DOCS_REPO_URL: "", NF_DOCS_REPO_BRANCH: "" },
    );
    expect(config.repo.url).toBe("https://github.com/nodefony/nodefony-core");
    expect(config.repo.branch).toBeUndefined();
  });

  it("le nom sans préfixe n'est pas lu", () => {
    // Toute variable lue par Nodefony porte le préfixe `NF_` : sans alias, une
    // collision avec l'environnement d'une application ne se manifesterait
    // par aucune erreur.
    const config = posees(
      {},
      {
        DOCS_REPO_URL: "https://example.test/ignored",
        DOCS_REPO_BRANCH: "ignored",
      },
    );
    expect(config.repo.url).not.toBe("https://example.test/ignored");
    expect(config.repo.branch).not.toBe("ignored");
  });
});
