/**
 * Le décor commun aux sondes : lancer le navigateur, se connecter, ouvrir une
 * page en étant sûr de mesurer CELLE-LÀ.
 *
 * Pourquoi une brique partagée plutôt que deux copies : les deux scripts sont
 * copiés ensemble (`docker cp <dossier>/. <conteneur>:/app/`), donc la partager
 * ne coûte rien — et la duplication précédente avait déjà divergé en silence,
 * une seule des deux copies rattrapant un état d'authentification périmé.
 *
 * `@env` NF_BROWSER_BASE origine à joindre (défaut CONSTATÉ : 127.0.0.1 en local, host.docker.internal en conteneur)
 * `@env` NF_BROWSER_OUT dossier des captures et de l'état d'authentification (défaut constaté de la même façon)
 * `@env` NF_BROWSER_LOGIN chemin du formulaire de connexion — REQUIS dès qu'un identifiant est donné, aucun défaut n'est deviné
 * `@env` NF_BROWSER_USER identifiant ; sans lui, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_COLOR_SCHEME schéma de couleurs émulé (light, dark, no-preference) ; sans lui, celui du navigateur
 * `@env` NF_BROWSER_STORAGE entrées de stockage local posées AVANT chargement (`clé=valeur`, séparées par des virgules)
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { defautsDecor, parseColorScheme, parseStorage } from "./probes.mjs";

/**
 * Playwright — chargé À LA DEMANDE, pour pouvoir expliquer son absence.
 *
 * Il porte un navigateur de plus de cent mégaoctets : l'imposer à toute
 * application qui installe cet outillage serait disproportionné, alors que
 * seuls ceux qui veulent REGARDER un écran en ont besoin. Il est donc déclaré
 * en pair optionnel — et un `MODULE_NOT_FOUND` nu, qui ne dit ni quoi
 * installer ni pourquoi, n'est pas une réponse acceptable.
 */
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Playwright est absent — c'est lui qui pilote le navigateur.\n\n" +
      "  npm i -D playwright && npx playwright install chromium\n\n" +
      "Autre voie, si tu préfères ne rien poser sur ta machine : exécuter ces\n" +
      "sondes dans un conteneur qui embarque déjà navigateur et pilote.",
  );
  process.exit(69); // EX_UNAVAILABLE
}

/**
 * Le décor : où joindre l'application, et où déposer ce qu'on produit.
 *
 * Les deux se CONSTATENT plutôt que de se supposer — `/.dockerenv` existe
 * quand, et seulement quand, on s'exécute dans un conteneur. Le déduire de la
 * plateforme serait faux dans les deux sens : un conteneur Linux sur un poste
 * macOS, ou un poste Linux nu, rendraient le même `process.platform`.
 *
 * L'enjeu n'est pas cosmétique : `127.0.0.1` désigne le conteneur LUI-MÊME
 * quand on y est enfermé, et la sonde mesurerait alors une connexion refusée
 * en croyant que l'application est en panne.
 */
const DANS_CONTENEUR = existsSync("/.dockerenv");
const { base: baseDecor, out: OUT } = defautsDecor({
  dansConteneur: DANS_CONTENEUR,
  base: process.env.NF_BROWSER_BASE,
  out: process.env.NF_BROWSER_OUT,
});

/** Où atterrissent captures et état d'authentification. */
export const SORTIE = OUT;
export const BASE = baseDecor;
export const USER = process.env.NF_BROWSER_USER ?? "";
export const PASSWORD = process.env.NF_BROWSER_PASSWORD ?? "";

/**
 * Le chemin du formulaire de connexion — celui de TON application.
 *
 * Aucun défaut : il n'existe pas d'écran de connexion universel, et deviner en
 * enverrait la sonde sur une page inexistante, où elle « se connecterait »
 * silencieusement avant de mesurer un écran d'erreur. Une ignorance ne doit
 * jamais passer pour un contrôle réussi : on le dit, et on s'arrête.
 */
export const LOGIN = process.env.NF_BROWSER_LOGIN ?? "";
if (USER && !LOGIN) {
  console.error(
    "NF_BROWSER_USER est posé mais pas NF_BROWSER_LOGIN : donne le chemin de ton\n" +
      "formulaire de connexion (par exemple /login), sinon la sonde n'a aucun moyen\n" +
      "de savoir où s'authentifier.",
  );
  process.exit(64); // EX_USAGE
}

/**
 * L'état d'authentification, SAUVEGARDÉ puis réutilisé d'une sonde à l'autre.
 *
 * Il vit dans le dossier de sortie — en conteneur, un volume monté, donc il
 * survit à l'arrêt de celui-ci.
 * Sans lui, chaque inspection rejoue le parcours de connexion — quelques
 * secondes perdues et une occasion d'échec de plus à chaque exécution.
 */
const STATE = path.join(OUT, ".auth-state.json");
// Créé AVANT la première écriture : en local, le dossier n'existe pas encore,
// et l'échec ne surviendrait qu'à la sauvegarde — après la connexion, donc
// après avoir fait croire que tout allait bien.
mkdirSync(OUT, { recursive: true });

/**
 * Le schéma de couleurs à émuler, et le stockage à poser avant chargement.
 *
 * Deux leviers plutôt qu'un, parce qu'il existe deux façons de choisir un
 * thème et qu'aucune ne couvre l'autre :
 *
 *  • `prefers-color-scheme` — la média query standard, que le navigateur
 *    expose et que le CSS peut suivre. Générique par construction : elle ne
 *    dépend d'aucune trousse d'interface.
 *  • une entrée de stockage — dès que l'application MÉMORISE le choix de
 *    l'utilisateur, la média query ne décide plus rien, et la clé employée
 *    appartient à l'application. On la reçoit, on ne la devine pas.
 *
 * Un défaut qui n'existe que dans un thème est invisible tant qu'on ne peut pas
 * demander l'autre : c'est ce qui a fait passer un menu à 1,63:1 sous le radar.
 */
const { schema: COLOR_SCHEME, invalide: schemaInvalide } = parseColorScheme(
  process.env.NF_BROWSER_COLOR_SCHEME,
);
if (schemaInvalide) {
  console.error(
    `NF_BROWSER_COLOR_SCHEME inconnu : « ${schemaInvalide} ».\n` +
      "Valeurs acceptées (celles de la média query standard) : light, dark, no-preference.",
  );
  process.exit(64); // EX_USAGE
}
const { entrees: STORAGE, rejetees: storageRejetees } = parseStorage(
  process.env.NF_BROWSER_STORAGE,
);
if (storageRejetees.length > 0) {
  console.error(
    `NF_BROWSER_STORAGE — entrée(s) malformée(s) ignorable(s) en silence, donc REFUSÉE(S) : ${storageRejetees.join(", ")}\n` +
      "Forme attendue : clé=valeur, séparées par des virgules.",
  );
  process.exit(64); // EX_USAGE
}

/**
 * Ouvre un navigateur et un contexte prêts à mesurer.
 *
 * @returns `{ browser, ctx, page, reuse }` — `reuse` dit si un état
 *   d'authentification a été repris, ce qui décide s'il faut se connecter.
 */
export async function open() {
  // `channel: "chromium"` demande le Chromium COMPLET plutôt que le
  // `chrome-headless-shell` que Playwright lance par défaut en mode sans
  // interface. Les deux décors y gagnent, pour des raisons opposées : une image
  // de conteneur n'embarque souvent que le premier (sans ce paramètre, elle
  // réclame une installation qui n'a pas lieu d'être), et sur un poste c'est le
  // navigateur qui rend le plus fidèlement ce qu'un utilisateur verra.
  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--no-sandbox"],
  });
  const options = {
    ignoreHTTPSErrors: true, // certificat de développement auto-signé
    viewport: { width: 1440, height: 900 },
    ...(COLOR_SCHEME ? { colorScheme: COLOR_SCHEME } : {}),
  };
  let reuse = Boolean(USER) && existsSync(STATE);
  let ctx = null;
  if (reuse) {
    try {
      ctx = await browser.newContext({ ...options, storageState: STATE });
    } catch (e) {
      // Un fichier d'état corrompu (tronqué, schéma inattendu) ne doit jamais
      // valoir un crash : on le dit, on le jette, et on rejoue le parcours de
      // connexion complet — l'ignorance ne passe pas pour un contrôle réussi.
      console.error(
        `État d'authentification illisible — il est supprimé et le parcours de connexion est rejoué.\n${String(e).slice(0, 200)}`,
      );
      rmSync(STATE, { force: true });
      reuse = false;
    }
  }
  if (!ctx) ctx = await browser.newContext(options);
  if (STORAGE.length > 0) {
    // AVANT tout script de la page, et à CHAQUE navigation : une application
    // lit son thème mémorisé au tout premier rendu. Poser la valeur après coup
    // obligerait à recharger, et l'on mesurerait l'entre-deux.
    //
    // Cela l'emporte volontairement sur un état d'authentification réutilisé
    // qui porterait l'ancienne valeur : ce que la ligne de commande demande
    // prime sur ce qu'une session précédente avait laissé.
    await ctx.addInitScript((entrees) => {
      try {
        for (const { cle, valeur } of entrees)
          localStorage.setItem(cle, valeur);
      } catch {
        // Stockage refusé (mode privé, origine opaque) : la sonde continue —
        // le thème sera celui par défaut, et la mesure le DIRA (champ `theme`).
      }
    }, STORAGE);
  }
  return { browser, ctx, page: await ctx.newPage(), reuse };
}

/**
 * Connexion par le formulaire, en deux temps (identifiant, puis mot de passe).
 *
 * Cible les champs par leur LIBELLÉ, jamais par un sélecteur CSS : « CSS and
 * XPath are not recommended as the DOM can often change » — une classe de
 * composant suit la bibliothèque, le libellé visible est le contrat avec
 * l'utilisateur. On valide par Entrée plutôt que de viser un bouton, dont le
 * texte varie d'une étape à l'autre.
 *
 * `getByRole("textbox", …)` et non `getByLabel(…)` seul : le champ mot de passe
 * partage souvent son libellé avec le bouton « afficher le mot de passe », et le
 * mode strict de Playwright REFUSE alors d'agir (« resolved to 2 elements »)
 * plutôt que de choisir au hasard.
 *
 * @param page - la page à piloter.
 * @param ctx - son contexte, dont l'état est sauvegardé après succès.
 */
export async function signIn(page, ctx) {
  await page.goto(`${BASE}${LOGIN}`, { waitUntil: "domcontentloaded" });
  const id = page.getByRole("textbox", {
    name: /identifiant|utilisateur|username|e-?mail/i,
  });
  const pw = page.getByRole("textbox", {
    name: /mot de passe|password/i,
  });
  // Un écran de connexion en deux étapes peut MÉMORISER l'identifiant (stockage
  // local) et présenter directement le mot de passe : exiger l'étape 1 faisait
  // expirer la sonde sur un parcours parfaitement sain. On attend la PREMIÈRE
  // des deux étapes qui se présente, et on ne remplit l'identifiant que si son
  // champ existe.
  await id.or(pw).first().waitFor({ timeout: 15000 });
  if ((await id.count()) > 0) {
    await id.fill(USER);
    await id.press("Enter");
  }
  await pw.fill(PASSWORD, { timeout: 15000 });
  await pw.press("Enter");
  await page.waitForURL((u) => !u.pathname.endsWith(LOGIN), { timeout: 20000 });
  await ctx.storageState({ path: STATE });
}

/**
 * Ouvre la page demandée, en garantissant que c'est bien ELLE qu'on mesure.
 *
 * Un état d'authentification réutilisé peut être PÉRIMÉ (session expirée,
 * serveur redémarré, magasin vidé) : l'application renvoie alors sur le
 * formulaire, et l'on mesurerait l'écran de connexion en croyant tenir la page
 * demandée. On le constate et on refait le parcours plutôt que de rendre une
 * mesure fausse.
 *
 * @param page - la page à piloter.
 * @param ctx - son contexte.
 * @param chemin - le chemin à ouvrir, relatif à l'origine.
 * @param reuse - un état d'authentification a-t-il été repris au lancement.
 */
export async function goTo(page, ctx, chemin, reuse) {
  if (USER && !reuse) await signIn(page, ctx);
  await page.goto(`${BASE}${chemin}`, { waitUntil: "domcontentloaded" });
  if (USER && reuse) {
    // 🔴 L'URL au `domcontentloaded` MENT sur une application à rendu client :
    // le serveur répond 200 sur toutes les routes, et c'est le code de la
    // page qui, une fois monté, constate la session invalide et renvoie vers
    // le formulaire. Tester l'URL immédiatement laissait donc passer TOUT
    // état périmé — la sonde restait sur l'écran de connexion et concluait
    // « identifiants refusés » sur des identifiants valides. On accorde à ce
    // détour le temps d'avoir lieu ; la fenêtre couvre aussi la redirection
    // serveur (déjà sur le formulaire ⇒ résolue immédiatement), et ne se paie
    // que sur une session REPRISE — jamais après une connexion fraîche.
    const detourne = await page
      .waitForURL((u) => u.pathname.endsWith(LOGIN), { timeout: 3000 })
      .then(
        () => true,
        () => false,
      );
    if (detourne) {
      // Repartir d'un contexte VIERGE avant de rejouer le parcours — cookies
      // ET stockage web. Les cookies : le jeton anti-CSRF est lié à la session
      // morte, la garder fait refuser la soumission et accuser le mot de
      // passe. Le stockage : l'application peut y avoir MÉMORISÉ l'identifiant
      // et présenter un formulaire raccourci — voire connecter un AUTRE
      // utilisateur que celui demandé. Vécu, les deux.
      await ctx.clearCookies();
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
      await signIn(page, ctx);
      await page.goto(`${BASE}${chemin}`, { waitUntil: "domcontentloaded" });
    }
  }
}
