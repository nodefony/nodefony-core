import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import {
  buildKeycloakRealm,
  mergeKeycloakRealm,
  renderKeycloakRealm,
  type IKeycloakMachineInput,
  type TKeycloakJson,
  type TKeycloakObject,
} from "./keycloakRealm.js";
import {
  defineSecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig.js";
import { readIfPresentSync } from "../src/token/secretFile.js";
import {
  deriveKeycloakRealmInput,
  KeycloakRealmError,
  type IAppServers,
} from "./keycloakRealmInput.js";

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

/** Où le compose d'une application importe ses realms. */
const IMPORT_DIR = path.join("docker", "keycloak", "import");

/** Codes de sortie (sysexits). */
const EXIT_DIFFERS = 1;
const EXIT_CONFIG = 78;

/**
 * Le fichier de realm par défaut : l'UNIQUE `.json` du dossier d'import, sinon
 * `realm.json` (le nom que `create app` écrit).
 */
function defaultRealmFile(root: string): string {
  const dir = path.join(root, IMPORT_DIR);
  let json: string[] = [];
  try {
    json = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    // Dossier absent : le chemin par défaut sera créé par `--write`.
  }
  return path.join(dir, json.length === 1 ? (json[0] as string) : "realm.json");
}

/** Un port lu dans `servers.<nom>` de la config ; `null` si le serveur est coupé. */
function portOf(
  servers: unknown,
  name: "http" | "https",
  fallback: number,
): number | null {
  if (typeof servers !== "object" || servers === null) return fallback;
  const server: unknown = (servers as Record<string, unknown>)[name];
  if (server === false) return null;
  if (typeof server !== "object" || server === null) return fallback;
  const port = Number((server as Record<string, unknown>).port);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

/**
 * Le client machine à tenir à jour : celui qu'on nomme, sinon le compte de
 * service que le realm existant déclare déjà (flux `client_credentials` seul).
 */
function machineClient(
  existing: TKeycloakObject | null,
  named: string | undefined,
): IKeycloakMachineInput | null {
  if (named !== undefined) return { clientId: named, secret: null };
  const clients = Array.isArray(existing?.clients) ? existing.clients : [];
  for (const client of clients) {
    if (typeof client !== "object" || client === null || Array.isArray(client))
      continue;
    if (
      client.serviceAccountsEnabled === true &&
      client.standardFlowEnabled !== true
    ) {
      if (typeof client.clientId === "string") {
        return { clientId: client.clientId, secret: null };
      }
    }
  }
  return null;
}

/**
 * `nodefony security:keycloak:realm` — le realm Keycloak que la configuration
 * de l'application implique.
 *
 * Le realm d'import répète ce que la config dit déjà : identifiant du client,
 * URL de retour, audience de chaque zone, rôles de `roleMapping`. Écrit à la
 * main, il diverge — et le symptôme est un 401 ou une URL de retour refusée,
 * jamais un message qui nomme la cause. Cette commande le DÉRIVE.
 *
 * Elle FUSIONNE dans le fichier existant au lieu de l'écraser : comptes de
 * démonstration, titres, secret machine, mappers posés dans la console
 * survivent (`mergeKeycloakRealm`, cœur — le même constructeur que
 * `create app`).
 *
 * - sans option : affiche le realm fusionné ;
 * - `--write` : l'écrit (le fichier par défaut est l'unique `.json` de
 *   `docker/keycloak/import/`) ;
 * - `--check` : sort en 1 si le fichier n'est plus à jour — la garde de CI.
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
      options,
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

  /** Racine du projet (kernel booté) — repli cwd. */
  #root(): string {
    return this.kernel?.path ?? process.cwd();
  }

  override async generate(opts: {
    write?: string | boolean;
    check?: string | boolean;
    provider?: string;
    machine?: string;
    backchannelOrigin?: string;
  }): Promise<this> {
    // Les options du module, telles que la config de l'application les a
    // fusionnées — validées juste après par `defineSecurityConfig`.
    const modules = this.kernel?.modules as
      { security?: { options?: ISecurityConfigInput } } | undefined;
    const target =
      typeof opts.write === "string"
        ? path.resolve(this.#root(), opts.write)
        : typeof opts.check === "string"
          ? path.resolve(this.#root(), opts.check)
          : defaultRealmFile(this.#root());
    const raw = readIfPresentSync(target);
    let existing: TKeycloakObject | null = null;
    if (raw !== null) {
      const parsed = JSON.parse(raw) as TKeycloakJson;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        this.log(`${target} n'est pas un realm (objet JSON attendu)`, "ERROR");
        process.exitCode = EXIT_CONFIG;
        return this;
      }
      existing = parsed;
    }

    let derived: TKeycloakObject;
    let warnings: string[];
    try {
      const config = defineSecurityConfig(modules?.security?.options ?? {});
      const servers: unknown = (
        this.kernel?.options as { servers?: unknown } | undefined
      )?.servers;
      const appServers: IAppServers = {
        httpPort: portOf(servers, "http", 5151),
        httpsPort: portOf(servers, "https", 5152),
      };
      const derivation = deriveKeycloakRealmInput({
        providerName: opts.provider ?? "keycloak",
        config,
        servers: appServers,
        production: this.kernel?.environment === "production",
        machine: machineClient(existing, opts.machine),
        currentLoginTheme:
          typeof existing?.loginTheme === "string" ? existing.loginTheme : null,
        ...(opts.backchannelOrigin === undefined
          ? {}
          : { backchannelOrigin: opts.backchannelOrigin }),
      });
      derived = buildKeycloakRealm(derivation.input);
      warnings = derivation.warnings;
    } catch (error) {
      if (!(error instanceof KeycloakRealmError)) throw error;
      this.log(error.message, "ERROR");
      process.exitCode = EXIT_CONFIG;
      return this;
    }

    const realm =
      existing === null ? derived : mergeKeycloakRealm(existing, derived);
    const text = renderKeycloakRealm(realm);
    const relative = path.relative(this.#root(), target);
    for (const warning of warnings) {
      process.stderr.write(`${YELLOW}⚠ ${warning}${RESET}\n`);
    }

    if (opts.check !== undefined) {
      if (raw === text) {
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
      if (raw === text) {
        process.stdout.write(
          `${GREEN}✓${RESET} ${relative} déjà à jour, rien d'écrit\n`,
        );
        return this;
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text);
      process.stdout.write(
        `${GREEN}✓${RESET} ${relative} écrit\n` +
          `${DIM}  Keycloak n'importe un realm qu'à sa CRÉATION — un realm déjà là ne ` +
          `relit pas ce fichier :\n` +
          `  · console › Realm settings › Action › Partial import, clients en ` +
          `« Overwrite » (comptes et seconds facteurs gardés) ;\n` +
          `  · ou recréer le realm (retirer le volume Keycloak) s'il ne porte rien ` +
          `à garder.${RESET}\n`,
      );
      return this;
    }

    process.stdout.write(text);
    return this;
  }
}

export default SecurityKeycloakRealm;
