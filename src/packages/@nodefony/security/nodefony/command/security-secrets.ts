import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { lireSiPresentSync } from "../src/token/secretFile.js";
import path from "node:path";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";

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
const ROLES: Record<string, { protege: string; sans: string }> = {
  NF_TOTP_KEY: {
    protege: "chiffre le secret 2FA de chaque compte au repos (AES-256-GCM)",
    sans: "2FA désactivé en production — un secret chiffré par une clé éphémère serait illisible au redémarrage",
  },
  NF_WEBHOOK_KEY: {
    protege: "chiffre les secrets de signature des webhooks au repos",
    sans: "webhooks désactivés en production (fail-safe, jamais de signature muette)",
  },
  NF_CSRF_SECRET: {
    protege: "signe les jetons anti-rejeu des mutations (`@CsrfProtect`)",
    sans: "en cluster, le jeton émis par un pod est rejeté par les autres",
  },
  "jwt.keystore": {
    protege: "signe les JWT (clé Ed25519, rotation gérée par le keystore)",
    sans: "chaque process signe avec la sienne : un jeton émis par la CLI est refusé par le serveur",
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
  }

  /** Racine du projet (kernel booté) — repli cwd. */
  #root(): string {
    return this.kernel?.path ?? process.cwd();
  }

  /**
   * `true` si `.env.local` est SUIVI par git — y écrire des secrets les mènerait
   * au commit (convention B : `*.local` doit être gitignoré). Best-effort : git
   * absent / hors repo → `false` (on écrit).
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

  /** Contenu d'un fichier du projet, "" si absent/illisible (détection best-effort). */
  #read(file: string): string {
    try {
      // `lireSiPresentSync` plutôt qu'un `existsSync ? read : ""` de plus : le
      // paquet porte DÉJÀ cette règle, et deux copies d'une lecture tolérante
      // divergent — l'une distingue « absent » d'« illisible », l'autre non.
      return lireSiPresentSync(path.resolve(this.#root(), file)) ?? "";
    } catch {
      return "";
    }
  }

  // Commande SANS argument positionnel → commander appelle l'action avec
  // (options, command) : les options sont le PREMIER argument.
  override async generate(opts: {
    json?: boolean;
    write?: boolean;
  }): Promise<this> {
    // 32 octets = exigence AES-256-GCM (HKDF côté cipher) ; base64 = sûr en .env.
    const gen = (): string => randomBytes(32).toString("base64");
    const secrets: Record<string, string> = {};
    for (const k of KEYS) secrets[k] = gen();

    if (opts.json) {
      process.stdout.write(JSON.stringify(secrets, null, 2) + "\n");
      return this;
    }

    // ── Détection de l'existant (le « une seule fois » devient automatique) ──
    // Convention B (Vite/Next, celle du core) : `.env` COMMITÉ (défauts
    // non-secrets) · `.env.local` GITIGNORÉ (secrets machine). Les valeurs vont
    // dans `.env.local` ; une clé déjà posée dans l'un OU l'autre compte.
    const dotenvLocal = this.#read(".env.local");
    const dotenv = this.#read(".env") + "\n" + dotenvLocal;
    const envTs = this.#read("env.ts");
    const cfgTs = this.#read("nodefony.config.ts");
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
    for (const [nom, role] of Object.entries(ROLES)) {
      const pose =
        nom === "jwt.keystore"
          ? /keystore\s*:/u.test(cfgTs)
          : new RegExp(`^\\s*${nom}\\s*=`, "m").test(dotenv);
      w(
        `  ${pose ? GREEN + "✓" : YELLOW + "○"}${RESET} ${BOLD}${nom.padEnd(16)}${RESET}${DIM}${role.protege}${RESET}\n` +
          `    ${DIM}sans → ${role.sans}${RESET}\n`,
      );
    }
    // 🔴 Ce qui N'EST PAS un secret de cette application, et la question qui
    // vient : « pourquoi NF_MCP_TOKEN n'est pas là ? ». Ce n'est pas une clé
    // dont l'application a besoin pour fonctionner — AUCUN de son code ne la
    // lit : c'est un JETON qu'elle ÉMET, que son porteur présente pour entrer.
    // Il ne vit donc pas ici mais chez l'agent qui le porte. Le taire
    // laisserait croire à un oubli.
    const jetonEncoreLa = /^\s*NF_MCP_TOKEN\s*=/m.test(dotenvLocal);
    w(
      `\n${DIM}  · NF_MCP_TOKEN n'est PAS un secret de cette application, et n'a rien à\n` +
        `    faire dans cette liste : c'est un jeton qu'elle ÉMET, présenté par un\n` +
        `    agent pour entrer. Aucun code d'ici ne le lit. Il se pose chez l'agent\n` +
        `    qui le porte — nodefony security:token --write.${RESET}\n`,
    );
    if (jetonEncoreLa) {
      // Une ligne héritée du temps où `--write` écrivait ici : un secret sans
      // lecteur, qui ne fait qu'attendre d'être commité par erreur.
      w(
        `${YELLOW}  ⚠ une ligne NF_MCP_TOKEN traîne encore dans .env.local — rien ne la lit,\n` +
          `    tu peux la retirer.${RESET}\n`,
      );
    }
    w(
      `\n${YELLOW}⚠ rien ne se tape dans le terminal : chaque bloc se colle dans le fichier indiqué.${RESET}\n\n`,
    );

    // ── 1. .env.local : les VALEURS (convention B — jamais dans le .env commité) ──
    w(
      `${BOLD}1. Fichier ${CYAN}.env.local${RESET}${BOLD} — les valeurs${RESET} ${DIM}(gitignoré ; .env commité = défauts NON-secrets)${RESET}\n`,
    );
    if (missingInDotenv.length === 0) {
      w(
        `   ${GREEN}✓ les 3 clés y sont déjà${RESET} ${DIM}(rien à faire — rotation = remplacer la valeur à la main)${RESET}\n\n`,
      );
    } else if (opts.write && this.#dotenvTracked()) {
      // Fail-safe : un secret écrit dans un fichier SUIVI par git finit commité.
      w(
        `   ${YELLOW}⚠ .env.local est suivi par git — je n'y écris PAS de secrets.${RESET}\n` +
          `   ${DIM}Ajoute \`*.local\` au .gitignore (et \`git rm --cached .env.local\`), puis relance --write ;\n` +
          `   ou colle les lignes ci-dessous à la main :${RESET}\n\n` +
          missingInDotenv.map((k) => `   ${k}=${secrets[k]}`).join("\n") +
          `\n\n`,
      );
    } else if (opts.write) {
      const block =
        (dotenvLocal && !dotenvLocal.endsWith("\n") ? "\n" : "") +
        `# clés security — générées par \`nodefony security:secrets\`\n` +
        missingInDotenv.map((k) => `${k}=${secrets[k]}`).join("\n") +
        "\n";
      appendFileSync(path.resolve(this.#root(), ".env.local"), block);
      w(
        `   ${GREEN}✓ écrit dans .env.local${RESET} ${DIM}(${missingInDotenv.join(", ")} — les clés déjà présentes n'ont pas été touchées)${RESET}\n\n`,
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

    // ── 3. nodefony.config.ts : le CÂBLAGE ───────────────────────────────────
    w(
      `${BOLD}3. Fichier ${CYAN}nodefony.config.ts${RESET}${BOLD} — le câblage vers le module security${RESET}\n`,
    );
    if (missingInCfg.length === 0) {
      w(`   ${GREEN}✓ déjà câblées${RESET}\n\n`);
    } else {
      w(
        `   complète l'entrée security du manifeste modules :\n\n` +
          `   use("@nodefony/security", {\n` +
          missingInCfg.map((k) => WIRING[k]).join("\n") +
          `\n   }),\n\n`,
      );
    }

    // ── 4. Le keyset JWT : CONSTATÉ, pas seulement mentionné ────────────────
    //
    // 🔴 Il l'était — dans le paragraphe explicatif du bas, en gris, après trois
    // « ✓ déjà câblées ». Personne ne le lisait : on lançait la commande, on
    // voyait trois coches, on concluait que tout était en place — et
    // `security:token` rendait ensuite un jeton que le serveur refusait, faute
    // de clé persistante. Une chose qu'on ne CONSTATE pas n'est pas faite.
    //
    // La méthodologie reste celle que la commande prescrit depuis toujours : le
    // keyset n'est pas un secret à COLLER (le keystore le génère, lui pose ses
    // permissions et y ajoute des clés à chaque rotation), donc il se déclare
    // par une SOURCE — un dossier en développement, l'environnement en prod.
    const jwtCable = /keystore\s*:/u.test(cfgTs);
    w(
      `${BOLD}4. Fichier ${CYAN}nodefony.config.ts${RESET}${BOLD} — les clés de SIGNATURE des jetons${RESET} ${DIM}(jwt.keystore)${RESET}\n`,
    );
    if (jwtCable) {
      w(`   ${GREEN}✓ déjà câblées${RESET}\n\n`);
    } else {
      w(
        `   ${YELLOW}⚠ absentes : chaque process signe avec une clé ÉPHÉMÈRE.${RESET}\n` +
          `   ${DIM}Un jeton émis par la CLI porte alors un \`kid\` que le serveur ne\n` +
          `   connaît pas, et il est refusé — et un redémarrage invalide les jetons\n` +
          `   en vol. Ce n'est pas une valeur à coller : c'est une SOURCE à déclarer.${RESET}\n\n` +
          `   use("@nodefony/security", {\n` +
          `     jwt: { keystore: ctx.isProd ? {} : { dir: "var/keys" } },\n` +
          `   }),\n\n` +
          `   ${DIM}En production, le dossier n'a pas de sens (pods jetables) : la clé vient\n` +
          `   de l'environnement — jwt.keystore.keySetJson, injecté par ton gestionnaire\n` +
          `   de secrets et partagé par tous les pods.${RESET}\n\n`,
      );
    }

    w(
      `${DIM}Pourquoi 3 fichiers ? .env.local porte la VALEUR (secret machine, gitignoré —\n` +
        `le .env commité ne porte que des défauts non-secrets) ; env.ts la DÉCLARE\n` +
        `(catalogue typé, validé au boot) ; nodefony.config.ts la CÂBLE au module.\n` +
        `Les étapes 2 et 3 ne se font qu'une fois — ensuite seule l'étape 1 vit.\n` +
        `L'étape 4 sort de ce schéma, et c'est voulu : un keyset n'est pas une valeur\n` +
        `qu'on colle, mais une source que le keystore gère (rotation, permissions).${RESET}\n\n` +
        `Relance le serveur : plus aucun warning « clé ÉPHÉMÈRE » au boot.\n\n`,
    );
    return this;
  }
}

export default SecuritySecrets;
