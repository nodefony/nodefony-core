import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import type { UserService } from "@nodefony/user";

const options: OptionsCommandInterface = {
  helpGroup: "COMPTES ET SECRETS",
  showBanner: false,
  kernelEvent: "onPostReady",
  quietBoot: true,
};

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * Rôle qui donne la main sur l'instance — celui dont il faut toujours garder un
 * porteur actif, sinon plus personne ne peut administrer l'application.
 */
const ADMIN_ROLE = "ROLE_NODEFONY_ADMIN";

/**
 * `nodefony security:user:delete <identifiant>` — retire un compte.
 *
 * **Un geste destructeur ne se fait pas sur une frappe.** La commande MONTRE ce
 * qu'elle va supprimer (identifiant, rôles, identifiant interne), puis demande
 * une confirmation. Hors terminal, elle exige `--yes` : un script qui supprime
 * doit le dire dans sa ligne, jamais l'obtenir d'un prompt sauté.
 *
 * **Garde-fou anti-lockout** : le DERNIER administrateur actif ne se supprime
 * pas. Sans lui, plus personne n'accède à la console d'administration, et le
 * seul recours est une écriture directe en base. Le même garde-fou existe côté
 * data plane (`UserAdminApi`) — ici il est constaté, pas supposé.
 *
 * La révocation des sessions et jetons du compte suit d'elle-même : la
 * suppression émet `onUserRevoked`, auquel `@nodefony/security` réagit en
 * éjectant sessions et jetons. Rien à faire de plus ici.
 */
class SecurityUserDelete extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:user:delete",
      "supprime un compte, après confirmation",
      cli,
      options,
    );
    // Optionnel : réclamé en terminal, refusé proprement hors terminal.
    this.addArgument("[identifier]", "identifiant (login) du compte à retirer");
    this.addOption(
      "-y, --yes",
      "ne pas demander confirmation (obligatoire hors terminal)",
    );
  }

  override async generate(
    identifierArg: string | undefined,
    opts: { yes?: boolean },
  ): Promise<this> {
    const users = this.kernel?.container?.get("users") as
      UserService | undefined;
    if (!users) {
      this.log(
        `service « users » absent — l'application ne provisionne pas son ` +
          `annuaire utilisateurs.`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }

    let identifier: string;
    try {
      identifier = await this.askArgument(identifierArg, {
        name: "identifier",
        message: "Compte à SUPPRIMER :",
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

    // 🔴 Le dernier administrateur ACTIF ne se supprime pas : sans lui,
    // l'administration de l'application devient inaccessible et le seul recours
    // est une écriture directe en base.
    if ((user.roles ?? []).includes(ADMIN_ROLE)) {
      const restants = await users.countActiveAdmins(ADMIN_ROLE);
      if (restants <= 1) {
        this.log(
          `« ${identifier} » est le DERNIER administrateur actif — refus.\n` +
            `  Sans lui, plus personne n'administre cette application.\n` +
            `  Crée d'abord un autre admin : nodefony security:user:add <id> --admin`,
          "ERROR",
        );
        process.exitCode = 1;
        return this;
      }
    }

    const w = (t: string): void => {
      process.stdout.write(t);
    };
    w(
      `\n${BOLD}Compte à supprimer${RESET}\n` +
        `  identifiant : ${BOLD}${user.identifier}${RESET}\n` +
        `  rôles       : ${(user.roles ?? []).join(", ") || "—"}\n` +
        `  id interne  : ${DIM}${user.id}${RESET}\n\n`,
    );

    if (!opts.yes) {
      if (!process.stdin.isTTY) {
        // Un prompt sauté hors terminal, c'est une suppression silencieuse.
        this.log(
          "confirmation impossible sans terminal — relance avec --yes si c'est voulu.",
          "ERROR",
        );
        process.exitCode = 1;
        return this;
      }
      await this.loadPrompts();
      const confirme = await this.prompts.confirm({
        message: `Supprimer définitivement « ${identifier} » ?`,
        default: false,
      });
      if (!confirme) {
        w(`${YELLOW}annulé — rien n'a été supprimé.${RESET}\n\n`);
        return this;
      }
    }

    // `delete` prend un CRITÈRE, pas un identifiant : viser par `id` évite de
    // supprimer plusieurs comptes si un jour deux partagent un identifiant.
    const supprimes = await users.delete({ id: user.id });
    if (supprimes === 0) {
      this.log(
        `aucune ligne supprimée pour « ${identifier} » — le compte a-t-il ` +
          `disparu entre-temps ?`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }
    w(
      `${GREEN}✓ compte supprimé${RESET} — ${BOLD}${identifier}${RESET}\n` +
        `${DIM}  ses sessions et ses jetons sont révoqués (event onUserRevoked).${RESET}\n\n`,
    );
    return this;
  }
}

export default SecurityUserDelete;
