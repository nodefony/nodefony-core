/**
 * Les dépendances de production d'une application MINIMALE, lues dans le gabarit
 * que `nodefony create app` rend.
 *
 * Pourquoi ce lecteur existe. Le nombre de dépendances d'une application générée
 * est devenu un ARGUMENT PUBLIC : c'est lui qui distingue le produit du dépôt de
 * développement, et c'est faute de le dire que des agents ont conclu qu'adopter
 * Nodefony revenait à hériter du monorepo. Une affirmation publique recopiée à la
 * main dérive au premier ajout de dépendance, sans un mot — donc elle se
 * CONSTATE, depuis la seule source qui fasse foi : le gabarit.
 *
 * Le gabarit est un modèle EJS. Ses blocs conditionnels portent les dépendances
 * des VARIANTES (`--complete`, `--front`) ; une application minimale est celle
 * qu'on obtient sans aucun drapeau, donc les dépendances au niveau ZÉRO de
 * conditionnel. C'est ce niveau que ce module isole, sans rendre le gabarit ni
 * évaluer une ligne de son code.
 */
import fs from "node:fs";
import path from "node:path";

/** Chemin du gabarit, relatif à la racine du dépôt (séparateurs natifs). */
export const APP_TEMPLATE_PATH = path.join(
  "src",
  "nodefony",
  "templates",
  "app",
  "base",
  "package.json.tpl",
);

/** Le même chemin tel qu'il s'ÉCRIT dans une page ou un message — toujours en `/`. */
export const APP_TEMPLATE_HREF =
  "src/nodefony/templates/app/base/package.json.tpl";

/**
 * Les dépendances de production d'une application minimale, dans l'ordre du gabarit.
 *
 * @param source - contenu du gabarit `package.json.tpl`.
 * @returns les noms de paquets déclarés hors de tout bloc conditionnel.
 * @throws Si le bloc `dependencies` est introuvable — un gabarit restructuré doit
 *   faire ÉCHOUER le contrôle, jamais lui faire rendre une liste vide qui
 *   passerait pour une réponse.
 */
export function readMinimalAppDependencies(source) {
  const start = source.indexOf('"dependencies": {');
  if (start === -1)
    throw new Error(
      `bloc "dependencies" introuvable dans le gabarit — structure changée ?`,
    );

  // Segmenter en balises EJS et texte. La profondeur ne bouge QUE dans les
  // balises : les accolades du texte sont celles du JSON.
  const segments = source.slice(start).split(/(<%[\s\S]*?%>)/);
  const names = [];
  let depth = 0;
  for (const segment of segments) {
    if (segment.startsWith("<%")) {
      // `<% } else if (it.front) { %>` ferme puis rouvre : le solde est ce qui
      // compte, pas la présence d'un mot-clé.
      depth +=
        (segment.match(/\{/g) ?? []).length -
        (segment.match(/\}/g) ?? []).length;
      continue;
    }
    // Fin du bloc : l'accolade fermante à deux espaces d'indentation.
    const end = segment.search(/^ {2}\},/m);
    const body = end === -1 ? segment : segment.slice(0, end);
    if (depth === 0)
      for (const m of body.matchAll(/"((?:@[\w.-]+\/)?[\w.-]+)"\s*:/g))
        if (m[1] !== "dependencies") names.push(m[1]);
    if (end !== -1) break;
  }
  if (!names.length)
    throw new Error("aucune dépendance minimale lue — gabarit illisible");
  return names;
}

/**
 * Lit le gabarit sur disque et rend ses dépendances minimales.
 *
 * @param repoRoot - racine du dépôt.
 * @returns les noms de paquets, dans l'ordre du gabarit.
 */
export function minimalAppDependencies(repoRoot) {
  return readMinimalAppDependencies(
    fs.readFileSync(path.join(repoRoot, APP_TEMPLATE_PATH), "utf8"),
  );
}
