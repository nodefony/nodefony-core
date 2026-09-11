import { describe, it, expect } from "vitest";
import { identityHint } from "../runtime/identityHint";
import type { IKernel } from "../types/IKernel";

/**
 * Ce que cette suite garde : un refus d'autorisation dit le GESTE, et il ne le
 * dit qu'en développement.
 *
 * Les deux moitiés comptent autant l'une que l'autre. Sans le geste, celui qui
 * vient d'écrire une route gardée n'a aucun moyen de l'essayer — mesuré,
 * 33 minutes sur 89 dans un essai réel. Avec le geste en production, la même
 * phrase renseigne l'attaquant : c'est exactement l'oracle que les motifs de
 * refus s'interdisent d'être.
 */
const faux = (
  environment: string | undefined,
  modules: Record<string, unknown> = {},
): IKernel => ({ environment, modules }) as unknown as IKernel;

describe("identityHint — le geste qui donne une identité", () => {
  it("production : rien, jamais", () => {
    expect(identityHint(faux("production", { security: {} }))).to.equal(null);
  });

  it("mode inconnu ou kernel absent : rien — une absence vaut production", () => {
    expect(identityHint(faux(undefined))).to.equal(null);
    expect(identityHint(null)).to.equal(null);
    expect(identityHint(undefined)).to.equal(null);
  });

  it("développement AVEC module d'identité : la commande qui crée un compte", () => {
    const hint = identityHint(faux("development", { security: {}, http: {} }));
    expect(hint).to.be.a("string");
    expect(hint).to.contain("security:user:add");
    // Créer le compte ne suffit pas : il faut savoir l'échanger contre une
    // session, sinon la route gardée reste intestable.
    expect(hint).to.contain("/nodefony/security/api/auth/login");
  });

  it("développement SANS module d'identité : ne prescrit pas une commande absente", () => {
    const hint = identityHint(faux("development", { http: {}, framework: {} }));
    expect(hint).to.be.a("string");
    // Prescrire `security:user:add` à une app qui n'a pas le module enverrait
    // droit sur un « command not found » — le refus dirait alors un geste faux,
    // ce qui est pire que pas de geste du tout.
    expect(hint).to.not.contain("security:user:add");
    expect(hint).to.contain("@nodefony/security");
  });
});
