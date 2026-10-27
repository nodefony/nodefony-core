import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SqlDialect } from "../../config/config";
import { readJournal, readSnapshot } from "./adopt";
import { writeCustomMigration } from "./appSchema";
import {
  applyRenames,
  missingRenameTargets,
  prependStatements,
  type IRenamePlan,
  type IRenamedSnapshot,
} from "./renames";

/**
 * Les renommages déclarés, sur le DISQUE : préparer l'instantané réécrit, le
 * poser le temps de la génération, compléter la migration écrite.
 *
 * Séparé de `renames.ts` (pur) parce que ce sont des I/O, et de la commande
 * parce que le banc de schéma réel et le corpus `erp-lite` doivent produire
 * leur migration v1 → v2 par CE code, pas par une copie : un banc qui
 * renommerait à sa façon prouverait sa façon.
 */

/** Un renommage préparé : l'instantané à réécrire, et de quoi le restituer. */
export interface IPreparedRenames {
  plan: IRenamePlan;
  /** Le dernier instantané du dossier — celui que l'outil compare. */
  file: string;
  /** Son contenu d'origine, octet pour octet — restitué quoi qu'il arrive. */
  raw: string;
  applied: IRenamedSnapshot;
}

/**
 * Prépare les renommages sur le DERNIER instantané du dossier — celui contre
 * lequel l'outil calcule son écart. Rien n'est écrit.
 *
 * @param outDir - dossier `<migrations>/<dialecte>`.
 * @param plan - les renommages déclarés.
 * @param dialect - le moteur, pour la forme des instructions.
 * @returns le renommage prêt, ou la liste de ce qui l'empêche.
 */
export async function prepareRenames(
  outDir: string,
  plan: IRenamePlan,
  dialect: SqlDialect,
): Promise<IPreparedRenames | string[]> {
  const meta = path.join(outDir, "meta");
  const snapshots = (await fs.readdir(meta).catch(() => []))
    .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
    .sort();
  const last = snapshots.at(-1);
  if (last === undefined) {
    return [
      "aucune migration n'a encore été générée : la première crée les tables sous leur nom, il n'y a rien à renommer",
    ];
  }
  const file = path.join(meta, last);
  const raw = await fs.readFile(file, "utf8");
  const applied = applyRenames(await readSnapshot(file), plan, dialect);
  if (applied.problems.length > 0) {
    return applied.problems;
  }
  return { plan, file, raw, applied };
}

/**
 * Pose l'instantané réécrit le temps de `generate`, puis restitue l'original
 * OCTET POUR OCTET — succès, échec ou exception : ce fichier est versionné, et
 * il décrit ce que les bases ont déjà reçu.
 *
 * @param prepared - le renommage préparé.
 * @param generate - la génération (l'outil lit l'instantané réécrit).
 * @returns ce que rend `generate`.
 */
export async function withRewrittenSnapshot<T>(
  prepared: IPreparedRenames,
  generate: () => T | Promise<T>,
): Promise<T> {
  await fs.writeFile(
    prepared.file,
    `${JSON.stringify(prepared.applied.doc, null, 2)}\n`,
    "utf8",
  );
  try {
    return await generate();
  } finally {
    await fs.writeFile(prepared.file, prepared.raw, "utf8");
  }
}

/**
 * Écrit les renommages dans la migration de ce run.
 *
 * Deux cas. L'outil a écrit une migration : les renommages passent en TÊTE
 * (tout ce qu'il a écrit emploie déjà les nouveaux noms), et son instantané
 * reçoit le `_meta` qu'une réponse « renamed » y aurait mis. L'outil n'a RIEN
 * écrit — le renommage était le seul changement, et il ne le voit plus — : la
 * migration est écrite ici, avec l'instantané réécrit pour état d'arrivée,
 * faute de quoi la génération suivante reproposerait le renommage.
 *
 * Appelé AVANT le scellement (`sealGeneratedSql`) : le fichier de l'outil est
 * encore brut.
 *
 * @param outDir - dossier `<migrations>/<dialecte>`.
 * @param dialect - le moteur.
 * @param name - nom de la migration (renommage seul).
 * @param added - tags écrits par l'outil pendant ce run.
 * @param prepared - le renommage préparé.
 * @returns les tags de ce run, ou les cibles absentes (rien n'est alors gardé).
 */
export async function completeRenames(
  outDir: string,
  dialect: SqlDialect,
  name: string,
  added: readonly string[],
  prepared: IPreparedRenames,
): Promise<{ tags: string[]; missing: string[] }> {
  const { applied, plan } = prepared;
  const meta = { schemas: {}, ...applied.meta };
  const tag = added.at(-1);
  if (tag === undefined) {
    const written = await writeCustomMigration({
      outDir,
      dialect,
      name,
      body: prependStatements("", applied.statements),
      snapshot: {
        ...applied.doc,
        id: randomUUID(),
        prevId: applied.doc.id,
        _meta: meta,
      },
    });
    return { tags: [written.tag], missing: [] };
  }
  const sqlFile = path.join(outDir, `${tag}.sql`);
  const snapshotFile = path.join(
    outDir,
    "meta",
    `${tag.slice(0, 4)}_snapshot.json`,
  );
  const snapshot = await readSnapshot(snapshotFile);
  const missing = missingRenameTargets(snapshot, plan);
  if (missing.length > 0) {
    // Écrits par CE run, jamais appliqués nulle part : les retirer est sûr, et
    // les garder laisserait au journal une migration qui renomme puis supprime.
    await forgetTag(outDir, tag, [sqlFile, snapshotFile]);
    return { tags: [], missing };
  }
  const sql = await fs.readFile(sqlFile, "utf8");
  await fs.writeFile(
    sqlFile,
    prependStatements(sql, applied.statements),
    "utf8",
  );
  await fs.writeFile(
    snapshotFile,
    `${JSON.stringify({ ...snapshot, _meta: meta }, null, 2)}\n`,
    "utf8",
  );
  return { tags: [...added], missing: [] };
}

/** Retire du journal et du disque une migration écrite par CE run. */
async function forgetTag(
  outDir: string,
  tag: string,
  files: readonly string[],
): Promise<void> {
  const journal = await readJournal(outDir);
  if (journal !== null) {
    await fs.writeFile(
      path.join(outDir, "meta", "_journal.json"),
      `${JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.tag !== tag) }, null, 2)}\n`,
      "utf8",
    );
  }
  await Promise.all(files.map((f) => fs.rm(f, { force: true })));
}
