import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import type {
  IOAuthCheck,
  IOAuthDiagnosis,
  OAuthCheckName,
} from "../src/oauth/providerDiagnosis.js";

const options: OptionsCommandInterface = {
  helpGroup: "COMPTES ET SECRETS",
  showBanner: false,
  // Le service `oauth2` lit sa configuration à `onBoot` ; à `onReady`, la
  // configuration fusionnée de chaque module est en place. Aucune base lue.
  kernelEvent: "onReady",
  quietBoot: true,
};

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/** Codes de sortie (sysexits). */
const EXIT_FAILED = 1;
const EXIT_CONFIG = 78;

const LABELS: Record<OAuthCheckName, string> = {
  discovery: "découverte",
  authorization: "URL de retour",
  token: "secret",
};

/** Vue MINIMALE du service `oauth2`. */
interface IOAuthDiagnoser {
  isEnabled(): boolean;
  diagnose(name?: string): Promise<IOAuthDiagnosis[]>;
}

function mark(check: IOAuthCheck): string {
  switch (check.status) {
    case "ok":
      return `${GREEN}✓${RESET}`;
    case "failed":
      return `${RED}✗${RESET}`;
    case "inconclusive":
      return `${YELLOW}?${RESET}`;
    case "skipped":
      return `${DIM}–${RESET}`;
  }
}

/**
 * `nodefony security:oauth:doctor` — dit POURQUOI un fournisseur OAuth refuse
 * l'application, sans qu'un humain ait à se connecter.
 *
 * Trois verdicts distincts là où le journal ne montre qu'un 401 : l'émetteur
 * se déclare autrement que la configuration ne l'écrit, l'URL de retour n'est
 * pas enregistrée, le secret est faux. La même analyse alimente
 * `nodefony doctor --live` (famille « Fournisseurs OAuth ») et l'endpoint
 * d'administration `security/oauth/diagnosis` : une seule implémentation, celle
 * du service `oauth2`.
 *
 * Valable pour tout fournisseur : les sondes passent par le fournisseur que le
 * login construit, Keycloak n'y a rien de particulier.
 */
class SecurityOAuthDoctor extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:oauth:doctor",
      "diagnostique le branchement des fournisseurs OAuth",
      cli,
      options,
    );
    this.addOption(
      "-p, --provider <nom>",
      "un seul fournisseur de oauth2.providers",
    );
    this.addOption("-j, --json", "sortie JSON (scripts/CI)");
  }

  override async generate(opts: {
    provider?: string;
    json?: boolean;
  }): Promise<this> {
    const oauth = this.kernel?.container?.get("oauth2") as
      IOAuthDiagnoser | undefined;
    const diagnoses =
      oauth?.isEnabled() === true ? await oauth.diagnose(opts.provider) : [];

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(diagnoses, null, 2)}\n`);
    } else if (diagnoses.length === 0) {
      process.stderr.write(
        "aucun fournisseur OAuth à diagnostiquer — `security.oauth2` est " +
          "désactivé ou ne déclare aucun fournisseur\n",
      );
    } else {
      for (const diagnosis of diagnoses) {
        process.stdout.write(
          `${diagnosis.ok ? GREEN : RED}${diagnosis.provider}${RESET}\n`,
        );
        for (const check of diagnosis.checks) {
          process.stdout.write(
            `  ${mark(check)} ${LABELS[check.name].padEnd(14)}${check.message}\n`,
          );
        }
      }
    }

    // Rien de diagnostiqué n'est pas un quitus : on n'a rien regardé.
    if (diagnoses.length === 0) process.exitCode = EXIT_CONFIG;
    else if (diagnoses.some((d) => !d.ok)) process.exitCode = EXIT_FAILED;
    return this;
  }
}

export default SecurityOAuthDoctor;
