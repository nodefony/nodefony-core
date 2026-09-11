/**
 * Ouvre une page dans le navigateur en conteneur, la MESURE et la capture.
 *
 * Pilote Playwright DIRECTEMENT (aucun protocole intermédiaire) : une commande,
 * un JSON en sortie, un code de retour. Rend les couleurs et tailles RÉELLEMENT
 * calculées par le moteur de rendu — ce qu'une capture d'écran ne dit pas.
 *
 * Le socle (thème, langue, titre, scripts servis, sondes de style, console,
 * erreurs non capturées, violations CSP, capture) sort toujours ; le reste est
 * découpé en FAMILLES activables — un mur de JSON que personne ne lit ne sert
 * à rien. La doc de chaque famille vit dans `references/sondes.md` du skill.
 *
 * `@usage` node skills/nodefony-browser/scripts/inspect.mjs /tableau-de-bord "Chiffre d'affaires"
 * `@env` NF_BROWSER_BASE origine à joindre (défaut CONSTATÉ : 127.0.0.1 en local, host.docker.internal en conteneur)
 * `@env` NF_BROWSER_OUT dossier des captures et de l'état d'authentification (défaut constaté de la même façon)
 * `@env` NF_BROWSER_PAGE chemin de la page à ouvrir (défaut /)
 * `@env` NF_BROWSER_EXPECT texte DISCRIMINANT attendu avant de mesurer (défaut : aucun, on mesure après domcontentloaded)
 * `@env` NF_BROWSER_FAMILIES familles de sondes à activer, séparées par des virgules (a11y, axe, rendu, reseau, perf, stockage, responsive — ou « toutes ») ; défaut : aucune, le socle seul
 * `@env` NF_BROWSER_ENGINE navigateur imposé (chromium, chrome, msedge) ; sans lui, le premier qui répond
 * `@env` NF_BROWSER_COLOR_SCHEME schéma de couleurs émulé (light, dark, no-preference) — un défaut peut n'exister que dans UN thème
 * `@env` NF_BROWSER_STORAGE entrées de stockage local posées AVANT chargement (`clé=valeur`) — pour une application qui MÉMORISE son thème
 * `@env` NF_BROWSER_LOGIN chemin du formulaire de connexion de TON application — requis dès qu'un identifiant est donné, aucun défaut n'est deviné
 * `@env` NF_BROWSER_USER identifiant de connexion ; si absent, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_ACTIONS séquence d'interactions AVANT mesure, séparées par `|` —
 *                        `verbe:cible[=valeur]` : clic (défaut), double, droit, survol,
 *                        saisir, touche, voir, defiler, attendre. Un écran qui se déplie
 *                        au clic n'existe pas tant qu'on ne l'a pas ouvert.
 * `@env` NF_BROWSER_FULLPAGE 1 = capture la page ENTIÈRE (défaut : la fenêtre)
 * `@env` NF_BROWSER_PROBES sélecteurs CSS à sonder, séparés par des virgules (`libellé=sélecteur`)
 * `@env` NF_BROWSER_WIDTHS largeurs de la famille responsive (défaut 360,768,1280)
 * `@env` NF_BROWSER_SEUIL_LOURD bytes au-delà desquels une ressource est « lourde » (défaut 512000)
 * `@env` NF_BROWSER_SEUIL_LENT millisecondes au-delà desquelles une réponse est « lente » (défaut 1000)
 * `@requires` conteneur du profil `browser` démarré · serveur joignable depuis le conteneur
 * `@output` un objet JSON sur stdout + une capture PNG horodatée dans /output
 * `@exit` 0 mesure rendue (le verdict est une DONNÉE, pas un code de retour) · 64 usage (famille inconnue, identifiant sans chemin de connexion) · 65 texte attendu jamais apparu
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as decor from "./lib/browser.mjs";
import { open, goTo, LOGIN, OUTPUT } from "./lib/browser.mjs";
import { sourceWcag } from "./lib/wcag.mjs";
import {
  FAMILIES,
  parseActions,
  parseFamilies,
  parseProbes,
  parseWidths,
  summarizeAxe,
  verdictGlobal,
} from "./lib/probes.mjs";

const PAGE = process.argv[2] ?? process.env.NF_BROWSER_PAGE ?? "/";
const EXPECT = process.argv[3] ?? process.env.NF_BROWSER_EXPECT ?? "";
/**
 * Ce qu'il faut FAIRE avant de mesurer — une séquence, pas un geste.
 *
 * Certaines pages ne sont pas un état mais un PARCOURS : le formulaire de
 * création d'application n'affiche ses questions qu'après le choix d'un type,
 * un menu ne s'ouvre qu'au survol, un panneau qu'au second clic. Sans ce
 * levier, on photographie l'écran d'accueil et l'on conclut « le champ n'y est
 * pas » — alors qu'on ne l'a jamais ouvert.
 *
 * Grammaire : `verbe:cible[=valeur]`, séparés par `|`. Le verbe est facultatif
 * (`clic` par défaut), et la cible est cherchée d'abord comme TEXTE visible —
 * ce que voit l'utilisateur — puis comme sélecteur CSS.
 *
 * | verbe      | ce qu'il fait                                             |
 * | ---------- | --------------------------------------------------------- |
 * | `clic`     | clic gauche (le défaut)                                   |
 * | `double`   | double-clic                                               |
 * | `droit`    | clic droit — ouvre un menu contextuel applicatif          |
 * | `survol`   | survol : révèle une infobulle, un menu déroulant          |
 * | `saisir`   | remplit un champ (`saisir:Nom=mon-app`)                   |
 * | `touche`   | frappe une touche (`touche:Enter`, `touche:Escape`)       |
 * | `voir`     | amène dans la vue SANS cliquer                            |
 * | `defiler`  | fait défiler de N pixels (`defiler:600`), page ou conteneur |
 * | `attendre` | attend qu'un texte APPARAISSE (après une action lente)    |
 *
 * 🔴 `voir` existe parce qu'un clic n'est pas neutre : sur un formulaire, le
 * texte d'une question est un `label` — cliquer dessus COCHE la case qu'il
 * décrit, et l'on observerait un écran que l'observation a modifié.
 *
 * ⚠️ Et `defiler` n'est pas `NF_BROWSER_FULLPAGE` : une application dont le
 * contenu défile dans un conteneur interne (toute console à barre latérale
 * fixe) ne GRANDIT pas — la capture « page entière » y rend exactement la
 * fenêtre, et l'on conclut que ce qui est plus bas n'existe pas. Vécu.
 */
const ACTIONS = parseActions(process.env.NF_BROWSER_ACTIONS);

const { kept, unknown } = parseFamilies(process.env.NF_BROWSER_FAMILIES);
if (unknown.length > 0) {
  // Refuser, jamais ignorer : une famille fautée en silence ferait croire
  // qu'on a mesuré ce qu'on n'a pas mesuré.
  console.error(
    `Famille(s) de sondes inconnue(s) : ${unknown.join(", ")}\n` +
      `Familles disponibles (ou « toutes ») :\n` +
      Object.entries(FAMILIES)
        .map(([name, description]) => `  ${name} — ${description}`)
        .join("\n"),
  );
  process.exit(64); // EX_USAGE
}
const active = new Set(kept);

/**
 * Sondes de style par défaut — surchargées par NF_BROWSER_PROBES.
 *
 * Ici, et SEULEMENT ici, les sélecteurs CSS sont le bon outil, alors que
 * Playwright les déconseille : la recommandation vise les tests, où l'on veut
 * atteindre ce que l'UTILISATEUR perçoit (rôle, libellé). Une sonde de style
 * fait l'inverse — elle mesure une IMPLÉMENTATION et doit viser la classe.
 * Le défaut vise des éléments que TOUTE page possède.
 */
const { probes: PROBES, rejected } = parseProbes(
  process.env.NF_BROWSER_PROBES ?? "titre principal=h1,corps de page=body",
);
if (rejected.length > 0) {
  console.error(
    `Sonde(s) ignorée(s), forme attendue « libellé=sélecteur » : ${rejected.join(" · ")}`,
  );
}

/**
 * Le code d'`axe-core`, quel que soit l'endroit d'où il est joignable.
 *
 * Trois voies, de la plus explicite à la plus commode — parce que le script
 * s'exécute DANS un conteneur où l'arborescence de l'application n'est pas
 * forcément montée, et qu'un « module introuvable » y est illisible.
 *
 * @returns {Promise<string>} le source complet, prêt à être évalué dans la page.
 * @throws Si aucune des trois voies n'aboutit — dire l'indisponibilité vaut
 *   toujours mieux que rendre un verdict sans avoir mesuré.
 */
async function axeSource() {
  const explicite = process.env.NF_BROWSER_AXE;
  if (explicite) return readFileSync(explicite, "utf8");
  const sibling = new URL("./axe.min.js", import.meta.url);
  if (existsSync(sibling)) return readFileSync(sibling, "utf8");
  const { default: axe } = await import("axe-core");
  return axe.source;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const { browser, ctx, page, reuse } = await open();

// ── Collecteurs — posés AVANT toute navigation ──────────────────────────────
const consoleErrors = [];
const uncaughtErrors = [];
page.on("console", (m) => {
  if (m.type() === "error" && consoleErrors.length < 30)
    consoleErrors.push(m.text().slice(0, 300));
});
// `pageerror` et non seulement `console` : une exception non capturée qui tue
// l'application ne passe pas toujours par console.error.
page.on("pageerror", (e) => {
  if (uncaughtErrors.length < 20) uncaughtErrors.push(String(e).slice(0, 300));
});

// Les violations CSP ne sont visibles QUE depuis la page : le réseau montre la
// requête absente, jamais la raison. L'init script est réinjecté à chaque
// navigation — c'est l'état de la DERNIÈRE page qu'on lit, celle qu'on mesure.
await page.addInitScript(() => {
  window.__nfCsp = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    if (window.__nfCsp.length < 20)
      window.__nfCsp.push({
        directive: e.violatedDirective,
        blocked: String(e.blockedURI ?? "").slice(0, 140),
        source: String(e.sourceFile ?? "").slice(0, 140),
        line: e.lineNumber,
      });
  });
});

if (active.has("perf")) {
  // LCP et CLS n'existent qu'en OBSERVANT pendant le chargement : les lire
  // après coup rend null. `buffered: true` rattrape ce qui s'est produit entre
  // l'injection et l'observation ; le try par type, car un navigateur qui
  // ignore un type d'entrée lève — et tuerait les deux autres mesures.
  await page.addInitScript(() => {
    window.__nfPerf = { lcpMs: null, cls: 0, longTasks: 0 };
    try {
      new PerformanceObserver((l) => {
        const e = l.getEntries().pop();
        if (e) window.__nfPerf.lcpMs = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          if (!e.hadRecentInput) window.__nfPerf.cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((l) => {
        window.__nfPerf.longTasks += l.getEntries().length;
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });
}

const finishedRequests = [];
const networkFailures = [];
if (active.has("reseau")) {
  page.on("requestfinished", (rq) => {
    if (finishedRequests.length < 300) finishedRequests.push(rq);
  });
  page.on("requestfailed", (rq) => {
    if (networkFailures.length < 40)
      networkFailures.push({
        url: rq.url().slice(0, 140),
        type: rq.resourceType(),
        error: rq.failure()?.errorText ?? "?",
      });
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && networkFailures.length < 40)
      networkFailures.push({
        url: r.url().slice(0, 140),
        type: r.request().resourceType(),
        status: r.status(),
      });
  });
}

await goTo(page, ctx, PAGE, reuse);

// Attendre un texte DISCRIMINANT, jamais `networkidle` : une application qui se
// monte puis demande ses données passe par un état « réseau calme » où l'écran
// est encore vide. Mesurer là rend des sondes absentes et des 401 encore en vol
// — on décrit alors un écran qui n'existe déjà plus. Vécu.
if (EXPECT) {
  try {
    await page.getByText(EXPECT).first().waitFor({ timeout: 20000 });
  } catch {
    // La cause la plus fréquente n'est pas « le texte n'existe pas » mais
    // « on n'est pas sur la page qu'on croit » — identifiants refusés, session
    // expirée, route protégée. On le CONSTATE avant de rendre la main.
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

// Jouer la séquence — après le texte discriminant (la page est montée), avant
// toute mesure. Une action qui ne trouve pas sa cible ARRÊTE la sonde : la
// mesure qui suivrait porterait sur un écran qu'on n'a pas ouvert, et rien ne
// le dirait.
for (const { verb, target, value } of ACTIONS) {
  if (verb === "defiler") {
    const pixels = Number.parseInt(target, 10);
    if (!Number.isFinite(pixels)) {
      console.error(`defiler attend un nombre de pixels, reçu « ${target} »`);
      await browser.close();
      process.exit(64); // EX_USAGE
    }
    // Le conteneur qui défile RÉELLEMENT, pas la fenêtre : sur une console à
    // barre latérale fixe, `window.scrollBy` ne bouge rien du tout.
    await page.evaluate((dy) => {
      const scrollable = [...document.querySelectorAll("*")].find(
        (el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200,
      );
      (scrollable ?? window).scrollBy(0, dy);
    }, pixels);
    continue;
  }
  // Le premier candidat VISIBLE, pas le premier du DOM : un libellé apparaît
  // souvent d'abord dans un menu replié ou un gabarit caché, et agir là ne fait
  // rien tout en passant pour un succès.
  const candidates = page.getByText(target, { exact: false });
  let locator = null;
  const total = await candidates.count();
  for (let i = 0; i < total; i += 1) {
    const c = candidates.nth(i);
    if (await c.isVisible().catch(() => false)) {
      locator = c;
      break;
    }
  }
  locator ??= page.locator(target).first();
  try {
    await locator.waitFor({ timeout: 15000 });
    if (verb === "clic") await locator.click();
    else if (verb === "double") await locator.dblclick();
    else if (verb === "droit") await locator.click({ button: "right" });
    else if (verb === "survol") await locator.hover();
    else if (verb === "saisir") await locator.fill(value);
    else if (verb === "touche") await locator.press(value || "Enter");
    else if (verb === "voir") await locator.scrollIntoViewIfNeeded();
    // `attendre` : le `waitFor` ci-dessus EST l'action.
  } catch {
    console.error(
      `Action « ${verb}:${target} » impossible\n` +
        `Page réellement ouverte : ${page.url()}\n` +
        "→ le libellé a changé, l'élément n'est pas encore rendu, ou il faut " +
        "agir sur autre chose avant lui (NF_BROWSER_ACTIONS accepte une séquence, séparée par « | »).",
    );
    await browser.close();
    process.exit(65); // EX_DATAERR
  }
}

// ── Les fonctions qui voyagent vers la page ─────────────────────────────────
// Elles sont AUTOSUFFISANTES (aucune fermeture sur ce module) : la sonde les
// injecte par leur code source dans une expression unique. C'est ce qui permet
// aux calculs WCAG d'avoir UNE seule implémentation, importée par les tests et
// exécutée par le navigateur.

/**
 * Décrit un élément en une ligne courte — pour des exemples lisibles, jamais
 * un dump de DOM.
 */
function describeElement(el) {
  const t = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = !id && el.classList.length ? `.${el.classList[0]}` : "";
  const text = (el.textContent ?? "").trim().slice(0, 30);
  return `${t}${id}${cls}${text ? ` « ${text} »` : ""}`.slice(0, 90);
}

/** Un élément participe-t-il au rendu — filtre commun des sondes. */
function isVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

/**
 * Le fond RÉELLEMENT perçu derrière un élément — toutes couches EMPILÉES.
 *
 * Deux erreurs classiques, qui font toutes deux conclure faux :
 *
 *  • lire `backgroundColor` sur l'élément seul rend `rgba(0, 0, 0, 0)` presque
 *    toujours, et le contraste calculé contre du transparent n'a aucun sens ;
 *  • s'arrêter à la première couche NON transparente traite un voile à 13 %
 *    comme un aplat plein — c'est-à-dire comme une couleur que personne ne voit.
 *
 * On empile donc les couches translucides jusqu'à la première opaque, puis on
 * les compose de bas en haut, exactement comme le fait le moteur de rendu.
 *
 * @param {Element} el - l'élément dont on cherche le fond perçu.
 * @returns {string} une couleur `rgb()` opaque, telle qu'elle est PERÇUE.
 */
function effectiveBackground(el) {
  const layers = [];
  let opaqueLayer = null;
  for (let n = el; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (!bg || /transparent/.test(bg)) continue;
    const { a } = parseColor(bg);
    if (a === 0) continue;
    if (a >= 1) {
      opaqueLayer = bg;
      break;
    }
    layers.push(bg);
  }
  // Faute de couche opaque rencontrée, le fond de la page fait socle — et à
  // défaut le blanc, qui est ce qu'un navigateur peint sous un document nu.
  if (opaqueLayer === null) {
    const rootBackground = getComputedStyle(
      document.documentElement,
    ).backgroundColor;
    opaqueLayer =
      rootBackground && parseColor(rootBackground).a >= 1
        ? rootBackground
        : "rgb(255, 255, 255)";
  }
  // De la plus basse à la plus haute : chacune se compose sur le résultat
  // précédent, jamais sur le socle seul.
  let perceived = opaqueLayer;
  for (let i = layers.length - 1; i >= 0; i--)
    perceived = compose(layers[i], perceived);
  return perceived;
}

/**
 * Famille a11y — ce qu'un lecteur d'écran ou un clavier rencontrent VRAIMENT.
 * Chaque règle rend un compte et 3 exemples, jamais la liste entière.
 */
function probeA11y() {
  const block = (list) => ({
    total: list.length,
    examples: list.slice(0, 3).map(describeElement),
  });
  // Nom accessible SIMPLIFIÉ (aria-label → aria-labelledby → texte → title →
  // alt d'une image fille). L'algorithme complet de la norme fait plus ; le
  // simplifié suffit à attraper un bouton-icône muet — le cas réel.
  const accessibleName = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const refs = el.getAttribute("aria-labelledby");
    if (refs) {
      const t = refs
        .split(/\s+/)
        .map((i) => document.getElementById(i)?.textContent ?? "")
        .join(" ")
        .trim();
      if (t) return t;
    }
    const text = (el.textContent ?? "").trim();
    if (text) return text;
    if (el.getAttribute("title")) return el.getAttribute("title");
    const img = el.querySelector("img[alt]");
    if (img && img.getAttribute("alt")?.trim())
      return img.getAttribute("alt").trim();
    return "";
  };
  const withoutAlt = [...document.querySelectorAll("img")]
    .filter(isVisible)
    .filter((i) => !i.hasAttribute("alt"));
  const withoutLabel = [
    ...document.querySelectorAll("input:not([type=hidden]), select, textarea"),
  ]
    .filter(isVisible)
    .filter((c) => {
      if (
        c.getAttribute("aria-label") ||
        c.getAttribute("aria-labelledby") ||
        c.getAttribute("title")
      )
        return false;
      if (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`))
        return false;
      return !c.closest("label");
    });
  const withoutName = [
    ...document.querySelectorAll("button, a[href], [role=button]"),
  ]
    .filter(isVisible)
    .filter((c) => !accessibleName(c));
  // Hiérarchie des titres : les niveaux dans l'ordre du document, et les sauts
  // (h2→h4) qui cassent la table des matières d'un lecteur d'écran.
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter(isVisible)
    .map((h) => Number(h.tagName[1]));
  const skips = [];
  for (let i = 1; i < headings.length; i++)
    if (headings[i] > headings[i - 1] + 1)
      skips.push(`h${headings[i - 1]}→h${headings[i]}`);
  const h1 = headings.filter((n) => n === 1).length;
  // Cibles < 24×24 (WCAG 2.5.8). Les liens DANS le texte (display inline) sont
  // exemptés par le critère lui-même — les compter noierait le signal.
  const interactive = [
    ...document.querySelectorAll(
      "button, a[href], input:not([type=hidden]), select, textarea, [role=button]",
    ),
  ].filter(isVisible);
  const small = [];
  for (const el of interactive) {
    if (el.tagName === "A" && getComputedStyle(el).display === "inline")
      continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24)
      small.push({
        element: describeElement(el),
        size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      });
    if (small.length >= 40) break;
  }
  // Un tabindex POSITIF impose un ordre de focus manuel qui diverge du DOM —
  // l'anti-pattern classique d'un parcours clavier incompréhensible.
  const positiveTabIndexes = [
    ...document.querySelectorAll("[tabindex]"),
  ].filter((el) => Number(el.getAttribute("tabindex")) > 0);
  const lang = document.documentElement.lang || null;
  const alerts =
    withoutAlt.length +
    withoutLabel.length +
    withoutName.length +
    small.length +
    positiveTabIndexes.length +
    skips.length +
    (h1 === 1 ? 0 : 1) +
    (lang ? 0 : 1);
  return {
    verdict: alerts === 0 ? "OK" : "ALERTE",
    lang,
    headings: { h1, order: headings.join(","), skips },
    imagesWithoutAlt: block(withoutAlt),
    fieldsWithoutLabel: block(withoutLabel),
    controlsWithoutName: block(withoutName),
    targetsTooSmall: {
      total: small.length,
      threshold: "24×24",
      // Regroupées par FAMILLE, pas listées une à une. Trente-six cibles trop
      // petites, c'est presque toujours un composant réutilisé trente-six fois :
      // trois exemples bruts font croire à trente-six corrections, quand il n'y
      // en a qu'une. Le compte par famille dit ce qu'il faut corriger, et
      // combien d'écrans en profiteront.
      families: Object.entries(
        small.reduce((acc, p) => {
          // Le texte distingue deux boutons du même composant : on l'enlève.
          const key = `${p.element.replace(/ «[\s\S]*$/, "")} ${p.size}`;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, Object.create(null)),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([what, n]) => ({ what, occurrences: n })),
      examples: small.slice(0, 3),
    },
    positiveTabIndexValues: block(positiveTabIndexes),
    visibleFocusables: interactive.length,
  };
}

/**
 * Famille rendu — la page tient-elle dans son viewport, ses polices sont-elles
 * VRAIMENT arrivées. Les éléments hors viewport sont une INFO, pas le verdict :
 * carrousels et textes pour lecteurs d'écran en produisent légitimement.
 */
function probeRendering() {
  const doc = document.scrollingElement ?? document.documentElement;
  const overflowPx = Math.max(0, doc.scrollWidth - window.innerWidth);
  const outsideViewport = [];
  let totalOutside = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 1) {
      totalOutside += 1;
      if (outsideViewport.length < 3) outsideViewport.push(describeElement(el));
      if (totalOutside >= 200) break;
    }
  }
  const families = {};
  let failedFonts = 0;
  for (const f of document.fonts) {
    families[`${f.family} ${f.weight}`] = f.status;
    if (f.status === "error") failedFonts += 1;
  }
  return {
    verdict: overflowPx > 0 || failedFonts > 0 ? "ALERTE" : "OK",
    horizontalOverflow: { present: overflowPx > 0, overflowPx },
    elementsOutsideViewport: { total: totalOutside, examples: outsideViewport },
    fonts: {
      status: document.fonts.status,
      failed: failedFonts,
      families,
    },
  };
}

/** Famille stockage, volet page — tailles et clés, JAMAIS les valeurs. */
function probeWebStorage() {
  // Les valeurs ne sortent pas : un jeton de session imprimé dans un JSON de
  // sonde finit dans un terminal, un log de CI, un rapport — il a fuité.
  const inventory = (store) => {
    const keys = [];
    let bytes = 0;
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      // ×2 : les chaînes JavaScript comptent en unités UTF-16.
      const size = (store.getItem(key) ?? "").length * 2;
      bytes += size;
      keys.push({ key, bytes: size });
    }
    keys.sort((a, b) => b.bytes - a.bytes);
    return { keys: keys.length, bytes, largest: keys.slice(0, 5) };
  };
  return {
    localStorage: inventory(window.localStorage),
    sessionStorage: inventory(window.sessionStorage),
  };
}

/** Famille perf — lit ce que les observateurs injectés AVANT navigation ont vu. */
function readPerf() {
  const round = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v));
  const nav = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  const p = window.__nfPerf ?? {};
  const lcpMs = round(p.lcpMs);
  const cls =
    typeof p.cls === "number" ? Math.round(p.cls * 1000) / 1000 : null;
  return {
    // Seuils « bons » de l'initiative Web Vitals — au-delà, l'utilisateur
    // attend ou voit la page bouger sous son doigt.
    verdict:
      (lcpMs != null && lcpMs > 2500) || (cls != null && cls > 0.1)
        ? "ALERTE"
        : "OK",
    ttfbMs: nav ? round(nav.responseStart) : null,
    domContentLoadedMs: nav ? round(nav.domContentLoadedEventEnd) : null,
    loadCompleteMs: nav ? round(nav.loadEventEnd) : null,
    fcpMs: fcp ? round(fcp.startTime) : null,
    lcpMs,
    cls,
    longTasks: typeof p.longTasks === "number" ? p.longTasks : null,
    thresholds: { lcpGoodMs: 2500, clsGood: 0.1 },
  };
}

/**
 * La mesure principale, composée puis évaluée en UNE expression dans la page.
 * Async : les polices se constatent après `document.fonts.ready` (borné — une
 * police qui ne finit jamais ne doit pas suspendre la sonde).
 */
async function measurePage(args) {
  const root = document.documentElement;
  if (args.families.includes("rendu")) {
    await Promise.race([
      document.fonts.ready,
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  }
  const base = {
    // Le thème clair/sombre se lit sur ce qui est STANDARD, jamais sur
    // l'attribut d'une bibliothèque en particulier : `color-scheme` est la
    // valeur que le moteur de rendu APPLIQUE, et `data-theme` la convention
    // du CSS nu. Autre marquage → le sonder soi-même (NF_BROWSER_PROBES).
    theme: getComputedStyle(root).colorScheme || (root.dataset.theme ?? "?"),
    lang: root.lang,
    title: document.title,
    // Les scripts RÉELLEMENT servis — c'est ce qui permet de vérifier que le
    // bundle observé est bien celui qu'on vient de bâtir.
    scripts: [...document.querySelectorAll("script[src]")].map((s) =>
      s.getAttribute("src"),
    ),
    probes: args.probes.map(({ label, sel }) => {
      const el = document.querySelector(sel);
      if (!el) return { label, absent: true, selector: sel };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const px = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const commun = {
        label,
        text: (el.textContent ?? "").trim().slice(0, 40),
        color: cs.color,
        font: `${cs.fontSize}${bold ? " gras" : ""}`,
        size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      };
      // `parseColor` REFUSE une notation qu'il ne sait pas lire, au lieu de
      // rendre du noir et un contraste plausible et faux. Certains moteurs
      // sérialisent `oklch()`, `lab()` ou `color-mix()` tels quels dans
      // `getComputedStyle` : la sonde le DIT alors pour cette sonde-là, et les
      // autres mesures de la page restent rendues. Laisser l'exception
      // remonter ferait perdre l'écran entier pour une seule couleur.
      try {
        const background = effectiveBackground(el);
        const contrast = contrastRatio(
          compose(cs.color, background),
          background,
        );
        return {
          ...commun,
          background,
          contrast,
          wcag: verdictWcag(contrast, px, bold),
        };
      } catch (e) {
        return {
          ...commun,
          contrast: null,
          wcag: "NON MESURÉ",
          unmeasured: e instanceof Error ? e.message : String(e),
        };
      }
    }),
    violationsCSP: window.__nfCsp ?? [],
  };
  if (args.families.includes("a11y")) base.a11y = probeA11y();
  if (args.families.includes("rendu")) base.rendu = probeRendering();
  if (args.families.includes("stockage")) base.stockageWeb = probeWebStorage();
  if (args.families.includes("perf")) base.perf = readPerf();
  return base;
}

// Composition : les sources des fonctions pures + les sondes + l'appel, en une
// expression unique. Passer par une chaîne évite `eval` DANS la page (que la
// CSP de l'application refuserait à bon droit) : c'est le pilote qui évalue.
const expression = `((args) => {
${sourceWcag()}
${describeElement}
${isVisible}
${effectiveBackground}
${probeA11y}
${probeRendering}
${probeWebStorage}
${readPerf}
return (${measurePage})(args);
})(${JSON.stringify({ probes: PROBES, families: [...active] })})`;

const measured = await page.evaluate(expression);

// ── Famille axe — l'audit d'accessibilité par un moteur dont c'est le métier ─
//
// Pourquoi une dépendance plutôt qu'un calcul maison : les règles WCAG sont
// pleines de cas particuliers qu'on ne devine pas — canaux en 0–1 des couleurs
// modernes, fonds semi-transparents à composer, texte peint par une police en
// couleurs, éléments masqués aux seules techniques d'assistance. Une sonde
// écrite à la main les rate, rend des échecs inventés qui NOIENT les vrais, et
// donne le pire des résultats : un rapport qu'on cesse de lire. `axe-core` est
// le moteur qu'embarque Lighthouse pour ce volet ; on l'appelle directement.
//
// Il est ÉVALUÉ par le pilote, jamais ajouté en `<script>` : la politique de
// sécurité de contenu d'une application sérieuse refuserait l'injection — et
// elle aurait raison.
if (active.has("axe")) {
  try {
    const axeCode = await axeSource();
    const report = await page.evaluate(async (source) => {
      // eslint-disable-next-line no-new-func -- évalué par le pilote, hors CSP
      new Function(source)();
      return await window.axe.run(document, {
        resultTypes: ["violations", "incomplete"],
        // La capture d'un nœud fautif suffit à le corriger ; l'inventaire
        // complet gonfle la sortie sans rien apprendre.
        elementRef: false,
      });
    }, axeCode);
    measured.axe = summarizeAxe(report);
  } catch (e) {
    // Dire l'indisponibilité, ne JAMAIS rendre un verdict OK sans avoir mesuré.
    measured.axe = {
      verdict: "INDISPONIBLE",
      reason: String(e).slice(0, 200),
      remedy:
        "Copier axe.min.js à côté des sondes (docker cp node_modules/axe-core/axe.min.js <conteneur>:/app/see-screen/axe.min.js), ou donner son chemin dans NF_BROWSER_AXE.",
    };
  }
}

// ── Arbre d'accessibilité — la voie Playwright, hors page ───────────────────
if (active.has("a11y") && measured.a11y) {
  try {
    // L'arbre ARIA tel que Playwright le calcule : ce que perçoit une
    // technologie d'assistance, rôles et noms compris. Tronqué : il dit la
    // STRUCTURE, pas l'inventaire.
    const yaml = await page.locator("body").ariaSnapshot();
    const lines = yaml.split("\n");
    measured.a11y.tree = {
      lines: lines.slice(0, 80),
      totalLines: lines.length,
      truncated: lines.length > 80,
    };
  } catch (e) {
    measured.a11y.tree = { unavailable: String(e).slice(0, 140) };
  }
}

// ── Famille réseau — bilan des collecteurs ──────────────────────────────────
if (active.has("reseau")) {
  const heavyThreshold = Number(process.env.NF_BROWSER_SEUIL_LOURD ?? 512000);
  const slowThreshold = Number(process.env.NF_BROWSER_SEUIL_LENT ?? 1000);
  const items = await Promise.all(
    finishedRequests.map(async (rq) => {
      let bytes = null;
      try {
        // `sizes()` rend la taille RÉELLEMENT transférée ; l'en-tête
        // content-length manque sur les réponses en flux.
        bytes = (await rq.sizes()).responseBodySize;
      } catch {
        const r = await rq.response().catch(() => null);
        const raw = r ? Number(r.headers()["content-length"]) : NaN;
        bytes = Number.isFinite(raw) ? raw : null;
      }
      const t = rq.timing();
      const ms =
        t && typeof t.responseEnd === "number" && t.responseEnd >= 0
          ? Math.round(t.responseEnd)
          : null;
      return { url: rq.url(), type: rq.resourceType(), bytes, ms };
    }),
  );
  const byType = {};
  let totalBytes = 0;
  let unknownBytes = 0;
  for (const i of items) {
    byType[i.type] = (byType[i.type] ?? 0) + 1;
    if (i.bytes != null && i.bytes >= 0) totalBytes += i.bytes;
    else unknownBytes += 1;
  }
  const compact = (i) => ({
    url: i.url.slice(0, 140),
    type: i.type,
    bytes: i.bytes,
    ms: i.ms,
  });
  const heavy = items
    .filter((i) => (i.bytes ?? 0) > heavyThreshold)
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
    .slice(0, 10)
    .map(compact);
  const slow = items
    .filter((i) => (i.ms ?? 0) > slowThreshold)
    .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
    .slice(0, 10)
    .map(compact);
  measured.reseau = {
    verdict: networkFailures.length > 0 || heavy.length > 0 ? "ALERTE" : "OK",
    total: items.length,
    byType,
    totalBytes,
    unknownBytes,
    failures: networkFailures,
    heavy: { bytesThreshold: heavyThreshold, resources: heavy },
    slow: { msThreshold: slowThreshold, resources: slow },
  };
}

// ── Famille stockage — volet cookies, lu hors page ──────────────────────────
if (active.has("stockage")) {
  const cookies = await ctx.cookies();
  const overHttps = page.url().startsWith("https");
  const insecure = cookies.filter((c) => !c.secure).length;
  measured.stockage = {
    // Un cookie sans Secure sur une origine https voyagera aussi en clair.
    verdict: overHttps && insecure > 0 ? "ALERTE" : "OK",
    cookies: cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expired:
        c.expires === -1 ? "session" : new Date(c.expires * 1000).toISOString(),
    })),
    ...measured.stockageWeb,
  };
  delete measured.stockageWeb;
}

// ── Capture — AVANT la famille responsive, qui déforme le viewport ──────────
const slug = PAGE.replace(/\//g, "-").replace(/^-/, "") || "racine";
const shot = path.join(OUTPUT, `${slug}-${stamp}.png`);
// `NF_BROWSER_FULLPAGE=1` : la page ENTIÈRE, pas la fenêtre. Un formulaire long
// (ou une page qu'on vient de déplier) a l'essentiel SOUS la ligne de flottaison
// — la capture par défaut laisse alors conclure « ce n'est pas là ».
await page.screenshot({
  path: shot,
  fullPage: process.env.NF_BROWSER_FULLPAGE === "1",
});

if (active.has("responsive")) {
  const { widths, invalidWidths: invalid } = parseWidths(
    process.env.NF_BROWSER_WIDTHS ?? "360,768,1280",
  );
  if (invalid.length > 0)
    console.error(
      `Largeur(s) ignorée(s) (entier entre 240 et 4000) : ${invalid.join(", ")}`,
    );
  const byWidth = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // Laisser les media queries et le reflow se produire — mesurer dans la
    // même frame que le resize rend l'ANCIENNE géométrie.
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      const overflowPx = Math.max(0, doc.scrollWidth - window.innerWidth);
      let overflowing = 0;
      const examples = [];
      if (overflowPx > 0) {
        for (const el of document.querySelectorAll("body *")) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.right > window.innerWidth + 1) {
            overflowing += 1;
            if (examples.length < 3) {
              const id = el.id ? `#${el.id}` : "";
              const cls =
                !id && el.classList.length ? `.${el.classList[0]}` : "";
              examples.push(`${el.tagName.toLowerCase()}${id}${cls}`);
            }
            if (overflowing >= 200) break;
          }
        }
      }
      return { overflowPx, overflowingElements: overflowing, examples };
    });
    byWidth.push({
      width,
      ...r,
      verdict: r.overflowPx > 0 ? "ALERTE" : "OK",
    });
  }
  measured.responsive = {
    verdict: verdictGlobal(byWidth.map((l) => l.verdict)),
    byWidth,
  };
}

// ── Sortie ──────────────────────────────────────────────────────────────────
const verdicts = [...active]
  .map((f) => measured[f]?.verdict)
  .filter((v) => typeof v === "string");
console.log(
  JSON.stringify(
    {
      url: page.url(),
      // Le navigateur qui a produit ces chiffres — un Chrome de système et le
      // Chromium du pilote n'ont pas la même version.
      browserName: decor.browserUsed,
      ...measured,
      consoleErrors,
      uncaughtErrors,
      // Le chemin RENDU est celui où l'appelant trouvera l'image. Dans un
      // conteneur, `/output` est un volume monté et ne veut rien dire au
      // dehors : on le retraduit en son point de montage habituel. En local,
      // le chemin est déjà le bon.
      capture:
        OUTPUT === "/output" ? shot.replace("/output", "tmp/browser") : shot,
      // Le verdict agrège les FAMILLES active — les erreurs de console et les
      // violations CSP restent des données : un parcours de connexion produit
      // des 401 légitimes, et trancher ici les ferait passer pour des pannes.
      ...(verdicts.length > 0 ? { verdict: verdictGlobal(verdicts) } : {}),
    },
    null,
    2,
  ),
);
await browser.close();
