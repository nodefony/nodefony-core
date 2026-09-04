import { inspect } from "node:util";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import type Certificate from "../service/certificates";

const options: OptionsCommandInterface = {
  helpGroup: "FRONT ET RÉSEAU",
  showBanner: false,
  // `onBoot` : modules chargés + config résolue + `kernel.domain` défini. Avec
  // `lifetime: "oneshot"` (défaut), le Kernel termine à `onBoot` → cette commande
  // NE démarre PAS les serveurs (génération de cert pure).
  kernelEvent: "onBoot",
};

/**
 * Commande CLI `certificates` — (re)génère et inspecte le certificat TLS de
 * DÉVELOPPEMENT. La génération reste un confort de dev : en production, fournir
 * un vrai certificat (`certificates.strategy: "explicit"`).
 *
 * Réutilise le service `certificates` du module `@nodefony/http` (source unique)
 * → la commande, le boot auto et un futur endpoint Studio appellent le même code.
 */
class Certificates extends Command {
  constructor(cli: CliKernel) {
    super(
      "http:certificates",
      "engendre ou inspecte le certificat TLS de dev",
      cli,
      options,
    );
    this.addOption(
      "-f, --force",
      "regenerate even if a valid certificate already exists",
    );
    this.addOption("-j, --json", "output the certificate summary as JSON");
  }

  override async generate(opts: {
    force?: boolean;
    json?: boolean;
  }): Promise<this> {
    const module = this.kernel?.getModules()?.["http"];
    const service = module?.get<Certificate>("certificates") ?? null;
    if (!service) {
      this.log(
        "Service 'certificates' introuvable (module @nodefony/http non chargé).",
        "ERROR",
      );
      return this;
    }
    await service.loadForge();
    await service.generateServerCertificates(Boolean(opts.force));
    const info = await service.describe();
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(info, undefined, 2)}\n`);
    } else {
      process.stdout.write(
        `${inspect(info, { colors: process.stdout.isTTY, depth: 4 })}\n`,
      );
      // Astuce : requête TLS VÉRIFIÉE (sans désactiver le contrôle). Avec mkcert,
      // la CA est dans le trust store → 0 flag ; sinon pointer la CA générée.
      if (info.caPath) {
        process.stdout.write(
          "\nRequête vérifiée (NE PAS utiliser -k / rejectUnauthorized:false) :\n" +
            `  curl --cacert ${info.caPath} https://localhost:5152/\n` +
            `  NODE_EXTRA_CA_CERTS=${info.caPath} node mon-script.mjs\n`,
        );
      } else {
        process.stdout.write(
          "\nCA dans le trust store système (mkcert) → requête vérifiée sans flag :\n" +
            "  curl https://localhost:5152/\n",
        );
      }
    }
    return this;
  }
}

export default Certificates;
