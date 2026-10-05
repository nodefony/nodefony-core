/**
 * `Kernel.frameworkVersion()` : la version de NODEFONY, jamais celle de
 * l'application — la ligne de commande porte celle de l'app dès son
 * chargement (`setCommandVersion`), et le bandeau du bilan la recopiait.
 */
import { describe, expect, it } from "vitest";
import Kernel from "../kernel/Kernel";
import { Nodefony } from "../Nodefony";
import pkg from "../../package.json" with { type: "json" };

describe("Kernel.frameworkVersion", () => {
  it("rend la version du paquet nodefony, même quand la ligne de commande porte celle de l'application", () => {
    const appCli = { cli: { commander: { version: () => "0.1.0" } } };
    expect(Kernel.prototype.frameworkVersion.call(appCli)).to.equal(
      pkg.version,
    );
    expect(Nodefony.version).to.equal(pkg.version);
  });
});
