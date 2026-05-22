import Command, { OptionsCommandInterface } from "../../command/Command";
import CliKernel from "../CliKernel";
import Kernel from "../Kernel";
import DevSupervisor from "../../service/dev/DevSupervisor";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onPostReady",
};

/** Variable d'env distinguant le serveur enfant du process superviseur parent. */
const CHILD_ENV = "NODEFONY_DEV_CHILD";

class Dev extends Command {
  constructor(cli: CliKernel) {
    super(
      "development",
      "Start Server in development Mode",
      cli as CliKernel,
      options,
    );
    this.alias("dev");
  }

  override async onKernelStart(): Promise<void> {
    this.cli.environment = "development";
    process.env.MODE_START = "development";

    // Enfant supervisé → boot serveur normal (HTTP/WS).
    if (process.env[CHILD_ENV] === "1") {
      (this.cli as CliKernel).setType("SERVER");
      return;
    }

    // Parent → superviseur auto-restart. Il NE boote PAS le kernel applicatif
    // (type reste CONSOLE → aucun serveur dans le parent, pas de collision de
    // port) : le serveur vit dans le process enfant, redémarré à chaque
    // changement backend. Le HMR frontend (Vite) est préservé (frontend/ exclu).
    const supervisor = new DevSupervisor({
      cwd: process.cwd(),
      childEnvKey: CHILD_ENV,
    });
    await supervisor.start();
    // Parke le flow CLI : le superviseur gère désormais le cycle de vie + Ctrl+C.
    await new Promise<void>(() => {});
  }

  override async generate(/*options: any*/): Promise<Kernel> {
    try {
      return this.cli?.kernel as Kernel;
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
  }
}

export default Dev;
