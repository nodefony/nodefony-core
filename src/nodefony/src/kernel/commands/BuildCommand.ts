import { spawn } from "node:child_process";
import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";

const options: OptionsCommandInterface = {
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
      "build Framework (turbo + rollup)",
      cli as CliKernel,
      options,
    );
    this.alias("compile");
  }

  override async generate(/*options: any*/): Promise<this> {
    this.log("build : npx turbo run build", "INFO");
    const code = await new Promise<number>((res) => {
      const p = spawn("npx", ["turbo", "run", "build"], {
        cwd: process.cwd(),
        stdio: "inherit",
        shell: process.platform === "win32",
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
