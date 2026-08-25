/**
 * Socle commun des bancs qui démarrent une APPLICATION Nodefony réelle.
 *
 * Ces gestes — lire un argument, attendre qu'une condition devienne vraie,
 * savoir si un port répond, démarrer un pod et attendre qu'il écoute, l'arrêter
 * proprement — étaient écrits une fois par banc. Deux copies d'un démarrage de
 * pod divergent en silence : chacune passe son propre banc, et le jour où l'une
 * corrige un défaut d'attente, l'autre le garde.
 *
 * Le lanceur n'est jamais deviné : il vient de `node_modules/nodefony/bin`, le
 * même que celui qu'une application installée exécute.
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

/** Lit `--nom valeur` sur la ligne de commande, ou rend `defaut`. */
export const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

/** Vrai si `--nom` est présent (drapeau sans valeur). */
export const drapeau = (nom) => process.argv.includes(`--${nom}`);

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lance `docker` sans jamais jeter — rend `ERR:…` pour que l'appelant décide. */
export const docker = (...a) => {
  try {
    return execFileSync("docker", a, { encoding: "utf8" }).trim();
  } catch (e) {
    return `ERR:${String(e.message).slice(0, 60)}`;
  }
};

/** Attend qu'une condition devienne vraie, ou rend `false` au bout de `maxMs`. */
export async function jusqua(verif, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await verif()) {
      return true;
    }
    await dormir(250);
  }
  return false;
}

/** Le port répond-il en HTTP ? (sans juger du code de retour) */
export async function repond(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(3000),
    });
    return r.status > 0;
  } catch {
    return false;
  }
}

/** Chemin du lanceur `nodefony` tel qu'une application installée l'exécute. */
export function nodefonyBin(racine = process.cwd()) {
  return path.join(racine, "node_modules", "nodefony", "bin", "nodefony");
}

/**
 * Démarre un pod et attend qu'il écoute.
 *
 * @param options.port - port HTTP (le port HTTPS est `port + 1`).
 * @param options.mode - commande du lanceur : `production` (défaut) ou `development`.
 * @param options.env - variables ajoutées à celles du process courant.
 * @param options.attenteMs - budget d'attente du boot (défaut 90 s).
 * @returns `{ enfant, port, journal, estMort, debout }` — `debout: false` veut
 *   dire « n'a jamais répondu », que le process soit mort ou simplement muet ;
 *   `journal` porte la sortie complète, seule chose qui explique un boot raté.
 */
export async function demarrerPod({
  port,
  mode = "production",
  env = {},
  attenteMs = 90_000,
  racine = process.cwd(),
} = {}) {
  const enfant = spawn(process.execPath, [nodefonyBin(racine), mode], {
    cwd: racine,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: mode === "development" ? "development" : "production",
      NF_PORT: String(port),
      NF_PORT_HTTPS: String(port + 1),
      ...env,
    },
  });
  const journal = [];
  enfant.stdout.on("data", (d) => journal.push(String(d)));
  enfant.stderr.on("data", (d) => journal.push(String(d)));
  let mort = null;
  enfant.on("exit", (code, sig) => {
    mort = { code, sig };
  });

  const debout = await jusqua(async () => {
    if (mort) {
      return false;
    }
    return repond(port);
  }, attenteMs);
  return { enfant, port, journal, estMort: () => mort, debout };
}

/**
 * Arrête un pod et attend sa mort EFFECTIVE.
 *
 * Le `SIGKILL` de secours n'est pas une ceinture de confort : sous Windows un
 * arbre ne s'arrête pas gracieusement, et un dossier ne se supprime pas tant
 * qu'un process l'a pour répertoire courant. Rendre la main avant la mort réelle
 * fait échouer le banc SUIVANT, sur le port que celui-ci n'a pas encore rendu.
 *
 * @returns `true` si l'arrêt a été gracieux (le process est parti sur SIGTERM).
 */
export async function arreterPod(pod, { graceMs = 10_000 } = {}) {
  if (pod.estMort() !== null) {
    return true;
  }
  try {
    process.kill(pod.enfant.pid, "SIGTERM");
  } catch {
    return true;
  }
  const gracieux = await jusqua(async () => pod.estMort() !== null, graceMs);
  if (!gracieux) {
    try {
      process.kill(pod.enfant.pid, "SIGKILL");
    } catch {
      /* déjà mort */
    }
    await jusqua(async () => pod.estMort() !== null, 5_000);
  }
  return gracieux;
}

/** Petit rapporteur de banc — accumule le verdict au lieu de sortir au premier échec. */
export function rapporteur() {
  let verdict = 0;
  return {
    dire(ok, texte) {
      console.log(`  ${ok ? "✔" : "✘"} ${texte}`);
      if (!ok) {
        verdict = 1;
      }
    },
    verdict: () => verdict,
  };
}
