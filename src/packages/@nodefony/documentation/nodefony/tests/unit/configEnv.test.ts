import { describe, it, expect, afterEach, vi } from "vitest";
import { defineDocumentationConfig } from "../../config/defineModuleConfig";

// Toute variable lue par Nodefony porte le préfixe `NF_` : le nom nu
// (`DOCS_REPO_URL`) n'est plus lu — sans alias, une collision avec
// l'environnement d'une application ne se manifesterait par aucune erreur.
describe("defineDocumentationConfig — surcharge par l'environnement", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("NF_DOCS_REPO_URL et NF_DOCS_REPO_BRANCH écrasent repo.url et repo.branch", () => {
    vi.stubEnv("NF_DOCS_REPO_URL", "https://example.test/repo");
    vi.stubEnv("NF_DOCS_REPO_BRANCH", "release");
    const config = defineDocumentationConfig({});
    expect(config.repo.url).toBe("https://example.test/repo");
    expect(config.repo.branch).toBe("release");
  });

  it("le nom sans préfixe n'est plus lu", () => {
    vi.stubEnv("NF_DOCS_REPO_URL", "");
    vi.stubEnv("NF_DOCS_REPO_BRANCH", "");
    vi.stubEnv("DOCS_REPO_URL", "https://example.test/ignored");
    vi.stubEnv("DOCS_REPO_BRANCH", "ignored");
    const config = defineDocumentationConfig({});
    expect(config.repo.url).not.toBe("https://example.test/ignored");
    expect(config.repo.branch).not.toBe("ignored");
  });
});
