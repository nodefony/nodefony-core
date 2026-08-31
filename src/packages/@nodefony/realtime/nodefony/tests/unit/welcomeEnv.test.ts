/**
 * Unit — le mode d'exécution n'est annoncé qu'HORS production (#136).
 *
 * La règle tient en une ligne dans la composition du `realtime:welcome`, et
 * c'est précisément pourquoi elle est isolée ici : une ligne noyée dans un
 * handshake ne se voit pas en revue, et son inversion ne casserait aucun test —
 * elle se contenterait d'annoncer le mode d'un serveur publié à tous ses
 * visiteurs.
 */
import { describe, it, expect } from "vitest";
import { welcomeEnv } from "../../src/server/welcomeEnv";

describe("realtime:welcome — le mode d'exécution", () => {
  it("est annoncé en développement : le client peut alors parler dans la console", () => {
    expect(welcomeEnv("development")).toEqual({ env: "development" });
  });

  it("est annoncé pour tout mode qui n'est pas la production (staging, banc)", () => {
    // Un mode intermédiaire est un mode de travail : on veut y voir la console
    // parler, sinon la propagation ne servirait qu'au poste du développeur.
    expect(welcomeEnv("staging")).toEqual({ env: "staging" });
  });

  it("est ABSENT en production — une permission ne s'accorde pas par défaut", () => {
    expect(welcomeEnv("production")).toEqual({});
  });

  it("est ABSENT quand le mode est inconnu — l'absence vaut production", () => {
    // Un kernel non résolu ne doit pas ouvrir la parole par accident : c'est la
    // même règle que côté client pour `import.meta.env.DEV`, et pour la même
    // raison — se taire à tort ne coûte qu'une ligne, parler à tort expose.
    expect(welcomeEnv(undefined)).toEqual({});
    expect(welcomeEnv(null)).toEqual({});
    expect(welcomeEnv("")).toEqual({});
  });
});
