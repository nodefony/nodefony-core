import { USER, signInElsewhere } from "./browser.mjs";

/**
 * Attend que le défilement se pose : la position de la fenêtre ne bouge plus
 * pendant trois images (une molette peut défiler en douceur). Borné à une
 * seconde environ — jamais une attente aveugle.
 *
 * @param {import("playwright").Page} page - la page pilotée.
 */
async function settleScroll(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = window.scrollY;
        let still = 0;
        let frames = 0;
        const tick = () => {
          frames += 1;
          still = window.scrollY === last ? still + 1 : 0;
          last = window.scrollY;
          if (still >= 3 || frames >= 60) resolve(undefined);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/**
 * Joue une séquence d'interactions (`NF_BROWSER_ACTIONS`, analysée par
 * `parseActions`) sur une page — la seule implémentation, partagée par
 * `inspect.mjs` (agir PUIS photographier) et `watch.mjs` (agir PENDANT qu'on
 * observe le trafic).
 *
 * Une action qui ne trouve pas sa cible ARRÊTE la séquence : une mesure faite
 * sur un écran qu'on n'a pas ouvert est pire qu'aucune mesure.
 *
 * @param {import("playwright").Page} page - la page pilotée.
 * @param {{ verb: string, target: string, value?: string }[]} actions - la séquence.
 * @returns {Promise<{ code: number, message: string } | null>} `null` si tout a
 *   été joué ; sinon le code de sortie à rendre (64 usage, 65 cible
 *   introuvable) et le message qui nomme l'action.
 */
export async function playActions(page, actions) {
  for (const { verb, target, value } of actions) {
    if (verb === "connecter") {
      if (!USER) {
        return {
          code: 64, // EX_USAGE
          message:
            "connecter: exige NF_BROWSER_USER, NF_BROWSER_PASSWORD et NF_BROWSER_LOGIN",
        };
      }
      await signInElsewhere(page.context());
      continue;
    }
    if (verb === "defiler" || verb === "molette") {
      const pixels = Number.parseInt(target, 10);
      if (!Number.isFinite(pixels)) {
        return {
          code: 64, // EX_USAGE
          message: `${verb} attend un nombre de pixels, reçu « ${target} »`,
        };
      }
      if (verb === "molette") {
        // Une VRAIE molette, là où est le pointeur (`survol:` avant) : c'est
        // le navigateur qui choisit quoi faire défiler, et qui passe à la page
        // quand le conteneur est en bout — ce que `defiler`, qui appelle
        // `scrollBy` sur un élément choisi, ne peut pas montrer.
        await page.mouse.wheel(0, pixels);
        await settleScroll(page);
        continue;
      }
      // Le conteneur qui défile RÉELLEMENT, pas la fenêtre : sur une console à
      // barre latérale fixe, `window.scrollBy` ne bouge rien du tout.
      await page.evaluate((dy) => {
        const scrollable = [...document.querySelectorAll("*")].find(
          (el) =>
            el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200,
        );
        (scrollable ?? window).scrollBy(0, dy);
      }, pixels);
      continue;
    }
    // Une touche sans cible part à l'élément qui a le focus (onglets,
    // listes, menus : c'est lui que le clavier pilote).
    if (verb === "touche" && target === "") {
      await page.keyboard.press(value || "Enter");
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
    // Aucun candidat visible À CET INSTANT ne dit pas que la cible est un
    // sélecteur : juste après un clic qui navigue, la page suivante n'est pas
    // encore rendue. On attend donc le texte OU le sélecteur — et le texte seul
    // quand la cible n'est pas du CSS valide. Trancher sur l'instant faisait
    // chercher une balise `<FreeOTP>` une fois sur trois.
    if (locator === null) {
      // Une navigation en vol détruirait le contexte de l'évaluation ci-dessous.
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      const isCss = await page
        .evaluate((s) => {
          try {
            document.querySelector(s);
            return true;
          } catch {
            return false;
          }
        }, target)
        .catch(() => false);
      locator = isCss
        ? candidates.or(page.locator(target)).first()
        : candidates.first();
    }
    try {
      await locator.waitFor({ timeout: 15000 });
      if (verb === "clic") await locator.click();
      else if (verb === "double") await locator.dblclick();
      else if (verb === "droit") await locator.click({ button: "right" });
      else if (verb === "survol") await locator.hover();
      else if (verb === "saisir") await locator.fill(value);
      // `choisir` : la cible peut être le `<label>` qui ENVELOPPE la liste —
      // Playwright reporte alors le choix sur son contrôle. La valeur est celle
      // de l'option (`value`), sinon son libellé.
      else if (verb === "choisir") {
        const chosen = await locator.selectOption(value);
        if (chosen.length === 0) throw new Error(`option « ${value} » absente`);
      } else if (verb === "touche") await locator.press(value || "Enter");
      else if (verb === "voir") await locator.scrollIntoViewIfNeeded();
      // `attendre` : le `waitFor` ci-dessus EST l'action.
    } catch {
      return {
        code: 65, // EX_DATAERR
        message:
          `Action « ${verb}:${target} » impossible\n` +
          `Page réellement ouverte : ${page.url()}\n` +
          "→ le libellé a changé, l'élément n'est pas encore rendu, ou il faut " +
          "agir sur autre chose avant lui (NF_BROWSER_ACTIONS accepte une séquence, séparée par « | »).",
      };
    }
  }
  return null;
}
