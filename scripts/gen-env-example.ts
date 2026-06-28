/**
 * Génère `.env.example` depuis le catalogue `env.ts` (`defineEnv`) — SOURCE UNIQUE,
 * anti-dérive (ADR-0006). Le corps (liste des variables + doc + drapeaux) est
 * entièrement dérivé du catalogue ; seul l'en-tête d'onboarding est curé ici.
 *
 *   Régénérer : npx tsx scripts/gen-env-example.ts
 *   Vérifier   : npx tsx scripts/gen-env-example.ts --check   (exit 1 si désync)
 *
 * Le mode `--check` est idéal en pre-commit / CI : il échoue si `.env.example`
 * diverge du catalogue (une variable ajoutée à `env.ts` mais pas régénérée).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getEnvCatalog, renderEnvExample } from "nodefony";

import { env } from "../env";

/** En-tête curé (prose d'onboarding) — le reste du fichier est généré. */
const HEADER = `# .env.example — MODÈLE d'onboarding (committé, 0 secret réel).
#
# ⚙️  GÉNÉRÉ depuis env.ts (catalogue defineEnv) — NE PAS éditer à la main.
#     Régénérer : npx tsx scripts/gen-env-example.ts
#
# Toutes les variables sont COMMENTÉES (le framework a des défauts) : décommenter
# celles que ton déploiement surcharge, dans .env.local (secrets/machine, gitignoré)
# ou .env / .env.<env> (défauts non-secrets). Précédence (cf
# src/nodefony/src/runtime/loadEnv.ts), du plus fort au plus faible :
#   process.env > .env.<appEnv>.local > .env.<env>.local > .env.local
#               > .env.<appEnv> > .env.<env> > .env
#
# Override GÉNÉRIQUE de config (hors catalogue) : NF__<MODULE|APP>__<CHEMIN>=valeur
#   ex. NF__APP__SERVERS__HTTP__PORT=8080  ·  NF__SECURITY__JWT__ACCESSTTLS=300
# Secret monté en conteneur : toute variable accepte aussi <NOM>_FILE (Docker/K8s).
#
# ─── Variables HORS catalogue typé (reconnues, non déclarées dans env.ts) ──────
# Mode runtime / déploiement (12-factor — posés par la commande \`nodefony …\` ou
# l'orchestrateur, PAS figés dans un fichier committé) :
#   NODE_ENV=production          # development | production (moteur runtime)
#   APP_ENV=staging              # env de DÉPLOIEMENT libre (alias : NODEFONY_ENV)
#   NODEFONY_WORKERS=auto        # nb de process cluster (CLI --workers > ceci)
# Module @nodefony/redis (lues par defineRedisConfig ; ou override NF__REDIS__*) :
#   REDIS_URL=redis://localhost:6379
#   REDIS_HOST=localhost
#   REDIS_PORT=6379
#   REDIS_PASSWORD=change-me     # → .env.local (secret, jamais committé)
#
# ─── Catalogue typé (env.ts) — généré ci-dessous ──────────────────────────────
#
# ─── Social login OAuth 2.0 ───────────────────────────────────────────────────
# Un fournisseur n'est monté QUE si SES deux secrets sont présents. Le callback
# enregistré chez le fournisseur doit être EXACTEMENT (RFC 9700) :
#   <OAUTH_REDIRECT_BASE>/nodefony/security/api/oauth2/<provider>/callback
# ⚠️ Défaut = https://localhost:5152 (PAS 127.0.0.1) : WebAuthn refuse une IP comme
#    rpId. Google : si https://localhost est refusé, utiliser http://localhost:5151.`;

const TARGET = resolve(import.meta.dirname, "..", ".env.example");
const catalog = getEnvCatalog(env);
const content = renderEnvExample(catalog, { header: HEADER });

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(TARGET, "utf8");
  } catch {
    /* fichier absent → désync */
  }
  if (current !== content) {
    console.error(
      "❌ .env.example désynchronisé de env.ts — lancer: npx tsx scripts/gen-env-example.ts",
    );
    process.exit(1);
  }
  console.log(
    `✅ .env.example synchronisé avec env.ts (${catalog.length} variables)`,
  );
} else {
  writeFileSync(TARGET, content);
  console.log(
    `✅ .env.example régénéré depuis env.ts (${catalog.length} variables)`,
  );
}
