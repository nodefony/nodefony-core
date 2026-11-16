/**
 * Ce que le suivi EN DIRECT affiche d'un journal d'agent, ligne à ligne.
 *
 * Sorti de `suivre-run.mjs` pour être éprouvé : le script n'a pas d'autre
 * logique que celle-ci, et elle se trompait sans que rien ne le dise.
 *
 * 🔴 Vécu (#785) : sur un journal Copilot, le suivi filtré n'affichait que
 * `✗ exit 128` / `✗ exit 64`, sans la commande. La grammaire n'y était pour
 * rien — `transcript-dialectes.mjs` lit bien la commande de l'APPEL. Mais
 * l'événement de FIN (`tool.execution_complete`) ne porte pas les arguments, et
 * l'appel, lui, avait été écarté par le filtre (ni `npx nodefony`, ni base) :
 * l'échec s'affichait donc orphelin. Le remède relie la fin à son appel par
 * leur identifiant commun (`toolCallId` chez Copilot, `tool_use_id`, `call_id`
 * ailleurs — la grammaire les rend tous sous `id`).
 *
 * @module
 */
import { ATTENTE, PAR_NOM, exitDansTexte } from "./transcript-dialectes.mjs";

/**
 * Ce qui mérite une ligne à l'écran.
 *
 * Le filtre par défaut est SERRÉ, et c'est le sujet : une tâche fait 50 à 80
 * tours, trois répétitions en font deux cents. Tout afficher, c'est ne rien
 * lire. Ne passent que les gestes qui décident d'un verdict — un skill chargé,
 * une commande du framework, tout ce qui touche à une base. Un ÉCHEC, lui,
 * passe toujours, avec la commande qui l'a produit.
 *
 * ⚠️ Viser `nodefony` tout court ne marche PAS : le décor VIT dans un chemin
 * qui porte ce mot (`…/nodefony-devkit-bench/…`), donc chaque lecture de
 * fichier le contient et tout passe. Le filtre vise la COMMANDE (`npx nodefony`,
 * `orm:<verbe>`), jamais le nom du projet — mesuré au premier essai, où il a
 * rendu le déluge qu'il existe pour éviter.
 */
export const INTERESSANT =
  /\bnpx\s+nodefony\b|\borm:[a-z]|\brm\b|\bcp\b|sqlite3|var[/\\]databases|\.db\b|skills[/\\]nodefony-/i;

/** Longueur d'une commande à l'écran — au-delà, elle déborde la ligne. */
const LARGEUR = 130;

/** Une commande sur une ligne, bornée. */
function resume(arg) {
  return String(arg ?? "")
    .replace(/\s+/g, " ")
    .slice(0, LARGEUR);
}

/**
 * Un lecteur de journal : il rend, pour chaque ligne, les lignes à afficher.
 *
 * Il a un ÉTAT — les appels ouverts, par identifiant — parce qu'un échec ne se
 * nomme qu'avec son appel, lu plus tôt. Un appel sort de la table à son retour :
 * elle ne grossit que des appels en vol, jamais de la session entière.
 *
 * @param {string} dialecte - nom de la grammaire du journal (`PAR_NOM`).
 * @param {{tout?: boolean}} [options] - `tout` : aucun filtre.
 * @returns {(ligne: string) => string[]} les lignes à afficher.
 */
export function lecteurDeGestes(dialecte, { tout = false } = {}) {
  const grammaire = PAR_NOM[dialecte];
  if (!grammaire) throw new Error(`grammaire inconnue : « ${dialecte} »`);
  /** @type {Map<string, {outil: string, arg: string}>} */
  const ouverts = new Map();
  return (ligne) => {
    let evenement;
    try {
      evenement = JSON.parse(ligne);
    } catch {
      return [];
    }
    const out = [];
    for (const g of grammaire.gestes(evenement, 0)) {
      if (g.nature === "retour") {
        const appel = g.id == null ? undefined : ouverts.get(g.id);
        if (g.id != null) ouverts.delete(g.id);
        // Structuré quand le harness le publie (Codex), sinon écrit dans la
        // sortie (Copilot : `completed with exit code 127`) — la règle de
        // `lireTimeline`, appelée et non recopiée.
        const exit = g.exit ?? exitDansTexte(g.texte);
        if (exit !== null && exit !== 0) {
          out.push(
            appel
              ? `    ✗ exit ${exit} · ${appel.outil} · ${resume(appel.arg)}`
              : `    ✗ exit ${exit} · (appel non lu)`,
          );
        }
        continue;
      }
      if (g.nature !== "appel") continue;
      if (g.id != null) ouverts.set(g.id, { outil: g.outil, arg: g.arg });
      if (g.outil === ATTENTE && !tout) continue;
      if (!tout && g.outil !== "Skill" && !INTERESSANT.test(g.arg)) continue;
      out.push(`  ${g.outil} · ${resume(g.arg)}`);
    }
    return out;
  };
}
