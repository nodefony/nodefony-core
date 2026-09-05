import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  OptionsCommandInterface,
  CliKernel,
  Command,
  MCP_ENDPOINT_PATH,
  MCP_TOKEN_ENV,
  ADMIN_SCOPE_READ,
  ADMIN_SCOPE_WRITE,
  AGENT_TARGETS,
  chargePrompts,
  agentsPresents,
  requestedAgents,
  poseVariable,
  alreadyHasKey,
  agentRoot,
  type IAgentTarget,
} from "nodefony";
import type { UserService } from "@nodefony/user";
import type TokenService from "../service/tokenService";
import {
  ecrireSecretSync,
  lireSiPresentSync,
  messageNonRestreint,
  modeNonRestreint,
} from "../src/token/secretFile";

const options: OptionsCommandInterface = {
  helpGroup: "COMPTES ET SECRETS",
  showBanner: false,
  // Services prêts, AUCUN serveur en écoute : cette commande SIGNE un jeton,
  // elle n'en demande pas un à une porte HTTP. C'est ce qui la rend utilisable
  // sans que l'application tourne — et sans mot de passe.
  kernelEvent: "onReady",
  // Le journal de cycle de vie n'est pas la sortie : ici la sortie est un jeton
  // qu'on copie ou qu'on exporte.
  quietBoot: true,
};

/**
 * La table des agents, leurs emplacements de secret et la façon de leur
 * déclarer la porte vivent dans le CŒUR (`nodefony/cli/agentTargets`) : ce sont
 * `ai:mcp` et `create app` — des commandes du cœur — qui déclarent la porte,
 * quand cette commande-ci pose le jeton. Deux tables recopiées auraient divergé
 * au premier agent ajouté d'un seul côté, et la divergence se serait vue chez
 * l'utilisateur, sous la forme d'un agent servi par l'une et ignoré par l'autre.
 */

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
 * Suit `security:secrets` : `--write` pose la valeur là où l'AGENT la lit
 * (gitignoré), jamais dans le `.env` commité, et ne remplace jamais une valeur
 * existante — une rotation est un geste explicite.
 */
class SecurityToken extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:token",
      `émet un jeton d'accès pour la porte MCP`,
      cli,
      options,
    );
    this.addArgument(
      "[identifier]",
      "compte porteur du jeton (défaut : admin)",
    );
    this.addOption(
      "-s, --scope <scopes>",
      `scopes demandés, séparés par des espaces (défaut : « ${ADMIN_SCOPE_READ} » ; ajouter « ${ADMIN_SCOPE_WRITE} » pour les mutations)`,
    );
    this.addOption(
      "-r, --resource <uri>",
      "audience visée (défaut : la porte MCP de cette application)",
    );
    this.addOption(
      "-a, --agent <noms>",
      "agents à servir, séparés par des virgules (défaut : ceux détectés ; « none » pour aucun)",
    );
    this.addOption(
      "-t, --ttl <duree>",
      "durée de validité, en minutes (défaut : celle de la config, 15 min)",
    );
    this.addOption(
      "-w, --write",
      `pose ${MCP_TOKEN_ENV} dans la configuration des agents présents`,
    );
    this.addOption("-j, --json", "sortie JSON (scripts/CI)");
  }

  /** Racine du projet (le kernel la connaît ; repli sur le cwd). */
  #root(): string {
    return this.kernel?.path ?? process.cwd();
  }

  /** Ce fichier est-il couvert par un `.gitignore` ? */
  #gitIgnored(file: string): boolean {
    try {
      return (
        spawnSync("git", ["check-ignore", "-q", file], {
          cwd: this.#root(),
          stdio: "ignore",
        }).status === 0
      );
    } catch {
      return false;
    }
  }

  /** Ce fichier est-il SUIVI par git ? Un secret n'entre pas dans un suivi. */
  #tracked(file: string): boolean {
    try {
      return (
        spawnSync("git", ["ls-files", "--error-unmatch", file], {
          cwd: this.#root(),
          stdio: "ignore",
        }).status === 0
      );
    } catch {
      return false;
    }
  }

  /**
   * Racine où vit la configuration d'une cible (projet, ou dossier maison).
   *
   * La résolution elle-même vit dans le cœur, avec la table : recopiée ici,
   * elle aurait cessé d'honorer `CODEX_HOME`/`VIBE_HOME` le jour où l'une des
   * deux copies aurait bougé — et le symptôme aurait été un jeton posé dans un
   * dossier que l'agent ne lit pas, donc un 401 qui accuse le jeton.
   */
  #racineDe(cible: IAgentTarget): string {
    return agentRoot(cible, { projectRoot: this.#root() });
  }

  /** Contenu du fichier d'une cible, "" s'il n'existe pas. */
  #contenuDe(cible: IAgentTarget): string {
    try {
      const abs = path.resolve(this.#racineDe(cible), cible.file);
      return lireSiPresentSync(abs) ?? "";
    } catch {
      return "";
    }
  }

  /**
   * Agents dont la présence est CONSTATÉE — on ne crée pas la configuration
   * d'un outil que personne n'utilise ici.
   */
  #agentsPresents(): IAgentTarget[] {
    // ⭐ La règle de détection vit au CŒUR (`agentsPresents`), elle n'est pas
    // recopiée ici. Cette copie portait le même cercle vicieux que l'original :
    // un agent dont la configuration s'écrit dans le PROJET n'était constaté
    // que si le projet était DÉJÀ configuré pour lui — donc jamais servi la
    // première fois. Deux implémentations d'une même règle divergent, et c'est
    // toujours celle qu'on relit le moins qui garde le défaut.
    return agentsPresents({ projectRoot: this.#root(), exists: existsSync });
  }

  /**
   * Pose le jeton dans la configuration des agents PRÉSENTS dans ce projet.
   *
   * Un agent n'est servi que si son marqueur existe : on ne crée pas la
   * configuration d'un outil que personne n'utilise ici. Et jamais dans un
   * fichier SUIVI par git — un jeton commité est un jeton publié, et c'est la
   * seule faute de cette commande qui serait irrattrapable.
   *
   * @param jeton - le jeton à poser
   * @param w - la sortie où rendre compte
   * @param cibles - agents à servir (déjà filtrés par le choix de l'appelant)
   * @returns le nombre d'agents effectivement servis
   */
  #poseChezAgents(
    jeton: string,
    w: (t: string) => void,
    cibles: readonly IAgentTarget[],
  ): number {
    let servis = 0;
    for (const cible of cibles) {
      const racine = this.#racineDe(cible);
      // La garde git ne vaut que pour le projet : le dossier de l'utilisateur
      // n'est pas versionné, et `git ls-files` y répondrait sur un autre dépôt.
      if (cible.scope === "projet" && this.#tracked(cible.file)) {
        w(
          `${YELLOW}⚠ ${cible.file} est SUIVI par git — rien n'est écrit.${RESET}\n` +
            `${DIM}  Un jeton commité est un jeton publié.${RESET}\n\n`,
        );
        continue;
      }
      const abs = path.resolve(racine, cible.file);
      // Lire d'abord, traiter l'absence ensuite : `existsSync` puis `read` teste
      // un état qui peut changer avant l'usage — et l'on écrit ici un SECRET.
      const pose = poseVariable(
        cible.forme,
        lireSiPresentSync(abs) ?? "",
        MCP_TOKEN_ENV,
        jeton,
      );
      if (pose instanceof Error) {
        w(
          `${YELLOW}⚠ ${cible.file} : ${pose.message} — rien n'est écrit.${RESET}\n\n`,
        );
        continue;
      }
      try {
        // 🔴 Ce fichier porte un JETON. Écrit au masque par défaut, il serait
        // lisible par tout compte de la machine — et rien ne le signalerait.
        // Même écriture que la clé privée du keystore : 0600, atomique.
        ecrireSecretSync(abs, pose);
      } catch (error) {
        w(
          `${YELLOW}⚠ ${cible.file} : écriture impossible — ${(error as Error).message}${RESET}\n\n`,
        );
        continue;
      }
      // Le mode demandé est une intention, pas une garantie (NTFS l'ignore, comme
      // FAT/exFAT ou NFS sans mapping). On le CONSTATE plutôt que de le déduire
      // de la plateforme — et s'il n'a pas pris, on le dit à celui qui vient de
      // déposer un secret, au moment où il peut encore agir.
      const modeObtenu = modeNonRestreint(abs);
      if (typeof modeObtenu === "number") {
        w(`${YELLOW}⚠ ${messageNonRestreint(abs, modeObtenu)}${RESET}\n`);
      }
      w(
        `${GREEN}✓ ${MCP_TOKEN_ENV} posé pour ${cible.name}${RESET} ` +
          // Le chemin AFFICHÉ est celui qu'on a réellement écrit : rendre
          // « .env » pour un fichier qui vit dans le dossier de l'utilisateur
          // le ferait confondre avec celui du projet, et chercher au mauvais
          // endroit le jour où quelque chose cloche.
          `${DIM}(${cible.scope === "projet" ? cible.file : abs})${RESET}\n` +
          `${DIM}  RELANCE-le : il lit sa configuration au démarrage.${RESET}\n`,
      );
      // Le fichier n'est pas suivi AUJOURD'HUI — mais rien n'empêche un
      // `git add -A` de l'emporter demain. Un jeton commité est un jeton
      // publié : la seule faute de cette commande qui serait irrattrapable.
      if (cible.scope === "projet" && !this.#gitIgnored(cible.file)) {
        w(
          `${YELLOW}  ⚠ ${cible.file} n'est PAS couvert par .gitignore — ` +
            `un « git add -A » l'emporterait.${RESET}\n`,
        );
      }
      w("\n");
      servis += 1;
    }
    return servis;
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
      agent?: string;
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
    // 🔴 Défaut UTILE, pas défaut vide. Ce jeton part dans la configuration
    // d'un agent : il vise la porte MCP, qui exige un scope d'administration.
    // Un jeton sans scope serait accepté par la vérification d'audience puis
    // refusé à la première lecture — un 401 remplacé par un 403, et l'utilisateur
    // n'aurait aucune raison de soupçonner le scope.
    //
    // LECTURE seule par défaut, et c'est le point : `admin:write` n'ouvre rien
    // de plus aujourd'hui (le plan n'a qu'un rôle, lectures et mutations
    // confondues), mais le jour où la distinction deviendra réelle, tous les
    // jetons émis d'office porteraient le pouvoir d'écrire sans que personne ne
    // l'ait décidé. Le défaut le plus étroit se durcit tout seul dans le bon
    // sens ; muter s'ÉCRIT (`--scope "admin:read admin:write"`).
    //
    // Ce défaut n'accorde rien de plus : `TokenService` retire les scopes
    // d'administration qu'un porteur non administrateur ne peut pas obtenir.
    // La sortie ci-dessous affiche ce qui a été RÉELLEMENT accordé.
    const scopesDemandes = (opts.scope ?? "").split(/\s+/u).filter(Boolean);
    const scopes =
      scopesDemandes.length > 0 ? scopesDemandes : [ADMIN_SCOPE_READ];
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
        // 🔴 Le diagnostic se CONSTATE, il ne se suppose pas. Ce message a
        // longtemps accusé une seule cause — « ce terminal n'a pas posé
        // NODE_ENV » — pour TOUTES les demandes refusées, et il se contredisait
        // dans sa propre phrase : il affichait « démarré en development » juste
        // après avoir dit que l'environnement n'était pas posé. En development,
        // la cause est ailleurs, et elle est même la plus fréquente dans une
        // application NEUVE : l'audience n'est pas déclarée à l'émetteur.
        const env = this.kernel?.environment ?? "?";
        const enDev = env === "development";
        this.log(
          `impossible d'émettre un jeton pour cette porte ici.\n` +
            `\n` +
            `  Ce n'est PAS un problème de serveur : cette commande n'en a pas\n` +
            `  besoin, elle signe le jeton elle-même.\n` +
            `\n` +
            `  La porte visée : ${resource}\n` +
            `  Environnement CONSTATÉ : ${env}\n` +
            `\n` +
            (enDev
              ? `  Cette application n'accepte pas cette audience. Une audience se\n` +
                `  DÉCLARE — c'est une liste blanche (RFC 8707), sans quoi tout\n` +
                `  porteur obtiendrait un jeton pour la ressource de son choix :\n` +
                `\n` +
                `      use("@nodefony/security", {\n` +
                `        jwt: { audiences: ["${resource}"] },\n` +
                `      })\n` +
                `\n` +
                `  → puis npm run build (le runtime lit le dist)\n`
              : `  La porte est servie par un module de DÉVELOPPEMENT, absent en\n` +
                `  « ${env} » : un jeton pour une porte absente n'aurait personne\n` +
                `  pour l'accepter.\n` +
                `\n` +
                `  → NODE_ENV=development nodefony security:token${opts.write ? " --write" : ""}\n`) +
            `  → ou vise une autre porte : --resource <uri>`,
          "ERROR",
        );
        process.exitCode = 1;
        return this;
      }
      throw e;
    }
    const jeton = emis.access_token;
    // 🔴 Ce qui est RENDU, ce sont les scopes ACCORDÉS, jamais ceux demandés :
    // l'émetteur retire ceux que ce porteur ne peut pas obtenir (RFC 6749 §3.3
    // l'y autorise à condition de le dire). Afficher la demande ferait croire à
    // un pouvoir que le jeton n'a pas, et le refus arriverait plus tard, ailleurs.
    const accordes = (emis.scope ?? "").split(/\s+/u).filter(Boolean);
    const nonAccordes = scopes.filter((s) => !accordes.includes(s));

    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ access_token: jeton, resource, scopes: accordes, requested: scopes, expires_in: emis.expires_in }, null, 2)}\n`,
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
        message: `Poser ${MCP_TOKEN_ENV} dans la configuration des agents présents ?`,
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
        `${DIM}   valable ${minutes} min${accordes.length ? `, scopes : ${accordes.join(" ")}` : ", aucun scope"}${RESET}\n\n`,
    );
    if (nonAccordes.length > 0) {
      // Le silence ici produirait un 403 inexplicable à la première lecture.
      w(
        `${DIM}   ⚠️  non accordé(s) : ${nonAccordes.join(" ")} — réservé(s) au ` +
          `rôle d'administration, que le compte « ${identifier} » ne porte pas.${RESET}\n\n`,
      );
    }

    if (ecrire) {
      // 🔴 Le jeton ne va PLUS dans `.env.local`, et c'est un retrait motivé :
      // AUCUN code de l'application ne lit `NF_MCP_TOKEN`. C'est cohérent — une
      // application est ici le serveur de RESSOURCE : elle vérifie les jetons
      // qu'on lui présente, elle n'en porte aucun. Le secret y dormait donc sans
      // lecteur, pure surface d'attaque, pendant que le seul consommateur — un
      // agent — le cherchait ailleurs et recevait un 401 qui accusait le jeton.
      // Et la duplication ne survivait pas à la première rotation : le fichier
      // refusait d'être touché quand les agents, eux, recevaient le neuf.
      const demandes = requestedAgents(opts.agent);
      if (demandes instanceof Error) {
        this.log(demandes.message, "ERROR");
        process.exitCode = 1;
        return this;
      }
      let cibles = demandes ?? [];
      if (demandes === undefined) {
        const presents = this.#agentsPresents();
        // ⭐ ROTATION : un agent qui PORTE déjà la clé a été câblé un jour. Le
        // relancer doit la mettre à jour SANS reposer la question — sinon
        // renouveler un jeton redevient un questionnaire, et c'est le geste le
        // plus fréquent. L'état n'est pas mémorisé : il est lu là où il vit.
        const porteurs = presents.filter((c) =>
          alreadyHasKey(c.forme, this.#contenuDe(c), MCP_TOKEN_ENV),
        );
        const nouveaux = presents.filter((c) => !porteurs.includes(c));
        cibles = porteurs;
        if (
          porteurs.length === 0 &&
          nouveaux.length > 0 &&
          process.stdin.isTTY
        ) {
          // PREMIÈRE fois : écrire dans la configuration d'un autre outil est un
          // geste qui se voit et se refuse, donc on propose.
          // Par la porte du cœur : les questions en sortent ancrées sur l'event
          // loop (cf `cli/prompts.ts`). Un import direct recrée le défaut.
          const { checkbox } = await chargePrompts();
          const choisis = (await checkbox({
            message: "Poser le jeton chez quels agents ?",
            choices: nouveaux.map((c) => ({
              name: `${c.name} — ${c.scope === "projet" ? c.file : `$${c.home}/${c.file}`}`,
              value: c.key,
              checked: true,
            })),
          })) as string[];
          cibles = nouveaux.filter((c) => choisis.includes(c.key));
        } else if (porteurs.length === 0) {
          // Hors terminal : servir ce qui est détecté, sinon la commande ne
          // ferait rien du tout dans un script.
          cibles = nouveaux;
        } else if (nouveaux.length > 0) {
          // Des agents sont là mais n'ont jamais été câblés : le DIRE, sans
          // décider à leur place — la rotation ne doit pas élargir le périmètre.
          w(
            `${DIM}  ${nouveaux.map((c) => c.name).join(", ")} ` +
              `${nouveaux.length > 1 ? "sont présents" : "est présent"} mais ne porte` +
              `${nouveaux.length > 1 ? "nt" : ""} pas encore le jeton — ` +
              `ajoute --agent ${nouveaux.map((c) => c.key).join(",")}.${RESET}\n\n`,
          );
        }
      }
      const servis = this.#poseChezAgents(jeton, w, cibles);
      if (servis === 0) {
        w(
          `${YELLOW}⚠ aucun agent reconnu dans ce projet — rien n'est écrit.${RESET}\n` +
            `${DIM}  Les agents connus rangent leur configuration ici :${RESET}\n` +
            AGENT_TARGETS.map(
              (c) =>
                `${DIM}    ${c.name} : ${c.scope === "projet" ? c.file : `$${c.home ?? "HOME"}/${c.file}`}${RESET}\n`,
            ).join("") +
            `\n  Le geste qui vaut pour TOUS — dans le shell d'où tu lances l'agent :\n\n` +
            `  ${BOLD}export ${MCP_TOKEN_ENV}=${jeton}${RESET}\n\n`,
        );
      }
      w(
        `${DIM}  Vibe et Codex prennent le NOM de la variable, pas le secret — ` +
          `déclare la porte une fois :${RESET}\n\n` +
          `  ${DIM}vibe mcp add nodefony --transport streamable-http \\${RESET}\n` +
          `  ${DIM}  --url ${resource} --api-key-env ${MCP_TOKEN_ENV}${RESET}\n` +
          `  ${DIM}codex mcp add nodefony --url ${resource} \\${RESET}\n` +
          `  ${DIM}  --bearer-token-env-var ${MCP_TOKEN_ENV}${RESET}\n\n`,
      );
      return this;
    }

    w(`  export ${MCP_TOKEN_ENV}=${jeton}\n\n`);
    w(
      `${DIM}  --write pose la valeur chez les agents présents · nodefony ai:mcp --auth câble .mcp.json${RESET}\n\n`,
    );
    return this;
  }
}

export default SecurityToken;
