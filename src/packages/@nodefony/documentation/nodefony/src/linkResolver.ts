/**
 * Réécriture des liens internes d'une page de doc en **slugs**.
 *
 * Une page vit sur le disque et lie ses voisines par chemin relatif — c'est ce
 * qui la rend lisible sur GitHub et dans un éditeur : `[CORS](cors.md)`,
 * `[Documentation](../../../../../docs/index.md)`. Mais le portail ne navigue
 * pas par chemin : il navigue par **slug** (`mod~security~cors`), parce qu'un
 * slug est une clé d'allowlist et jamais un chemin FS (anti-traversée, cf
 * {@link ../src/slug}).
 *
 * Sans traduction, seuls les liens PLATS fonctionnaient dans Studio : toute
 * remontée (`../index.md`) tombait en ancre HTML morte. La résolution appartient
 * au serveur, seul à connaître la table chemin → slug ; le client n'a aucun
 * moyen de deviner à quel fichier `../../..` correspond.
 *
 * Le lien conserve l'extension `.md` après réécriture (`mod~security~cors.md`) :
 * le rendu markdown reconnaît un lien interne à cette extension, et un slug
 * seul serait indistinguable d'une URL relative quelconque.
 */

/**
 * Liens markdown `[texte](cible)` — on ne touche QUE les cibles `.md`.
 * Exclus : URL absolues (`http:`, `mailto:`), ancres pures (`#section`), et
 * tout ce qui n'est pas un fichier markdown.
 */
const MD_LINK = /\]\((?!https?:|mailto:|#)([^)\s]+?\.md)(#[^)\s]*)?\)/gi;

/**
 * Cible d'un bloc déclaratif : `"href": "../x.md"` dans un JSON de fence typée
 * (`nodefony-cards`…). Même règle que les liens markdown — seules les cibles
 * `.md` internes sont traduites.
 */
const JSON_HREF = /"href"\s*:\s*"(?!https?:|mailto:|#)([^"\s]+?\.md)"/gi;

/** Résout un chemin relatif POSIX contre le dossier d'une page. */
function resolveRelative(fromDir: string, href: string): string {
  const base = href.startsWith("/") ? [] : fromDir.split("/").filter(Boolean);
  const out = [...base];
  for (const seg of href.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

/** Options de {@link rewriteInternalLinks}. */
export interface RewriteLinksOptions {
  /**
   * Dossier de la page courante, relatif à la racine du projet (POSIX, sans
   * fichier). Ex. `src/packages/@nodefony/security/docs`.
   */
  fromDir: string;
  /**
   * Traduit un chemin de fichier relatif à la racine du projet en slug.
   * Retourne `undefined` si le fichier n'est pas dans l'index (lien laissé
   * intact — on ne fabrique jamais un slug qui n'existe pas).
   */
  toSlug: (repoRelPath: string) => string | undefined;
}

/**
 * Réécrit les liens markdown internes d'une page en slugs navigables.
 *
 * Un lien dont la cible n'est pas indexée est **laissé tel quel** : mieux vaut
 * un lien inerte qu'un slug inventé qui produirait un 404 côté portail.
 *
 * @param markdown - corps de la page (frontmatter déjà retiré).
 * @param options - dossier d'origine + résolution chemin → slug.
 * @returns le markdown avec ses liens internes traduits.
 */
export function rewriteInternalLinks(
  markdown: string,
  options: RewriteLinksOptions,
): string {
  const { fromDir, toSlug } = options;
  const translate = (href: string): string | null => {
    const slug = toSlug(resolveRelative(fromDir, href));
    return slug ? `${slug}.md` : null;
  };
  const out = markdown.replace(MD_LINK, (whole, href: string, hash = "") => {
    const t = translate(href);
    return t ? `](${t}${hash})` : whole;
  });
  // Les blocs déclaratifs (`nodefony-cards`…) portent leurs cibles dans du JSON,
  // hors de la syntaxe markdown : leurs `href` doivent être traduits AUSSI,
  // sinon un catalogue de hub renvoie dans le vide.
  return out.replace(JSON_HREF, (whole, href: string) => {
    const t = translate(href);
    return t ? `"href": "${t}"` : whole;
  });
}
