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
 * `@usage` docker exec <app>-browser node /app/see-screen/inspect.mjs /tableau-de-bord "Chiffre d'affaires"
 * `@env` NF_BROWSER_BASE origine vue DEPUIS le conteneur (défaut https://host.docker.internal:5152 — jamais localhost)
 * `@env` NF_BROWSER_PAGE chemin de la page à ouvrir (défaut /)
 * `@env` NF_BROWSER_EXPECT texte DISCRIMINANT attendu avant de mesurer (défaut : aucun, on mesure après domcontentloaded)
 * `@env` NF_BROWSER_FAMILIES familles de sondes à activer, séparées par des virgules (a11y, rendu, reseau, perf, stockage, responsive — ou « toutes ») ; défaut : aucune, le socle seul
 * `@env` NF_BROWSER_LOGIN chemin du formulaire de connexion de TON application — requis dès qu'un identifiant est donné, aucun défaut n'est deviné
 * `@env` NF_BROWSER_USER identifiant de connexion ; si absent, aucune authentification n'est tentée
 * `@env` NF_BROWSER_PASSWORD mot de passe associé
 * `@env` NF_BROWSER_PROBES sélecteurs CSS à sonder, séparés par des virgules (`libellé=sélecteur`)
 * `@env` NF_BROWSER_WIDTHS largeurs de la famille responsive (défaut 360,768,1280)
 * `@env` NF_BROWSER_SEUIL_LOURD octets au-delà desquels une ressource est « lourde » (défaut 512000)
 * `@env` NF_BROWSER_SEUIL_LENT millisecondes au-delà desquelles une réponse est « lente » (défaut 1000)
 * `@requires` conteneur du profil `browser` démarré · serveur joignable depuis le conteneur
 * `@output` un objet JSON sur stdout + une capture PNG horodatée dans /output
 * `@exit` 0 mesure rendue (le verdict est une DONNÉE, pas un code de retour) · 64 usage (famille inconnue, identifiant sans chemin de connexion) · 65 texte attendu jamais apparu
 */
import { open, goTo, LOGIN } from "./lib/browser.mjs";
import { sourceWcag } from "./lib/wcag.mjs";
import {
  FAMILLES,
  parseFamilies,
  parseProbes,
  parseWidths,
  verdictGlobal,
} from "./lib/probes.mjs";

const PAGE = process.argv[2] ?? process.env.NF_BROWSER_PAGE ?? "/";
const EXPECT = process.argv[3] ?? process.env.NF_BROWSER_EXPECT ?? "";

const { retenues, inconnues } = parseFamilies(process.env.NF_BROWSER_FAMILIES);
if (inconnues.length > 0) {
  // Refuser, jamais ignorer : une famille fautée en silence ferait croire
  // qu'on a mesuré ce qu'on n'a pas mesuré.
  console.error(
    `Famille(s) de sondes inconnue(s) : ${inconnues.join(", ")}\n` +
      `Familles disponibles (ou « toutes ») :\n` +
      Object.entries(FAMILLES)
        .map(([nom, description]) => `  ${nom} — ${description}`)
        .join("\n"),
  );
  process.exit(64); // EX_USAGE
}
const actives = new Set(retenues);

/**
 * Sondes de style par défaut — surchargées par NF_BROWSER_PROBES.
 *
 * Ici, et SEULEMENT ici, les sélecteurs CSS sont le bon outil, alors que
 * Playwright les déconseille : la recommandation vise les tests, où l'on veut
 * atteindre ce que l'UTILISATEUR perçoit (rôle, libellé). Une sonde de style
 * fait l'inverse — elle mesure une IMPLÉMENTATION et doit viser la classe.
 * Le défaut vise des éléments que TOUTE page possède.
 */
const { sondes: PROBES, rejetees } = parseProbes(
  process.env.NF_BROWSER_PROBES ?? "titre principal=h1,corps de page=body",
);
if (rejetees.length > 0) {
  console.error(
    `Sonde(s) ignorée(s), forme attendue « libellé=sélecteur » : ${rejetees.join(" · ")}`,
  );
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const { browser, ctx, page, reuse } = await open();

// ── Collecteurs — posés AVANT toute navigation ──────────────────────────────
const erreursConsole = [];
const erreursNonCapturees = [];
page.on("console", (m) => {
  if (m.type() === "error" && erreursConsole.length < 30)
    erreursConsole.push(m.text().slice(0, 300));
});
// `pageerror` et non seulement `console` : une exception non capturée qui tue
// l'application ne passe pas toujours par console.error.
page.on("pageerror", (e) => {
  if (erreursNonCapturees.length < 20)
    erreursNonCapturees.push(String(e).slice(0, 300));
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
        bloque: String(e.blockedURI ?? "").slice(0, 140),
        source: String(e.sourceFile ?? "").slice(0, 140),
        ligne: e.lineNumber,
      });
  });
});

if (actives.has("perf")) {
  // LCP et CLS n'existent qu'en OBSERVANT pendant le chargement : les lire
  // après coup rend null. `buffered: true` rattrape ce qui s'est produit entre
  // l'injection et l'observation ; le try par type, car un navigateur qui
  // ignore un type d'entrée lève — et tuerait les deux autres mesures.
  await page.addInitScript(() => {
    window.__nfPerf = { lcpMs: null, cls: 0, tachesLongues: 0 };
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
        window.__nfPerf.tachesLongues += l.getEntries().length;
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });
}

const requetesFinies = [];
const echecsReseau = [];
if (actives.has("reseau")) {
  page.on("requestfinished", (rq) => {
    if (requetesFinies.length < 300) requetesFinies.push(rq);
  });
  page.on("requestfailed", (rq) => {
    if (echecsReseau.length < 40)
      echecsReseau.push({
        url: rq.url().slice(0, 140),
        type: rq.resourceType(),
        erreur: rq.failure()?.errorText ?? "?",
      });
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && echecsReseau.length < 40)
      echecsReseau.push({
        url: r.url().slice(0, 140),
        type: r.request().resourceType(),
        statut: r.status(),
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

// ── Les fonctions qui voyagent vers la page ─────────────────────────────────
// Elles sont AUTOSUFFISANTES (aucune fermeture sur ce module) : la sonde les
// injecte par leur code source dans une expression unique. C'est ce qui permet
// aux calculs WCAG d'avoir UNE seule implémentation, importée par les tests et
// exécutée par le navigateur.

/**
 * Décrit un élément en une ligne courte — pour des exemples lisibles, jamais
 * un dump de DOM.
 */
function decrireElement(el) {
  const t = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = !id && el.classList.length ? `.${el.classList[0]}` : "";
  const texte = (el.textContent ?? "").trim().slice(0, 30);
  return `${t}${id}${cls}${texte ? ` « ${texte} »` : ""}`.slice(0, 90);
}

/** Un élément participe-t-il au rendu — filtre commun des sondes. */
function estVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

/**
 * Famille a11y — ce qu'un lecteur d'écran ou un clavier rencontrent VRAIMENT.
 * Chaque règle rend un compte et 3 exemples, jamais la liste entière.
 */
function sondeA11y() {
  const bloc = (liste) => ({
    total: liste.length,
    exemples: liste.slice(0, 3).map(decrireElement),
  });
  // Nom accessible SIMPLIFIÉ (aria-label → aria-labelledby → texte → title →
  // alt d'une image fille). L'algorithme complet de la norme fait plus ; le
  // simplifié suffit à attraper un bouton-icône muet — le cas réel.
  const nomAccessible = (el) => {
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
    const texte = (el.textContent ?? "").trim();
    if (texte) return texte;
    if (el.getAttribute("title")) return el.getAttribute("title");
    const img = el.querySelector("img[alt]");
    if (img && img.getAttribute("alt")?.trim())
      return img.getAttribute("alt").trim();
    return "";
  };
  const sansAlt = [...document.querySelectorAll("img")]
    .filter(estVisible)
    .filter((i) => !i.hasAttribute("alt"));
  const sansEtiquette = [
    ...document.querySelectorAll("input:not([type=hidden]), select, textarea"),
  ]
    .filter(estVisible)
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
  const sansNom = [
    ...document.querySelectorAll("button, a[href], [role=button]"),
  ]
    .filter(estVisible)
    .filter((c) => !nomAccessible(c));
  // Hiérarchie des titres : les niveaux dans l'ordre du document, et les sauts
  // (h2→h4) qui cassent la table des matières d'un lecteur d'écran.
  const titres = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
    .filter(estVisible)
    .map((h) => Number(h.tagName[1]));
  const sauts = [];
  for (let i = 1; i < titres.length; i++)
    if (titres[i] > titres[i - 1] + 1)
      sauts.push(`h${titres[i - 1]}→h${titres[i]}`);
  const h1 = titres.filter((n) => n === 1).length;
  // Cibles < 24×24 (WCAG 2.5.8). Les liens DANS le texte (display inline) sont
  // exemptés par le critère lui-même — les compter noierait le signal.
  const interactifs = [
    ...document.querySelectorAll(
      "button, a[href], input:not([type=hidden]), select, textarea, [role=button]",
    ),
  ].filter(estVisible);
  const petites = [];
  for (const el of interactifs) {
    if (el.tagName === "A" && getComputedStyle(el).display === "inline")
      continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24)
      petites.push({
        element: decrireElement(el),
        taille: `${Math.round(r.width)}×${Math.round(r.height)}`,
      });
    if (petites.length >= 40) break;
  }
  // Un tabindex POSITIF impose un ordre de focus manuel qui diverge du DOM —
  // l'anti-pattern classique d'un parcours clavier incompréhensible.
  const tabPositifs = [...document.querySelectorAll("[tabindex]")].filter(
    (el) => Number(el.getAttribute("tabindex")) > 0,
  );
  const langue = document.documentElement.lang || null;
  const alertes =
    sansAlt.length +
    sansEtiquette.length +
    sansNom.length +
    petites.length +
    tabPositifs.length +
    sauts.length +
    (h1 === 1 ? 0 : 1) +
    (langue ? 0 : 1);
  return {
    verdict: alertes === 0 ? "OK" : "ALERTE",
    langue,
    titres: { h1, ordre: titres.join(","), sauts },
    imagesSansAlternative: bloc(sansAlt),
    champsSansEtiquette: bloc(sansEtiquette),
    controlesSansNom: bloc(sansNom),
    ciblesTropPetites: {
      total: petites.length,
      seuil: "24×24",
      exemples: petites.slice(0, 3),
    },
    tabindexPositifs: bloc(tabPositifs),
    focusablesVisibles: interactifs.length,
  };
}

/**
 * Famille rendu — la page tient-elle dans son viewport, ses polices sont-elles
 * VRAIMENT arrivées. Les éléments hors viewport sont une INFO, pas le verdict :
 * carrousels et textes pour lecteurs d'écran en produisent légitimement.
 */
function sondeRendu() {
  const doc = document.scrollingElement ?? document.documentElement;
  const depassementPx = Math.max(0, doc.scrollWidth - window.innerWidth);
  const horsViewport = [];
  let totalHors = 0;
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 1) {
      totalHors += 1;
      if (horsViewport.length < 3) horsViewport.push(decrireElement(el));
      if (totalHors >= 200) break;
    }
  }
  const familles = {};
  let policesEnEchec = 0;
  for (const f of document.fonts) {
    familles[`${f.family} ${f.weight}`] = f.status;
    if (f.status === "error") policesEnEchec += 1;
  }
  return {
    verdict: depassementPx > 0 || policesEnEchec > 0 ? "ALERTE" : "OK",
    debordementHorizontal: { present: depassementPx > 0, depassementPx },
    elementsHorsViewport: { total: totalHors, exemples: horsViewport },
    polices: {
      statut: document.fonts.status,
      enEchec: policesEnEchec,
      familles,
    },
  };
}

/** Famille stockage, volet page — tailles et clés, JAMAIS les valeurs. */
function sondeStockageWeb() {
  // Les valeurs ne sortent pas : un jeton de session imprimé dans un JSON de
  // sonde finit dans un terminal, un log de CI, un rapport — il a fuité.
  const inventaire = (magasin) => {
    const cles = [];
    let octets = 0;
    for (let i = 0; i < magasin.length; i++) {
      const cle = magasin.key(i);
      // ×2 : les chaînes JavaScript comptent en unités UTF-16.
      const taille = (magasin.getItem(cle) ?? "").length * 2;
      octets += taille;
      cles.push({ cle, octets: taille });
    }
    cles.sort((a, b) => b.octets - a.octets);
    return { cles: cles.length, octets, plusGrosses: cles.slice(0, 5) };
  };
  return {
    localStorage: inventaire(window.localStorage),
    sessionStorage: inventaire(window.sessionStorage),
  };
}

/** Famille perf — lit ce que les observateurs injectés AVANT navigation ont vu. */
function lirePerf() {
  const arrondi = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v));
  const nav = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  const p = window.__nfPerf ?? {};
  const lcpMs = arrondi(p.lcpMs);
  const cls =
    typeof p.cls === "number" ? Math.round(p.cls * 1000) / 1000 : null;
  return {
    // Seuils « bons » de l'initiative Web Vitals — au-delà, l'utilisateur
    // attend ou voit la page bouger sous son doigt.
    verdict:
      (lcpMs != null && lcpMs > 2500) || (cls != null && cls > 0.1)
        ? "ALERTE"
        : "OK",
    ttfbMs: nav ? arrondi(nav.responseStart) : null,
    domContentLoadedMs: nav ? arrondi(nav.domContentLoadedEventEnd) : null,
    chargeCompleteMs: nav ? arrondi(nav.loadEventEnd) : null,
    fcpMs: fcp ? arrondi(fcp.startTime) : null,
    lcpMs,
    cls,
    tachesLongues: typeof p.tachesLongues === "number" ? p.tachesLongues : null,
    seuils: { lcpBonMs: 2500, clsBon: 0.1 },
  };
}

/**
 * La mesure principale, composée puis évaluée en UNE expression dans la page.
 * Async : les polices se constatent après `document.fonts.ready` (borné — une
 * police qui ne finit jamais ne doit pas suspendre la sonde).
 */
async function mesurePage(args) {
  const root = document.documentElement;
  if (args.familles.includes("rendu")) {
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
    titre: document.title,
    // Les scripts RÉELLEMENT servis — c'est ce qui permet de vérifier que le
    // bundle observé est bien celui qu'on vient de bâtir.
    scripts: [...document.querySelectorAll("script[src]")].map((s) =>
      s.getAttribute("src"),
    ),
    sondes: args.probes.map(({ label, sel }) => {
      const el = document.querySelector(sel);
      if (!el) return { label, absent: true, selecteur: sel };
      const cs = getComputedStyle(el);
      // Le fond effectif est celui du premier ancêtre non transparent : lire
      // `backgroundColor` sur l'élément rend `rgba(0,0,0,0)` et un contraste
      // faux — l'erreur classique de ce genre de sonde.
      let fond = getComputedStyle(document.body).backgroundColor;
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
          fond = bg;
          break;
        }
      }
      const r = el.getBoundingClientRect();
      const contraste = contrastRatio(cs.color, fond);
      const px = parseFloat(cs.fontSize);
      const gras = Number(cs.fontWeight) >= 700;
      return {
        label,
        texte: (el.textContent ?? "").trim().slice(0, 40),
        couleur: cs.color,
        fond,
        contraste,
        police: `${cs.fontSize}${gras ? " gras" : ""}`,
        wcag: verdictWcag(contraste, px, gras),
        taille: `${Math.round(r.width)}×${Math.round(r.height)}`,
      };
    }),
    violationsCSP: window.__nfCsp ?? [],
  };
  if (args.familles.includes("a11y")) base.a11y = sondeA11y();
  if (args.familles.includes("rendu")) base.rendu = sondeRendu();
  if (args.familles.includes("stockage")) base.stockageWeb = sondeStockageWeb();
  if (args.familles.includes("perf")) base.perf = lirePerf();
  return base;
}

// Composition : les sources des fonctions pures + les sondes + l'appel, en une
// expression unique. Passer par une chaîne évite `eval` DANS la page (que la
// CSP de l'application refuserait à bon droit) : c'est le pilote qui évalue.
const expression = `((args) => {
${sourceWcag()}
${decrireElement}
${estVisible}
${sondeA11y}
${sondeRendu}
${sondeStockageWeb}
${lirePerf}
return (${mesurePage})(args);
})(${JSON.stringify({ probes: PROBES, familles: [...actives] })})`;

const measured = await page.evaluate(expression);

// ── Arbre d'accessibilité — la voie Playwright, hors page ───────────────────
if (actives.has("a11y") && measured.a11y) {
  try {
    // L'arbre ARIA tel que Playwright le calcule : ce que perçoit une
    // technologie d'assistance, rôles et noms compris. Tronqué : il dit la
    // STRUCTURE, pas l'inventaire.
    const yaml = await page.locator("body").ariaSnapshot();
    const lignes = yaml.split("\n");
    measured.a11y.arbre = {
      lignes: lignes.slice(0, 80),
      totalLignes: lignes.length,
      tronque: lignes.length > 80,
    };
  } catch (e) {
    measured.a11y.arbre = { indisponible: String(e).slice(0, 140) };
  }
}

// ── Famille réseau — bilan des collecteurs ──────────────────────────────────
if (actives.has("reseau")) {
  const seuilLourd = Number(process.env.NF_BROWSER_SEUIL_LOURD ?? 512000);
  const seuilLent = Number(process.env.NF_BROWSER_SEUIL_LENT ?? 1000);
  const items = await Promise.all(
    requetesFinies.map(async (rq) => {
      let octets = null;
      try {
        // `sizes()` rend la taille RÉELLEMENT transférée ; l'en-tête
        // content-length manque sur les réponses en flux.
        octets = (await rq.sizes()).responseBodySize;
      } catch {
        const r = await rq.response().catch(() => null);
        const brut = r ? Number(r.headers()["content-length"]) : NaN;
        octets = Number.isFinite(brut) ? brut : null;
      }
      const t = rq.timing();
      const ms =
        t && typeof t.responseEnd === "number" && t.responseEnd >= 0
          ? Math.round(t.responseEnd)
          : null;
      return { url: rq.url(), type: rq.resourceType(), octets, ms };
    }),
  );
  const parType = {};
  let totalOctets = 0;
  let octetsInconnus = 0;
  for (const i of items) {
    parType[i.type] = (parType[i.type] ?? 0) + 1;
    if (i.octets != null && i.octets >= 0) totalOctets += i.octets;
    else octetsInconnus += 1;
  }
  const compacte = (i) => ({
    url: i.url.slice(0, 140),
    type: i.type,
    octets: i.octets,
    ms: i.ms,
  });
  const lourdes = items
    .filter((i) => (i.octets ?? 0) > seuilLourd)
    .sort((a, b) => (b.octets ?? 0) - (a.octets ?? 0))
    .slice(0, 10)
    .map(compacte);
  const lentes = items
    .filter((i) => (i.ms ?? 0) > seuilLent)
    .sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
    .slice(0, 10)
    .map(compacte);
  measured.reseau = {
    verdict: echecsReseau.length > 0 || lourdes.length > 0 ? "ALERTE" : "OK",
    total: items.length,
    parType,
    totalOctets,
    octetsInconnus,
    echecs: echecsReseau,
    lourdes: { seuilOctets: seuilLourd, ressources: lourdes },
    lentes: { seuilMs: seuilLent, ressources: lentes },
  };
}

// ── Famille stockage — volet cookies, lu hors page ──────────────────────────
if (actives.has("stockage")) {
  const cookies = await ctx.cookies();
  const surHttps = page.url().startsWith("https");
  const nonSecurises = cookies.filter((c) => !c.secure).length;
  measured.stockage = {
    // Un cookie sans Secure sur une origine https voyagera aussi en clair.
    verdict: surHttps && nonSecurises > 0 ? "ALERTE" : "OK",
    cookies: cookies.map((c) => ({
      nom: c.name,
      domaine: c.domain,
      chemin: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expire:
        c.expires === -1 ? "session" : new Date(c.expires * 1000).toISOString(),
    })),
    ...measured.stockageWeb,
  };
  delete measured.stockageWeb;
}

// ── Capture — AVANT la famille responsive, qui déforme le viewport ──────────
const slug = PAGE.replace(/\//g, "-").replace(/^-/, "") || "racine";
const shot = `/output/${slug}-${stamp}.png`;
await page.screenshot({ path: shot });

if (actives.has("responsive")) {
  const { largeurs, invalides } = parseWidths(
    process.env.NF_BROWSER_WIDTHS ?? "360,768,1280",
  );
  if (invalides.length > 0)
    console.error(
      `Largeur(s) ignorée(s) (entier entre 240 et 4000) : ${invalides.join(", ")}`,
    );
  const parLargeur = [];
  for (const largeur of largeurs) {
    await page.setViewportSize({ width: largeur, height: 900 });
    // Laisser les media queries et le reflow se produire — mesurer dans la
    // même frame que le resize rend l'ANCIENNE géométrie.
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      const depassementPx = Math.max(0, doc.scrollWidth - window.innerWidth);
      let debordants = 0;
      const exemples = [];
      if (depassementPx > 0) {
        for (const el of document.querySelectorAll("body *")) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.right > window.innerWidth + 1) {
            debordants += 1;
            if (exemples.length < 3) {
              const id = el.id ? `#${el.id}` : "";
              const cls =
                !id && el.classList.length ? `.${el.classList[0]}` : "";
              exemples.push(`${el.tagName.toLowerCase()}${id}${cls}`);
            }
            if (debordants >= 200) break;
          }
        }
      }
      return { depassementPx, elementsDebordants: debordants, exemples };
    });
    parLargeur.push({
      largeur,
      ...r,
      verdict: r.depassementPx > 0 ? "ALERTE" : "OK",
    });
  }
  measured.responsive = {
    verdict: verdictGlobal(parLargeur.map((l) => l.verdict)),
    parLargeur,
  };
}

// ── Sortie ──────────────────────────────────────────────────────────────────
const verdicts = [...actives]
  .map((f) => measured[f]?.verdict)
  .filter((v) => typeof v === "string");
console.log(
  JSON.stringify(
    {
      url: page.url(),
      ...measured,
      erreursConsole,
      erreursNonCapturees,
      capture: shot.replace("/output", "tmp/browser"),
      // Le verdict agrège les FAMILLES actives — les erreurs de console et les
      // violations CSP restent des données : un parcours de connexion produit
      // des 401 légitimes, et trancher ici les ferait passer pour des pannes.
      ...(verdicts.length > 0 ? { verdict: verdictGlobal(verdicts) } : {}),
    },
    null,
    2,
  ),
);
await browser.close();
