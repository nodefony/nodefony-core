/**
 * Le décor commun aux sondes : lancer le navigateur, se connecter, ouvrir une
 * page en étant sûr de mesurer CELLE-LÀ.
 *
 * Pourquoi une brique partagée plutôt que deux copies : les deux scripts sont
 * copiés ensemble (`docker cp <dossier>/. <conteneur>:/app/`), donc la partager
 * ne coûte rien — et la duplication précédente avait déjà divergé en silence,
 * une seule des deux copies rattrapant un état d'authentification périmé.
 *
 * `@env` NF_BROWSER_BASE origine vue DEPUIS le conteneur (défaut https://host.docker.internal:5152 — jamais localhost)
 * `@env` NF_BROWSER_LOGIN chemin du formulaire de connexion — REQUIS dès qu'un identifiant est donné, aucun défaut n'est deviné
 * `@env` NF_BROWSER_USER identifiant ; sans lui, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 */
import { chromium } from "playwright";
import { existsSync, rmSync } from "node:fs";

export const BASE =
  process.env.NF_BROWSER_BASE ?? "https://host.docker.internal:5152";
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
 * Il vit dans `/output`, donc dans le volume monté : il survit au conteneur.
 * Sans lui, chaque inspection rejoue le parcours de connexion — quelques
 * secondes perdues et une occasion d'échec de plus à chaque exécution.
 */
const STATE = "/output/.auth-state.json";

/**
 * Ouvre un navigateur et un contexte prêts à mesurer.
 *
 * @returns `{ browser, ctx, page, reuse }` — `reuse` dit si un état
 *   d'authentification a été repris, ce qui décide s'il faut se connecter.
 */
export async function open() {
  // `channel: "chromium"` : l'image embarque le Chromium COMPLET, mais PAS le
  // `chrome-headless-shell` que Playwright lance par défaut en headless — sans
  // ce paramètre il réclame un `npx playwright install` qui n'a pas lieu d'être.
  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--no-sandbox"],
  });
  const options = {
    ignoreHTTPSErrors: true, // certificat de développement auto-signé
    viewport: { width: 1440, height: 900 },
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
