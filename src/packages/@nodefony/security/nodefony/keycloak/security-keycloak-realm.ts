import path from "node:path";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import { KeycloakAdminError } from "./keycloakAdmin.js";
import { KeycloakRealmError } from "./keycloakRealmInput.js";
import type { KeycloakService } from "../service/keycloak.js";

const options: OptionsCommandInterface = {
  helpGroup: "COMPTES ET SECRETS",
  showBanner: false,
  // La config de sécurité FUSIONNÉE (zones apportées par chaque module) est
  // prête à `onReady` ; aucune base n'est lue, donc aucun profil de données.
  kernelEvent: "onReady",
  quietBoot: true,
};

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Codes de sortie (sysexits). */
const EXIT_DIFFERS = 1;
const EXIT_CONFIG = 78;

/**
 * `nodefony security:keycloak:realm` — le realm Keycloak que la configuration
 * de l'application implique.
 *
 * Le realm d'import répète ce que la config dit déjà : identifiant du client,
 * URL de retour, audience de chaque zone, rôles de `roleMapping`. Écrit à la
 * main, il diverge — et le symptôme est un 401 ou une URL de retour refusée,
 * jamais un message qui nomme la cause. Cette commande le DÉRIVE, par le
 * service `keycloak` — qui porte toutes les actions Keycloak ; elle n'en
 * garde que l'affichage et les codes de sortie.
 *
 * Elle FUSIONNE dans le fichier existant au lieu de l'écraser : comptes de
 * démonstration, titres, secret machine, mappers posés dans la console
 * survivent (`mergeKeycloakRealm`, cœur — le même constructeur que
 * `create app`).
 *
 * - sans option : affiche le realm fusionné ;
 * - `--write` : l'écrit (le fichier par défaut est l'unique `.json` de
 *   `docker/keycloak/import/`) ;
 * - `--check` : sort en 1 si le fichier n'est plus à jour — la garde de CI ;
 * - `--apply` : pose sur le realm EXISTANT le thème de connexion qui suit
 *   `loginPage.skin`, par l'API d'administration (service `keycloak`) —
 *   développement seulement, compte `oauth2.providers.<nom>.admin` requis.
 *
 * ⚠️ Keycloak n'importe un realm qu'à sa CRÉATION : un realm déjà présent
 * n'est pas relu. Après `--write`, le porter par un import PARTIEL (clients en
 * « Overwrite » : comptes et seconds facteurs survivent) ; retirer le volume
 * ne se fait que sur un realm qui ne porte rien à garder.
 */
class SecurityKeycloakRealm extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:keycloak:realm",
      "écrit le realm Keycloak déduit de la configuration",
      cli,
      {
        ...options,
        examples: [
          "nodefony security:keycloak:realm --check",
          "nodefony security:keycloak:realm --write",
        ],
      },
    );
    this.addOption(
      "-w, --write [fichier]",
      "écrit le realm fusionné dans le fichier d'import",
    );
    this.addOption(
      "-c, --check [fichier]",
      "sort en 1 si le fichier d'import n'est plus à jour",
    );
    this.addOption(
      "-a, --apply",
      "pose le thème de connexion sur le realm existant (développement)",
    );
    this.addOption(
      "-p, --provider <nom>",
      "fournisseur de oauth2.providers (défaut keycloak)",
    );
    this.addOption(
      "-m, --machine <clientId>",
      "client machine dont l'audience suit la config",
    );
    this.addOption(
      "--backchannel-origin <url>",
      "origine par laquelle Keycloak joint l'application (canal arrière)",
    );
  }

  /** Le service `keycloak`, ou `null` (code de sortie posé). */
  #service(): KeycloakService | null {
    const service = this.kernel?.container?.get<KeycloakService>("keycloak");
    if (service) return service;
    this.log("service keycloak absent — module security non chargé ?", "ERROR");
    process.exitCode = EXIT_CONFIG;
    return null;
  }

  override async generate(opts: {
    write?: string | boolean;
    check?: string | boolean;
    apply?: boolean;
    provider?: string;
    machine?: string;
    backchannelOrigin?: string;
  }): Promise<this> {
    const service = this.#service();
    if (service === null) return this;

    if (opts.apply === true) {
      const done = await this.#apply(service, opts.provider);
      if (!done || (opts.write === undefined && opts.check === undefined)) {
        return this;
      }
    }

    let plan;
    try {
      plan = service.realmPlan({
        provider: opts.provider,
        machine: opts.machine,
        backchannelOrigin: opts.backchannelOrigin,
        file:
          typeof opts.write === "string"
            ? opts.write
            : typeof opts.check === "string"
              ? opts.check
              : undefined,
      });
    } catch (error) {
      if (!(error instanceof KeycloakRealmError)) throw error;
      this.log(error.message, "ERROR");
      process.exitCode = EXIT_CONFIG;
      return this;
    }
    for (const warning of plan.warnings) {
      process.stderr.write(`${YELLOW}⚠ ${warning}${RESET}\n`);
    }
    const relative = path.relative(
      this.kernel?.path ?? process.cwd(),
      plan.file,
    );

    if (opts.check !== undefined) {
      if (plan.upToDate) {
        process.stdout.write(`${GREEN}✓${RESET} ${relative} est à jour\n`);
        return this;
      }
      process.stderr.write(
        `${relative} ne correspond plus à la configuration — ` +
          `nodefony security:keycloak:realm --write\n`,
      );
      process.exitCode = EXIT_DIFFERS;
      return this;
    }

    if (opts.write !== undefined) {
      if (!service.writeRealm(plan)) {
        process.stdout.write(
          `${GREEN}✓${RESET} ${relative} déjà à jour, rien d'écrit\n`,
        );
        return this;
      }
      process.stdout.write(
        `${GREEN}✓${RESET} ${relative} écrit\n` +
          `${DIM}  Keycloak n'importe un realm qu'à sa CRÉATION — un realm déjà là ne ` +
          `relit pas ce fichier :\n` +
          `  · thème de connexion : nodefony security:keycloak:realm --apply ;\n` +
          `  · le reste : console › Realm settings › Action › Partial import, clients en ` +
          `« Overwrite » (comptes et seconds facteurs gardés) ;\n` +
          `  · ou recréer le realm (retirer le volume Keycloak) s'il ne porte rien ` +
          `à garder.${RESET}\n`,
      );
      return this;
    }

    process.stdout.write(plan.text);
    return this;
  }

  /**
   * `--apply` : le thème que l'habillage demande, posé sur le realm vivant.
   *
   * @returns `false` si le geste a échoué (code de sortie posé)
   */
  async #apply(
    service: KeycloakService,
    provider: string | undefined,
  ): Promise<boolean> {
    try {
      const result = await service.applyLoginTheme(
        provider === undefined ? {} : { provider },
      );
      const line =
        result.outcome === "applied"
          ? `${GREEN}✓${RESET} realm « ${result.realm} » : thème « ${result.previous ?? "—"} » → « ${result.theme} »`
          : result.outcome === "unchanged"
            ? `${GREEN}✓${RESET} realm « ${result.realm} » : déjà sur « ${result.theme} »`
            : `${YELLOW}⚠${RESET} realm « ${result.realm} » : thème « ${result.previous ?? "aucun"} » propre à l'application, laissé tel quel`;
      process.stdout.write(`${line}\n`);
      return true;
    } catch (error) {
      if (!(error instanceof KeycloakAdminError)) throw error;
      this.log(error.message, "ERROR");
      process.exitCode = EXIT_CONFIG;
      return false;
    }
  }
}

export default SecurityKeycloakRealm;
