import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import {
  OptionsCommandInterface,
  CliKernel,
  Command,
  MCP_ENDPOINT_PATH,
} from "nodefony";
import type { UserService } from "@nodefony/user";
import type TokenService from "../service/tokenService";

const options: OptionsCommandInterface = {
  showBanner: false,
  // Services prêts, AUCUN serveur en écoute : cette commande SIGNE un jeton,
  // elle n'en demande pas un à une porte HTTP. C'est ce qui la rend utilisable
  // sans que l'application tourne — et sans mot de passe.
  kernelEvent: "onReady",
  // Le journal de cycle de vie n'est pas la sortie : ici la sortie est un jeton
  // qu'on copie ou qu'on exporte.
  quietBoot: true,
};

/** Variable d'environnement que le câblage `.mcp.json` développe. */
const MCP_TOKEN_ENV = "NF_MCP_TOKEN";

/** Plafond d'une durée demandée en ligne de commande : 30 jours. */
const TTL_MAX_MINUTES = 30 * 24 * 60;

/**
 * Traduit `--ttl` en secondes, ou rend l'erreur à afficher.
 *
 * Exportée pour être ÉPROUVÉE : c'est une fonction pure dont chaque verdict est
 * binaire, et dont l'échec — une durée acceptée alors qu'elle est aberrante —
 * ne se verrait qu'au moment où un jeton refuse de mourir.
 *
 * @param raw - la valeur telle que tapée, ou rien
 * @returns les secondes, `undefined` si rien n'est demandé, une `Error` sinon
 */
export function ttlSeconds(
  raw: string | undefined,
): number | undefined | Error {
  if (raw === undefined) return undefined;
  const minutes = Number.parseInt(raw, 10);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return new Error(
      `--ttl attend un nombre de MINUTES supérieur à zéro (reçu « ${raw} »)`,
    );
  }
  if (minutes > TTL_MAX_MINUTES) {
    return new Error(
      `--ttl est borné à ${TTL_MAX_MINUTES} minutes (30 jours) — un jeton posé ` +
        `dans un fichier est une clé, et une clé se remplace`,
    );
  }
  return minutes * 60;
}

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * `nodefony security:token` — émet un jeton d'accès pour une porte de cette
 * application (la porte MCP par défaut).
 *
 * **Pourquoi une commande, et pas un `curl`.** Le jeton s'obtenait par un appel
 * au grant : trouver l'URL, composer un JSON, y mettre un mot de passe en clair
 * dans l'historique du shell, et surtout AVOIR un serveur en marche. Personne ne
 * fait ça deux fois. Ici l'application SIGNE elle-même — elle possède la clé —
 * donc : pas de serveur, pas de mot de passe, pas de réseau.
 *
 * **L'audience est celle de la porte, et ce n'est pas un détail** (RFC 8707) :
 * un jeton d'audience différente est refusé, à juste titre — c'est toute la
 * raison d'être de la liaison d'audience. La commande la vise d'elle-même,
 * `--resource` ne sert qu'à en viser une autre.
 *
 * Suit `security:secrets` : `--write` pose la valeur dans `.env.local`
 * (gitignoré), jamais dans le `.env` commité, et ne remplace jamais une valeur
 * existante — une rotation est un geste explicite.
 */
class SecurityToken extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:token",
      `Émet un jeton d'accès pour la porte MCP (--write : pose ${MCP_TOKEN_ENV} dans .env.local)`,
      cli,
      options,
    );
    this.addArgument(
      "[identifier]",
      "compte porteur du jeton (défaut : admin)",
    );
    this.addOption(
      "-s, --scope <scopes>",
      "scopes demandés, séparés par des espaces (défaut : aucun)",
    );
    this.addOption(
      "-r, --resource <uri>",
      "audience visée (défaut : la porte MCP de cette application)",
    );
    this.addOption(
      "-t, --ttl <duree>",
      "durée de validité, en minutes (défaut : celle de la config, 15 min)",
    );
    this.addOption(
      "-w, --write",
      `écrit ${MCP_TOKEN_ENV} dans .env.local (jamais de remplacement)`,
    );
    this.addOption("-j, --json", "sortie JSON (scripts/CI)");
  }

  /** Racine du projet (le kernel la connaît ; repli sur le cwd). */
  #root(): string {
    return this.kernel?.path ?? process.cwd();
  }

  /**
   * `true` si `.env.local` est SUIVI par git — y écrire un jeton le mènerait au
   * commit. Best-effort : git absent / hors dépôt → `false` (on écrit).
   */
  #dotenvTracked(): boolean {
    try {
      return (
        spawnSync("git", ["ls-files", "--error-unmatch", ".env.local"], {
          cwd: this.#root(),
          stdio: "ignore",
        }).status === 0
      );
    } catch {
      return false;
    }
  }

  /** Contenu d'un fichier du projet, "" si absent/illisible. */
  #read(file: string): string {
    try {
      const abs = path.resolve(this.#root(), file);
      return existsSync(abs) ? readFileSync(abs, "utf8") : "";
    } catch {
      return "";
    }
  }

  /**
   * Audience par défaut : la porte MCP de CETTE application.
   *
   * Lue de la configuration quand elle y est écrite — c'est elle qui fait foi,
   * et elle doit l'être : dérivée d'un en-tête `Host`, un `Host` forgé
   * obtiendrait un jeton d'audience arbitraire. À défaut, on compose l'adresse
   * locale, qui est celle du développement.
   */
  #defaultResource(): string {
    // La configuration du module qui SERT la porte fait foi quand elle est
    // écrite — et elle doit l'être : dérivée d'un en-tête `Host`, un `Host`
    // forgé obtiendrait un jeton d'audience arbitraire.
    const modules = this.kernel?.modules as
      Record<string, { options?: Record<string, unknown> }> | undefined;
    const devkit = modules?.devkit?.options as
      { mcp?: { authorization?: { resource?: string } } } | undefined;
    const declaree = devkit?.mcp?.authorization?.resource;
    if (typeof declaree === "string" && declaree.length > 0) return declaree;
    const port = process.env.NF_PORT ?? "5151";
    return `http://localhost:${port}${MCP_ENDPOINT_PATH}`;
  }

  /**
   * `true` si l'application signe avec une clé ÉPHÉMÈRE (ni `keySetJson` ni
   * `dir` déclarés dans `security.jwt.keystore`).
   *
   * 🔴 C'est le piège que cette commande doit annoncer : le jeton produit est
   * parfaitement valide et n'est vérifiable par PERSONNE d'autre que le process
   * qui vient de le signer — celui-ci. Le serveur en marche a généré la sienne
   * au démarrage, et refusera ce jeton en « autorisation requise ». Mesuré :
   * deux `kid` distincts pour la même application, et un troisième après un
   * redémarrage.
   */
  #cleEphemere(): boolean {
    const modules = this.kernel?.modules as
      Record<string, { options?: Record<string, unknown> }> | undefined;
    const jwt = (
      modules?.security?.options as
        | { jwt?: { keystore?: { keySetJson?: string; dir?: string } } }
        | undefined
    )?.jwt;
    const ks = jwt?.keystore;
    return !ks?.keySetJson && !ks?.dir;
  }

  override async generate(
    identifierArg: string | undefined,
    opts: {
      scope?: string;
      ttl?: string;
      resource?: string;
      write?: boolean;
      json?: boolean;
    },
  ): Promise<this> {
    const tokens = this.kernel?.container?.get("tokenService") as
      TokenService | undefined;
    const users = this.kernel?.container?.get("users") as
      UserService | undefined;
    if (!tokens || !users) {
      this.log(
        `service « ${!tokens ? "tokenService" : "users"} » absent — cette ` +
          `application ne provisionne pas d'émetteur de jetons.`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }

    // En terminal et sans argument : on PROPOSE les comptes qui existent.
    // Taper un identifiant de mémoire est la meilleure façon de se tromper —
    // et l'erreur ne se voit qu'après le boot complet.
    let identifier = identifierArg?.trim() ?? "";
    if (!identifier && process.stdin.isTTY) {
      const page = await users.listPage({ limit: 25 });
      if (page.items.length > 0) {
        await this.loadPrompts();
        identifier = (await this.prompts.select({
          message: "Compte porteur du jeton :",
          choices: page.items.map((u) => ({
            name: `${u.identifier}${(u.roles ?? []).length ? ` ${DIM}(${(u.roles ?? []).join(", ")})${RESET}` : ""}`,
            value: u.identifier,
          })),
        })) as string;
      }
    }
    if (!identifier) identifier = "admin";
    const user = await users.findByIdentifier(identifier);
    if (!user) {
      this.log(
        `compte « ${identifier} » introuvable — crée-le : ` +
          `nodefony security:user:add ${identifier}`,
        "ERROR",
      );
      process.exitCode = 1;
      return this;
    }

    const resource = opts.resource ?? this.#defaultResource();
    const scopes = (opts.scope ?? "").split(/\s+/u).filter(Boolean);
    // Une durée EXPLICITE, bornée. Le défaut de configuration (15 min) est
    // taillé pour un jeton d'API qu'un client rafraîchit ; l'en-tête statique
    // d'un agent, lui, n'est renouvelé par personne — le porteur revient toutes
    // les quinze minutes constater un 401 qui n'accuse pas la bonne chose. La
    // borne haute existe pour que « pratique » ne devienne pas « éternel » : un
    // jeton posé dans un fichier est une clé, et une clé se remplace.
    const ttlS = ttlSeconds(opts.ttl);
    if (ttlS instanceof Error) {
      this.log(ttlS.message, "ERROR");
      process.exitCode = 1;
      return this;
    }
    let emis;
    try {
      emis = await tokens.issueTokens(user, scopes, resource, ttlS);
    } catch (e) {
      // `invalid_target` en clair. L'émetteur refuse une audience qu'il ne sert
      // pas, et il a RAISON de ne rien dire de plus (énumérer les audiences
      // acceptées donnerait la carte des ressources protégées à qui possède un
      // simple identifiant). Mais l'utilisateur, lui, mérite la cause la plus
      // fréquente : la porte MCP est servie par un module `policy: "dev"`, donc
      // elle N'EXISTE PAS en production — et le CLI boote en production quand
      // le terminal n'a pas posé `NODE_ENV`.
      const oauth = (e as { oauthError?: string }).oauthError;
      if (oauth === "invalid_target") {
        // Le message dit d'abord ce que ce N'EST PAS : le premier réflexe est
        // de chercher un serveur éteint — vécu — alors que cette commande n'en
        // utilise aucun. Écarter la fausse piste coûte une ligne et fait gagner
        // le quart d'heure qu'on passerait à relancer un serveur pour rien.
        const env = this.kernel?.environment ?? "?";
        this.log(
          `impossible d'émettre un jeton pour cette porte ici.\n` +
            `\n` +
            `  Ce n'est PAS un problème de serveur : cette commande n'en a pas\n` +
            `  besoin, elle signe le jeton elle-même.\n` +
            `\n` +
            `  La porte visée — ${resource} — est servie par un module de\n` +
            `  DÉVELOPPEMENT. Ce terminal n'a pas posé NODE_ENV, donc le CLI a\n` +
            `  démarré en « ${env} », où ce module n'existe pas : un jeton pour\n` +
            `  une porte absente n'aurait personne pour l'accepter.\n` +
            `\n` +
            `  → NODE_ENV=development nodefony security:token${opts.write ? " --write" : ""}\n` +
            `  → ou vise une autre porte : --resource <uri>`,
          "ERROR",
        );
        process.exitCode = 1;
        return this;
      }
      throw e;
    }
    const jeton = emis.access_token;

    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ access_token: jeton, resource, scopes, expires_in: emis.expires_in }, null, 2)}\n`,
      );
      return this;
    }

    const w = (s: string): void => {
      process.stdout.write(s);
    };
    // Sans `--write` mais en terminal : proposer de poser la valeur plutôt que
    // de laisser copier un jeton de 400 caractères à la main.
    let ecrire = opts.write === true;
    if (!ecrire && process.stdin.isTTY && !opts.json) {
      await this.loadPrompts();
      ecrire = await this.prompts.confirm({
        message: `Écrire ${MCP_TOKEN_ENV} dans .env.local ?`,
        default: true,
      });
    }
    if (this.#cleEphemere()) {
      // Avant le jeton, pas après : on ne laisse pas copier une valeur dont on
      // sait qu'elle sera refusée.
      w(
        `\n${YELLOW}⚠ Clé de signature ÉPHÉMÈRE — ce jeton sera REFUSÉ.${RESET}\n` +
          `${DIM}  Cette application n'a pas de clé persistante : chaque process en génère\n` +
          `  une au démarrage. Le jeton ci-dessous n'est vérifiable que par le process\n` +
          `  qui vient de le signer — pas par le serveur en marche, qui a la sienne.\n` +
          `  → déclare une source de clés dans nodefony.config.ts :\n` +
          `      use("@nodefony/security", { jwt: { keystore: { dir: "var/keys" } } })\n` +
          `    ou, en production, keySetJson depuis l'environnement.${RESET}\n`,
      );
    }
    const minutes = Math.round((emis.expires_in ?? 0) / 60);
    w(
      `\n${BOLD}🔑 Jeton d'accès${RESET} ${DIM}— compte ${identifier}, audience ${resource}${RESET}\n` +
        `${DIM}   valable ${minutes} min${scopes.length ? `, scopes : ${scopes.join(" ")}` : ", aucun scope"}${RESET}\n\n`,
    );

    if (ecrire) {
      if (this.#dotenvTracked()) {
        w(
          `${YELLOW}⚠ .env.local est SUIVI par git — rien n'est écrit.${RESET}\n` +
            `${DIM}  Un jeton commité est un jeton publié. Ajoute .env.local au .gitignore.${RESET}\n\n`,
        );
      } else if (
        new RegExp(`^\\s*${MCP_TOKEN_ENV}\\s*=`, "m").test(
          this.#read(".env.local"),
        )
      ) {
        // Jamais de remplacement : une rotation est un geste explicite, et
        // écraser en silence ferait perdre un jeton encore utilisé ailleurs.
        w(
          `${YELLOW}⚠ ${MCP_TOKEN_ENV} existe déjà dans .env.local — inchangé.${RESET}\n` +
            `${DIM}  Remplace la ligne à la main pour tourner le jeton :${RESET}\n\n` +
            `  ${MCP_TOKEN_ENV}=${jeton}\n\n` +
            `${DIM}  Et pour ton agent — qui ne lit AUCUN .env, il résout la variable dans\n` +
            `  son propre environnement :${RESET}\n\n` +
            `  ${BOLD}export ${MCP_TOKEN_ENV}=${jeton}${RESET}\n\n`,
        );
      } else {
        // Le commentaire dit CE QUE CE JETON PEUT — compte, rôles, scopes,
        // durée. Un jeton est opaque à l'œil : sans cette ligne, celui qui
        // relit `.env.local` dans trois semaines ne sait ni qui il incarne, ni
        // pourquoi la porte le refuse (elle le refusera : il aura expiré).
        const roles = (user.roles ?? []) as readonly string[];
        appendFileSync(
          path.resolve(this.#root(), ".env.local"),
          `\n# Jeton de la porte MCP — compte « ${identifier} »` +
            `${roles.length ? ` · rôles ${roles.join(", ")}` : " · aucun rôle"}` +
            `${scopes.length ? ` · scopes ${scopes.join(" ")}` : " · aucun scope"}\n` +
            `# audience ${resource} · valable ${minutes} min` +
            ` à partir du ${new Date().toISOString()}\n` +
            `${MCP_TOKEN_ENV}=${jeton}\n`,
          "utf8",
        );
        w(
          `${GREEN}✓ ${MCP_TOKEN_ENV} écrit dans .env.local${RESET} ${DIM}(gitignoré)${RESET}\n\n` +
            // 🔴 CE QUI MANQUAIT, et qui coûtait une heure de diagnostic.
            // `.env.local` est lu par l'APPLICATION à son démarrage. Le client
            // MCP, lui, ne le lit jamais : il résout `\${NF_MCP_TOKEN}` de
            // `.mcp.json` dans SON PROPRE environnement. Absent, il envoie
            // l'en-tête non substitué — et le serveur répond « autorisation
            // requise », un 401 qui accuse le jeton alors qu'il est parfait.
            // « Redémarre ton agent » laissait croire que le fichier suffisait.
            `${YELLOW}⚠ .env.local ne suffit PAS pour ton agent.${RESET}\n` +
            `${DIM}  Ce fichier est lu par l'APPLICATION à son démarrage. Le client MCP, lui,\n` +
            `  résout \${${MCP_TOKEN_ENV}} de .mcp.json dans SON environnement — il ne lit\n` +
            `  aucun .env. Sans la variable, il envoie l'en-tête tel quel et reçoit un 401\n` +
            `  « autorisation requise », qui accuse le jeton à tort.${RESET}\n\n` +
            `  Deux façons de la lui donner — dans les deux cas, RELANCE l'agent :\n\n` +
            `  ${BOLD}export ${MCP_TOKEN_ENV}=${jeton}${RESET}\n` +
            `${DIM}    …dans le shell d'où tu le lances (vaut pour tout agent).${RESET}\n\n` +
            `${DIM}  ou, pour Claude Code, une valeur qui SURVIT au shell — clé "env" de\n` +
            `  .claude/settings.local.json (fichier local, jamais commité) :${RESET}\n\n` +
            `  ${BOLD}{ "env": { "${MCP_TOKEN_ENV}": "<le jeton>" } }${RESET}\n\n`,
        );
      }
      return this;
    }

    w(`  export ${MCP_TOKEN_ENV}=${jeton}\n\n`);
    w(
      `${DIM}  --write pose la valeur dans .env.local · nodefony ai:mcp --auth câble .mcp.json${RESET}\n\n`,
    );
    return this;
  }
}

export default SecurityToken;
