/// <reference types="node" />
import { expect } from "chai";
import "reflect-metadata";
import { RequestContext } from "nodefony";
import {
  computeActionMeta,
  IsGranted,
  Anonymous,
  CurrentUser,
  resolveParamArg,
  type ParamMeta,
  type IParamArgContext,
} from "../../decorators/routerDecorators.js";

// P6 J7 — autorisation déclarative. On teste la PRODUCTION de métadonnées figées
// (computeActionMeta.security) + l'injection @CurrentUser, sans pipeline (mêmes
// décorateurs que le runtime). L'enforcement (decide/403) est testé via le Resolver.

describe("@IsGranted — descripteur figé (méthode)", () => {
  class Ctrl {
    @IsGranted("ROLE_ADMIN")
    single() {}

    @IsGranted(["ROLE_ADMIN", "ROLE_AUDITOR"])
    orArray() {}

    @IsGranted("ROLE_ADMIN")
    @IsGranted("PERM_billing")
    stacked() {}

    @IsGranted("doc.edit", { subject: "id" })
    withSubject() {}

    plain() {}
  }

  it("attribut unique → 1 clause, anyOf=[attr]", () => {
    const sec = computeActionMeta(Ctrl, "single").security!;
    expect(sec.clauses).to.have.lengthOf(1);
    expect(sec.clauses[0]!.anyOf).to.deep.equal(["ROLE_ADMIN"]);
    expect(sec.clauses[0]!.subjectParam).to.equal(undefined);
  });

  it("tableau → OR (1 clause, plusieurs attributs)", () => {
    const sec = computeActionMeta(Ctrl, "orArray").security!;
    expect(sec.clauses).to.have.lengthOf(1);
    expect(sec.clauses[0]!.anyOf).to.deep.equal(["ROLE_ADMIN", "ROLE_AUDITOR"]);
  });

  it("empilés → AND (2 clauses)", () => {
    const sec = computeActionMeta(Ctrl, "stacked").security!;
    expect(sec.clauses).to.have.lengthOf(2);
    const attrs = sec.clauses.map((c) => c.anyOf[0]);
    expect(attrs).to.include.members(["ROLE_ADMIN", "PERM_billing"]);
  });

  it("subject → subjectParam capturé", () => {
    const sec = computeActionMeta(Ctrl, "withSubject").security!;
    expect(sec.clauses[0]!.subjectParam).to.equal("id");
    expect(sec.clauses[0]!.anyOf).to.deep.equal(["doc.edit"]);
  });

  it("action non décorée → security null (0 coût hot path)", () => {
    expect(computeActionMeta(Ctrl, "plain").security).to.equal(null);
  });

  it("descripteur gelé (objet partagé entre requêtes, jamais muté)", () => {
    const sec = computeActionMeta(Ctrl, "single").security!;
    expect(Object.isFrozen(sec)).to.equal(true);
    expect(Object.isFrozen(sec.clauses)).to.equal(true);
  });
});

describe("@IsGranted / @Anonymous — fusion classe + méthode", () => {
  @IsGranted("ROLE_USER")
  class GuardedCtrl {
    @IsGranted("ROLE_ADMIN")
    adminAction() {}

    inherited() {}

    @Anonymous()
    publicAction() {}
  }

  it("classe + méthode → AND (2 clauses)", () => {
    const sec = computeActionMeta(GuardedCtrl, "adminAction").security!;
    expect(sec.clauses).to.have.lengthOf(2);
    const attrs = sec.clauses.map((c) => c.anyOf[0]);
    expect(attrs).to.include.members(["ROLE_USER", "ROLE_ADMIN"]);
  });

  it("méthode nue hérite la garde de classe", () => {
    const sec = computeActionMeta(GuardedCtrl, "inherited").security!;
    expect(sec.clauses).to.have.lengthOf(1);
    expect(sec.clauses[0]!.anyOf).to.deep.equal(["ROLE_USER"]);
  });

  it("@Anonymous (méthode) override la garde de classe → security null", () => {
    expect(computeActionMeta(GuardedCtrl, "publicAction").security).to.equal(
      null,
    );
  });
});

describe("@CurrentUser — injection de l'utilisateur ALS", () => {
  class Ctrl {
    me(@CurrentUser() _user?: unknown) {}
  }

  it("pose un ParamMeta source 'user'", () => {
    const meta = computeActionMeta(Ctrl, "me");
    expect(meta.paramsMeta).to.have.lengthOf(1);
    expect(meta.paramsMeta?.[0]!.source).to.equal("user");
  });

  it("resolveParamArg('user') renvoie l'utilisateur de l'ALS", () => {
    const user = { identifier: "alice" };
    const pm: ParamMeta = { source: "user", index: 0 };
    RequestContext.run({ requestId: "t", user }, () => {
      expect(
        resolveParamArg(pm, undefined as unknown as IParamArgContext),
      ).to.equal(user);
    });
  });

  it("resolveParamArg('user') = undefined hors scope authentifié", () => {
    const pm: ParamMeta = { source: "user", index: 0 };
    expect(
      resolveParamArg(pm, undefined as unknown as IParamArgContext),
    ).to.equal(undefined);
  });
});
