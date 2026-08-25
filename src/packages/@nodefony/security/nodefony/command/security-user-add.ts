import {
  OptionsCommandInterface,
  CliKernel,
  Command,
  askPasswordMasked,
} from "nodefony";
import type { UserService } from "@nodefony/user";

const options: OptionsCommandInterface = {
  showBanner: false,
  // `onPostReady` : `fireLifecycle("onReady")` attend TOUS ses listeners — dont
  // le `provisionUsers` de l'app qui pose le service "users" — avant de fire.
  // Un `kernelEvent: "onReady"` serait une course (deux listeners du même event).
  kernelEvent: "onPostReady",
};

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Rôles du raccourci `--admin` — À PLAT (ne dépend pas d'une hiérarchie). */
const ADMIN_ROLES = ["ROLE_ADMIN", "ROLE_NODEFONY_ADMIN"];

/** Rôle de base, toujours proposé même si l'application n'en déclare aucun. */
const ROLE_BASE = "ROLE_USER";

/**
 * `nodefony security:user:add [identifier]` — crée un compte utilisateur via le
 * service applicatif `users` (hash Argon2id fait par `UserService.createUser`,
 * jamais de mot de passe stocké en clair).
 *
 * Identifiant : en argument, ou DEMANDÉ quand un terminal est là — la commande
 * est proposée au menu, où personne ne peut taper d'argument. Hors terminal
 * (CI, script), l'absence reste une erreur, avec la ligne exacte à taper.
 *
 * Mot de passe : `--password` (visible dans l'historique shell — accepté pour
 * les scripts) ou PROMPT MASQUÉ en TTY (recommandé). Rôles : `--roles a,b,c`
 * (CSV) ou `--admin` (raccourci `ROLE_ADMIN + ROLE_NODEFONY_ADMIN` → accès
 * console Studio). Défaut : `ROLE_USER`.
 *
 * Le service `users` est posé par l'APPLICATION (cf `provisionUsers` du
 * template d'app) — absent = message actionnable, pas de stack.
 */
class SecurityUserAdd extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:user:add",
      "Crée un utilisateur (mot de passe demandé masqué ; --admin pour un compte administrateur)",
      cli,
      options,
    );
    // OPTIONNEL, et c'est le point : déclaré `<identifier>`, commander refusait
    // la commande AVANT qu'elle existe — « missing required argument » puis
    // exit 1, y compris quand l'utilisateur l'avait CHOISIE dans le menu, où il
    // n'avait aucun moyen de taper un argument. Optionnel ici, réclamé en TTY
    // par `askArgument`, et toujours exigé hors terminal (message actionnable).
    this.addArgument("[identifier]", "identifiant (login) du compte");
    this.addOption(
      "-p, --password <password>",
      "mot de passe (sinon : prompt masqué en TTY)",
    );
    this.addOption(
      "-r, --roles <roles>",
      "rôles CSV (ex: ROLE_USER,ROLE_DEV) — défaut ROLE_USER",
    );
    this.addOption(
      "-a, --admin",
      `compte administrateur (${ADMIN_ROLES.join(" + ")} — accès Studio)`,
    );
  }

  /**
   * Rôles que CETTE application connaît, lus de sa hiérarchie déclarée.
   *
   * 🔴 Jamais une liste recopiée ici : une constante en dur diverge dès que
   * l'application déclare un rôle métier, et la commande proposerait alors des
   * rôles qui n'existent pas tout en taisant ceux qui existent. La hiérarchie
   * (`security.roleHierarchy`) est la seule source — ses clés sont les rôles
   * qui couvrent, ses valeurs ceux qui sont couverts.
   *
   * Un rôle inconnu du RBAC n'est pas une faute : il est simplement inerte.
   * On ne refuse donc rien, on PROPOSE ce qu'on sait.
   */
  #rolesConnus(): string[] {
    const modules = this.kernel?.modules as
      Record<string, { options?: Record<string, unknown> }> | undefined;
    const hierarchie = (
      modules?.security?.options as
        { roleHierarchy?: Record<string, string[]> } | undefined
    )?.roleHierarchy;
    const tous = new Set<string>([ROLE_BASE]);
    for (const [porteur, couverts] of Object.entries(hierarchie ?? {})) {
      tous.add(porteur);
      for (const c of couverts) tous.add(c);
    }
    // `ROLE_USER` d'abord (le défaut), puis l'ordre déclaré : le premier choix
    // proposé doit être celui qu'on prend neuf fois sur dix.
    return [ROLE_BASE, ...[...tous].filter((r) => r !== ROLE_BASE).sort()];
  }

  // Argument positionnel déclaré → commander appelle (identifier, options, cmd).
  override async generate(
    identifierArg: string | undefined,
    opts: { password?: string; roles?: string; admin?: boolean },
  ): Promise<this> {
    let identifier: string;
    try {
      identifier = await this.askArgument(identifierArg, {
        name: "identifier",
        message: "Identifiant (login) du compte :",
      });
    } catch (e) {
      // Hors terminal : l'échec reste un échec, mais il montre la ligne à taper
      // au lieu du « missing required argument » de commander.
      this.log((e as Error).message, "ERROR");
      process.exitCode = 1;
      return this;
    }
    const users = this.kernel?.container?.get("users") as
      UserService | undefined;
    if (!users) {
      this.log(
        `service "users" absent — l'application ne provisionne pas son annuaire ` +
          `utilisateurs. Ajoute-le (cf nodefony/security/provisionUsers.ts d'une ` +
          `app générée : container.set("users", new UserService(repo, encoder)) ` +
          `à onKernelReady).`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }
    if (await users.findByIdentifier(identifier)) {
      this.log(
        `le compte « ${identifier} » existe déjà.\n` +
          `  · le voir       : nodefony security:user:list -q ${identifier}\n` +
          `  · le supprimer  : nodefony security:user:delete ${identifier}\n` +
          `  · mot de passe oublié : par Studio (/nodefony) — la commande n'existe pas encore.`,
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
        `${BOLD}Mot de passe de « ${identifier} »${RESET} ${DIM}(frappe masquée)${RESET} : `,
      );
      const confirmed = await askPasswordMasked(
        `${BOLD}Confirme le mot de passe${RESET} : `,
      );
      if (password !== confirmed) {
        this.log("les deux saisies diffèrent — rien n'a été créé.", "ERROR");
        process.exitCode = 1;
        return this;
      }
    }
    if (!password) {
      this.log("mot de passe vide — rien n'a été créé.", "ERROR");
      process.exitCode = 1;
      return this;
    }
    let roles: string[];
    if (opts.admin) {
      roles = ADMIN_ROLES;
    } else if (opts.roles) {
      roles = opts.roles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
    } else if (process.stdin.isTTY) {
      // 🔴 En terminal, on PROPOSE au lieu d'imposer le défaut en silence.
      // Vécu : « je n'ai jamais pu gérer le rôle » — l'option `--roles` existait
      // depuis toujours, et rien ne la faisait connaître à qui n'avait pas lu
      // `--help`. Un compte créé sans rôle utile est un compte à refaire.
      await this.loadPrompts();
      const choisis = (await this.prompts.checkbox({
        message: `Rôles de « ${identifier} » :`,
        choices: this.#rolesConnus().map((r) => ({
          name: r,
          value: r,
          checked: r === ROLE_BASE,
        })),
      })) as string[];
      roles = choisis.length > 0 ? choisis : [ROLE_BASE];
    } else {
      roles = [ROLE_BASE];
    }
    const user = await users.createUser({
      identifier,
      plainPassword: password,
      roles,
    });
    process.stdout.write(
      `\n${GREEN}✓ compte créé${RESET} — ${BOLD}${user.identifier}${RESET} ` +
        `${DIM}(id ${user.id})${RESET}\n` +
        `  rôles : ${roles.join(" · ")}\n` +
        (opts.admin
          ? `  ${DIM}accès console Studio : /nodefony${RESET}\n`
          : "") +
        (opts.password
          ? `  ${YELLOW}⚠ mot de passe passé en argument — pense à purger l'historique shell${RESET}\n`
          : ""),
    );
    return this;
  }
}

export default SecurityUserAdd;
