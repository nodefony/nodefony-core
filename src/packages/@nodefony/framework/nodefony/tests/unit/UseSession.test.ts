/// <reference types="node" />
import { expect } from "chai";
import "reflect-metadata";
import {
  UseSession,
  Session,
  resolveSessionIntent,
} from "../../decorators/routerDecorators.js";
import type { ControllerConstructor } from "../../src/Route.js";

// Les classes ci-dessous ne sont jamais instanciées — `resolveSessionIntent`
// lit uniquement les métadonnées Reflect posées par les décorateurs (ctor +
// nom d'action), donc des classes nues suffisent.
const asCtor = (c: unknown): ControllerConstructor =>
  c as unknown as ControllerConstructor;

// ─── @UseSession classe ───────────────────────────────────────────────────────

@UseSession({ context: "area-class" })
class ClassIntent {
  plain(): void {}
}

// ─── @UseSession méthode ──────────────────────────────────────────────────────

class MethodIntent {
  @UseSession({ readOnly: true })
  ro(): void {}
  plain(): void {}
}

// ─── précédence classe + méthode ──────────────────────────────────────────────

@UseSession({ context: "cls", readOnly: false })
class MergeIntent {
  @UseSession({ readOnly: true })
  merge(): void {}
  inherited(): void {}
}

@UseSession({ context: "cls" })
class OverrideIntent {
  @UseSession({ context: "mth" })
  ov(): void {}
}

// ─── intent implicite via paramètre @Session ──────────────────────────────────

class ParamIntent {
  withParam(_s: unknown): void {}
  withKey(_v: unknown): void {}
  plain(): void {}
}
// Décorateurs de paramètre appliqués hors corps de classe (équivalent au @Session
// inline) pour rester lisibles.
Session()(ParamIntent.prototype, "withParam", 0);
Session("k")(ParamIntent.prototype, "withKey", 0);

// ─── aucun intent ─────────────────────────────────────────────────────────────

class NoIntent {
  plain(): void {}
}

describe("@UseSession / resolveSessionIntent", () => {
  it("classe : applique l'intent à toutes les actions", () => {
    expect(resolveSessionIntent(asCtor(ClassIntent), "plain")).to.deep.equal({
      context: "area-class",
    });
  });

  it("méthode : intent ciblé sur l'action décorée seulement", () => {
    expect(resolveSessionIntent(asCtor(MethodIntent), "ro")).to.deep.equal({
      readOnly: true,
    });
    expect(resolveSessionIntent(asCtor(MethodIntent), "plain")).to.equal(null);
  });

  it("précédence : la méthode complète et écrase la classe", () => {
    // classe {context:"cls", readOnly:false} ⊕ méthode {readOnly:true}
    expect(resolveSessionIntent(asCtor(MergeIntent), "merge")).to.deep.equal({
      context: "cls",
      readOnly: true,
    });
    // action non décorée → hérite de la classe
    expect(
      resolveSessionIntent(asCtor(MergeIntent), "inherited"),
    ).to.deep.equal({ context: "cls", readOnly: false });
  });

  it("précédence : la méthode écrase une même clé de la classe", () => {
    expect(resolveSessionIntent(asCtor(OverrideIntent), "ov")).to.deep.equal({
      context: "mth",
    });
  });

  it("intent implicite : un paramètre @Session suffit", () => {
    expect(
      resolveSessionIntent(asCtor(ParamIntent), "withParam"),
    ).to.deep.equal({});
    expect(resolveSessionIntent(asCtor(ParamIntent), "withKey")).to.deep.equal(
      {},
    );
  });

  it("aucune déclaration → null (lazy : 0 session)", () => {
    expect(resolveSessionIntent(asCtor(ParamIntent), "plain")).to.equal(null);
    expect(resolveSessionIntent(asCtor(NoIntent), "plain")).to.equal(null);
  });

  it("porte eager (seam P6)", () => {
    @UseSession({ eager: true })
    class EagerIntent {
      a(): void {}
    }
    expect(resolveSessionIntent(asCtor(EagerIntent), "a")).to.deep.equal({
      eager: true,
    });
  });
});
