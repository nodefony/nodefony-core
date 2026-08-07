/**
 * Ouvre une page dans le navigateur en conteneur, la MESURE et la capture.
 *
 * Pilote Playwright DIRECTEMENT (aucun protocole intermédiaire) : une commande,
 * un JSON en sortie, un code de retour. Rend les couleurs et tailles RÉELLEMENT
 * calculées par le moteur de rendu — ce qu'une capture d'écran ne dit pas.
 *
 * `@usage` docker cp <ce-fichier> nodefony-browser:/app/inspect.mjs && docker exec nodefony-browser node /app/inspect.mjs
 * `@usage` docker exec nodefony-browser node /app/inspect.mjs /nodefony/supervision
 * `@env` NF_BROWSER_BASE origine vue DEPUIS le conteneur (défaut https://host.docker.internal:5152 — jamais localhost)
 * `@env` NF_BROWSER_PAGE chemin de la page à ouvrir (défaut /nodefony)
 * `@env` NF_BROWSER_EXPECT texte DISCRIMINANT attendu avant de mesurer (défaut : aucun, on ne mesure alors qu'après domcontentloaded)
 * `@env` NF_BROWSER_USER identifiant de connexion ; si absent, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_PROBES sélecteurs CSS à sonder, séparés par des virgules (`libellé=sélecteur`)
 * `@requires` conteneur `nodefony-browser` démarré (profil `browser` du docker-compose)
 * `@requires` serveur Nodefony joignable depuis le conteneur
 * `@output` un objet JSON sur stdout (URL, schéma, langue, sondes mesurées, erreurs console) + une capture PNG horodatée dans /output (monté sur tmp/browser/)
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.NF_BROWSER_BASE ?? "https://host.docker.internal:5152";
const PAGE = process.argv[2] ?? process.env.NF_BROWSER_PAGE ?? "/nodefony";
const EXPECT = process.argv[3] ?? process.env.NF_BROWSER_EXPECT ?? "";
const USER = process.env.NF_BROWSER_USER ?? "";
const PASSWORD = process.env.NF_BROWSER_PASSWORD ?? "";

/**
 * Sondes par défaut — surchargées par NF_BROWSER_PROBES (`libellé=sélecteur,…`).
 *
 * Ici, et SEULEMENT ici, les sélecteurs CSS sont le bon outil, alors que
 * Playwright les déconseille : la recommandation vise les tests, où l'on veut
 * atteindre ce que l'UTILISATEUR perçoit (rôle, libellé) pour résister aux
 * changements de DOM. Une sonde de style fait l'inverse — elle mesure une
 * IMPLÉMENTATION (« l'entrée de menu active telle que la bibliothèque la rend »)
 * et doit donc viser la classe, pas le rôle. Le pilotage, lui, passe bien par
 * des locators.
 */
const PROBES = (
  process.env.NF_BROWSER_PROBES ??
  "titre principal=h1,texte secondaire=[class*='Text-root'][data-size='xs']"
)
  .split(",")
  .map((p) => {
    const i = p.indexOf("=");
    return { label: p.slice(0, i).trim(), sel: p.slice(i + 1).trim() };
  })
  .filter((p) => p.label && p.sel);

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// `channel: "chromium"` : l'image embarque le Chromium COMPLET, mais PAS le
// `chrome-headless-shell` que Playwright lance par défaut en headless — sans ce
// paramètre il réclame un `npx playwright install` qui n'a pas lieu d'être.
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--no-sandbox"],
});

// `storageState` — l'état d'authentification est SAUVEGARDÉ puis réutilisé
// (recommandation `auth.md`) : sans lui, chaque inspection rejoue le parcours de
// connexion, soit ~4 s perdues et un risque d'échec supplémentaire à chaque run.
// Le fichier vit dans /output, donc il survit au conteneur (volume monté).
const STATE = "/output/.auth-state.json";
const reuse = USER && existsSync(STATE);
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true, // certificat de développement auto-signé
  viewport: { width: 1440, height: 900 },
  ...(reuse ? { storageState: STATE } : {}),
});
const page = await ctx.newPage();

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

/**
 * Connexion par le formulaire (deux temps : identifiant, puis mot de passe).
 *
 * Cible les champs par leur LIBELLÉ (`getByLabel`), pas par un sélecteur CSS :
 * « CSS and XPath are not recommended as the DOM can often change » — une classe
 * de composant change au gré de la bibliothèque, le libellé visible est le
 * contrat avec l'utilisateur. On valide par Entrée plutôt que de viser un
 * bouton, dont le texte varie d'une étape à l'autre.
 */
const login = async () => {
  await page.goto(`${BASE}/nodefony/login`, { waitUntil: "domcontentloaded" });
  // `getByRole("textbox", …)` et non `getByLabel(…)` seul : le champ mot de
  // passe partage son libellé avec le bouton « afficher le mot de passe », et
  // le mode strict de Playwright REFUSE alors d'agir (« resolved to 2
  // elements ») plutôt que de choisir au hasard. Préciser le rôle lève
  // l'ambiguïté — et c'est le mode strict qui a révélé le défaut.
  const id = page.getByRole("textbox", { name: /identifiant|username/i });
  await id.fill(USER);
  await id.press("Enter");
  const pw = page.getByRole("textbox", { name: /mot de passe|password/i });
  await pw.fill(PASSWORD, { timeout: 15000 });
  await pw.press("Enter");
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), {
    timeout: 20000,
  });
  await ctx.storageState({ path: STATE });
};

if (USER && !reuse) await login();

await page.goto(`${BASE}${PAGE}`, { waitUntil: "domcontentloaded" });

// Un état réutilisé peut être PÉRIMÉ (session expirée, serveur redémarré, store
// vidé) : l'application renvoie alors sur /login, et l'on mesurerait l'écran de
// connexion en croyant tenir la page demandée. On le constate et on refait le
// parcours plutôt que de rendre une mesure fausse.
if (USER && new URL(page.url()).pathname.endsWith("/login")) {
  await login();
  await page.goto(`${BASE}${PAGE}`, { waitUntil: "domcontentloaded" });
}

// Attendre un texte DISCRIMINANT, jamais `networkidle` : une application qui se
// monte puis demande ses données passe par un état « réseau calme » où l'écran
// est encore vide. Mesurer là rend des sondes absentes et des 401 encore en vol
// — on décrit alors un écran qui n'existe déjà plus. Vécu.
//
// `getByText` plutôt qu'un sélecteur `text=` (locators recommandés), et `.first()`
// assumé : la doc le déconseille pour les ACTIONS, où viser le mauvais élément
// est dangereux. Ici on attend une APPARITION — le risque n'existe pas.
if (EXPECT) {
  await page.getByText(EXPECT).first().waitFor({ timeout: 20000 });
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
  return {
    schema: document.documentElement.dataset.mantineColorScheme ?? "?",
    lang: document.documentElement.lang,
    titre: document.title,
    sondes: probes.map(({ label, sel }) => {
      const el = document.querySelector(sel);
      if (!el) return { label, absent: true, selecteur: sel };
      const cs = getComputedStyle(el);
      const bg = bgOf(el);
      const r = el.getBoundingClientRect();
      return {
        label,
        texte: (el.textContent ?? "").trim().slice(0, 40),
        couleur: cs.color,
        fond: bg,
        contraste: ratio(cs.color, bg),
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
