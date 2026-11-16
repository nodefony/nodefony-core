/**
 * Par où l'agent AURAIT dû apprendre à lire `AGENTS.md` — et lequel a manqué.
 *
 * « N'a pas lu AGENTS.md » ne dit rien de la cause. Deux canaux portent la
 * consigne jusqu'à un agent qui part d'un dossier vide, et le remède n'est pas
 * le même selon celui qui a manqué :
 *
 * 1. **la sortie de `create app`** — « Pour ton agent — lis AGENTS.md … ». Vécu
 *    (#785) : imprimée en FIN d'une sortie de 25 Ko que Copilot a déversée dans
 *    un fichier, elle n'a jamais atteint le modèle (0 occurrence au journal).
 *    Remède : le PRODUIT (sortie courte, consigne en tête).
 * 2. **les skills annoncés au démarrage** — l'agent qui reçoit `nodefony-*` dans
 *    son message système a un second chemin vers la conduite. Vécu : Copilot
 *    n'en listait AUCUN (ses skills intégrés seulement). Remède : la découverte
 *    des skills par le harness, que le produit ne contrôle pas.
 *
 * Lu au transcript ENTIER (la matière REÇUE, pas la parole de l'agent) : c'est
 * précisément ce qui lui a été donné qu'on interroge.
 *
 * @module
 */

/**
 * La consigne que `create app` imprime pour l'agent — forme courante, et celle
 * des versions publiées jusqu'à la `10.0.0-beta.8`. L'auto-contrôle relit le
 * gabarit de `src/nodefony/src/cli/create.ts` : si le produit reformule, il tombe.
 */
export const CONSIGNE_CREATE_APP =
  /Pour ton agent — lis \S*AGENTS\.md|AGENTS\.md — à lire AVANT/u;

/**
 * Les skills `nodefony-*` annoncés à l'agent au démarrage, lus dans l'événement
 * qui les porte selon le harness.
 *
 * @param {string} transcript - le transcript JSONL entier.
 * @returns {number|null} le nombre de skills distincts, ou `null` si aucun
 *   événement de démarrage n'est lisible (harness non reconnu).
 */
export function skillsAnnonces(transcript) {
  let vu = false;
  const noms = new Set();
  for (const ligne of transcript.split("\n")) {
    if (!ligne.includes('"system')) continue;
    let o;
    try {
      o = JSON.parse(ligne);
    } catch {
      continue;
    }
    // Claude (`-p --output-format stream-json`) : l'événement `init` liste ses skills.
    // Copilot : le `system.message` porte le texte du message système.
    const porteur =
      o?.type === "system" && o?.subtype === "init"
        ? (o.skills ?? [])
        : o?.type === "system.message"
          ? o.data
          : null;
    if (porteur === null) continue;
    vu = true;
    for (const m of JSON.stringify(porteur).matchAll(/nodefony-[a-z0-9-]+/gu))
      noms.add(m[0]);
  }
  return vu ? noms.size : null;
}

/**
 * Le diagnostic des deux canaux, en une ligne — ce que le rapport accole à la
 * sonde « a lu AGENTS.md » quand elle tombe.
 *
 * @param {string} transcript - le transcript JSONL entier.
 * @returns {string}
 */
export function canauxAgentsMd(transcript) {
  const consigne = CONSIGNE_CREATE_APP.test(transcript)
    ? "consigne de create app REÇUE"
    : "consigne de create app JAMAIS reçue";
  const n = skillsAnnonces(transcript);
  const skills =
    n === null
      ? "skills du démarrage non lisibles pour ce harness"
      : n === 0
        ? "AUCUN skill nodefony-* annoncé au démarrage"
        : `${n} skill(s) nodefony-* annoncé(s) au démarrage`;
  return `canaux : ${consigne} · ${skills}`;
}
