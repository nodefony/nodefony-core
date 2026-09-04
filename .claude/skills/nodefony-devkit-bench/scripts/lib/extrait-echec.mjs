/**
 * L'EXTRAIT d'une sortie en échec — ce que le lecteur voit quand il n'aura PAS
 * le fichier.
 *
 * 🔴 Pourquoi ce fichier existe. Le banc écrit la sortie ENTIÈRE sur disque et
 * n'affiche que sa fin — bonne discipline, tant qu'on lit le journal sur la
 * machine qui a mesuré. En intégration continue cette machine est jetée : ce
 * qui reste au lecteur est l'extrait, et rien d'autre. Or « la fin » n'est pas
 * « la cause ». Vécu sur deux jobs rouges de la forge : la commande de
 * migration tombait en code 2 et l'extrait retenu était sa BARRE DE
 * PROGRESSION —
 *
 * ```
 * [⣷] 0  views fetching
 * [✓] 4  tables fetched
 * ```
 *
 * — pendant que le message qui NOMMAIT l'échec, émis plus haut, sortait de la
 * fenêtre. L'outil avait dit pourquoi ; le banc a montré autre chose.
 *
 * Deux gestes, indépendants :
 *
 * 1. **Nettoyer** — une barre de progression n'est pas du texte, c'est UNE
 *    ligne réécrite des dizaines de fois par des retours chariot et des codes
 *    ANSI. Dépliée telle quelle, elle consomme le budget entier sans porter une
 *    seule information. Résolue, elle tient en une ligne.
 * 2. **Trier** — à budget égal, une ligne qui NOMME l'échec vaut mieux que la
 *    dernière ligne écrite. Les lignes porteuses sont donc gardées en plus de
 *    la queue, et le nombre de lignes écartées est DIT : un extrait qui se
 *    présente comme une sortie complète ment.
 *
 * La fonction est PURE — un texte entre, un texte sort. C'est ce qui permet de
 * l'éprouver sur les sorties exactes qui ont produit le défaut, plutôt que
 * d'attendre qu'un job rouge veuille bien se reproduire.
 */

/** Séquences ANSI (couleurs, effacement de ligne, déplacement du curseur). */
const ANSI = /\u001B\[[0-9;?]*[A-Za-z]|\u001B[()#][0-9A-Za-z]/gu;

/** Caractères d'animation d'un spinner — braille, quarts de cercle, barres. */
const SPINNER = /[⠀-⣿◢-◥▖-▟|/\\-]+/gu;

/**
 * Ce qui fait qu'une ligne NOMME l'échec.
 *
 * Volontairement large côté anglais : les outils que le banc lance (npm, tsc,
 * drizzle-kit, oxlint, vitest, le moteur de base) parlent tous anglais, et un
 * motif trop étroit reproduirait exactement le défaut qu'on corrige — ne
 * montrer que ce à quoi on s'attendait. Le français y est parce que le PRODUIT
 * répond en français : c'est la sortie de `nodefony` qu'on lit le plus souvent.
 */
const PORTEUSE =
  /\b(error|errors|erreur|erreurs|failed|failing|failure|échec|echec|exception|cannot|refus\w*|invalid|unknown|missing|introuvable|denied|timeout|fatal|panic)\b|could not|^\s*(at\s|npm ERR!|Error:|[A-Za-z]*Error:)|[✗❌✖]|\b[A-Z]{2,}[A-Z0-9]*_[A-Z0-9_]+\b|\bE[A-Z]{4,}\b/u;

/**
 * Déplie une sortie de terminal en lignes LISIBLES.
 *
 * Un retour chariot ne coupe pas une ligne : il ramène le curseur en colonne
 * zéro, et ce qui suit ÉCRASE ce qui précède. Découper naïvement sur `\n`
 * conserve donc les dizaines d'états intermédiaires d'une même ligne — et c'est
 * précisément ce qui remplit la fenêtre d'extrait avec du vide.
 *
 * @param {string} brut - la sortie telle que l'enfant l'a écrite.
 * @returns {string[]} une ligne par ligne réellement affichée, sans code ANSI.
 */
export function lignesLisibles(brut) {
  const lignes = [];
  for (const bloc of String(brut ?? "").split("\n")) {
    // Le dernier segment d'une ligne réécrite est celui qui restait à l'écran.
    const segments = bloc.split("\r");
    const visible = segments[segments.length - 1] ?? "";
    lignes.push(visible.replace(ANSI, "").trimEnd());
  }
  // Les états successifs d'un même spinner ne diffèrent que par son caractère
  // d'animation et son compteur : réduits, ils se reconnaissent comme doublons.
  //
  // ⚠️ La réduction ne s'applique QU'aux lignes qui portent un caractère
  // d'animation. Écrite sans cette garde, elle fusionnait « étape 0 terminée »
  // et « étape 1 terminée » — deux faits distincts ramenés à un seul, ce qui
  // fabrique un extrait qui ment sur ce qu'il a vu.
  const sortie = [];
  let precedente = null;
  for (const l of lignes) {
    const anime = /[⠀-⣿◢-◥▖-▟]/u.test(l);
    const forme = anime
      ? l.replace(SPINNER, "").replace(/\d+/gu, "#").trim()
      : null;
    if (forme !== null && forme !== "" && forme === precedente) {
      sortie[sortie.length - 1] = l; // garder le DERNIER état, pas le premier
      continue;
    }
    precedente = forme;
    sortie.push(l);
  }
  return sortie;
}

/**
 * L'extrait à MONTRER pour une commande en échec.
 *
 * Contrat : **si la sortie contient une ligne qui nomme l'échec, l'extrait la
 * contient**. C'est l'affirmation que le défaut d'origine violait, et c'est
 * elle que le contrôle éprouve — sur les sorties réelles qui l'ont produite.
 *
 * @param {string} brut - la sortie entière de la commande.
 * @param {{budget?: number, queue?: number}} [opts] - budget total en
 *   caractères, et nombre de dernières lignes toujours candidates.
 * @returns {string} l'extrait, prêt à être affiché.
 */
export function extraitEchec(brut, opts = {}) {
  const budget = opts.budget ?? 1500;
  const queue = opts.queue ?? 12;
  // Les lignes vides consécutives ne portent rien et coûtent le budget.
  const lignes = lignesLisibles(brut).filter(
    (l, i, t) => l !== "" || (t[i - 1] ?? "") !== "",
  );
  while (lignes.length > 0 && lignes[lignes.length - 1] === "") lignes.pop();
  if (lignes.length === 0) return "";

  const complet = lignes.join("\n");
  if (complet.length <= budget) return complet;

  // La queue d'abord : elle porte le contexte immédiat de l'arrêt.
  const debutQueue = Math.max(0, lignes.length - queue);
  const gardees = new Set();
  let taille = 0;
  for (let i = lignes.length - 1; i >= debutQueue; i--) {
    if (taille + lignes[i].length + 1 > budget) break;
    gardees.add(i);
    taille += lignes[i].length + 1;
  }
  // Puis les lignes porteuses, des plus récentes aux plus anciennes : une cause
  // hors de la fenêtre est exactement le cas qui a coûté deux jobs rouges.
  for (let i = debutQueue - 1; i >= 0; i--) {
    if (!PORTEUSE.test(lignes[i])) continue;
    if (taille + lignes[i].length + 1 > budget) break;
    gardees.add(i);
    taille += lignes[i].length + 1;
  }

  const rendu = [];
  let saut = 0;
  for (let i = 0; i < lignes.length; i++) {
    if (!gardees.has(i)) {
      saut++;
      continue;
    }
    if (saut > 0) rendu.push(`  […] ${saut} ligne(s) écartée(s)`);
    saut = 0;
    rendu.push(lignes[i]);
  }
  if (saut > 0) rendu.push(`  […] ${saut} ligne(s) écartée(s)`);
  return rendu.join("\n");
}
