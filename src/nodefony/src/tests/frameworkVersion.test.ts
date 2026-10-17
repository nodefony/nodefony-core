/**
 * `Kernel.frameworkVersion()` : la version de NODEFONY, jamais celle de
 * l'application — la ligne de commande porte celle de l'app dès son
 * chargement (`setCommandVersion`), et le bandeau du bilan la recopiait.
 * Éprouvé sur un VRAI noyau (la méthode délègue à son lien superviseur) dont la
 * CLI attachée annonce la version de l'application.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Kernel from "../kernel/Kernel";
import CliKernel from "../kernel/CliKernel";
import { Nodefony } from "../Nodefony";
import pkg from "../../package.json" with { type: "json" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Kernel.frameworkVersion", () => {
  it("rend la version du paquet nodefony, même quand la ligne de commande porte celle de l'application", () => {
    const cli = new CliKernel("development");
    const commander = cli.commander;
    expect(commander).not.to.equal(null);
    if (!commander) return;
    vi.spyOn(commander, "version").mockImplementation(() => "0.1.0");
    expect(commander.version()).to.equal(
      "0.1.0",
      "décor : la CLI annonce l'app",
    );
    const kernel = new Kernel("development", cli, { log: { active: false } });
    expect(kernel.frameworkVersion()).to.equal(pkg.version);
    expect(Nodefony.version).to.equal(pkg.version);
  });
});
