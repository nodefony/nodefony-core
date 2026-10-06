import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { readIfPresentSync } from "../src/token/secretFile.js";
import { generateKeySet } from "../src/token/JwtKeystore.js";
import path from "node:path";
import {
  OptionsCommandInterface,
  CliKernel,
  Command,
  readManifestCode,
  manifestFileWith,
  diskManifestReader,
  ENV_FILE,
} from "nodefony";

const options: OptionsCommandInterface = {
  helpGroup: "COMPTES ET SECRETS",
  showBanner: false,
  kernelEvent: "onReady",
};

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/** Les 3 clés générées (nom d'env var → rôle affiché). */
const KEYS = ["NF_TOTP_KEY", "NF_WEBHOOK_KEY", "NF_CSRF_SECRET"] as const;

/**
 * Ce que chaque secret PROTÈGE, et ce qui casse sans lui.
 *
 * 🔴 Sans ce catalogue, la commande était muette sur l'essentiel : quand les
 * trois clés étaient en place, elle affichait trois « ✓ » et RIEN d'autre — ni
 * les noms, ni les rôles. On ne savait donc ni ce qui avait été généré, ni
 * pourquoi. Un secret qu'on ne comprend pas est un secret qu'on ne fait jamais
 * tourner, et qu'on recopie d'un environnement à l'autre.
 *
 * La conséquence est écrite au présent et pour la PRODUCTION : c'est là qu'une
 * clé absente cesse d'être un avertissement de développement.
 */
const ROLES: Record<string, { protected: string; without: string }> = {
  NF_TOTP_KEY: {
    protected: "chiffre le secret 2FA de chaque compte au repos (AES-256-GCM)",
    without:
      "2FA désactivé en production — un secret chiffré par une clé éphémère serait illisible au redémarrage",
  },
  NF_WEBHOOK_KEY: {
    protected: "chiffre les secrets de signature des webhooks au repos",
    without:
      "webhooks désactivés en production (fail-safe, jamais de signature muette)",
  },
  NF_CSRF_SECRET: {
    protected: "signe les jetons anti-rejeu des mutations (`@CsrfProtect`)",
    without:
      "démarrage REFUSÉ en production (code 78) — une valeur tirée au hasard différerait d'un exemplaire à l'autre",
  },
  NF_JWT_KEYSET: {
    protected:
      "signe les jetons JWT (paire Ed25519) — la MÊME pour tous les pods et workers",
    without:
      "démarrage REFUSÉ en production dès que l'application émet des jetons — sinon 401 au hasard derrière plusieurs exemplaires, et tous les jetons perdus au redémarrage",
  },
};

/**
 * `nodefony security:secrets` — génère les clés de chiffrement attendues par le
 * module security (TOTP, webhooks, CSRF) au bon format (32 octets aléatoires,
 * base64) et guide le câblage en 3 FICHIERS (.env → env.ts → nodefony.config.ts).
 * Réponse directe aux warnings « clé ÉPHÉMÈRE générée » du boot.
 *
 * DX anti-confusion (vécu : blocs collés dans le shell → parse error zsh) :
 * - chaque étape nomme son FICHIER et rappelle que rien ne se tape au terminal ;
 * - les étapes déjà faites sont DÉTECTÉES (grep des fichiers du projet) et
 *   affichées `✓` au lieu de redemander un collage ;
 * - `--write` écrit le `.env` (fichier local gitignoré) : ajoute uniquement les
 *   clés ABSENTES, ne remplace jamais une valeur existante (rotation = manuelle).
 * `env.ts` et `nodefony.config.ts` ne sont JAMAIS modifiés (code de l'app).
 */
class SecuritySecrets extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:secrets",
      "engendre les clés de chiffrement du module security",
      cli,
      options,
    );
    this.addOption("-j, --json", "sortie JSON (scripts/CI)");
    this.addOption(
      "-w, --write",
      "écrit les clés manquantes dans le .env du projet (jamais de remplacement)",
    );
    this.addOption(
      "-e, --env",
      "les 4 secrets en lignes CLÉ=valeur (docker run --env-file, gestionnaire de secrets)",
    );
    this.addOption(
      "-k, --jwt-keyset",
      "génère la valeur de NF_JWT_KEYSET (une ligne JSON, à ranger dans le gestionnaire de secrets)",
    );
  }

  /** Racine du projet (kernel booté) — repli cwd. */
  #root(): string {
    return this.kernel?.path ?? process.cwd();
  }

  /**
   * `true` si `.env` est SUIVI par git — y écrire des secrets les mènerait au
   * commit (`.env` doit être gitignoré). Best-effort : git absent / hors repo →
   * `false` (on écrit).
   */
  #dotenvTracked(): boolean {
    try {
      return (
        spawnSync("git", ["ls-files", "--error-unmatch", ENV_FILE], {
          cwd: this.#root(),
          stdio: "ignore",
        }).status === 0
      );
    } catch {
      return false;
    }
  }

  /** Contenu d'un fichier du projet, "" si absent/illisible (détection best-effort). */
  #read(file: string): string {
    try {
      // `lireSiPresentSync` plutôt qu'un `existsSync ? read : ""` de plus : le
      // paquet porte DÉJÀ cette règle, et deux copies d'une lecture tolérante
      // divergent — l'une distingue « absent » d'« illisible », l'autre non.
      return readIfPresentSync(path.resolve(this.#root(), file)) ?? "";
    } catch {
      return "";
    }
  }

  // Commande SANS argument positionnel → commander appelle l'action avec
  // (options, command) : les options sont le PREMIER argument.
  override async generate(opts: {
    json?: boolean;
    write?: boolean;
    jwtKeyset?: boolean;
    env?: boolean;
  }): Promise<this> {
    // La valeur SEULE, sur la sortie standard : elle se redirige telle quelle
    // vers un gestionnaire de secrets (`| kubectl create secret … --from-file`).
    if (opts.jwtKeyset) {
      process.stdout.write((await generateKeySet()) + "\n");
      return this;
    }
    // 32 octets = exigence AES-256-GCM (HKDF côté cipher) ; base64 = sûr en .env.
    const gen = (): string => randomBytes(32).toString("base64");
    const secrets: Record<string, string> = {};
    for (const k of KEYS) secrets[k] = gen();

    if (opts.json) {
      secrets["NF_JWT_KEYSET"] = await generateKeySet();
      process.stdout.write(JSON.stringify(secrets, null, 2) + "\n");
      return this;
    }
    // Une ligne `CLÉ=valeur` par secret, SANS guillemets ni commentaire : c'est
    // le format que `docker run --env-file` lit tel quel (la valeur est prise
    // littéralement, le JSON du jeu de clés compris). C'est ce qui permet à une
    // image de produire ses propres secrets sans outil sur le poste :
    // `docker run --rm <image> node_modules/.bin/nodefony security:secrets --env > nodefony.env`.
    if (opts.env) {
      secrets["NF_JWT_KEYSET"] = await generateKeySet();
      process.stdout.write(
        Object.entries(secrets)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n") + "\n",
      );
      return this;
    }

    // ── Détection de l'existant (le « une seule fois » devient automatique) ──
    // `.env` porte les valeurs du POSTE (gitignoré) — c'est là que vont les clés.
    const dotenv = this.#read(ENV_FILE);
    const envTs = this.#read("env.ts");
    // Le manifeste ET ses fragments, en CODE : la documentation donne `security`
    // en exemple d'extraction — après ce geste, lire la seule racine faisait
    // réclamer de coller un bloc déjà en place et déclarait `jwt.keystore`
    // non câblé. Sur les secrets, un faux constat coûte cher.
    const cfgTs = readManifestCode(this.#root(), diskManifestReader);
    // QUEL fichier porte cette configuration — le fragment
    // `nodefony/config/security.ts` depuis son extraction, la racine dans une
    // application qui n'a pas extrait. Le nommer en dur envoie ouvrir un
    // fichier où la clé n'est pas : on ne la trouve pas, et on invente. Le
    // motif est le `satisfies` du bloc, et RIEN d'autre : le nom du module
    // figure dans l'index racine (le `use(…)`), et le type d'entrée y figure
    // AUSSI — le manifeste le re-exporte pour ses fragments. L'un comme
    // l'autre auraient désigné la racine, qui est testée en premier, et la
    // commande aurait continué de nommer le mauvais fichier en ayant l'air
    // de le chercher. Une application qui n'a pas extrait n'a pas ce motif :
    // le repli sur la racine est alors le bon fichier.
    const cfgFile = manifestFileWith(
      this.#root(),
      diskManifestReader,
      /satisfies\s+ISecurityConfigInput/,
    );
    const cfgRel = path
      .relative(this.#root(), cfgFile)
      .split(path.sep)
      .join("/");
    const cfgIsFragment = cfgRel !== "nodefony.config.ts";
    const missingInDotenv = KEYS.filter(
      (k) => !new RegExp(`^\\s*${k}\\s*=`, "m").test(dotenv),
    );
    // Granularité PAR CLÉ : on ne redemande jamais un collage déjà fait (2 clés
    // déclarées sur 3 → seule la 3ᵉ est proposée).
    const missingInEnvTs = KEYS.filter((k) => !envTs.includes(k));
    const WIRING: Record<(typeof KEYS)[number], string> = {
      NF_TOTP_KEY: `     totp:     { encryptionKey: ctx.env.NF_TOTP_KEY },`,
      NF_WEBHOOK_KEY: `     webhooks: { encryptionKey: ctx.env.NF_WEBHOOK_KEY },`,
      NF_CSRF_SECRET: `     csrf:     { secret: ctx.env.NF_CSRF_SECRET },`,
    };
    const missingInCfg = KEYS.filter((k) => !cfgTs.includes(k));

    const w = (s: string): void => {
      process.stdout.write(s);
    };
    w(
      `\n${BOLD}🔐 Secrets du module security${RESET} ${DIM}— 4 secrets, 3 fichiers${RESET}\n\n`,
    );
    // Ce que chaque secret PROTÈGE, avant de dire s'il est en place : « ✓ » sur
    // un nom qu'on ne comprend pas n'apprend rien, et c'est ce que la commande
    // affichait quand tout était câblé.
    for (const [name, role] of Object.entries(ROLES)) {
      // La clé de signature n'a PAS de valeur dans `.env` (cf étape 4) :
      // elle est en place quand le câblage la lit.
      const pose =
        name === "NF_JWT_KEYSET"
          ? cfgTs.includes(name)
          : new RegExp(`^\\s*${name}\\s*=`, "m").test(dotenv);
      w(
        `  ${pose ? GREEN + "✓" : YELLOW + "○"}${RESET} ${BOLD}${name.padEnd(16)}${RESET}${DIM}${role.protected}${RESET}\n` +
          `    ${DIM}sans → ${role.without}${RESET}\n`,
      );
    }
    // 🔴 Ce qui N'EST PAS un secret de cette application, et la question qui
    // vient : « pourquoi NF_MCP_TOKEN n'est pas là ? ». Ce n'est pas une clé
    // dont l'application a besoin pour fonctionner — AUCUN de son code ne la
    // lit : c'est un JETON qu'elle ÉMET, que son porteur présente pour entrer.
    // Il ne vit donc pas ici mais chez l'agent qui le porte. Le taire
    // laisserait croire à un oubli.
    const tokenStillThere = /^\s*NF_MCP_TOKEN\s*=/m.test(dotenv);
    w(
      `\n${DIM}  · NF_MCP_TOKEN n'est PAS un secret de cette application, et n'a rien à\n` +
        `    faire dans cette liste : c'est un jeton qu'elle ÉMET, présenté par un\n` +
        `    agent pour entrer. Aucun code d'ici ne le lit. Il se pose chez l'agent\n` +
        `    qui le porte — nodefony security:token --write.${RESET}\n`,
    );
    if (tokenStillThere) {
      // Une ligne héritée du temps où `--write` écrivait ici : un secret sans
      // lecteur, qui ne fait qu'attendre d'être commité par erreur.
      w(
        `${YELLOW}  ⚠ une ligne NF_MCP_TOKEN traîne encore dans .env — rien ne la lit,\n` +
          `    tu peux la retirer.${RESET}\n`,
      );
    }
    w(
      `\n${YELLOW}⚠ rien ne se tape dans le terminal : chaque bloc se colle dans le fichier indiqué.${RESET}\n\n`,
    );

    // ── 1. .env : les VALEURS du poste (gitignoré, jamais commité) ──────────
    w(
      `${BOLD}1. Fichier ${CYAN}.env${RESET}${BOLD} — les valeurs${RESET} ${DIM}(valeurs du poste, gitignoré ; la notice est .env.example)${RESET}\n`,
    );
    if (missingInDotenv.length === 0) {
      w(
        `   ${GREEN}✓ les 3 clés y sont déjà${RESET} ${DIM}(rien à faire — rotation = remplacer la valeur à la main)${RESET}\n\n`,
      );
    } else if (opts.write && this.#dotenvTracked()) {
      // Fail-safe : un secret écrit dans un fichier SUIVI par git finit commité.
      w(
        `   ${YELLOW}⚠ .env est suivi par git — je n'y écris PAS de secrets.${RESET}\n` +
          `   ${DIM}Ajoute \`.env\` au .gitignore (et \`git rm --cached .env\`), puis relance --write ;\n` +
          `   ou colle les lignes ci-dessous à la main :${RESET}\n\n` +
          missingInDotenv.map((k) => `   ${k}=${secrets[k]}`).join("\n") +
          `\n\n`,
      );
    } else if (opts.write) {
      const block =
        (dotenv && !dotenv.endsWith("\n") ? "\n" : "") +
        `# clés security — générées par \`nodefony security:secrets\`\n` +
        missingInDotenv.map((k) => `${k}=${secrets[k]}`).join("\n") +
        "\n";
      appendFileSync(path.resolve(this.#root(), ENV_FILE), block);
      w(
        `   ${GREEN}✓ écrit dans .env${RESET} ${DIM}(${missingInDotenv.join(", ")} — les clés déjà présentes n'ont pas été touchées)${RESET}\n\n`,
      );
    } else {
      w(
        `   colle ces lignes ${DIM}(ou relance avec ${RESET}${CYAN}--write${RESET}${DIM} pour que je les écrive)${RESET} :\n\n` +
          missingInDotenv.map((k) => `   ${k}=${secrets[k]}`).join("\n") +
          `\n   ${DIM}(en prod : Secret k8s / vault — jamais en git)${RESET}\n\n`,
      );
    }

    // ── 2. env.ts : la DÉCLARATION typée ─────────────────────────────────────
    w(
      `${BOLD}2. Fichier ${CYAN}env.ts${RESET}${BOLD} — la déclaration typée${RESET} ${DIM}(env.ts est le seul lecteur de process.env)${RESET}\n`,
    );
    if (missingInEnvTs.length === 0) {
      w(`   ${GREEN}✓ déjà déclarées${RESET}\n\n`);
    } else {
      w(
        `   ajoute dans le defineEnv({ … }) :\n\n` +
          missingInEnvTs
            .map((k) => `   ${k}: envString({ optional: true }),`)
            .join("\n") +
          `\n\n`,
      );
    }

    // ── 3. La configuration du module : le CÂBLAGE ───────────────────────────
    w(
      `${BOLD}3. Fichier ${CYAN}${cfgRel}${RESET}${BOLD} — le câblage vers le module security${RESET}\n`,
    );
    if (missingInCfg.length === 0) {
      w(`   ${GREEN}✓ déjà câblées${RESET}\n\n`);
    } else if (cfgIsFragment) {
      w(
        `   complète le descripteur ${CYAN}securityConfig${RESET} :\n\n` +
          missingInCfg.map((k) => WIRING[k]).join("\n") +
          `\n\n`,
      );
    } else {
      w(
        `   complète l'entrée security du manifeste modules :\n\n` +
          `   use("@nodefony/security", {\n` +
          missingInCfg.map((k) => WIRING[k]).join("\n") +
          `\n   }),\n\n`,
      );
    }

    // ── 4. La clé de SIGNATURE des jetons : une autre nature de secret ──────
    //
    // Pas 32 octets aléatoires mais une PAIRE Ed25519 en JSON, et pas de valeur
    // dans `.env` : en développement le keystore la génère lui-même dans
    // `var/keys/` (persistée, création exclusive entre workers). Une clé privée
    // de PRODUCTION posée sur un poste de dev n'y servirait à rien — elle n'y
    // apporterait que le risque de fuir. Elle se génère à part, et part
    // directement dans le gestionnaire de secrets.
    const jwtDeclared = envTs.includes("NF_JWT_KEYSET");
    const jwtWired = cfgTs.includes("NF_JWT_KEYSET");
    w(
      `${BOLD}4. La clé de SIGNATURE des jetons${RESET} ${DIM}(NF_JWT_KEYSET — production seulement)${RESET}\n`,
    );
    if (jwtDeclared && jwtWired) {
      w(`   ${GREEN}✓ déclarée dans env.ts et câblée dans ${cfgRel}${RESET}\n`);
    } else {
      if (!jwtDeclared) {
        w(
          `   ${CYAN}env.ts${RESET}, dans le defineEnv({ … }) :\n\n` +
            `   NF_JWT_KEYSET: envString({ optional: true }),\n\n`,
        );
      }
      if (!jwtWired) {
        w(
          `   ${CYAN}${cfgRel}${RESET}, entrée security :\n\n` +
            `   jwt: {\n` +
            `     keystore: {\n` +
            `       keySetJson: ctx.env.NF_JWT_KEYSET,\n` +
            `       dir: ctx.isProd ? undefined : "var/keys",\n` +
            `     },\n` +
            `   },\n\n`,
        );
      }
    }
    w(
      `   ${DIM}Développement : rien à poser, la clé vit dans var/keys/.\n` +
        `   Production : UNE valeur pour tous les pods et workers, générée une fois —\n` +
        `   ${RESET}${CYAN}npx nodefony security:secrets --jwt-keyset${RESET}${DIM} — puis rangée dans le\n` +
        `   gestionnaire de secrets et injectée en NF_JWT_KEYSET. Jamais dans .env,\n` +
        `   jamais dans git. STABLE : la changer refuse les jetons en vol ; pour une\n` +
        `   rotation, ajouter la nouvelle clé au jeu, la rendre « active », garder l'ancienne.${RESET}\n\n`,
    );

    w(
      `${DIM}Pourquoi 3 fichiers ? .env porte la VALEUR (secret du poste, gitignoré ;\n` +
        `en production, le gestionnaire de secrets) ; env.ts la DÉCLARE\n` +
        `(catalogue typé, validé au boot) ; ${cfgRel} la CÂBLE au module.\n` +
        `Les étapes 2 et 3 ne se font qu'une fois — ensuite seule l'étape 1 vit.${RESET}\n\n` +
        `Relance le serveur : plus aucun warning « clé ÉPHÉMÈRE » au boot.\n\n`,
    );
    return this;
  }
}

export default SecuritySecrets;
