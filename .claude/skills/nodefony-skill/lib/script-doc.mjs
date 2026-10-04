/**
 * Ce qu'on sait d'un script du dépôt — sa documentation et l'automate qui le
 * lance — en une seule implémentation.
 *
 * Deux outils en ont besoin : `scripts-audit.mjs` (chaque script est-il au bon
 * endroit, quelqu'un l'appelle-t-il ?) et `skills-doc.mjs` (fiches des skills,
 * `README.md` de chaque dossier de `scripts/`). Les deux s'exécutent à l'import : la règle vit
 * donc ici, sans effet de bord, et chacun l'appelle.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, posix, sep } from "node:path";

/** Chemin à séparateur `/`, quelle que soit la plateforme — la clé de comparaison. */
export const cle = (p) => p.split(sep).join("/");

const EXT = [".mjs", ".js", ".sh", ".ts", ".py"];

const isScript = (f) => EXT.some((e) => f.endsWith(e));

/**
 * Tous les scripts sous un dossier, hors dépendances et build (profondeur 4).
 *
 * @param {string} dir - dossier de départ, relatif à la racine du dépôt.
 * @returns {string[]} chemins natifs des scripts trouvés.
 */
export function collectScripts(dir, out = [], depth = 0) {
  if (!existsSync(dir) || depth > 4) return out;
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", "coverage"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) collectScripts(p, out, depth + 1);
    else if (isScript(e)) out.push(p);
  }
  return out;
}

/**
 * Le source de chaque script, illisible = vide.
 *
 * @param {string[]} paths - chemins des scripts.
 * @returns {Map<string, string>} chemin → source.
 */
export const readSources = (paths) =>
  new Map(
    paths.map((p) => {
      try {
        return [p, readFileSync(p, "utf8")];
      } catch {
        return [p, ""];
      }
    }),
  );

/** Le source sans ses commentaires : un exemple n'invoque rien. */
export const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1")
    .replace(/(^|\s)#[^\n]*/g, "$1");

/**
 * Radiographie d'un script : sa raison d'être, sa ligne d'usage, ses options et les variables
 * d'environnement qu'il lit. Tout est extrait du SOURCE — une option ajoutée au script apparaît
 * dans la fiche à la régénération suivante, sans que personne ait à y penser.
 */
const ENV_NOISE =
  /^(PATH|HOME|PWD|SHELL|USER|TERM|LANG|TMPDIR|NODE_OPTIONS|FORCE_COLOR|CI)$/;

export function analyzeScript(path) {
  let src = "";
  try {
    src = readFileSync(path, "utf8");
  } catch {
    return {
      purpose: "",
      usage: "",
      flags: [],
      envs: [],
      docs: {},
      requires: [],
    };
  }
  const head = src.split("\n").slice(0, 40);

  // ── HOOK DE DOC ────────────────────────────────────────────────────────────────────────────
  // Un script peut se DÉCRIRE lui-même dans son entête, au lieu de laisser deviner. Ces tags
  // sont facultatifs : sans eux, l'heuristique plus bas fait de son mieux ; avec eux, la fiche
  // devient exacte. C'est le seul endroit où la doc d'un script doit vivre — pas dans un fichier
  // parallèle qui divergera.
  //
  // (exemples entre accents graves pour qu'ils ne soient pas moissonnés par leur propre lecteur)
  //   `@usage`    node scripts/x.mjs --out rapport.html
  //   `@option`   --out    chemin du rapport produit
  //   `@env`      NF_PORT  port du serveur à interroger
  //   `@requires` docker, serveur UP
  //   `@output`   un rapport HTML autonome
  const tag = (name) =>
    [
      ...src.matchAll(
        new RegExp(`^\\s*(?:#|//|\\*)\\s*@${name}\\s+(.+)$`, "gm"),
      ),
    ].map((m) => m[1].trim());
  const docs = {
    usage: tag("usage"),
    options: tag("option").map((l) => {
      const m = l.match(/^(--?[\w-]+)\s+(.*)$/);
      return m
        ? { flag: m[1], help: m[2] }
        : { flag: l.split(/\s+/)[0], help: l.split(/\s+/).slice(1).join(" ") };
    }),
    envs: tag("env").map((l) => {
      const m = l.match(/^([A-Z][A-Z0-9_]*)\s+(.*)$/);
      return m
        ? { name: m[1], help: m[2] }
        : { name: l.split(/\s+/)[0], help: "" };
    }),
    output: tag("output"),
  };
  const declaredRequires = tag("requires")
    .flatMap((l) => l.split(/\s*,\s*/))
    .filter(Boolean);

  // Prérequis déduits quand le script ne les déclare pas : ce qu'il faut avoir sous la main
  // pour que son résultat veuille dire quelque chose.
  const inferred = [];
  if (/\bdocker\b/i.test(src)) inferred.push("docker");
  if (/localhost:\d|127\.0\.0\.1|https?:\/\/localhost/.test(src))
    inferred.push("serveur UP");
  if (/redis|REDIS_/i.test(src)) inferred.push("redis");
  if (/\b(psql|postgres|mysql|mariadb|mongo)\b/i.test(src))
    inferred.push("base de données");
  const requires = [
    ...new Set(declaredRequires.length ? declaredRequires : inferred),
  ];

  // Raison d'être : la première PHRASE de commentaire substantielle de l'entête.
  // Une phrase court souvent sur deux lignes : n'en garder que la première rendait
  // « Garde des dossiers temporaires — le jetable d'un test, le » — une coupure
  // qui oblige le lecteur à rouvrir le fichier, ce que l'index devait lui épargner.
  let purpose = "";
  const commentaire = (line) => line.match(/^\s*(?:#|\/\/|\*)\s*(.*)$/)?.[1];
  for (let i = 0; i < head.length; i++) {
    const line = head[i];
    const c = line.match(/^\s*(?:#|\/\/|\*)\s*(.{8,})$/);
    // Un filet de séparation (tirets ASCII ou box-drawing) n'est pas une raison d'être.
    if (
      c &&
      !line.trim().startsWith("#!") &&
      !/eslint|prettier|@ts-/.test(c[1]) &&
      !/^[-=─━_*·.\s]+$/u.test(c[1])
    ) {
      // Le paragraphe : jusqu'à une ligne de commentaire vide, un tag ou la fin.
      const paragraphe = [c[1].trim()];
      for (let j = i + 1; j < head.length; j++) {
        const suite = commentaire(head[j])?.trim();
        if (!suite || suite.startsWith("@") || /^[-=─━_*·.\s]+$/u.test(suite))
          break;
        paragraphe.push(suite);
      }
      const texte = paragraphe.join(" ");
      // Le paragraphe ENTIER : c'est lui qui porte le pourquoi, et l'index doit
      // dispenser de rouvrir le fichier. Au-delà de 600 caractères, coupé à la
      // dernière fin de phrase qui tient — jamais au milieu d'un mot.
      const MAX = 600;
      let resume = texte;
      if (texte.length > MAX) {
        const fins = [...texte.slice(0, MAX).matchAll(/[.!?](?=\s)/gu)];
        const fin = fins.at(-1)?.index;
        resume =
          fin === undefined
            ? `${texte.slice(0, MAX - 1)}…`
            : `${texte.slice(0, fin + 1)} […]`;
      }
      purpose = resume.trim().replace(/\s*[-–—]\s*$/, "");
      break;
    }
  }

  // Ligne d'usage : un exemple d'invocation cité dans l'entête.
  const usageLine = head.find(
    (l) =>
      /(?:^|\s)(?:node|bash|sh|npx)\s+[\w./-]*(?:scripts\/)?[\w.-]+\.(?:mjs|js|sh)/.test(
        l,
      ) && /^\s*(?:#|\/\/|\*)/.test(l),
  );
  const usage = usageLine
    ? usageLine.replace(/^\s*(?:#|\/\/|\*)\s*/, "").trim()
    : "";

  // Options : les drapeaux réellement testés par le script.
  const flags = [
    ...new Set([...src.matchAll(/--[a-z][a-z0-9-]{1,24}/g)].map((m) => m[0])),
  ]
    .filter(
      (f) =>
        !/^--(?:experimental|max-old|expose|enable|no-warnings|loader|import)/.test(
          f,
        ),
    )
    .sort();

  // Variables d'ENTRÉE : ce qui vient de l'extérieur, jamais les variables de travail du script.
  // En shell, `VAR=…` en début de ligne signale une variable locale — sauf `VAR="${VAR:-défaut}"`,
  // qui est précisément la forme d'un paramètre configurable avec valeur par défaut.
  const assignedLocally = new Set(
    [...src.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})=(.*)$/gm)]
      .filter((m) => !new RegExp(`\\$\\{?${m[1]}\\b`).test(m[2]))
      .map((m) => m[1]),
  );
  const envs = [
    ...new Set([
      ...[...src.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)].map(
        (m) => m[1],
      ),
      ...[...src.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]{2,})["']\]/g)].map(
        (m) => m[1],
      ),
      ...[...src.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})[:}\s]/g)].map((m) => m[1]),
    ]),
  ]
    .filter(
      (e) =>
        !ENV_NOISE.test(e) &&
        !assignedLocally.has(e) &&
        !/^(BASH_|FUNCNAME|RANDOM|SECONDS|PIPESTATUS)/.test(e),
    )
    .sort();

  return {
    purpose: docs.output.length && !purpose ? docs.output[0] : purpose,
    usage: docs.usage[0] || usage,
    usages: docs.usage.length ? docs.usage : usage ? [usage] : [],
    flags: docs.options.length ? docs.options.map((o) => o.flag) : flags,
    options: docs.options,
    envs: docs.envs.length ? docs.envs.map((e) => e.name) : envs,
    envDocs: docs.envs,
    output: docs.output[0] || "",
    requires,
    selfDocumented: Boolean(
      docs.usage.length || docs.options.length || docs.envs.length,
    ),
    declaredUsage: docs.usage.length > 0,
  };
}

/**
 * Les AUTOMATES du dépôt — ce qui LANCE un script sans qu'un humain ait à le taper.
 *
 * Être nommé dans une page n'est PAS être exécuté. Ce contrôle a annoncé « 0
 * orphelin » cinq semaines durant pendant qu'une vingtaine d'auto-contrôles,
 * énumérés un par un dans leur page de skill, n'étaient lancés par rien — dont
 * celui qui savait nommer quinze causes qu'aucun juge ne classait. Un inventaire
 * qui compte une phrase comme un appel ne mesure pas l'exécution : il mesure la
 * documentation.
 *
 * Trois automates, et rien d'autre : un script npm, un étage de forge, un autre
 * script qui l'invoque ou l'importe — un module importé s'exécute.
 */
export function createLaunchFinder(sourcesByPath, pkgText) {
  /** Les VALEURS des scripts npm, jamais le fichier entier : une dépendance qui
   * porte le nom d'un script n'en fait pas un automate. */
  const scriptsNpm = (() => {
    try {
      return Object.entries(JSON.parse(pkgText).scripts ?? {});
    } catch {
      return [["package.json", pkgText]];
    }
  })();

  /** Tous les fichiers d'un dossier (un niveau), lus — vide si absent. */
  const lireDossier = (dir, filtre = () => true) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter(filtre)
          .map((f) => join(dir, f))
          .filter((p) => statSync(p).isFile())
          .map((p) => [cle(p), readFileSync(p, "utf8")])
      : [];

  const forge = lireDossier(join(".github", "workflows"), (f) =>
    /\.ya?ml$/u.test(f),
  );

  /**
   * Les HOOKS — git (`.githooks/`) et agent (`.claude/hooks/`). Ce sont des
   * automates au même titre qu'un étage de forge : le pre-commit lance
   * `check-package-deps` à chaque commit. Ne pas les lire déclarait « jamais
   * lancés » des gardes exécutées des dizaines de fois par jour, acquittées à la
   * main faute de mieux. En shell, toute mention hors commentaire est un appel.
   */
  const hooks = [".githooks", join(".claude", "hooks")]
    .flatMap((d) => lireDossier(d))
    .map(([p, src]) => [p, sansCommentaires(src)]);

  /**
   * Les tests du PRODUIT qui exécutent un script du dépôt (`passwordPolicy.test.ts`
   * lance le générateur de la liste noire pour comparer les deux troncatures).
   * Le critère est la RÉSOLUTION du chemin (`resolve(`/`join(` juste avant) : un
   * test qui se contente d'AFFICHER la commande à lancer (`brandAssets.test.ts`,
   * « lancer node scripts/generate/brand-assets.mjs ») ne l'exécute pas.
   */
  const testsProduit = (() => {
    const out = [];
    const descendre = (dir, depth = 0) => {
      if (!existsSync(dir) || depth > 8) return;
      for (const e of readdirSync(dir)) {
        if (["node_modules", "dist", ".git", "coverage"].includes(e)) continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) descendre(p, depth + 1);
        else if (/\.test\.[cm]?[jt]sx?$/u.test(e)) {
          const src = readFileSync(p, "utf8");
          if (src.includes("scripts/"))
            out.push([cle(p), sansCommentaires(src)]);
        }
      }
    };
    descendre("src");
    return out;
  })();

  const resoluPar = (src, k) => {
    for (let i = src.indexOf(k); i !== -1; i = src.indexOf(k, i + 1))
      if (/(?:resolve|join)\(/u.test(src.slice(Math.max(0, i - 200), i)))
        return true;
    return false;
  };

  /**
   * Les IMPORTS qui remontent vers `scripts/` depuis le reste du dépôt — config
   * vitest d'un paquet, test du cœur. Un module importé s'exécute : c'est un
   * appel, et le seul que voient les socles de `scripts/test/vitest/`, qu'aucun
   * script npm ni aucune forge ne nomme. Sans lui, l'audit les déclarait orphelins
   * et l'index écrivait « appelé par aucun automate » d'un fichier importé par
   * vingt-quatre configurations.
   *
   * Une seule passe `git grep`, chaque chemin résolu depuis le fichier qui l'écrit :
   * un `../` de trop viserait un autre dossier.
   *
   * @type {Map<string, string[]>} socle (chemin sans extension) → importeurs.
   */
  const importsDuDepot = (() => {
    const socles = new Map();
    let sortie = "";
    try {
      sortie = execFileSync(
        "git",
        [
          "grep",
          "-n",
          "-o",
          "-E",
          `(from|import)[[:space:]]*\\(?[[:space:]]*["'](\\.\\./)+scripts/[^"']+["']`,
        ],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
    } catch {
      // `git grep` sort 1 quand rien ne correspond : aucun import, aucun socle.
    }
    for (const ligne of sortie.split("\n")) {
      const m = /^(.+?):\d+:.*["']([^"']+)["']$/u.exec(ligne);
      if (!m) continue;
      const cible = posix
        .normalize(posix.join(posix.dirname(m[1]), m[2]))
        .replace(/\.(?:ts|mts|mjs|js)$/u, "");
      if (!cible.startsWith("scripts/")) continue;
      const importeurs = socles.get(cible) ?? [];
      if (!importeurs.includes(m[1])) importeurs.push(m[1]);
      socles.set(cible, importeurs);
    }
    return socles;
  })();

  /**
   * Les sources, commentaires retirés. Ce qui sépare un APPEL d'une MENTION n'est
   * pas la forme du chemin — un script est aussi bien lancé par `spawn`, importé,
   * ou nommé dans une table que son lanceur parcourt (`readdirSync` + liste
   * attendue) — mais la NATURE du fichier qui le nomme : un nom écrit dans un
   * source exécutable y est pour servir ; un nom écrit dans une page est de la
   * prose. Exiger une invocation adjacente accusait 39 juges parfaitement vivants,
   * dont le chemin est assemblé dans une constante et lancé dix lignes plus loin.
   */
  const sourcesNettoyees = new Map(
    [...sourcesByPath].map(([chemin, src]) => [chemin, sansCommentaires(src)]),
  );

  /**
   * TOUS les automates qui lancent ce script, dans l'ordre de priorité — vide
   * quand personne ne le fait : le script peut alors être parfaitement
   * documenté, il n'en est pas exécuté pour autant.
   *
   * @param {string} p - chemin du script, tel que collecté.
   * @returns {{ label: string, name: string }[]} `label` dit la nature de
   *   l'automate (« un script npm »…), `name` le désigne (`test:all`, `pages.yml`…).
   */
  function appelants(p) {
    const k = cle(p);
    const base = k.split("/").pop();
    const out = [];
    const nom = (chemin) => chemin.split("/").pop();
    for (const [n, v] of scriptsNpm)
      if (v.includes(k) || v.includes(base))
        out.push({ label: "un script npm", name: `npm run ${n}` });
    for (const [f, src] of forge)
      if (src.includes(k) || src.includes(base))
        out.push({ label: "un étage de forge", name: nom(f) });
    for (const [f, src] of hooks)
      if (src.includes(k))
        out.push({ label: "un hook (git ou agent)", name: f });
    for (const [f, src] of testsProduit)
      if (resoluPar(src, k)) out.push({ label: "un test du produit", name: f });
    for (const f of importsDuDepot.get(
      k.replace(/\.(?:ts|mts|mjs|js)$/u, ""),
    ) ?? [])
      out.push({ label: "un import du dépôt", name: f });
    // 🔴 Un runner de tests prend un DOSSIER, pas une liste de fichiers.
    // `vitest run scripts/release/` lance tout ce qui s'y termine en `.test.*` —
    // et ce contrôle, qui cherchait un nom de fichier, déclarait ces tests
    // « exécutés par aucun automate ». Trois l'étaient à tort, dont deux depuis
    // des semaines : un faux orphelin fait retirer ou recâbler du code vivant, et
    // surtout il apprend à ne plus croire la liste.
    //
    // La reconnaissance est BORNÉE aux fichiers de test, et c'est ce qui la rend
    // sûre : une cible-dossier ne blanchit pas les outils qui vivent à côté
    // (`pack-all.mjs`, `fix-dts-extensions.mjs`), qu'aucun runner ne ramasse.
    if (/\.test\.[cm]?[jt]sx?$/u.test(base)) {
      const dossier = k.slice(0, k.lastIndexOf("/") + 1);
      // Le dossier doit être un ARGUMENT entier (`vitest run scripts/gates`),
      // pas une sous-chaîne : `node scripts/gates/size-check.mjs` contient
      // `scripts/gates/` sans lancer aucun test du dossier.
      const cible = new RegExp(
        `(?:^|\\s)${dossier.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?(?=\\s|$)`,
        "mu",
      );
      if (dossier) {
        for (const [n, v] of scriptsNpm)
          if (cible.test(v))
            out.push({
              label: "un script npm (cible-dossier)",
              name: `npm run ${n}`,
            });
        for (const [f, src] of forge)
          if (cible.test(src))
            out.push({
              label: "un étage de forge (cible-dossier)",
              name: nom(f),
            });
      }
    }
    // Le nom précédé d'un séparateur ou d'un délimiteur de chaîne : sans cette
    // frontière, `index.mjs` se croit appelé par tout le dépôt.
    for (const [autre, src] of sourcesNettoyees) {
      if (cle(autre) === k) continue;
      if (
        src.includes(`/${base}`) ||
        src.includes(`"${base}`) ||
        src.includes(`'${base}`) ||
        src.includes(`\`${base}`)
      )
        out.push({
          label: `un autre script (${nom(cle(autre))})`,
          name: cle(autre),
        });
    }
    return out;
  }

  /**
   * Quel automate lance ce script ? `null` quand personne ne le fait.
   *
   * @param {string} p - chemin du script, tel que collecté.
   * @returns {string|null} le nom de l'automate, ou `null` si aucun.
   */
  const automateQuiLance = (p) => appelants(p)[0]?.label ?? null;

  return { appelants, automateQuiLance };
}
