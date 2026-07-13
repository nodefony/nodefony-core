/**
 * brand.mjs — identité visuelle d'un rapport (logo, nom, couleurs).
 *
 * Le rapport reste **autonome** : le logo est un data-URI, jamais un fichier
 * externe ni une URL. Un rapport envoyé par courriel ou archivé six mois doit
 * s'afficher à l'identique, hors ligne.
 *
 * ── UNE SEULE SOURCE POUR LE LOGO ───────────────────────────────────────────
 * Le logo officiel Nodefony vit dans le composant Studio `NodefonyLogo.tsx`.
 * On le LIT depuis là plutôt que d'en recopier le base64 : deux copies d'un même
 * asset finissent toujours par diverger (on change le logo d'un côté, et les
 * rapports continuent de porter l'ancien pendant des mois, sans que personne ne
 * le voie). Si la source devient introuvable (fichier déplacé, skill utilisé hors
 * du repo), on retombe sur une copie de secours — et on le DIT dans la console,
 * plutôt que de rendre un rapport sans logo en silence.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Source de vérité : le composant Studio.
 * Chemin relatif à CE fichier : `lib/` → skill → `skills/` → `.claude/` → racine.
 */
const LOGO_SOURCE =
  "../../../../src/packages/@nodefony/studio/frontend/src/components/NodefonyLogo.tsx";

/** Copie de secours : un « N » vectoriel aux couleurs de la marque. */
const FALLBACK_LOGO =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 41 64"><path d="M6 58V10l29 44V6" fill="none" stroke="#0067ba" stroke-width="7" stroke-linecap="round"/></svg>`,
  ).toString("base64");

function loadLogo() {
  try {
    const path = fileURLToPath(new URL(LOGO_SOURCE, import.meta.url));
    const src = readFileSync(path, "utf8");
    const m = src.match(/"(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)"/);
    if (m) return m[1];
    throw new Error("data-URI introuvable dans le composant");
  } catch (e) {
    console.warn(
      `[brand] logo officiel illisible (${e.message}) → repli sur le logo de secours.`,
    );
    return FALLBACK_LOGO;
  }
}

/**
 * Marque par défaut. Le skill étant **générique**, tout est surchargeable :
 * `doc({ brand: { name: "Acme", logo: "data:…", tagline: "…" } })`.
 */
export const NODEFONY_BRAND = {
  name: "Nodefony",
  tagline: "Framework Node.js fullstack — HTTP & WebSocket, même contexte",
  logo: loadLogo(),
  /** Bleu officiel (extrait du logo) — sert d'accent au document. */
  accent: "#0067ba",
};

export default NODEFONY_BRAND;
