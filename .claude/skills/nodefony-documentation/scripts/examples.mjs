#!/usr/bin/env node
/**
 * Garde des EXEMPLES de code d'une page publiée (`doc-lint`).
 *
 * Un exemple se recopie. Celui qui lit `process.env` hors de `env.ts`, ou qui range une base
 * SQLite dans un dossier que le framework n'utilise pas, compile très bien : rien ne signale
 * au lecteur qu'il s'écarte de l'application générée. Ces deux motifs sont mécaniques, donc
 * gardés ; la forme d'une config de module (`nodefony/config/<module>.ts`) relève, elle, d'une
 * convention que seul un humain juge.
 *
 * Une exception se DIT : le commentaire `<!-- doc-lint: process-env — raison -->` sur la
 * ligne juste avant la fence lève le premier motif pour CE bloc, et la raison reste écrite.
 */

/** Lecture d'une variable : `process.env.X` ou `process.env["X"]` — pas la prose « process.env. ». */
const PROCESS_ENV = /\bprocess\.env\s*(?:\.\s*[A-Za-z_$]|\[)/;
/** Base rangée sous le dossier du code : le framework range ses données sous `var/databases/`. */
const DATABASES_DIR = /nodefony\/databases\//;
/** Directive d'exception, sur la ligne qui précède la fence. */
const PROCESS_ENV_OK = /^\s*<!--\s*doc-lint:\s*process-env\b[^>]*-->\s*$/;

/**
 * Cherche, dans les blocs de code d'une page, les exemples qui s'écartent de l'application générée.
 *
 * @param src - contenu Markdown complet de la page
 * @returns la liste des défauts `{ line, message }` (ligne 1-based), vide si l'exemple est conforme
 */
export function exampleDefects(src) {
  const defects = [];
  const lines = src.split("\n");
  let fence = null;
  let allowProcessEnv = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*(`{3,})(.*)$/);
    if (fence === null) {
      if (m) {
        fence = m[1];
        allowProcessEnv = i > 0 && PROCESS_ENV_OK.test(lines[i - 1]);
      }
      continue;
    }
    if (m && m[1].length >= fence.length && !m[2].trim()) {
      fence = null;
      continue;
    }
    // Un commentaire n'exécute rien : on ne juge que le code.
    const code = line.replace(/(^|\s)\/\/.*$/, "$1");
    if (!allowProcessEnv && PROCESS_ENV.test(code))
      defects.push({
        line: i + 1,
        message:
          "`process.env` dans un exemple — déclarer la variable dans `env.ts` (préfixe NF_) " +
          'et lire `ctx.env.X`, ou `import { env } from "../../env"` hors configuration ' +
          "(exception : `<!-- doc-lint: process-env — raison -->` avant la fence)",
      });
    if (DATABASES_DIR.test(code))
      defects.push({
        line: i + 1,
        message:
          "base sous `nodefony/databases/` — le framework range ses données sous `var/databases/`",
      });
  }
  return defects;
}
