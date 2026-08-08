/**
 * Audit Lighthouse d'une page, y compris DERRIÈRE une authentification.
 *
 * Pourquoi un script à part plutôt qu'une famille d'`inspect.mjs` : Lighthouse
 * ne mesure pas une page ouverte, il en PILOTE le chargement — il recharge, vide
 * le cache, bride le réseau et le processeur, et chronomètre. C'est l'inverse de
 * la photographie d'un instant, et cela prend des dizaines de secondes.
 *
 * Comment l'authentification survit, alors que Lighthouse ouvre son propre
 * onglet : le navigateur est lancé avec un PROFIL PERSISTANT et un port de
 * débogage. On s'y connecte normalement — les témoins de session vivent alors
 * dans le profil, pas dans un contexte isolé — puis Lighthouse se branche sur ce
 * même navigateur et hérite du profil. Sans cela, il mesurerait l'écran de
 * connexion en croyant tenir la page demandée.
 *
 * `@usage` node audit.mjs /tableau-de-bord
 * `@env` NF_BROWSER_BASE origine à joindre (défaut constaté : local ou conteneur)
 * `@env` NF_BROWSER_OUT dossier de sortie (le rapport complet y est déposé)
 * `@env` NF_BROWSER_LOGIN chemin du formulaire de connexion — aucun défaut deviné
 * `@env` NF_BROWSER_USER identifiant ; sans lui, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_CATEGORIES catégories à jouer, séparées par des virgules (défaut : toutes celles que ce Lighthouse connaît)
 * `@env` NF_BROWSER_FORMFACTOR `desktop` (défaut) ou `mobile` — un score de performance ne veut RIEN dire sans son appareil
 * `@env` NF_BROWSER_SEUIL_AUDIT score en deçà duquel un audit est retenu, en pourcentage (défaut 90)
 * `@requires` `lighthouse` et `playwright` installés (pairs optionnels)
 * `@output` un résumé JSON sur stdout + le rapport COMPLET dans le dossier de sortie
 * `@exit` 0 mesure rendue (le verdict est une DONNÉE) · 64 usage · 69 outil indisponible
 */
import { createServer } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { BASE, LOGIN, PASSWORD, SORTIE, USER } from "./lib/browser.mjs";
import { resumeLighthouse } from "./lib/probes.mjs";

const PAGE = process.argv[2] ?? process.env.NF_BROWSER_PAGE ?? "/";
const SEUIL = Number(process.env.NF_BROWSER_SEUIL_AUDIT ?? 90) / 100;
const FORMFACTOR = (process.env.NF_BROWSER_FORMFACTOR ?? "desktop").trim();
if (FORMFACTOR !== "desktop" && FORMFACTOR !== "mobile") {
  console.error(
    `NF_BROWSER_FORMFACTOR inconnu : « ${FORMFACTOR} ». Valeurs : desktop, mobile.`,
  );
  process.exit(64); // EX_USAGE
}

const outils = {};
for (const nom of ["lighthouse", "playwright"]) {
  try {
    outils[nom] = await import(nom);
  } catch {
    console.error(
      `${nom} est absent — cet audit ne peut pas avoir lieu sans lui.\n\n` +
        `  npm i -D lighthouse playwright && npx playwright install chromium\n\n` +
        "Les deux sont des pairs OPTIONNELS : seuls ceux qui auditent une page\n" +
        "les installent, personne ne les paie sans les vouloir.",
    );
    process.exit(69); // EX_UNAVAILABLE
  }
}
const lighthouse = outils.lighthouse.default;
const { chromium } = outils.playwright;

/**
 * Un port libre, demandé au système plutôt que choisi au hasard.
 *
 * Un port fixe entrerait en collision avec un autre navigateur de débogage —
 * et l'audit se brancherait alors sur le mauvais, ce qui ne produit pas une
 * erreur mais une mesure d'une AUTRE page.
 *
 * @returns {Promise<number>} un port que rien n'écoute au moment du rendu.
 */
function portLibre() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const port = await portLibre();
// Profil PERSISTANT : c'est lui qui porte la session entre notre connexion et
// l'onglet que Lighthouse ouvrira. Jetable — il vit le temps de l'audit.
const profil = mkdtempSync(path.join(tmpdir(), "nf-audit-"));
const ctx = await chromium.launchPersistentContext(profil, {
  channel: "chromium",
  ignoreHTTPSErrors: true,
  args: [`--remote-debugging-port=${port}`, "--no-sandbox"],
});

try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  if (USER) {
    if (!LOGIN) {
      console.error(
        "NF_BROWSER_USER est posé mais pas NF_BROWSER_LOGIN : donne le chemin de\n" +
          "ton formulaire de connexion, sinon l'audit mesurerait l'écran de connexion.",
      );
      process.exit(64); // EX_USAGE
    }
    await page.goto(`${BASE}${LOGIN}`, { waitUntil: "domcontentloaded" });
    const id = page.getByRole("textbox", {
      name: /identifiant|utilisateur|username|e-?mail/iu,
    });
    const pw = page.getByRole("textbox", { name: /mot de passe|password/iu });
    await id.or(pw).first().waitFor({ timeout: 15000 });
    if ((await id.count()) > 0) {
      await id.fill(USER);
      await id.press("Enter");
    }
    await pw.fill(PASSWORD, { timeout: 15000 });
    await pw.press("Enter");
    await page.waitForURL((u) => !u.pathname.endsWith(LOGIN), {
      timeout: 20000,
    });
  }

  const cible = `${BASE}${PAGE}`;
  const categories = (process.env.NF_BROWSER_CATEGORIES ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const runnerResult = await lighthouse(cible, {
    port,
    output: "json",
    logLevel: "error",
    formFactor: FORMFACTOR,
    // Le bridage d'écran par défaut simule un téléphone : le laisser en place
    // pendant qu'on demande `desktop` produirait un décor incohérent, et des
    // chiffres qu'on ne saurait rattacher à aucun appareil réel.
    screenEmulation:
      FORMFACTOR === "desktop"
        ? { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1 }
        : undefined,
    // 🔴 Sans ceci, Lighthouse VIDE le stockage avant de mesurer — donc les
    // témoins de session — et audite l'écran de connexion en silence. C'est le
    // piège central d'un audit derrière authentification.
    disableStorageReset: true,
    ...(categories.length > 0 ? { onlyCategories: categories } : {}),
  });

  const lhr = runnerResult?.lhr;
  if (!lhr) {
    console.error("Lighthouse n'a rendu aucun rapport.");
    process.exit(69); // EX_UNAVAILABLE
  }

  // Le rapport COMPLET est conservé : le résumé sert à décider, l'original à
  // vérifier — et à comparer dans le temps.
  mkdirSync(SORTIE, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19);
  const slug = PAGE.replace(/\//gu, "-").replace(/^-/u, "") || "racine";
  const complet = path.join(SORTIE, `lighthouse-${slug}-${stamp}.json`);
  writeFileSync(complet, JSON.stringify(lhr), "utf8");

  console.log(
    JSON.stringify(
      { ...resumeLighthouse(lhr, SEUIL), rapportComplet: complet },
      null,
      2,
    ),
  );
} finally {
  await ctx.close();
}
