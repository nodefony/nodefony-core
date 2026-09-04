import { spawn } from "node:child_process";
import { besoinDeShell } from "../../cli/execPortable";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";

const options: OptionsCommandInterface = {
  helpGroup: "GÉNÉRER ET CONSTRUIRE",
  showBanner: false,
  kernelEvent: "onRegister",
};

/**
 * Commande `nodefony build` (alias `compile`) — délègue à la **toolchain CLI**
 * (`turbo run build` → chaque `rollup.config.ts` de workspace), source UNIQUE du
 * build. Ne build PLUS via un service rollup embarqué dans le process (retiré
 * 2026-06-02 : doublon de config + import de la toolchain à chaque boot serveur).
 */
class Build extends Command {
  constructor(cli: CliKernel) {
    super(
      "build",
      "compile les modules puis l'application vers dist/",
      cli as CliKernel,
      options,
    );
    this.alias("compile");
    this.addOption(
      "-f, --force",
      "Ignore le cache turbo et reconstruit tout (--force)",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async generate(...args: any[]): Promise<this> {
    // commander passe l'objet d'options en 1er arg de l'action.
    const force = Boolean((args[0] as { force?: boolean })?.force);
    const turboArgs = ["turbo", "run", "build"];
    if (force) turboArgs.push("--force");
    this.log(`build : npx ${turboArgs.join(" ")}`, "INFO");
    const code = await new Promise<number>((res) => {
      const p = spawn("npx", turboArgs, {
        cwd: process.cwd(),
        stdio: "inherit",
        shell: besoinDeShell("npx"),
      });
      p.once("exit", (c) => res(c ?? 1));
      p.once("error", () => res(1));
    });
    if (code !== 0) {
      this.log(`build échoué (turbo exit ${code})`, "ERROR");
      throw new Error(`turbo build failed (${code})`);
    }
    this.log("build ok", "INFO");
    return this;
  }
}

export default Build;
