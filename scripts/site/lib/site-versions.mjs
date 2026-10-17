/**
 * Versions du site publié — qui vit où, et comment passer de l'une à l'autre.
 *
 * Le site en ligne porte TROIS sortes de dossiers : la racine (la dernière
 * version PUBLIÉE sur npm, bâtie depuis `main`), `next/` (la branche `dev`, pas
 * encore publiée) et un dossier par release archivée (`10.0.0-beta.4/`…), figé
 * tel qu'il était le jour de sa sortie. Ce module décide de cet agencement et
 * du manifeste que chaque dossier reçoit ; il ne lit ni n'écrit rien, ce qui
 * le rend testable seul.
 *
 * @usage import { planVersions, manifestFor } from "./lib/site-versions.mjs"
 */

/** Dossier de la branche de développement, sous la racine du site. */
export const NEXT_DIR = "next";

/** Nom du manifeste posé dans CHAQUE dossier de version. */
export const MANIFEST_NAME = "versions.json";

/**
 * Forme d'une version qui a le droit de devenir un dossier du site.
 *
 * Le nom vient d'une pièce jointe de release : sans ce filtre, une archive
 * nommée `site-../x.tar.gz` écrirait hors du site. Semver strict, préversion
 * comprise — rien d'autre.
 */
const VERSION_DIR = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * La chaîne est-elle une version utilisable comme nom de dossier ?
 *
 * @param {string} name - nom candidat (sans `v` de tête).
 * @returns {boolean} vrai si semver strict, sans séparateur de chemin.
 */
export function isVersionDir(name) {
  return VERSION_DIR.test(name) && !name.includes("..");
}

/**
 * Compare deux versions semver, préversions comprises (ordre de semver §11).
 *
 * @param {string} a - première version.
 * @param {string} b - seconde version.
 * @returns {number} négatif si `a` précède `b`, positif s'il le suit, 0 si égales.
 */
export function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre] = v.split(/-(.*)/s);
    return { core: core.split(".").map(Number), pre: pre ?? null };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i++)
    if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  // Une préversion PRÉCÈDE sa version stable.
  if (x.pre === null || y.pre === null)
    return x.pre === y.pre ? 0 : x.pre === null ? 1 : -1;
  const p = x.pre.split(".");
  const q = y.pre.split(".");
  for (let i = 0; i < Math.max(p.length, q.length); i++) {
    if (p[i] === undefined) return -1;
    if (q[i] === undefined) return 1;
    const n = /^\d+$/.test(p[i]);
    const m = /^\d+$/.test(q[i]);
    if (n && m && Number(p[i]) !== Number(q[i]))
      return Number(p[i]) - Number(q[i]);
    if (n !== m) return n ? -1 : 1;
    if (!n && p[i] !== q[i]) return p[i] < q[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Plan des versions servies, dans l'ordre où le sélecteur les propose.
 *
 * La version publiée vit à la RACINE ; son archive, quand elle existe, garde
 * son dossier (une URL citée reste valide après la release suivante) mais
 * n'apparaît pas deux fois dans le sélecteur.
 *
 * @param {object} input
 * @param {string} input.published - version servie par npm, que la racine décrit.
 * @param {string[]} input.archives - versions dont une archive de site existe.
 * @param {boolean} input.hasNext - `next/` est-il servi ?
 * @returns {{ id: string, dir: string, label: string, kind: "published"|"next"|"archive" }[]}
 * @throws Error si une archive porte un nom qui n'est pas une version.
 */
export function planVersions({ published, archives, hasNext }) {
  for (const a of archives)
    if (!isVersionDir(a))
      throw new Error(`archive au nom invalide : ${JSON.stringify(a)}`);
  const entries = [];
  if (hasNext)
    entries.push({
      id: NEXT_DIR,
      dir: NEXT_DIR,
      label: "en développement (dev)",
      kind: "next",
    });
  entries.push({
    id: published,
    dir: "",
    label: `${published} — publiée`,
    kind: "published",
  });
  const older = [...new Set(archives)]
    .filter((a) => a !== published)
    .sort((a, b) => compareVersions(b, a));
  for (const a of older)
    entries.push({ id: a, dir: a, label: a, kind: "archive" });
  return entries;
}

/**
 * Chemin relatif d'un dossier de version vers un autre, terminé par `/`.
 *
 * @param {string} from - dossier de départ (`""` = racine).
 * @param {string} to - dossier d'arrivée.
 * @returns {string} chemin relatif, `./` pour soi-même.
 */
export function relativeDir(from, to) {
  if (from === to) return "./";
  const up = from === "" ? "" : "../";
  return to === "" ? up : `${up}${to}/`;
}

/**
 * Manifeste à poser dans le dossier `fromDir` : les liens y sont RELATIFS à lui.
 *
 * Le site est servi sous un sous-chemin (`/nodefony-core/`) et une archive ne
 * sait pas où elle sera rangée : chaque dossier reçoit donc sa propre copie,
 * qu'une page lit à côté de sa racine sans rien deviner.
 *
 * @param {ReturnType<typeof planVersions>} entries - plan des versions.
 * @param {string} fromDir - dossier qui recevra ce manifeste.
 * @returns {{ current: string, versions: { id: string, label: string, kind: string, href: string }[] }}
 */
export function manifestFor(entries, fromDir) {
  const own = entries.find((e) => e.dir === fromDir);
  return {
    current: own ? own.id : fromDir,
    versions: entries.map((e) => ({
      id: e.id,
      label: e.label,
      kind: e.kind,
      href: relativeDir(fromDir, e.dir),
    })),
  };
}

/**
 * Où mène le choix d'une autre version : la même page, et l'accueil à défaut.
 *
 * Sérialisée telle quelle dans chaque page (`toString()`) : c'est la SEULE
 * implémentation, celle que les tests éprouvent est celle que le navigateur
 * exécute. N'utilise donc que des globales communes à Node et au navigateur.
 *
 * @param {string} pageUrl - URL absolue de la page courante.
 * @param {string} rootUrl - URL absolue de la racine de SA version.
 * @param {string} targetHref - lien relatif de la version visée (manifeste).
 * @returns {{ page: string, home: string }} URL de la même page, et de l'accueil visé.
 */
export function versionTarget(pageUrl, rootUrl, targetHref) {
  const page = new URL(pageUrl);
  const root = new URL(rootUrl);
  const home = new URL(targetHref, root);
  const rest = page.pathname.startsWith(root.pathname)
    ? page.pathname.slice(root.pathname.length)
    : "";
  return { page: new URL(rest, home).href + page.hash, home: home.href };
}

/**
 * Script du sélecteur de version, à insérer dans l'en-tête d'une page.
 *
 * Amélioration progressive : sans manifeste (site bâti en local, archive lue
 * hors ligne), il ne montre rien. La page visée est d'abord demandée en `HEAD`
 * — une page retirée entre deux versions mène à l'accueil plutôt qu'au 404.
 *
 * @param {string} rootRel - chemin relatif de la page vers la racine de sa version.
 * @returns {string} un élément `<script>` autonome.
 */
export function versionSwitchScript(rootRel) {
  return `<script>
(function(){
var versionTarget=${versionTarget.toString()};
var root=new URL(${JSON.stringify(rootRel)},location.href).href;
fetch(new URL(${JSON.stringify(MANIFEST_NAME)},root)).then(function(r){return r.ok?r.json():null;}).then(function(m){
if(!m||!m.versions||m.versions.length<2)return;
var head=document.querySelector("header.rep-head");if(!head)return;
var sel=document.createElement("select");sel.className="nf-version no-print";
sel.setAttribute("aria-label","Version de la documentation");
m.versions.forEach(function(v){var o=document.createElement("option");o.value=v.href;o.textContent=v.label;if(v.id===m.current)o.selected=true;sel.appendChild(o);});
sel.addEventListener("change",function(){
var t=versionTarget(location.href,root,sel.value);
fetch(t.page.split("#")[0],{method:"HEAD"}).then(function(r){location.href=r.ok?t.page:t.home;},function(){location.href=t.home;});
});
head.insertBefore(sel,head.querySelector("#theme-toggle"));
}).catch(function(){});
})();
</script>
<style>.nf-version{margin-left:auto;margin-right:8px;font:inherit;font-size:13px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);}</style>`;
}
