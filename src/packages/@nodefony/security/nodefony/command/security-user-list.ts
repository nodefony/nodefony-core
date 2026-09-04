import { OptionsCommandInterface, CliKernel, Command } from "nodefony";
import type { UserService } from "@nodefony/user";

const options: OptionsCommandInterface = {
  helpGroup: "COMPTES ET SECRETS",
  showBanner: false,
  kernelEvent: "onReady",
  // Le journal de cycle de vie n'est pas la sortie : ici la sortie est la liste.
  quietBoot: true,
};

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Défaut volontairement BORNÉ — une liste se borne, toujours. */
const LIMITE_DEFAUT = 50;

/**
 * `nodefony security:user:list` — qui a un compte dans cette application.
 *
 * **Lister n'est pas une fuite, et c'était la question.** Cette commande
 * s'exécute sur la machine qui possède déjà la base : elle ne divulgue rien que
 * son utilisateur ne puisse lire avec un client SQL. Ce qui serait dangereux est
 * ailleurs, et gardé ici : **jamais le hachage du mot de passe**, jamais les
 * secrets de second facteur, jamais les jetons d'un fournisseur social. La
 * sortie est composée champ par champ — un `console.table(user)` livrerait le
 * credential, parce que le repository, lui, le voit.
 *
 * Le contraire — ne pas pouvoir lister — a un coût réel : on crée un compte, on
 * ne voit pas ce qu'on a créé, et on recommence en doublon.
 *
 * La pagination est NATIVE (`users.listPage`) : jamais un `find()` complet
 * ramené en mémoire, indolore sur trois comptes et fatal sur cent mille.
 */
class SecurityUserList extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:user:list",
      "Liste les comptes (identifiant, rôles, état) — jamais les mots de passe",
      cli,
      options,
    );
    this.addOption(
      "-q, --query <texte>",
      "filtre sur l'identifiant (sous-chaîne, insensible à la casse)",
    );
    this.addOption("-r, --role <role>", "n'affiche que les porteurs d'un rôle");
    this.addOption(
      "-l, --limit <n>",
      `nombre maximum de comptes (défaut ${LIMITE_DEFAUT})`,
    );
    this.addOption("-j, --json", "sortie JSON (scripts/CI)");
  }

  override async generate(opts: {
    query?: string;
    role?: string;
    limit?: string;
    json?: boolean;
  }): Promise<this> {
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

    const limit = Number.parseInt(opts.limit ?? "", 10);
    const page = await users.listPage({
      limit: Number.isInteger(limit) && limit > 0 ? limit : LIMITE_DEFAUT,
      ...(opts.query ? { q: opts.query } : {}),
      ...(opts.role ? { role: opts.role } : {}),
    });

    // 🔴 Projection EXPLICITE, champ par champ. Le repository est la frontière
    // du credential : il voit `password`. Rendre l'entité telle quelle — ou la
    // passer à `console.table` — publierait le hachage dans un terminal, un
    // journal de CI ou un copier-coller.
    const lignes = page.items.map((u) => ({
      identifiant: u.identifier,
      rôles: (u.roles ?? []).join(", ") || "—",
      // `isActive()`/`isLocked()` sont des MÉTHODES du contrat `IUser` — pas
      // des colonnes. Lire `u.enabled` compilait chez d'autres ORM et rendait
      // `undefined` ici : un compte désactivé se serait affiché « actif ».
      actif: u.isActive() ? "oui" : "non",
      verrouillé: u.isLocked() ? "OUI" : "—",
      id: u.id,
    }));

    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ items: lignes, hasNext: page.hasNext }, null, 2)}\n`,
      );
      return this;
    }

    if (lignes.length === 0) {
      process.stdout.write(
        `aucun compte${opts.query || opts.role ? " pour ce filtre" : ""} — ` +
          `nodefony security:user:add <identifiant>\n`,
      );
      return this;
    }

    process.stdout.write(`\n${BOLD}👤 Comptes${RESET}\n`);
    console.table(lignes);
    process.stdout.write(
      `${lignes.length} compte(s)` +
        (page.hasNext
          ? `${DIM} — page bornée, il y en a d'autres (--limit)${RESET}`
          : "") +
        `\n\n`,
    );
    return this;
  }
}

export default SecurityUserList;
