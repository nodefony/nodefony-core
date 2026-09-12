/**
 * Auto-contrôle du socle de la tâche 0.
 *
 * `--prove` ampute les règles une à une et EXIGE que des cas tombent : un
 * auto-contrôle qu'on n'a jamais vu échouer ne prouve rien. Les mutations
 * visent ce qui a déjà coûté un faux verdict ailleurs dans ce banc — supposer
 * un chemin, lire une plage de version au lieu de la version résolue, laisser
 * `node_modules` entrer dans une recherche.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Le module éprouvé est paramétrable : `--prove` relance CE MÊME fichier sur
// des copies mutées. Une seule liste de cas, donc — la faire diverger ferait
// « prouver » à la mutation un contrôle qui n'est pas celui qu'on exécute.
// Même patron que `reference.selftest.mjs` : une règle, une implémentation.
const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./tache-zero.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const {
  canalDe,
  commandeCreation,
  registreLocalRequis,
  resoudreAppGeneree,
  versionInstallee,
  situerTours,
  REFERENCE_CONCURRENTE,
  PORTES_CLIENT,
  porteClientDe,
  motifPorteClient,
} = await import(MODULE);

const PROVE = process.argv.includes("--prove") && MODULE === "./tache-zero.mjs";
let verts = 0;
const rouges = [];

/**
 * @param {string} nom - ce qu'on affirme.
 * @param {boolean} condition - le fait.
 */
function cas(nom, condition) {
  if (condition) verts += 1;
  else rouges.push(nom);
}

/**
 * Un faux système de fichiers — l'injection rend la règle éprouvable sans décor.
 *
 * @param {Record<string, object|null>} paquets - chemin → package.json (ou null).
 * @param {Record<string, string[]>} dossiers - chemin → sous-dossiers.
 */
function io(paquets, dossiers = {}) {
  return {
    lirePackage: (d) => paquets[d] ?? null,
    listerDossiers: (d) => dossiers[d] ?? [],
  };
}

// ── canalDe ──────────────────────────────────────────────────────────────────
cas("canal par défaut = alpha", canalDe({}) === "alpha");
cas(
  "canal explicite respecté",
  canalDe({ NF_DEVKIT_BENCH_CANAL: "latest" }) === "latest",
);
// Une campagne doit pouvoir se rejouer sur CHAQUE version installable.
for (const e of ["alpha", "beta", "latest", "local"]) {
  cas(
    `étiquette « ${e} » acceptée`,
    canalDe({ NF_DEVKIT_BENCH_CANAL: e }) === e,
  );
}
// La version EXACTE est la seule forme REJOUABLE : `latest` d'aujourd'hui n'est
// pas celui du mois prochain, et une mesure qui ne cite qu'une étiquette ne se
// rejoue pas.
for (const v of ["10.0.0", "10.0.0-alpha.5", "10.1.0-beta.2"]) {
  cas(
    `version exacte « ${v} » acceptée`,
    canalDe({ NF_DEVKIT_BENCH_CANAL: v }) === v,
  );
}
cas(
  "la commande porte la version exacte",
  commandeCreation("10.0.0-alpha.5") === "npm create nodefony@10.0.0-alpha.5",
);
cas(
  "seul « local » exige un registre interposé",
  registreLocalRequis("local") === true &&
    registreLocalRequis("alpha") === false &&
    registreLocalRequis("10.0.0") === false,
);
{
  // Une version mal formée doit LEVER : npm servirait sinon autre chose.
  let leve = false;
  try {
    canalDe({ NF_DEVKIT_BENCH_CANAL: "10.0" });
  } catch {
    leve = true;
  }
  cas("une version tronquée LÈVE", leve);
}
{
  // Un canal mal orthographié servirait la version 7 depuis npm, en silence.
  let leve = false;
  try {
    canalDe({ NF_DEVKIT_BENCH_CANAL: "aplha" });
  } catch {
    leve = true;
  }
  cas("un canal inconnu LÈVE (sinon npm sert la version 7)", leve);
}

// ── commandeCreation ─────────────────────────────────────────────────────────
cas(
  "la commande porte le canal",
  commandeCreation("alpha") === "npm create nodefony@alpha" &&
    commandeCreation("latest") === "npm create nodefony@latest",
);

// ── resoudreAppGeneree ───────────────────────────────────────────────────────
const APP = { dependencies: { nodefony: "10.0.0-alpha.5" } };

cas(
  "app créée dans un SOUS-dossier au nom libre",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io({ "/vide/ma-messagerie": APP }, { "/vide": ["ma-messagerie"] }),
    );
    return r.ok && r.dir === "/vide/ma-messagerie";
  })(),
);

cas(
  "app créée DANS le dossier courant (--dir .)",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io({ "/vide": APP }, { "/vide": [] }),
    );
    return r.ok && r.dir === "/vide";
  })(),
);

cas(
  "aucune application ⇒ cause nommée, pas une exception",
  (() => {
    const r = resoudreAppGeneree("/vide", io({}, { "/vide": ["notes"] }));
    return !r.ok && r.cause === "aucune-application";
  })(),
);

cas(
  "deux candidats ⇒ NON jugée plutôt que devinée",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io({ "/vide/a": APP, "/vide/b": APP }, { "/vide": ["a", "b"] }),
    );
    return !r.ok && r.cause === "application-ambigue";
  })(),
);

cas(
  "node_modules ne peut pas passer pour l'application",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io(
        { "/vide/node_modules": APP, "/vide/app": APP },
        { "/vide": ["node_modules", "app"] },
      ),
    );
    return r.ok && r.dir === "/vide/app";
  })(),
);

cas(
  "un dossier caché n'est pas un candidat",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io(
        { "/vide/.cache": APP, "/vide/app": APP },
        { "/vide": [".cache", "app"] },
      ),
    );
    return r.ok && r.dir === "/vide/app";
  })(),
);

cas(
  "une dépendance en devDependencies compte aussi",
  (() => {
    const r = resoudreAppGeneree(
      "/vide",
      io(
        { "/vide/app": { devDependencies: { nodefony: "10.0.0" } } },
        { "/vide": ["app"] },
      ),
    );
    return r.ok;
  })(),
);

// ── versionInstallee ─────────────────────────────────────────────────────────
cas(
  "version RÉSOLUE lue dans node_modules, pas la plage du manifeste",
  versionInstallee(
    "/app",
    io({
      "/app": { dependencies: { nodefony: "^10.0.0-alpha.5" } },
      "/app/node_modules/nodefony": { version: "10.0.0-alpha.5" },
    }),
  ) === "10.0.0-alpha.5",
);

cas(
  "version illisible ⇒ null, jamais une plage",
  versionInstallee(
    "/app",
    io({ "/app": { dependencies: { nodefony: "^10.0.0" } } }),
  ) === null,
);

// ── situerTours ──────────────────────────────────────────────────────────────
cas(
  "moins de tours que le concurrent se lit « MOINS »",
  situerTours(43).lecture.includes("MOINS"),
);
cas("plus de tours se lit « PLUS »", situerTours(120).lecture.includes("PLUS"));
cas(
  "la réserve accompagne TOUJOURS la comparaison",
  situerTours(43).lecture.includes("assistée") ||
    situerTours(43).lecture.includes("ASSISTÉE"),
);
cas(
  "tours non mesurés ⇒ pas de verdict inventé",
  situerTours(null).ecart === null,
);
cas(
  "la référence porte sa réserve et son transcript",
  REFERENCE_CONCURRENTE.relancesHumaines === 4 &&
    REFERENCE_CONCURRENTE.transcript.endsWith(".jsonl"),
);

// ── porteClientDe — le critère client suit le moteur CHOISI ─────────────────
for (const { moteur, marker, subpath } of PORTES_CLIENT) {
  cas(
    `moteur « ${moteur} » ⇒ porte ${subpath}`,
    (() => {
      const r = porteClientDe({ devDependencies: { [marker]: "1.0.0" } });
      return r.ok && r.moteur === moteur && r.subpath === subpath;
    })(),
  );
}

cas(
  "sans moteur front ⇒ la façade isomorphe de base, jamais « rien à exiger »",
  (() => {
    const r = porteClientDe({ dependencies: { nodefony: "10.0.0" } });
    return r.ok && r.moteur === "none" && r.subpath === "nodefony/client";
  })(),
);

cas(
  "deux moteurs signés ⇒ NON opposable plutôt que deviné",
  (() => {
    const r = porteClientDe({
      devDependencies: { react: "19.0.0", svelte: "5.0.0" },
    });
    return !r.ok && r.cause === "moteur-front-ambigu";
  })(),
);

cas(
  "manifeste illisible ⇒ cause nommée, pas une exception",
  porteClientDe(null).cause === "manifeste-illisible",
);

// 🔴 LE cas qui fonde la règle : une application SVELTE avec l'ancien critère
// React-centré rendait un FAUX ROUGE. C'est le moteur qu'a effectivement choisi
// l'agent du premier essai réel.
cas(
  "une app Svelte n'est PAS jugée au critère React",
  (() => {
    const r = porteClientDe({ devDependencies: { svelte: "5.0.0" } });
    const motif = motifPorteClient(r.subpath);
    return (
      motif.test('import { useChannel } from "nodefony/svelte";') &&
      !motif.test('import { useChannel } from "nodefony/react";')
    );
  })(),
);

cas(
  "la façade isomorphe elle-même reste acceptée, quel que soit le moteur",
  motifPorteClient("nodefony/vue").test("new RealtimeClient({ url })"),
);

// ── La table est une COPIE : la CONFRONTER au source du produit ─────────────
// Deux copies d'une règle divergent en silence, chacune passant ses propres
// tests. Ajouter un moteur à `FRONTEND_PARAMS` sans l'ajouter ici ferait juger
// une application avec un critère que le banc ne connaît pas — et rien ne le
// dirait. Le contrôle ne relit donc pas la table : il la compare.
{
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const engine = path.resolve(
    ici,
    "../../../../../src/nodefony/src/cli/scaffold/engine.ts",
  );
  if (!existsSync(engine)) {
    // Skill livré par npm sans le checkout : le DIRE, jamais compter vert.
    // Un contrôle qui ne peut pas mesurer doit se taire, pas se rassurer.
    console.log(
      "  ⚠️ source du produit absent — la table des portes clientes n'a PAS " +
        "été confrontée (skill hors checkout)",
    );
  } else {
    const src = readFileSync(engine, "utf8");
    // Chaque moteur du produit porte son bloc `client: { subpath, doc, marker }`.
    const duProduit = new Map();
    for (const m of src.matchAll(
      /subpath:\s*"([^"]+)"[\s\S]{0,200}?marker:\s*"([^"]+)"/gu,
    )) {
      duProduit.set(m[2], m[1]);
    }
    cas(
      "le source du produit a bien été LU (sinon la confrontation est vide)",
      duProduit.size >= 4,
    );
    const duBanc = new Map(PORTES_CLIENT.map((p) => [p.marker, p.subpath]));
    const manquants = [...duProduit.keys()].filter((k) => !duBanc.has(k));
    const surnumeraires = [...duBanc.keys()].filter((k) => !duProduit.has(k));
    cas(
      `aucun moteur du produit absent du banc (${manquants.join(", ") || "—"})`,
      manquants.length === 0,
    );
    cas(
      `aucun moteur inventé par le banc (${surnumeraires.join(", ") || "—"})`,
      surnumeraires.length === 0,
    );
    const divergents = [...duProduit.entries()].filter(
      ([marker, subpath]) =>
        duBanc.has(marker) && duBanc.get(marker) !== subpath,
    );
    cas(
      `aucune porte divergente (${divergents.map(([m]) => m).join(", ") || "—"})`,
      divergents.length === 0,
    );
  }
}

// ── --prove : MUTER le vrai module, et exiger que ce contrôle TOMBE ─────────
// Les mutations s'appliquent à une COPIE dans un répertoire temporaire : muter
// le fichier du dépôt le laisserait cassé à la première interruption.
if (PROVE) {
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(ici, "tache-zero.mjs"), "utf8");
  const mutations = [
    {
      // 🔴 LA LIGNE TÉMOIN — elle ne change RIEN, et le contrôle doit rester
      // VERT. Sans elle, une mutation qui « tombe » ne prouve pas qu'elle est
      // tombée pour SA règle : un module copié hors de son dossier ne résout
      // plus ses imports relatifs, sort en `ERR_MODULE_NOT_FOUND`, et toutes
      // les mutations passent alors pour probantes — y compris celle-ci.
      // C'est la panne qui a réellement eu lieu ici, et rien ne la disait.
      regle: "TÉMOIN — une mutation inoffensive ne fait tomber personne",
      de: " * @module",
      vers: " * @module (témoin)",
      temoin: true,
    },
    {
      // L'état exact d'un juge naïf : `node_modules` porte des centaines de
      // `package.json` dépendant de `nodefony` — le premier venu passerait pour
      // l'application de l'agent.
      regle: "node_modules et dossiers cachés écartés",
      de: '    if (sous === "node_modules" || sous.startsWith(".")) continue;\n',
      vers: "",
    },
    {
      // Deviner entre deux candidats, c'est juger le mauvais dossier — et le
      // verdict aurait l'aplomb d'une mesure.
      regle: "refus de trancher entre deux candidats",
      de: "  if (candidats.length > 1) {",
      vers: "  if (false) {",
    },
    {
      // Lire la plage du manifeste au lieu de la version résolue ferait
      // comparer deux runs séparés par une publication.
      regle: "version RÉSOLUE, pas la plage déclarée",
      de: "  const pkg = io.lirePackage(`${appDir}/node_modules/nodefony`);",
      vers: "  const pkg = io.lirePackage(appDir);",
    },
    {
      // Le critère React-centré, exactement : une app Svelte serait jugée sur
      // la porte de React et rendrait un FAUX ROUGE sur un travail juste.
      regle: "la porte cliente suit le moteur CHOISI",
      de: "  return { ok: true, moteur: signes[0].moteur, subpath: signes[0].subpath };",
      vers: '  return { ok: true, moteur: "react", subpath: "nodefony/react" };',
    },
    {
      // LE défaut que la confrontation existe pour attraper : un moteur ajouté
      // au produit et pas au banc. Sans elle, le banc jugerait une application
      // Svelte avec un critère qu'il ne connaît pas, et rien ne le dirait.
      regle: "la table du banc est confrontée au source du produit",
      // Le MARKER, pas le moteur : c'est lui que la confrontation compare —
      // il est le paquet qui SIGNE le moteur dans le manifeste. Muter le
      // libellé `moteur` ne faisait rien tomber, et la ligne témoin l'a dit.
      de: '    moteur: "svelte",\n    marker: "svelte",',
      vers: '    moteur: "svelte",\n    marker: "sveltejs",',
    },
    {
      // Deviner entre deux moteurs, c'est juger sur le mauvais critère.
      regle: "refus de trancher entre deux moteurs front",
      de: "  if (signes.length > 1) {",
      vers: "  if (false) {",
    },
    {
      // Sans la réserve, la comparaison surestime le concurrent : ses 86 tours
      // sont ASSISTÉS de 4 relances humaines.
      regle: "la réserve accompagne la comparaison des tours",
      de: "    lecture: `${lecture} (${REFERENCE_CONCURRENTE.reserve})`,",
      vers: "    lecture,",
    },
  ];

  // Les règles du CANAL et de la SOURCE ne sont plus mutées ici : elles ont
  // déménagé dans `decor-source.mjs`, qui porte son propre auto-contrôle. Muter
  // un module qui ne les porte plus rendrait une « mutation MORTE » — ce que ce
  // contrôle a signalé au moment du déménagement, au lieu de se taire.
  console.log(
    "\n━━ --prove : mutation de chaque règle (le contrôle doit TOMBER)",
  );
  // 🔴 La copie mutée vit À CÔTÉ du module, jamais dans un dossier temporaire
  // — pas même un sous-dossier de celui-ci.
  //
  // Un module qui importe un voisin en relatif (`./decor-source.mjs`) ne résout
  // plus rien ailleurs : Node sort en `ERR_MODULE_NOT_FOUND`, le code de retour
  // est non nul, et l'auto-contrôle compte « le contrôle tombe ». Toutes les
  // mutations passaient alors pour probantes — y compris une mutation
  // INOFFENSIVE, ce qui est la définition d'un contrôle qui ne garde rien.
  // Vécu ici même : le défaut est né avec l'extraction de `decor-source.mjs`,
  // et le commit qui l'a introduit annonçait « 9 mutations, toutes vues
  // tomber ». Elles tombaient, mais pas pour leur règle.
  //
  // C'est le patron que porte déjà le jumeau `gate-tache-zero.selftest.mjs` :
  // une règle, une implémentation. La copie est préfixée d'un point et retirée
  // juste après son verdict.
  const moi = fileURLToPath(import.meta.url);
  for (const m of mutations) {
    if (!source.includes(m.de)) {
      rouges.push(
        `[--prove] ancre introuvable pour « ${m.regle} » — mutation MORTE`,
      );
      continue;
    }
    const copie = path.join(
      ici,
      `.prove-tache-zero.${mutations.indexOf(m)}.mjs`,
    );
    writeFileSync(copie, source.replace(m.de, m.vers));
    const r = spawnSync(process.execPath, [moi, "--module", copie], {
      encoding: "utf8",
    });
    rmSync(copie, { force: true });
    // Le TÉMOIN attend l'inverse : rester vert. Un contrôle qui tombe sur une
    // mutation inoffensive tombe pour une autre raison que la règle qu'on
    // croit éprouver, et ses autres verdicts ne valent alors plus rien.
    const attenduVert = m.temoin === true;
    if ((r.status === 0) === attenduVert) {
      verts += 1;
      console.log(
        `  ✅ ${m.regle} — ${attenduVert ? "le contrôle reste vert" : "le contrôle tombe"}`,
      );
    } else if (attenduVert) {
      rouges.push(
        `[--prove] TÉMOIN tombé : les mutations ne prouvent PAS leur règle ` +
          `(${(r.stderr ?? "").split("\n")[0] || `exit ${r.status}`})`,
      );
      console.log(
        `  ❌ ${m.regle} — il tombe sans raison, les autres verdicts sont NULS`,
      );
    } else {
      rouges.push(`[--prove] « ${m.regle} » mutée : RIEN n'est tombé`);
      console.log(`  ❌ ${m.regle} — le contrôle reste vert, il ne garde rien`);
    }
  }
}

console.log(
  rouges.length === 0
    ? `✅ tache-zero.selftest — ${verts} cas${PROVE ? " (dont les amputations)" : ""}`
    : `❌ tache-zero.selftest — ${rouges.length} rouge(s) :\n   ${rouges.join("\n   ")}`,
);
process.exit(rouges.length === 0 ? 0 : 1);
