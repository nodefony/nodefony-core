#!/usr/bin/env node
/**
 * Auto-contrôle de la REMONTÉE de preuve depuis la forge.
 *
 * 🔴 Le trou qu'il ferme. Les fichiers de preuve d'un job rouge sont nommés à
 * DEUX endroits — le script les écrit (`echec.log`, `report.json`,
 * `conformite.json`, le journal du serveur détaché), le workflow les copie puis
 * les dépose — et rien ne tenait les deux listes ensemble. Une divergence ne
 * fait échouer aucun job : elle se manifeste le jour où quelqu'un télécharge
 * l'objet déposé pour comprendre un rouge, et n'y trouve pas ce qu'il cherche.
 * C'est-à-dire au pire moment, et sans que rien n'ait prévenu.
 *
 * Ce qu'il vérifie, sur le YAML réel :
 *
 * 1. tout ce que les étapes de récupération COPIENT porte un chemin que le banc
 *    écrit réellement — pas un nom voisin, pas un nom d'hier ;
 * 2. tout fichier ainsi produit est LISTÉ dans le `path:` d'un dépôt d'objet du
 *    même job — copier sans déposer ne laisse rien au lecteur ;
 * 3. chaque étape de remontée porte `if: failure()`. Sans cette condition,
 *    l'objet est déposé à chaque passe : le contrôle « l'artefact existe » est
 *    alors vert en permanence et ne prouve plus rien d'un job ROUGE.
 *
 * `--prove` retire un fichier du dépôt : les cas correspondants doivent tomber.
 *
 * Usage :
 *   node lib/artefacts-forge.selftest.mjs
 *   node lib/artefacts-forge.selftest.mjs --prove
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `yaml` n'est pas une dépendance DÉCLARÉE du dépôt : il arrive par transitivité
// (vite, lint-staged, typedoc). Le jour où aucun de ces trois ne l'amène plus,
// l'import échoue — et un contrôle qui disparaît en silence est exactement ce
// que ce banc combat. On S'ABSTIENT donc bruyamment (code 2), on ne rend pas
// vert. Écrire un lecteur de YAML maison serait pire : un parseur approximatif
// rend des verdicts approximatifs sur un fichier qu'on ne relit jamais.
let yaml;
try {
  yaml = (await import("yaml")).default;
} catch {
  process.stdout.write(
    "⚠️  ABSTENTION — le module `yaml` est introuvable.\n" +
      "   Il n'est pas déclaré dans package.json : ce contrôle en dépend et ne\n" +
      "   peut pas juger. Le déclarer en devDependency, ou lui donner un lecteur.\n",
  );
  process.exit(2);
}

const PROVE = process.argv.includes("--prove");
const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "../../../../..");
const WORKFLOW = path.join(RACINE, ".github/workflows/scaffold.yml");

/**
 * Les fichiers de preuve que les bancs écrivent DANS le décor, et qui les
 * écrit. Cette table est le seul endroit où la liste est tenue à la main : les
 * cas ci-dessous la confrontent au source, pour qu'elle ne puisse pas dériver
 * en silence à son tour.
 */
const ECRITS = [
  { fichier: "echec.log", source: "scripts/verify-generated.mjs" },
  { fichier: "report.json", source: "scripts/verify-generated.mjs" },
  { fichier: "conformite.json", source: "scripts/verify-runtime.mjs" },
];

const doc = yaml.parse(readFileSync(WORKFLOW, "utf8"));

/** Les étapes d'un job, à plat. */
const etapes = (job) => doc.jobs[job]?.steps ?? [];

/** Les fichiers listés dans les `path:` des dépôts d'objets d'un job. */
function deposes(job) {
  const noms = new Set();
  for (const e of etapes(job)) {
    if (!String(e.uses ?? "").startsWith("actions/upload-artifact")) continue;
    for (const l of String(e.with?.path ?? "").split("\n")) {
      const n = l.trim();
      if (n) noms.add(n);
    }
  }
  // La mutation retire UN fichier du dépôt — sans toucher au disque : ce que le
  // contrôle éprouve est la cohérence, pas la capacité à écrire un YAML.
  if (PROVE) noms.delete("echec-commande.log");
  return noms;
}

/**
 * Les couples `['<dans le décor>', '<nom déposé>']` que les étapes de
 * récupération déroulent — c'est sous cette forme que le workflow les écrit.
 */
function couples(job) {
  const paires = [];
  for (const e of etapes(job)) {
    const script = String(e.run ?? "");
    // ⚠️ Seuls les tableaux DÉSTRUCTURÉS en paire sont des couples. Une simple
    // liste de fichiers à lire (`for (const rel of ['a.ts', 'b.json'])`) a la
    // même forme littérale et n'a rien d'un couple source→cible : la prendre
    // pour telle faisait accuser deux fichiers de l'application témoin de ne
    // pas être déposés.
    for (const bloc of script.matchAll(
      /for\s*\(\s*const\s*\[[^\]]+\]\s*of\s*\[([\s\S]*?)\]\s*\)/gu,
    ))
      for (const m of bloc[1].matchAll(
        /\[\s*'([\w.\-/]+)',\s*'([\w.\-/]+)'\s*\]/gu,
      ))
        paires.push([m[1], m[2]]);
  }
  return paires;
}

/** Les cibles que les étapes de récupération PRODUISENT dans le dossier de travail. */
function copiees(job) {
  const noms = new Set(couples(job).map(([, cible]) => cible));
  for (const e of etapes(job)) {
    const script = String(e.run ?? "");
    for (const m of script.matchAll(/copyFileSync\([^,]+,\s*'([^']+)'\)/gu))
      noms.add(m[1]);
    for (const m of script.matchAll(/writeFileSync\('([^']+)'/gu))
      noms.add(m[1]);
    // Un journal composé au shell (`>> fichier.log`) compte autant qu'une copie.
    for (const m of script.matchAll(/>>\s*([\w.-]+\.log)\b/gu)) noms.add(m[1]);
  }
  return noms;
}

/**
 * Les fichiers que les étapes vont CHERCHER dans le décor : le premier membre
 * de chaque couple, plus les chemins composés littéralement (`path.join(app,
 * 'tmp', 'nodefony-detached.log')`).
 */
function cherches(job) {
  const noms = new Set(couples(job).map(([source]) => source));
  for (const e of etapes(job))
    for (const m of String(e.run ?? "").matchAll(
      /path\.join\([^)]*?'([\w.-]+\.(?:log|json))'\s*\)/gu,
    ))
      noms.add(m[1]);
  return noms;
}

const JOBS = ["generated", "dialectes"];
const cas = [];

for (const job of JOBS) {
  const dep = deposes(job);
  const cop = copiees(job);
  const che = cherches(job);

  cas.push({
    quoi: `[${job}] tout fichier produit par la récupération est DÉPOSÉ`,
    calcul: () => [...cop].filter((n) => !dep.has(n)),
    attenduVide: true,
  });

  cas.push({
    quoi: `[${job}] toute étape de remontée est conditionnée à l'ÉCHEC`,
    calcul: () =>
      etapes(job)
        .filter(
          (e) =>
            String(e.uses ?? "").startsWith("actions/upload-artifact") ||
            /copyFileSync|docker logs/u.test(String(e.run ?? "")),
        )
        .filter((e) => String(e.if ?? "") !== "failure()")
        .map((e) => e.name),
    attenduVide: true,
  });

  cas.push({
    quoi: `[${job}] les fichiers cherchés dans le décor sont ceux que le banc ÉCRIT`,
    calcul: () =>
      [...che].filter(
        (n) =>
          !ECRITS.some((e) => e.fichier === n) &&
          // Le journal du serveur détaché est écrit par le PRODUIT, pas par un
          // banc : il est légitimement cherché sans figurer dans `ECRITS`.
          n !== "nodefony-detached.log",
      ),
    attenduVide: true,
  });
}

// La table `ECRITS` doit elle-même dire vrai du code : sinon on contrôle une
// liste contre une autre liste, et les deux peuvent avoir tort ensemble.
cas.push({
  quoi: "chaque fichier de preuve déclaré est bien écrit par son banc",
  calcul: () =>
    ECRITS.filter(({ fichier, source }) => {
      const src = readFileSync(
        path.join(ICI, "..", path.basename(source)),
        "utf8",
      );
      return !src.includes(`"${fichier}"`);
    }).map((e) => `${e.fichier} absent de ${e.source}`),
  attenduVide: true,
});

// Le journal des serveurs de base : c'est la pièce qui manquait, et elle ne
// concerne que le job où des conteneurs tournent.
cas.push({
  quoi: "[dialectes] le journal des conteneurs de base est déposé",
  calcul: () => (deposes("dialectes").has("services-db.log") ? [] : ["absent"]),
  attenduVide: true,
});

let verts = 0;
let rouges = 0;
for (const c of cas) {
  const restes = c.calcul();
  const ok = restes.length === 0;
  if (ok) verts += 1;
  else rouges += 1;
  process.stdout.write(
    `  ${ok ? "✅" : "❌"} ${c.quoi}${ok ? "" : ` → ${restes.join(", ")}`}\n`,
  );
}

if (PROVE) {
  const attendus = 2;
  if (rouges < attendus) {
    process.stdout.write(
      `\n❌ un fichier retiré du dépôt : ${rouges} cas tombé(s), ${attendus} attendus — ` +
        `le contrôle ne relie pas la copie au dépôt\n`,
    );
    process.exit(2);
  }
  process.stdout.write(
    `\n✅ un fichier retiré du dépôt fait tomber ${rouges} cas — le lien tient\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `\n━━ ${verts}/${cas.length} : la preuve d'un job rouge est récupérable\n`,
);
process.exit(rouges === 0 ? 0 : 1);
