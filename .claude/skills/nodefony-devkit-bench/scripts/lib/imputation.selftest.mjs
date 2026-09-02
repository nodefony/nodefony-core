#!/usr/bin/env node
/**
 * Auto-contrôle du classement des causes — AVANT qu'il ne serve à juger.
 *
 * `imputation.mjs` décide si le rouge d'un juge condamne l'agent ou écarte le
 * run. Une table posée à distance du code qui l'alimente dérive : un juge neuf
 * arrive avec ses causes, personne ne les classe, et elles tombent dans le trou.
 * Ce contrôle referme les deux sens à la fois :
 *
 * - **cause émise, jamais classée** — le banc s'abstiendrait sans le dire ;
 * - **entrée classée, plus jamais émise** — reliquat d'un juge supprimé ou
 *   d'une cause renommée, qui donne l'illusion d'une couverture.
 *
 * Aucun agent lancé, aucun décor monté : une lecture des sources et quelques
 * cas figés, en une seconde.
 *
 * ```bash
 * node lib/imputation.selftest.mjs
 * node lib/imputation.selftest.mjs --prove   # les contrôles mordent-ils ?
 * ```
 *
 * Sorties : `0` classement complet et contrôles mordants · `1` un contrôle
 * MENT ou une cause est mal lue · `2` couverture incomplète, causes nommées.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT,
  DECOR,
  INDETERMINE,
  IMPUTATIONS,
  estOpposable,
  imputationDe,
  lireCause,
} from "./imputation.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));

/**
 * Toutes les causes ÉCRITES dans les juges, relevées à la source.
 *
 * On scanne le dossier plutôt qu'une liste de fichiers : un juge neuf entre
 * dans le contrôle sans qu'on ait à l'y inscrire — c'est justement l'oubli
 * qu'on cherche à rendre impossible. `imputation.mjs` s'exclut lui-même : sa
 * documentation cite le format.
 *
 * @returns {Map<string, string[]>} cause → fichiers qui l'émettent.
 */
function causesEmises() {
  const trouvees = new Map();
  for (const nom of readdirSync(ICI).sort()) {
    if (!nom.endsWith(".mjs")) continue;
    if (nom.endsWith(".selftest.mjs") || nom === "imputation.mjs") continue;
    const source = readFileSync(path.join(ICI, nom), "utf8");
    // 🔴 DEUX grammaires, et n'en lire qu'une a rendu ce contrôle aveugle sur
    // trois juges entiers pendant qu'il affichait un compte rassurant. Un juge
    // de la première génération IMPRIME lui-même `CAUSE=<nom>` ; un juge qui
    // sépare la collecte du verdict REND `{ cause: "<nom>" }` et laisse
    // l'impression à l'appelant — sa source ne porte alors jamais `CAUSE=`.
    // Balayer le dossier ne suffit donc pas : c'est la FORME écrite qui décide
    // de ce qu'on voit.
    for (const m of source.matchAll(
      /CAUSE=([a-z0-9-]+)|\bcause:\s*"([a-z0-9-]+)"/gu,
    )) {
      const cause = m[1] ?? m[2];
      // `conforme` est le VERT. Le banc ne consulte l'imputation que sur un
      // rouge (`!pass && cause`) : la classer n'aurait aucun sens.
      if (cause === "conforme") continue;
      const liste = trouvees.get(cause) ?? [];
      if (!liste.includes(nom)) liste.push(nom);
      trouvees.set(cause, liste);
    }
  }
  return trouvees;
}

/**
 * Les deux écarts entre ce que les juges émettent et ce que la table classe.
 *
 * Fonction PURE, table passée en argument : c'est ce qui permet à `--prove` de
 * la muter sur une COPIE pour vérifier que le contrôle mord, sans jamais
 * toucher au dépôt.
 *
 * @param {Map<string, string[]>} emises
 * @param {Record<string, string>} table
 * @returns {{nonClassees: string[], mortes: string[]}}
 */
export function ecarts(emises, table) {
  const nonClassees = [...emises.keys()]
    .filter((c) => !Object.hasOwn(table, c))
    .sort();
  const mortes = Object.keys(table)
    .filter((c) => !emises.has(c))
    .sort();
  return { nonClassees, mortes };
}

/** Lecteur AMPUTÉ — prend la ligne entière pour un nom de cause. */
const lecteurNaif = (sortie) => {
  const ligne = (sortie ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("CAUSE="));
  return ligne ? ligne.slice("CAUSE=".length) : null;
};

/**
 * Cas figés de lecture d'une sortie de juge.
 *
 * Ils portent les formes RÉELLEMENT écrites par les juges : tiret cadratin
 * après le nom, cause seule, ligne noyée dans du texte, sortie muette.
 */
const CAS_LECTURE = [
  {
    label: "nom suivi du tiret cadratin",
    sortie: "CAUSE=route-absente — GET /api/x rend 404\n",
    nom: "route-absente",
  },
  {
    label: "nom seul, sans phrase",
    sortie: "CAUSE=charge-tout\n",
    nom: "charge-tout",
  },
  {
    label: "ligne précédée d'autre chose",
    sortie: "bruit du décor\nCAUSE=session-semee — un cookie est posé\nfin\n",
    nom: "session-semee",
  },
  {
    label: "ligne indentée",
    sortie: "   CAUSE=port-deja-tenu — le port 5151 répond\n",
    nom: "port-deja-tenu",
  },
  {
    label: "evidence d'un run déjà joué (cause en milieu de ligne)",
    sortie: "exit 4 — CAUSE=aucune-reponse — GET /api/x n'obtient rien",
    nom: "aucune-reponse",
  },
  {
    label: "gate générique — aucune cause nommée",
    sortie: "exit 1\nnpm test a échoué\n",
    nom: null,
  },
];

function main() {
  const prove = process.argv.includes("--prove");
  const defauts = [];
  const emises = causesEmises();

  // ─── 1. Le classement couvre-t-il ce que les juges émettent ? ─────────────
  const { nonClassees, mortes } = ecarts(emises, IMPUTATIONS);
  for (const c of mortes) {
    defauts.push(
      `entrée MORTE : « ${c} » est classée mais plus aucun juge ne l'émet`,
    );
  }

  // ─── 2. La lecture d'une sortie de juge ───────────────────────────────────
  for (const cas of CAS_LECTURE) {
    const lu = lireCause(cas.sortie);
    const nom = lu?.nom ?? null;
    if (nom !== cas.nom) {
      defauts.push(
        `lecture « ${cas.label} » : attendu ${cas.nom ?? "aucune cause"}, obtenu ${nom ?? "aucune cause"}`,
      );
    }
  }

  // ─── 3. Seule une faute d'agent est opposable ─────────────────────────────
  const attendus = [
    [AGENT, true],
    [DECOR, false],
    [INDETERMINE, false],
    [null, false],
  ];
  for (const [imputation, attendu] of attendus) {
    if (estOpposable(imputation) !== attendu) {
      defauts.push(
        `opposabilité de « ${imputation ?? "cause inconnue"} » : attendu ${attendu}`,
      );
    }
  }
  // Une cause absente de la table ne condamne PAS : c'est ce qui garantit que
  // l'oubli produit une abstention bruyante, jamais une accusation muette.
  if (imputationDe("cause-qui-nexiste-pas") !== null) {
    defauts.push("une cause inconnue devrait rendre `null`");
  }

  // ─── 4. Les contrôles mordent-ils ? ───────────────────────────────────────
  if (prove) {
    const premiere = Object.keys(IMPUTATIONS)[0];
    const amputee = { ...IMPUTATIONS };
    delete amputee[premiere];
    if (!ecarts(emises, amputee).nonClassees.includes(premiere)) {
      defauts.push(
        `--prove : « ${premiere} » retirée de la table, le contrôle reste vert`,
      );
    }
    const polluee = { ...IMPUTATIONS, "cause-jamais-emise": AGENT };
    if (!ecarts(emises, polluee).mortes.includes("cause-jamais-emise")) {
      defauts.push(
        "--prove : une entrée morte ajoutée, le contrôle reste vert",
      );
    }
    const rate = CAS_LECTURE.filter((c) => c.nom !== null).some(
      (c) => lecteurNaif(c.sortie) !== c.nom,
    );
    if (!rate) {
      defauts.push(
        "--prove : un lecteur amputé passe tous les cas — ils ne l'exercent pas",
      );
    }
  }

  for (const d of defauts) console.log(`  ✗ ${d}`);
  for (const c of nonClassees) {
    console.log(
      `  ⚠ non classée : ${c} (émise par ${emises.get(c).join(", ")})`,
    );
  }

  const parImputation = (valeur) =>
    Object.values(IMPUTATIONS).filter((v) => v === valeur).length;
  console.log(
    `\n━━ ${emises.size} cause(s) émise(s), ${Object.keys(IMPUTATIONS).length} classée(s) : ` +
      `${parImputation(AGENT)} agent · ${parImputation(DECOR)} décor · ` +
      `${parImputation(INDETERMINE)} indéterminé` +
      (prove ? " — mutation vérifiée" : "") +
      (defauts.length ? `, ${defauts.length} DÉFAUT(S)` : ""),
  );

  if (defauts.length > 0) return 1;
  if (nonClassees.length > 0) {
    console.log(
      `(${nonClassees.length} cause(s) sans imputation — le banc s'abstiendrait sur elles)`,
    );
    return 2;
  }
  return 0;
}

process.exit(main());
