import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";

const options: OptionsCommandInterface = {
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
      "Génère les clés de chiffrement du module security (TOTP, webhooks, CSRF) et guide le câblage (--write : remplit le .env)",
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
      const abs = path.resolve(this.#root(), file);
      return existsSync(abs) ? readFileSync(abs, "utf8") : "";
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
      `\n${BOLD}🔐 Secrets security — 3 étapes, 3 FICHIERS${RESET}\n` +
        `${YELLOW}⚠ rien ne se tape dans le terminal : chaque bloc se colle dans le fichier indiqué.${RESET}\n\n`,
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

    w(
      `${DIM}Pourquoi 3 étapes ? .env.local porte la VALEUR (secret machine, gitignoré —\n` +
        `le .env commité ne porte que des défauts non-secrets) ; env.ts la DÉCLARE\n` +
        `(catalogue typé, validé au boot) ; nodefony.config.ts la CÂBLE au module.\n` +
        `Les étapes 2 et 3 ne se font qu'une fois — ensuite seule l'étape 1 vit.\n` +
        `JWT (refresh durables) : pas un secret à coller — persistance du keyset via\n` +
        `jwt.keystore.dir = "./var/keys" (dev/VPS) ou jwt.keystore.keySetJson (prod).${RESET}\n\n` +
        `Relance le serveur : plus aucun warning « clé ÉPHÉMÈRE » au boot.\n\n`,
    );
    return this;
  }
}

export default SecuritySecrets;
