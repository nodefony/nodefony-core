#!/usr/bin/env node
/**
 * check-licenses — DÉLÈGUE à la commande du produit, et ne décide plus rien.
 *
 * La règle — quelles licences sont acceptables, comment l'arbre est relevé, ce
 * qui n'est pas couvert — vit désormais dans le CŒUR (`nodefony`,
 * `src/cli/licenses.ts`), exposée par `nodefony licenses`. Deux raisons, et la
 * seconde est celle qui a fait bouger le code :
 *
 * 1. **Une règle, une implémentation.** Ce script et la commande auraient
 *    divergé au premier ajout à la liste d'acceptation, chacun passant ses
 *    propres contrôles.
 * 2. **L'utilisateur a le même besoin que nous.** Une application générée
 *    redistribue une cinquantaine de paquets tiers et doit pouvoir dire
 *    lesquels, sous quelle licence — or elle n'a pas le dossier `scripts/` de ce
 *    dépôt. Ce qui vaut pour elle vit dans le PRODUIT, jamais dans l'outillage.
 *
 * Ce fichier reste pour que `npm run check:licenses` continue de fonctionner —
 * et parce que le dépôt doit CONSOMMER la commande qu'il livre.
 *
 * @usage    node scripts/check-licenses.mjs [--json] [--cwd <dir>]
 * @output   celle de `nodefony licenses`, verbatim, avec son code de sortie
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "src", "nodefony", "bin", "nodefony");

const run = spawnSync(
  process.execPath,
  [BIN, "licenses", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(run.status ?? 1);
