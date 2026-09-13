#!/usr/bin/env node
/**
 * **Publie sur Docker Hub la description de l'image — depuis un fichier versionné.**
 *
 * Docker Hub affiche « Repository overview — INCOMPLETE » tant que le champ
 * `full_description` du dépôt est vide. C'était le cas : l'image publiée ne
 * disait ni ce qu'elle contient, ni comment la lancer, ni qu'elle n'est PAS le
 * framework mais une application de démonstration générée. Une image sans page
 * est une image qu'on ne tire pas.
 *
 * ## Pourquoi un script maison plutôt qu'une action du marché
 *
 * Une action tierce reçoit le jeton Docker Hub en clair. Ce dépôt refuse déjà ce
 * modèle pour npm (cf. `release-preflight.yml` : un jeton qui « transite par
 * chaque action tierce du workflow » est le vecteur des attaques de chaîne
 * d'approvisionnement). Deux appels HTTP ne justifient pas d'y déroger.
 *
 * ## La source est un FICHIER du dépôt, jamais la page
 *
 * `docker/hub-overview.md` est la vérité ; la page en est le rendu. C'est ce qui
 * permet de la relire en diff, et à `accueil-gate.mjs` d'y maintenir la version
 * annoncée — cette page est déclarée parmi ses surfaces, donc elle bascule avec
 * les autres et un écart y est refusé comme ailleurs.
 *
 * ## Ce qu'il ne fait pas
 *
 * Il n'écrase PAS la description COURTE si elle existe déjà : cent caractères
 * choisis à la main valent mieux qu'un remplacement automatique, et rien dans un
 * fichier de page ne dit lequel des paragraphes devrait la devenir. Il la POSE
 * quand elle est vide, et le dit.
 *
 * ## Codes de sortie
 *
 * - `0` — la page publiée est celle du dépôt (constaté par relecture).
 * - `1` — Docker Hub a refusé, ou la relecture ne rend pas ce qu'on a écrit.
 * - `2` — **on n'a pas pu regarder** : identifiants absents, source introuvable,
 *   API muette. Ne pas savoir n'est pas un verdict favorable.
 *
 * @example
 * ```bash
 * NF_DOCKERHUB_USER=… NF_DOCKERHUB_TOKEN=… node scripts/release/hub-description.mjs
 * node scripts/release/hub-description.mjs --dry-run   # montre ce qui partirait
 * ```
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT =
  process.env.NF_HUB_ROOT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** L'API de Docker Hub — injectable pour être éprouvable sans réseau. */
const API = (process.env.NF_HUB_API ?? "https://hub.docker.com").replace(
  /\/$/,
  "",
);

/** Le dépôt d'images dont cette page est la vitrine. */
const DEPOT = process.env.NF_HUB_DEPOT ?? "nodefony/nodefony";

/** La source versionnée de la page. */
const SOURCE = process.env.NF_HUB_SOURCE ?? "docker/hub-overview.md";

/**
 * Limites imposées par Docker Hub. Elles ne sont pas documentées comme des
 * erreurs explicites : au-delà, l'API tronque ou refuse selon le champ — donc on
 * refuse AVANT d'envoyer, pour que l'échec nomme sa cause au lieu de produire une
 * page coupée au milieu d'une phrase.
 */
const MAX_LONGUE = 25_000;
const MAX_COURTE = 100;

/**
 * Confronte la page à ce que Docker Hub accepte.
 *
 * Fonction pure — c'est elle qu'on éprouve, pas le réseau.
 *
 * @param page - le markdown à publier.
 * @returns la liste des refus, vide quand la page est publiable.
 */
function controlerPage(page) {
  const refus = [];
  if (page.trim().length === 0) {
    refus.push("la page est vide — Docker Hub afficherait « INCOMPLETE »");
  }
  if (page.length > MAX_LONGUE) {
    refus.push(
      `${page.length} caractères, au-delà des ${MAX_LONGUE} acceptés : la page serait tronquée`,
    );
  }
  return refus;
}

/**
 * Ouvre une session Docker Hub.
 *
 * 🔴 TROIS points que la spec officielle contredit par rapport à l'usage répandu,
 * vérifiés dans `https://docs.docker.com/reference/api/hub/latest.yaml` :
 *
 * 1. `POST /v2/users/login` est **déprécié** — la spec renvoie explicitement vers
 *    `POST /v2/auth/token` (« Create access token »).
 * 2. Les champs sont `identifier` / `secret`, **pas** `username` / `password`, et
 *    la réponse porte `access_token`, **pas** `token`.
 * 3. Le jeton se présente en `Authorization: Bearer …`, **pas** en `JWT …`.
 *
 * Le jeton **expire en 10 minutes** (la spec le dit) : il se prend au moment de
 * s'en servir, jamais en tête d'un flux long.
 *
 * @returns le jeton, ou `null` si l'API n'a rien rendu d'exploitable.
 */
async function ouvrirSession(identifiant, secret) {
  try {
    const res = await fetch(`${API}/v2/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: identifiant, secret }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.access_token === "string" ? body.access_token : null;
  } catch {
    return null;
  }
}

/**
 * Lit l'état courant du dépôt d'images.
 *
 * ⚠️ `full_description` n'est PAS rendu par une lecture anonyme — constaté sur
 * `nodefony/nodefony`, sur les deux formes d'URL. C'est pourquoi la lecture passe
 * ici par le jeton : sans lui, la relecture de preuve conclurait « page vide »
 * sur une page correctement publiée.
 */
async function lireDepot(jeton) {
  try {
    const res = await fetch(`${API}/v2/repositories/${DEPOT}/`, {
      headers: { authorization: `Bearer ${jeton}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Écrit les champs de description.
 *
 * 🔴 CET ENDPOINT N'EST PAS DANS LA SPEC OFFICIELLE, et il faut le savoir. La
 * spec ne documente pour un dépôt que `GET` et `HEAD`
 * (`/v2/namespaces/{ns}/repositories/{repo}`) : **aucune mutation de la
 * description n'y figure**. `PATCH /v2/repositories/{ns}/{repo}/` est la voie
 * employée en pratique — c'est celle des actions du marché — mais elle n'est
 * couverte par aucun contrat public, donc elle peut changer sans préavis.
 *
 * C'est précisément pourquoi l'appelant RELIT après avoir écrit, au lieu de se
 * fier au code 200 : le jour où cet endpoint bougera, on veut l'apprendre d'une
 * preuve absente, pas d'un utilisateur qui signale une page vide.
 */
async function ecrireDepot(jeton, champs) {
  try {
    const res = await fetch(`${API}/v2/repositories/${DEPOT}/`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${jeton}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(champs),
    });
    return { ok: res.ok, statut: res.status, corps: await res.text() };
  } catch (e) {
    return { ok: false, statut: 0, corps: e.message };
  }
}

/**
 * Point d'entrée.
 *
 * @param argv - arguments, sans `node` ni le chemin du script.
 * @returns le code de sortie.
 */
async function principal(argv) {
  const repetition = argv.includes("--dry-run");

  const abs = path.join(ROOT, ...SOURCE.split("/"));
  if (!fs.existsSync(abs)) {
    console.error(`✗ CONTRÔLE AVEUGLE — source introuvable : ${SOURCE}`);
    return 2;
  }
  const page = fs.readFileSync(abs, "utf8");

  const refus = controlerPage(page);
  if (refus.length > 0) {
    console.error(`✗ ${SOURCE} n'est pas publiable :`);
    for (const r of refus) console.error(`   · ${r}`);
    return 1;
  }

  if (repetition) {
    console.log(
      `· répétition — ${page.length} caractères partiraient vers ${DEPOT}\n` +
        `  premier titre : ${page.split("\n")[0]}`,
    );
    return 0;
  }

  const identifiant = process.env.NF_DOCKERHUB_USER;
  const secret = process.env.NF_DOCKERHUB_TOKEN;
  if (!identifiant || !secret) {
    console.error(
      "✗ CONTRÔLE AVEUGLE — NF_DOCKERHUB_USER ou NF_DOCKERHUB_TOKEN absent.\n" +
        "  Sans eux la page ne peut pas être publiée, et l'image reste sans overview.",
    );
    return 2;
  }

  const jeton = await ouvrirSession(identifiant, secret);
  if (!jeton) {
    console.error(
      `✗ Docker Hub a refusé la session de « ${identifiant} » — jeton expiré, révoqué, ` +
        "ou identifiant erroné.",
    );
    return 1;
  }

  const avant = await lireDepot(jeton);
  if (!avant) {
    console.error(
      `✗ CONTRÔLE AVEUGLE — ${DEPOT} illisible. Le dépôt existe-t-il, et ce compte y a-t-il accès ?`,
    );
    return 2;
  }

  const champs = { full_description: page };
  const courteVide = !String(avant.description ?? "").trim();
  if (courteVide) {
    champs.description =
      "Application Nodefony de démonstration, générée par le scaffold du framework".slice(
        0,
        MAX_COURTE,
      );
  }

  const ecrit = await ecrireDepot(jeton, champs);
  if (!ecrit.ok) {
    console.error(
      `✗ Docker Hub a refusé l'écriture (HTTP ${ecrit.statut}) : ${ecrit.corps.slice(0, 400)}`,
    );
    return 1;
  }

  // 🔴 RELIRE. L'API rend 200 sans garantir que le champ porte ce qu'on a envoyé
  // — une troncature silencieuse ressemblerait exactement à un succès. La preuve
  // porte sur ce que la page SERT, pas sur ce qu'on a posté.
  const apres = await lireDepot(jeton);
  if (!apres) {
    console.error(
      "✗ écriture acceptée mais relecture impossible — publication NON prouvée.",
    );
    return 1;
  }
  // Trois issues, et les confondre produirait un faux verdict. Le champ ABSENT
  // n'est pas un champ VIDE : une lecture qui ne l'expose pas ne dit rien du
  // contenu publié, et crier « page vide » sur une page correcte est exactement
  // le genre d'alerte qui apprend à ignorer l'instrument.
  if (!("full_description" in apres)) {
    console.error(
      "✗ écriture acceptée, mais la relecture n'EXPOSE PAS `full_description` — " +
        "publication NON prouvée.\n" +
        `  Vérifier à l'œil : https://hub.docker.com/r/${DEPOT}\n` +
        "  Cet endpoint d'écriture n'est couvert par aucune spec publique : s'il a changé,\n" +
        "  c'est ici qu'on l'apprend.",
    );
    return 1;
  }
  const servie = String(apres.full_description ?? "");
  if (servie !== page) {
    console.error(
      `✗ la page servie n'est pas celle envoyée — ${servie.length} caractères servis ` +
        `contre ${page.length} envoyés. Docker Hub a tronqué ou transformé le contenu.`,
    );
    return 1;
  }

  console.log(
    `✓ overview de ${DEPOT} publiée et RELUE — ${page.length} caractères` +
      (courteVide ? " · description courte posée (elle était vide)" : ""),
  );
  return 0;
}

// Axiome de portabilité : on compare des URL, jamais des chemins.
const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (lanceDirectement) {
  try {
    process.exitCode = await principal(process.argv.slice(2));
  } catch (erreur) {
    console.error(`\n✗ CONTRÔLE AVEUGLE — ${erreur.message}\n`);
    process.exitCode = 2;
  }
}

export { controlerPage, MAX_LONGUE, MAX_COURTE, SOURCE, DEPOT };
