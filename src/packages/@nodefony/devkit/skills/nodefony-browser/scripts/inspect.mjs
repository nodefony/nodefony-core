/**
 * Ouvre une page dans le navigateur en conteneur, la MESURE et la capture.
 *
 * Pilote Playwright DIRECTEMENT (aucun protocole intermédiaire) : une commande,
 * un JSON en sortie, un code de retour. Rend les couleurs et tailles RÉELLEMENT
 * calculées par le moteur de rendu — ce qu'une capture d'écran ne dit pas.
 *
 * `@usage` docker cp <dossier scripts>/. <app>-browser:/app/ && docker exec <app>-browser node /app/inspect.mjs
 * `@usage` docker exec <app>-browser node /app/inspect.mjs /tableau-de-bord "Chiffre d'affaires"
 * `@env` NF_BROWSER_BASE origine vue DEPUIS le conteneur (défaut https://host.docker.internal:5152 — jamais localhost)
 * `@env` NF_BROWSER_PAGE chemin de la page à ouvrir (défaut /)
 * `@env` NF_BROWSER_EXPECT texte DISCRIMINANT attendu avant de mesurer (défaut : aucun, on ne mesure alors qu'après domcontentloaded)
 * `@env` NF_BROWSER_LOGIN chemin du formulaire de connexion de TON application — requis dès qu'un identifiant est donné, aucun défaut n'est deviné
 * `@env` NF_BROWSER_USER identifiant de connexion ; si absent, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_PROBES sélecteurs CSS à sonder, séparés par des virgules (`libellé=sélecteur`)
 * `@requires` conteneur du profil `browser` démarré · serveur Nodefony joignable depuis le conteneur
 * `@output` un objet JSON sur stdout (URL, thème, langue, sondes mesurées, erreurs console) + une capture PNG horodatée dans /output (monté sur tmp/browser/)
 */
import { open, goTo, LOGIN } from "./lib/browser.mjs";

const PAGE = process.argv[2] ?? process.env.NF_BROWSER_PAGE ?? "/";
const EXPECT = process.argv[3] ?? process.env.NF_BROWSER_EXPECT ?? "";

/**
 * Sondes par défaut — surchargées par NF_BROWSER_PROBES (`libellé=sélecteur,…`).
 *
 * Ici, et SEULEMENT ici, les sélecteurs CSS sont le bon outil, alors que
 * Playwright les déconseille : la recommandation vise les tests, où l'on veut
 * atteindre ce que l'UTILISATEUR perçoit (rôle, libellé) pour résister aux
 * changements de DOM. Une sonde de style fait l'inverse — elle mesure une
 * IMPLÉMENTATION (« le bouton principal tel que la bibliothèque le rend ») et
 * doit donc viser la classe, pas le rôle. Le pilotage, lui, passe bien par des
 * locators.
 *
 * Le défaut vise des éléments que TOUTE page possède : ce script ne connaît pas
 * ta bibliothèque de composants, à toi de lui donner tes sélecteurs.
 */
const PROBES = (
  process.env.NF_BROWSER_PROBES ?? "titre principal=h1,corps de page=body"
)
  .split(",")
  .map((p) => {
    const i = p.indexOf("=");
    return { label: p.slice(0, i).trim(), sel: p.slice(i + 1).trim() };
  })
  .filter((p) => p.label && p.sel);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const { browser, ctx, page, reuse } = await open();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await goTo(page, ctx, PAGE, reuse);

// Attendre un texte DISCRIMINANT, jamais `networkidle` : une application qui se
// monte puis demande ses données passe par un état « réseau calme » où l'écran
// est encore vide. Mesurer là rend des sondes absentes et des 401 encore en vol
// — on décrit alors un écran qui n'existe déjà plus. Vécu.
//
// `getByText` plutôt qu'un sélecteur `text=` (locators recommandés), et `.first()`
// assumé : la doc le déconseille pour les ACTIONS, où viser le mauvais élément
// est dangereux. Ici on attend une APPARITION — le risque n'existe pas.
if (EXPECT) {
  try {
    await page.getByText(EXPECT).first().waitFor({ timeout: 20000 });
  } catch {
    // Une attente qui expire rend un TimeoutError de Playwright : exact, et
    // muet sur la cause. Or la cause la plus fréquente n'est pas « le texte
    // n'existe pas » mais « on n'est pas sur la page qu'on croit » — identifiants
    // refusés, session expirée, route protégée. On le CONSTATE avant de rendre
    // la main, sinon chacun rediagnostique la même chose.
    console.error(
      `Texte attendu jamais apparu : « ${EXPECT} »\n` +
        `Page réellement ouverte : ${page.url()}\n` +
        (LOGIN && new URL(page.url()).pathname.endsWith(LOGIN)
          ? "→ on est resté sur le formulaire de connexion : identifiants refusés, ou la page demandée est protégée et NF_BROWSER_USER n'a pas été fourni."
          : "→ la page est bien ouverte : le texte attendu est absent, ou il n'est pas encore rendu."),
    );
    await browser.close();
    process.exit(65); // EX_DATAERR
  }
}

const measured = await page.evaluate((probes) => {
  // Luminance relative et rapport de contraste — définitions WCAG 2.x.
  const lum = (c) => {
    const m = c.match(/\d+(\.\d+)?/g);
    if (!m) return 0;
    const [r, g, b] = m.slice(0, 3).map((v) => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return +((x + 0.05) / (y + 0.05)).toFixed(2);
  };
  // Le fond effectif est celui du premier ancêtre non transparent : lire
  // `backgroundColor` sur l'élément lui-même rend `rgba(0,0,0,0)` et un
  // contraste faux — c'est l'erreur classique de ce genre de sonde.
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const root = document.documentElement;
  return {
    // Le thème clair/sombre se lit sur ce qui est STANDARD, jamais sur
    // l'attribut d'une bibliothèque en particulier : `color-scheme` est la
    // valeur que le moteur de rendu APPLIQUE, et `data-theme` la convention que
    // le CSS nu emploie le plus souvent. Si ton application marque son thème
    // autrement, sonde-le comme n'importe quel autre élément (NF_BROWSER_PROBES).
    theme: getComputedStyle(root).colorScheme || (root.dataset.theme ?? "?"),
    lang: root.lang,
    titre: document.title,
    // Les scripts RÉELLEMENT servis à la page. C'est ce qui permet de vérifier
    // que le bundle observé est bien celui qu'on vient de bâtir — comparer avec
    // l'`index.html` produit dans `dist/` — sans dépendre d'un `curl` ni d'un
    // `grep`, qui n'existent pas sur toutes les machines de développement.
    scripts: [...document.querySelectorAll("script[src]")].map((s) =>
      s.getAttribute("src"),
    ),
    sondes: probes.map(({ label, sel }) => {
      const el = document.querySelector(sel);
      if (!el) return { label, absent: true, selecteur: sel };
      const cs = getComputedStyle(el);
      const bg = bgOf(el);
      const r = el.getBoundingClientRect();
      const c = ratio(cs.color, bg);
      // Le seuil applicable dépend de la POLICE, pas de la taille du bloc :
      // WCAG appelle « large » un texte d'au moins 24 px, ou 18,66 px en gras.
      // Rendre le contraste sans la police laisse le lecteur conclure au
      // hasard entre 3:1 et 4,5:1 — c'est-à-dire ne rien conclure.
      const px = parseFloat(cs.fontSize);
      const gras = Number(cs.fontWeight) >= 700;
      const large = px >= 24 || (gras && px >= 18.66);
      return {
        label,
        texte: (el.textContent ?? "").trim().slice(0, 40),
        couleur: cs.color,
        fond: bg,
        contraste: c,
        police: `${cs.fontSize}${gras ? " gras" : ""}`,
        wcag:
          c >= (large ? 4.5 : 7)
            ? "AAA"
            : c >= (large ? 3 : 4.5)
              ? "AA"
              : "ÉCHEC",
        taille: `${Math.round(r.width)}×${Math.round(r.height)}`,
      };
    }),
  };
}, PROBES);

const slug = PAGE.replace(/\//g, "-").replace(/^-/, "") || "racine";
const shot = `/output/${slug}-${stamp}.png`;
await page.screenshot({ path: shot });

console.log(
  JSON.stringify(
    {
      url: page.url(),
      ...measured,
      erreursConsole: errors,
      capture: shot.replace("/output", "tmp/browser"),
    },
    null,
    2,
  ),
);
await browser.close();
