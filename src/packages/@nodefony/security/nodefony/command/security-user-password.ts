import {
  CONSOLE_DATA_RUN_PROFILE,
  OptionsCommandInterface,
  CliKernel,
  Command,
  askPasswordMasked,
} from "nodefony";
import type { UserService } from "@nodefony/user";
import { USER_REVOKED_EVENT } from "@nodefony/user";

const options: OptionsCommandInterface = {
  // Cette commande LIT ou ÉCRIT des comptes : il lui faut la base.
  runProfile: CONSOLE_DATA_RUN_PROFILE,
  helpGroup: "COMPTES ET SECRETS",
  showBanner: false,
  // `onPostReady` : `fireLifecycle("onReady")` attend TOUS ses listeners — dont
  // le `provisionUsers` de l'app qui pose le service "users" — avant de fire.
  kernelEvent: "onPostReady",
  quietBoot: true,
};

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * `nodefony security:user:password [identifiant]` — change le mot de passe d'un
 * compte.
 *
 * Le geste d'exploitation qui manquait : `user:add`, `user:list` et
 * `user:delete` existaient, mais un mot de passe perdu n'avait aucun recours en
 * ligne de commande — seule la console d'administration savait le faire, ce qui
 * suppose d'y être déjà entré. Sur un serveur, c'est précisément le cas où l'on
 * ne peut pas.
 *
 * Mot de passe : `--password` (visible dans l'historique shell — accepté pour
 * les scripts) ou PROMPT MASQUÉ en TTY, demandé deux fois. Le hachage est celui
 * du service (`UserService.changePassword` → Argon2id) : jamais de clair
 * persisté, et la liste de mots de passe interdits s'applique comme à la
 * création.
 *
 * 🔒 **Les sessions et les jetons du compte sont RÉVOQUÉS**, et ce n'est pas une
 * option : on change un mot de passe parce qu'il est compromis ou perdu, et
 * laisser vivre les sessions ouvertes laisserait l'accès à qui l'a volé. La
 * révocation passe par l'événement que la suppression emploie déjà — une
 * cascade, un seul canal, et les abonnés futurs (webhooks) en profitent sans
 * rien changer ici.
 */
class SecurityUserPassword extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:user:password",
      "change le mot de passe d'un compte",
      cli,
      options,
    );
    // Optionnel : réclamé en terminal, refusé proprement hors terminal — même
    // raison que `user:add`, la commande est proposée au menu où personne ne
    // peut taper d'argument.
    this.addArgument("[identifier]", "identifiant (login) du compte");
    this.addOption(
      "-p, --password <password>",
      "nouveau mot de passe (sinon : prompt masqué en TTY)",
    );
  }

  override async generate(
    identifierArg: string | undefined,
    opts: { password?: string },
  ): Promise<this> {
    const users = this.kernel?.container?.get("users") as
      UserService | undefined;
    if (!users) {
      this.log(
        `service « users » absent — l'application ne provisionne pas son ` +
          `annuaire utilisateurs (cf nodefony/security/provisionUsers.ts d'une ` +
          `app générée).`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }

    let identifier: string;
    try {
      identifier = await this.askArgument(identifierArg, {
        name: "identifier",
        message: "Compte dont changer le mot de passe :",
      });
    } catch (e) {
      this.log((e as Error).message, "ERROR");
      process.exitCode = 1;
      return this;
    }

    const user = await users.findByIdentifier(identifier);
    if (!user) {
      this.log(
        `aucun compte « ${identifier} » — nodefony security:user:list`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }

    let password = opts.password;
    if (!password) {
      if (!process.stdin.isTTY) {
        this.log(
          "mot de passe requis : --password <pwd> (pas de prompt hors terminal).",
          "ERROR",
        );
        process.exitCode = 1;
        return this;
      }
      password = await askPasswordMasked(
        `${BOLD}Nouveau mot de passe de « ${identifier} »${RESET} ${DIM}(frappe masquée)${RESET} : `,
      );
      const confirmed = await askPasswordMasked(
        `${BOLD}Confirme le mot de passe${RESET} : `,
      );
      if (password !== confirmed) {
        this.log("les deux saisies diffèrent — rien n'a changé.", "ERROR");
        process.exitCode = 1;
        return this;
      }
    }
    if (!password) {
      this.log("mot de passe vide — rien n'a changé.", "ERROR");
      process.exitCode = 1;
      return this;
    }

    try {
      // `changePassword` prend l'identifiant INTERNE : viser par `id` évite de
      // changer le mot de passe d'un homonyme, comme pour la suppression.
      const updated = await users.changePassword(user.id, password);
      if (updated === null) {
        this.log(
          `aucune ligne modifiée pour « ${identifier} » — le compte a-t-il ` +
            `disparu entre-temps ?`,
          "ERROR",
        );
        process.exitCode = 1;
        return this;
      }
    } catch (e) {
      // Mot de passe refusé par la liste d'interdits : c'est une décision du
      // service, pas une panne — un message, jamais une pile d'appels.
      this.log((e as Error).message, "ERROR");
      process.exitCode = 1;
      return this;
    }

    // Sessions et jetons : on réutilise la cascade de la suppression plutôt que
    // d'éjecter à la main. Émettre ne peut pas échouer bruyamment (les abonnés
    // sont best-effort), mais l'absence de kernel doit rester silencieuse.
    this.kernel?.fire(USER_REVOKED_EVENT, {
      id: user.id,
      identifier: user.identifier,
      tenantId: null,
      reason: "password_changed",
    });

    process.stdout.write(
      `\n${GREEN}✓ mot de passe changé${RESET} — ${BOLD}${user.identifier}${RESET}\n` +
        `${DIM}  ses sessions et ses jetons sont révoqués : il devra se reconnecter.${RESET}\n` +
        `${DIM}  connexion : POST /nodefony/security/api/auth/login${RESET}\n` +
        (opts.password
          ? `  ${YELLOW}⚠ mot de passe passé en argument — pense à purger l'historique shell${RESET}\n`
          : "") +
        "\n",
    );
    return this;
  }
}

export default SecurityUserPassword;
