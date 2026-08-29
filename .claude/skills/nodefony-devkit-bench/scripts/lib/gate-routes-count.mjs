/**
 * Juge de la tâche 9 — le nombre de routes annoncé est-il celui de
 * L'APPLICATION QUE L'AGENT A INTERROGÉE ?
 *
 * 🔴 **Le défaut que ce juge existe pour fermer.** Le gate bootait un SECOND
 * kernel, à froid, après le passage de l'agent, et comparait son compte au
 * rapport. Deux kernels, deux instants, deux mesures — et l'agent payait
 * l'écart. Vécu, deux runs d'affilée : la porte de l'application EN MARCHE a
 * répondu `count: 145`, l'agent l'a écrit en CITANT sa source, et le gate a
 * rendu « routes réelles=147, absent du rapport ». Il a donc sanctionné le seul
 * geste que la tâche demande : croire l'application plutôt que ses sources.
 * Pire, l'écart est INTERMITTENT — rejoué le lendemain sur la même application
 * témoin, kernel froid et porte en marche disent tous deux 147. Un gate qui se
 * trompe toujours se répare ; un gate qui se trompe parfois condamne au hasard.
 *
 * La règle appliquée ici est celle du reste du banc : **on interroge ce que
 * l'agent a interrogé**. L'application tourne (la prémisse de la tâche l'a
 * démarrée) : son compte se demande à SA porte. Le kernel à froid ne redevient
 * le juge que si PERSONNE ne répond — et alors le juge le DIT, parce qu'un
 * verdict rendu sur une autre application que celle mesurée doit se lire comme
 * tel.
 *
 * Sortie : `0` si le compte figure dans `AUDIT.md`, `1` sinon, `5` si rien n'a
 * pu être compté (ni porte, ni kernel) — un « je n'ai pas mesuré » qui ne
 * s'impute pas à l'agent.
 *
 * @module
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  CookieJar,
  request,
  appPortUnderTest,
  portTaken,
  exit,
} from "./http-probe.mjs";

/** Le chemin de la porte MCP d'une application Nodefony. */
const CHEMIN_MCP = "/nodefony/mcp";

/**
 * Le compte rendu par la porte MCP de l'application en marche.
 *
 * On passe par l'outil `nodefony_inspect`, sujet `routes` : c'est très
 * exactement ce que l'agent appelle. Sa réponse porte un `count` EXACT, calculé
 * sur la liste entière — la troncature d'affichage ne le touche pas.
 *
 * Aucun jeton n'est présenté : `inspect` est un outil public de la porte, et le
 * demander en anonyme mesure ce que l'agent le moins outillé obtient. Vérifié :
 * avec ou sans jeton, la porte rend le même compte.
 *
 * @returns {Promise<{compte: number}|{echec: string}>}
 */
async function compteParLaPorte() {
  if (!(await portTaken())) {
    return { echec: "aucune application n'écoute" };
  }
  // 🔴 Quelqu'un répond — mais QUI ? Un run précédent laissé vivant tient les
  // mêmes ports et porte le même nom d'application. Sans cette garde, ce juge
  // rend un chiffre EXACT à propos d'une autre application, et personne ne peut
  // le voir : c'est arrivé, et le seul verdict juste de la passe fut le rouge
  // de `nodefony check` (« le port est tenu par un autre processus »).
  const cible = appPortUnderTest();
  if (!cible.sien) {
    return { echec: `un serveur répond, mais ${cible.motif}` };
  }
  const rep = await request("POST", CHEMIN_MCP, new CookieJar(), {
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "nodefony_inspect",
        arguments: { subject: "routes" },
      },
    },
    headers: { accept: "application/json, text/event-stream" },
  });
  if (rep.error) return { echec: `porte injoignable : ${rep.error}` };
  if (rep.status !== 200) return { echec: `porte en ${rep.status}` };
  // Le texte de l'outil est du JSON DANS du JSON : l'enveloppe JSON-RPC porte un
  // bloc `text` qui contient la réponse. On lit le `count` de ce second niveau.
  let compte = null;
  try {
    const enveloppe = JSON.parse(rep.body ?? "{}");
    const bloc = enveloppe?.result?.content?.[0]?.text;
    if (typeof bloc === "string") {
      compte = JSON.parse(bloc)?.count ?? null;
    }
  } catch (e) {
    return { echec: `réponse illisible : ${e.message}` };
  }
  if (typeof compte !== "number") {
    return { echec: "la porte n'a pas rendu de `count`" };
  }
  return { compte };
}

/**
 * Le compte rendu par un kernel booté à froid — REPLI, jamais le premier choix.
 *
 * 🔴 `NODE_ENV=development` n'est pas un détail : le nombre de routes DÉPEND du
 * mode, les modules `policy:"dev"` n'étant pas chargés en production. Ce repli
 * bootait autrefois en production et comparait deux chiffres qui n'ont jamais
 * parlé de la même application (142 pour l'agent, 119 pour le gate).
 *
 * @param {string} bin - chemin du binaire `nodefony` de l'application.
 * @returns {{compte: number}|{echec: string}}
 */
function compteParKernelFroid(bin) {
  let brut;
  try {
    brut = execFileSync(
      process.execPath,
      [bin, "inspect", "routes", "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "development" },
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (e) {
    return { echec: `inspect routes a échoué : ${e.message}` };
  }
  try {
    const liste = JSON.parse(brut);
    if (!Array.isArray(liste))
      return { echec: "inspect routes n'a pas rendu une liste" };
    return { compte: liste.length };
  } catch (e) {
    return { echec: `inspect routes illisible : ${e.message}` };
  }
}

/**
 * @param {string} bin - chemin du binaire `nodefony` de l'application témoin.
 */
export async function judge(bin) {
  const parLaPorte = await compteParLaPorte();
  let compte;
  let source;
  if ("compte" in parLaPorte) {
    compte = parLaPorte.compte;
    source = "l'application EN MARCHE (porte MCP)";
  } else {
    const froid = compteParKernelFroid(bin);
    if ("echec" in froid) {
      // Ni l'un ni l'autre : on n'a RIEN mesuré. Le dire, et sortir sur un code
      // distinct — imputer cela à l'agent serait inventer un verdict.
      exit(
        5,
        `aucun compte de routes obtenu — porte : ${parLaPorte.echec} ; ` +
          `kernel froid : ${froid.echec}`,
      );
      return;
    }
    compte = froid.compte;
    // ⚠️ Un verdict rendu sur une AUTRE application que celle interrogée par
    // l'agent doit se lire comme tel, y compris quand il est VERT.
    source =
      `un kernel booté à FROID (repli : ${parLaPorte.echec}) — ` +
      `ce n'est pas l'application que l'agent a interrogée`;
  }

  if (!existsSync("AUDIT.md")) {
    exit(1, "AUDIT.md absent");
    return;
  }
  const rapport = readFileSync("AUDIT.md", "utf8");
  if (!new RegExp(`\\b${compte}\\b`).test(rapport)) {
    exit(1, `routes réelles=${compte} selon ${source}, absent du rapport`);
    return;
  }
  process.stdout.write(`routes=${compte}, annoncé — source : ${source}\n`);
}

// Exécution directe : le banc appelle `node gate-routes-count.mjs <bin>`.
if (process.argv[1] && process.argv[1].endsWith("gate-routes-count.mjs")) {
  const bin = process.argv[2];
  if (!bin) {
    exit(5, "chemin du binaire `nodefony` non fourni");
  } else {
    await judge(bin);
  }
}
