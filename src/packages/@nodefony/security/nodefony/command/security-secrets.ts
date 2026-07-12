import { randomBytes } from "node:crypto";
import { OptionsCommandInterface, CliKernel, Command } from "nodefony";

const options: OptionsCommandInterface = {
  showBanner: false,
  kernelEvent: "onReady",
};

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * `nodefony security:secrets` — génère les clés de chiffrement attendues par le
 * module security (TOTP, webhooks, CSRF) au bon format (32 octets aléatoires,
 * base64) et imprime le câblage COMPLET à coller (.env → env.ts →
 * nodefony.config.ts). Réponse directe aux warnings « clé ÉPHÉMÈRE générée » du
 * boot : l'utilisateur sait quoi coller, où, et pourquoi.
 *
 * N'écrit RIEN sur le disque : un secret ne doit exister que dans
 * l'environnement (ou le gestionnaire de secrets en prod), jamais en git.
 */
class SecuritySecrets extends Command {
  constructor(cli: CliKernel) {
    super(
      "security:secrets",
      "Génère les clés de chiffrement du module security (TOTP, webhooks, CSRF) + le câblage à coller",
      cli,
      options,
    );
    this.addOption("-j, --json", "sortie JSON (scripts/CI)");
  }

  // Commande SANS argument positionnel → commander appelle l'action avec
  // (options, command) : les options sont le PREMIER argument.
  override async generate(opts: { json?: boolean }): Promise<this> {
    // 32 octets = exigence AES-256-GCM (HKDF côté cipher) ; base64 = sûr en .env.
    const gen = (): string => randomBytes(32).toString("base64");
    const secrets: Record<string, string> = {
      NF_TOTP_KEY: gen(),
      NF_WEBHOOK_KEY: gen(),
      NF_CSRF_SECRET: gen(),
    };
    if (opts.json) {
      process.stdout.write(JSON.stringify(secrets, null, 2) + "\n");
      return this;
    }
    const envLines = Object.entries(secrets)
      .map(([k, v]) => `   ${k}=${v}`)
      .join("\n");
    process.stdout.write(
      `\n${BOLD}🔐 Secrets générés${RESET} ${DIM}(32 octets aléatoires, base64 — rien n'a été écrit)${RESET}\n\n` +
        `${BOLD}1.${RESET} Colle dans ton ${CYAN}.env${RESET} ${DIM}(gitignoré ; en prod : Secret k8s / vault, jamais en git)${RESET} :\n\n` +
        `${envLines}\n\n` +
        `${BOLD}2.${RESET} Déclare-les dans ${CYAN}env.ts${RESET} ${DIM}(une seule fois)${RESET} :\n\n` +
        `   NF_TOTP_KEY: envString({ optional: true }),\n` +
        `   NF_WEBHOOK_KEY: envString({ optional: true }),\n` +
        `   NF_CSRF_SECRET: envString({ optional: true }),\n\n` +
        `${BOLD}3.${RESET} Câble-les dans ${CYAN}nodefony.config.ts${RESET} ${DIM}(une seule fois)${RESET} :\n\n` +
        `   use("@nodefony/security", {\n` +
        `     totp:     { encryptionKey: ctx.env.NF_TOTP_KEY },\n` +
        `     webhooks: { encryptionKey: ctx.env.NF_WEBHOOK_KEY },\n` +
        `     csrf:     { secret: ctx.env.NF_CSRF_SECRET },\n` +
        `   }),\n\n` +
        `${DIM}JWT (refresh tokens durables) : pas un secret à coller — configure la\n` +
        `persistance du keyset : jwt.keystore.dir = "./var/keys" (dev/VPS, fichier\n` +
        `chmod 600 généré) ou jwt.keystore.keySetJson depuis l'env (prod/cluster).${RESET}\n\n` +
        `Relance le serveur : plus aucun warning « clé ÉPHÉMÈRE » au boot.\n\n`,
    );
    return this;
  }
}

export default SecuritySecrets;
