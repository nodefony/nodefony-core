//
// ─── Décorateurs — une sous-classe ne modifie pas son parent (#574) ──────────
//
// `Reflect.getMetadata` remonte la chaîne des prototypes : sur une sous-classe
// (ou une méthode redéfinie), il rend l'objet du PARENT. Un décorateur qui
// l'écrit en place ajoute alors au parent — et à toutes les classes sœurs — les
// routes, en-têtes, paramètres et clauses d'autorisation du fils. Le pire cas :
// une méthode redéfinie avec ses propres paramètres décorés faisait recevoir à
// la méthode PARENTE des arguments qui ne sont pas les siens.
//
// Débrancher : écrire dans l'objet lu au lieu d'une copie, dans `route`,
// `Header`, `IsGranted`, `RequireScope` ou la fabrique des paramètres.
//
import { expect } from "vitest";
import "reflect-metadata";
import {
  route,
  Header,
  IsGranted,
  RequireScope,
  Body,
  Query,
  HEADERS_METADATA,
  getParamArgsMeta,
} from "../../decorators/routerDecorators.js";

// Clés internes, lues telles que les décorateurs les posent.
const ROUTES = "routes:definitions";
const CLAUSES = "nodefony:security:clauses";
const SCOPES = "nodefony:security:scopes";

const own = (key: string, target: object, prop?: string): unknown =>
  prop === undefined
    ? Reflect.getMetadata(key, target)
    : Reflect.getMetadata(key, target, prop);

describe("décorateurs — héritage sans écriture chez le parent (#574)", () => {
  it("@route sur une sous-classe n'ajoute pas ses routes à la base", () => {
    class BaseCtrl {
      @route("base-index", { path: "/" })
      index(): void {}
    }
    class ChildCtrl extends BaseCtrl {
      @route("child-extra", { path: "/extra" })
      extra(): void {}
    }
    class SiblingCtrl extends BaseCtrl {}
    expect(Object.keys(own(ROUTES, BaseCtrl) as object)).to.deep.equal([
      "base-index",
    ]);
    expect(Object.keys(own(ROUTES, SiblingCtrl) as object)).to.deep.equal([
      "base-index",
    ]);
    expect(Object.keys(own(ROUTES, ChildCtrl) as object).sort()).to.deep.equal([
      "base-index",
      "child-extra",
    ]);
  });

  it("@Header sur une méthode redéfinie ne modifie pas la méthode parente", () => {
    class Base {
      @Header("X-Base", "1")
      act(): void {}
    }
    class Child extends Base {
      @Header("X-Child", "2")
      override act(): void {}
    }
    expect(own(HEADERS_METADATA, Base.prototype, "act")).to.deep.equal({
      "X-Base": "1",
    });
    expect(own(HEADERS_METADATA, Child.prototype, "act")).to.deep.equal({
      "X-Base": "1",
      "X-Child": "2",
    });
  });

  it("@IsGranted et @RequireScope d'une sous-classe ne durcissent pas le parent", () => {
    @IsGranted("ROLE_BASE")
    @RequireScope("base:read")
    class Base {
      @IsGranted("ROLE_ACT")
      @RequireScope("act:read")
      act(): void {}
    }
    @IsGranted("ROLE_CHILD")
    @RequireScope("child:read")
    class Child extends Base {
      @IsGranted("ROLE_CHILD_ACT")
      @RequireScope("child:act")
      override act(): void {}
    }
    class Sibling extends Base {}
    for (const target of [Base, Sibling]) {
      expect(own(CLAUSES, target)).to.have.length(1);
      expect(own(SCOPES, target)).to.have.length(1);
    }
    expect(own(CLAUSES, Base.prototype, "act")).to.have.length(1);
    expect(own(SCOPES, Base.prototype, "act")).to.have.length(1);
    // Le fils garde l'exigence du parent ET ajoute la sienne (jamais moins strict).
    expect(own(CLAUSES, Child)).to.have.length(2);
    expect(own(SCOPES, Child)).to.have.length(2);
    expect(own(CLAUSES, Child.prototype, "act")).to.have.length(2);
    expect(own(SCOPES, Child.prototype, "act")).to.have.length(2);
  });

  it("les paramètres d'une méthode redéfinie ne s'ajoutent pas à ceux du parent", () => {
    class Base {
      act(@Query("q") _q: unknown): void {}
    }
    class Child extends Base {
      override act(@Body() _b: unknown): void {}
    }
    class Sibling extends Base {}
    const base = getParamArgsMeta(Base.prototype, "act");
    expect(base?.map((m) => m.source)).to.deep.equal(["query"]);
    expect(
      getParamArgsMeta(Sibling.prototype, "act")?.map((m) => m.source),
    ).to.deep.equal(["query"]);
    // La redéfinition décrit SA signature : ses seuls paramètres, à leur index.
    expect(
      getParamArgsMeta(Child.prototype, "act")?.map((m) => m.source),
    ).to.deep.equal(["body"]);
  });

  it("une méthode redéfinie SANS décorateur garde les paramètres du parent", () => {
    class Base {
      act(@Query("q") _q: unknown): void {}
    }
    class Child extends Base {
      override act(_q: unknown): void {}
    }
    expect(
      getParamArgsMeta(Child.prototype, "act")?.map((m) => m.source),
    ).to.deep.equal(["query"]);
  });
});
