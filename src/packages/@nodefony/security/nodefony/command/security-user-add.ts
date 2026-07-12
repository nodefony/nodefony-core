import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
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

/**
 * `nodefony security:user:add <identifier>` — crée un compte utilisateur via le
 * service applicatif `users` (hash Argon2id fait par `UserService.createUser`,
 * jamais de mot de passe stocké en clair).
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
    this.addArgument("<identifier>", "identifiant (login) du compte");
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
   * Prompt de mot de passe MASQUÉ (readline sur un flux de sortie muet — la
   * question est écrite directement, la frappe n'est jamais échoée).
   */
  async #askPassword(question: string): Promise<string> {
    const muted = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output: muted,
      terminal: true,
    });
    process.stdout.write(question);
    try {
      const answer = await rl.question("");
      process.stdout.write("\n");
      return answer;
    } finally {
      rl.close();
    }
  }

  // Argument positionnel déclaré → commander appelle (identifier, options, cmd).
  override async generate(
    identifier: string,
    opts: { password?: string; roles?: string; admin?: boolean },
  ): Promise<this> {
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
        `le compte « ${identifier} » existe déjà — mot de passe oublié ? ` +
          `\`security:user:password\` (à venir) ou passe par Studio (/nodefony).`,
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
      password = await this.#askPassword(
        `${BOLD}Mot de passe de « ${identifier} »${RESET} ${DIM}(frappe masquée)${RESET} : `,
      );
      const confirmed = await this.#askPassword(
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
    const roles = opts.admin
      ? ADMIN_ROLES
      : (opts.roles ?? "ROLE_USER")
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean);
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
