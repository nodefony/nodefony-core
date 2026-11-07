/**
 * Gravité d'un défaut — lue, validée et calculée selon une NORME, jamais estimée
 * à l'impression.
 *
 * Deux normes, deux rôles, sans recouvrement :
 *
 * - la CLASSE, pour TOUT défaut : l'échelle de gravité de l'**IEEE 1044**
 *   (Blocking, Critical, Major, Minor, Inconsequential) — ce que le défaut
 *   casse. Elle vit dans la colonne « Gravité » du tableau de bord, qui en est
 *   la SOURCE ; le corps du ticket en porte le motif ;
 * - le SCORE, pour une FAILLE en plus (un tiers atteint la confidentialité,
 *   l'intégrité ou la disponibilité) : le vecteur **CVSS 3.1** (FIRST), dont le
 *   score se CALCULE ici — un score recopié à la main est l'erreur la plus
 *   facile à faire, et la plus crue. Il vit au corps, ligne `**CVSS** : …`.
 *
 * La gravité n'est PAS la priorité : elle dit l'impact, la colonne `Priorité`
 * dit le moment. La gravité fixe un plancher à la priorité (`severityFloor`).
 *
 * Partagé par `ticket-open.mjs`, `ticket-severity.mjs` et `board-lint.mjs` :
 * une règle, une implémentation. Rien ne s'exécute à l'import.
 */

/** Classes de l'IEEE 1044, et ce que chacune recouvre dans ce dépôt. */
export const SEVERITY_SCALE = {
  Blocking:
    "l'usage est arrêté tant qu'il n'y a ni correctif ni contournement — processus arrêté, démarrage impossible",
  Critical:
    "des opérations essentielles sont interrompues sans recours — données perdues ou corrompues",
  Major:
    "des opérations essentielles sont touchées mais peuvent continuer — un contournement existe",
  Minor: "des opérations non essentielles sont perturbées",
  Inconsequential:
    "aucun effet notable sur le fonctionnement — texte, message, documentation",
};

/** Plancher de priorité de chaque classe — on peut monter, jamais descendre. */
const SCALE_FLOOR = {
  Blocking: "P0",
  Critical: "P0",
  Major: "P1",
  Minor: "P3",
  Inconsequential: "P3",
};
const SCALE_RE = new RegExp(
  `^(${Object.keys(SEVERITY_SCALE).join("|")})\\b\\s*[—–-]?\\s*(.*)$`,
  "u",
);

/** Poids des métriques de base CVSS 3.1 (spécification FIRST, §7.4). */
const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  PR: { U: { N: 0.85, L: 0.62, H: 0.27 }, C: { N: 0.85, L: 0.68, H: 0.5 } },
  UI: { N: 0.85, R: 0.62 },
  S: { U: "U", C: "C" },
  CIA: { H: 0.56, L: 0.22, N: 0 },
};
const BASE = ["AV", "AC", "PR", "UI", "S", "C", "I", "A"];

/** Arrondi supérieur à une décimale de CVSS 3.1 (annexe A, sans flottant sale). */
function roundUp(value) {
  const int = Math.round(value * 100000);
  return int % 10000 === 0 ? int / 100000 : (Math.floor(int / 10000) + 1) / 10;
}

/**
 * Libellé qualitatif d'un score CVSS 3.1 (§5).
 *
 * @param score - score de base, 0 à 10
 * @returns None, Low, Medium, High ou Critical
 */
export function cvssRating(score) {
  if (score === 0) return "None";
  if (score < 4) return "Low";
  if (score < 7) return "Medium";
  if (score < 9) return "High";
  return "Critical";
}

/**
 * Calcule le score de base d'un vecteur CVSS 3.1.
 *
 * @param vector - `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`
 * @returns `{ score, rating }`, ou `null` si le vecteur n'est pas un vecteur 3.1
 *   complet et valide (métrique manquante, doublée ou hors valeurs)
 */
export function cvss31Score(vector) {
  const parts = String(vector).trim().split("/");
  if (parts.shift() !== "CVSS:3.1") return null;
  const m = {};
  for (const part of parts) {
    const [key, value] = part.split(":");
    if (!BASE.includes(key) || key in m) return null;
    m[key] = value;
  }
  if (BASE.some((k) => !(k in m))) return null;
  const scope = W.S[m.S];
  const av = W.AV[m.AV];
  const ac = W.AC[m.AC];
  const pr = scope ? W.PR[scope][m.PR] : undefined;
  const ui = W.UI[m.UI];
  const [c, i, a] = [W.CIA[m.C], W.CIA[m.I], W.CIA[m.A]];
  if ([av, ac, pr, ui, c, i, a].some((x) => x === undefined)) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact =
    scope === "U"
      ? 6.42 * iss
      : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15;
  const exploitability = 8.22 * av * ac * pr * ui;
  let score = 0;
  if (impact > 0) {
    score =
      scope === "U"
        ? roundUp(Math.min(impact + exploitability, 10))
        : roundUp(Math.min(1.08 * (impact + exploitability), 10));
  }
  return { score, rating: cvssRating(score) };
}

/**
 * Valide une gravité telle qu'on la donne : une classe de l'IEEE 1044 suivie de
 * son motif.
 *
 * @param text - `Major — l'export échoue au-delà de 1 000 lignes`
 * @returns `{ ok: true, cls, motif, line }` — `line` est la ligne du corps — ou
 *   `{ ok: false, reason }`
 */
export function checkSeverity(text) {
  const value = String(text ?? "").trim();
  const scale = value.match(SCALE_RE);
  if (!scale) {
    return {
      ok: false,
      reason: `gravité illisible — « <classe> — motif », classe parmi ${Object.keys(SEVERITY_SCALE).join(", ")} (IEEE 1044)`,
    };
  }
  const motif = scale[2].trim();
  if (motif === "") {
    return {
      ok: false,
      reason: `« ${scale[1]} » sans motif — dire CE QUI casse (« ${scale[1]} — … »), la classe seule ne s'instruit pas`,
    };
  }
  return {
    ok: true,
    cls: scale[1],
    motif,
    line: `**Gravité** : ${scale[1]} — ${motif}`,
  };
}

/**
 * Valide un vecteur CVSS 3.1 et rend la ligne du corps, score CALCULÉ.
 *
 * @param vector - `CVSS:3.1/…`
 * @returns `{ ok: true, score, rating, line }` ou `{ ok: false, reason }`
 */
export function checkCvss(vector) {
  const value = String(vector ?? "")
    .trim()
    .split(/\s/u)[0];
  const result = cvss31Score(value);
  if (result === null) {
    return {
      ok: false,
      reason: `vecteur CVSS invalide « ${value} » — attendu CVSS:3.1/AV:_/AC:_/PR:_/UI:_/S:_/C:_/I:_/A:_ (les 8 métriques de base)`,
    };
  }
  return {
    ok: true,
    score: result.score,
    rating: result.rating,
    line: `**CVSS** : ${value} — ${String(result.score).replace(".", ",")} (${result.rating})`,
  };
}

/**
 * Lit la gravité déclarée dans le corps d'un ticket.
 *
 * Deux écritures : la ligne `**Gravité** : …` que posent les scripts, et la
 * section `### Gravité` que GitHub rend pour le champ du formulaire de défaut
 * (`.github/ISSUE_TEMPLATE/defaut.yml`).
 *
 * @param body - corps brut de l'issue
 * @returns la gravité déclarée, ou `null` si le corps n'en porte pas
 */
export function parseSeverity(body) {
  const text = String(body ?? "");
  const line = text.match(/^\s*\*{0,2}Gravit[ée]\*{0,2}\s*:\s*(.+)$/imu);
  if (line) return line[1].trim();
  const section = text.match(/^#{2,4}\s*Gravit[ée]\s*\n+\s*(\S.*)$/imu);
  return section ? section[1].trim() : null;
}

/**
 * Lit le vecteur CVSS déclaré au corps (ligne `**CVSS** : …`).
 *
 * @param body - corps brut de l'issue
 * @returns le vecteur, ou `null`
 */
export function parseCvss(body) {
  const match = String(body ?? "").match(
    /^\s*\*{0,2}CVSS\*{0,2}\s*:\s*(CVSS:\S+)/imu,
  );
  return match ? match[1] : null;
}

/**
 * Les options du champ « Gravité » du formulaire GitHub, dérivées de l'échelle :
 * le formulaire est une COPIE imposée par la frontière (GitHub ne lit pas ce
 * module), et `github-templates.test.mjs` compare les deux.
 *
 * @returns `Blocking — …` … `Inconsequential — …`
 */
export function severityFormOptions() {
  return Object.entries(SEVERITY_SCALE).map(([k, v]) => `${k} — ${v}`);
}

/**
 * Priorité PLANCHER qu'imposent la classe et, pour une faille, le score CVSS —
 * le plus exigeant des deux. On peut monter au-dessus, jamais descendre.
 *
 * @param cls - classe IEEE 1044 (colonne « Gravité »), ou `null`
 * @param cvssVector - vecteur CVSS 3.1 du corps, ou `null`
 * @returns `P0` à `P3`, ou `null` si rien n'est lisible
 */
export function severityFloor(cls, cvssVector = null) {
  const floors = [];
  if (cls && SCALE_FLOOR[cls]) floors.push(SCALE_FLOOR[cls]);
  const cvss = cvssVector ? cvss31Score(cvssVector) : null;
  if (cvss) floors.push(cvss.score >= 7 ? "P0" : cvss.score >= 4 ? "P1" : "P2");
  if (floors.length === 0) return null;
  return floors.sort()[0];
}

/**
 * Pose une ligne `**<Clé>** : …` dans un corps de ticket : remplace celle qui y
 * est, sinon l'insère avant l'estimation, sinon l'ajoute à la fin.
 *
 * @param body - corps du ticket
 * @param line - ligne rendue par `checkSeverity` ou `checkCvss`
 * @returns le corps avec UNE ligne de cette clé
 */
export function withSeverityLine(body, line) {
  const text = String(body ?? "");
  const key = line.match(/^\*\*(.+?)\*\*/u)?.[1] ?? "Gravité";
  const pattern = key === "Gravité" ? "Gravit[ée]" : key;
  const existing = new RegExp(`^\\s*\\*{0,2}${pattern}\\*{0,2}\\s*:.*$`, "imu");
  if (existing.test(text)) return text.replace(existing, () => line);
  const estimate = /^\*{0,2}Estimation\b/mu;
  const at = text.search(estimate);
  if (at !== -1) return `${text.slice(0, at)}${line}\n${text.slice(at)}`;
  return `${text.replace(/\s*$/u, "")}\n\n${line}\n`;
}
