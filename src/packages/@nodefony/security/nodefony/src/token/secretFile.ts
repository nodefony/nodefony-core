import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * Écrire un SECRET sur disque — la seule implémentation du dépôt.
 *
 * ## Les trois règles, et ce que chacune évite
 *
 * 1. **Ne jamais tester la présence avant de lire.** `existsSync(f) ? read(f)
 *    : ""` ouvre une fenêtre entre le test et l'usage : le fichier peut
 *    disparaître, ou devenir un lien vers ailleurs. La forme juste est de lire
 *    et de traiter `ENOENT` — le système de fichiers répond en une opération ce
 *    que deux appels ne peuvent pas garantir.
 * 2. **Écrire en 0600, atomiquement.** Un secret créé au masque par défaut est
 *    lisible par tous les comptes de la machine, et rien ne le signale. Le
 *    couple fichier temporaire + `rename` évite en plus qu'un lecteur tombe sur
 *    un fichier à demi écrit.
 * 3. **CONSTATER le mode obtenu.** Le mode demandé est une intention, pas une
 *    garantie : NTFS l'ignore, comme un montage FAT/exFAT ou NFS sans mapping
 *    d'identité. Une capacité se constate, elle ne se déduit pas de
 *    `process.platform` — et si la restriction n'a pas pris, il faut le DIRE
 *    plutôt que laisser croire à une protection.
 *
 * ## Pourquoi les deux formes, synchrone et asynchrone
 *
 * Le runtime persiste ses clés dans du code asynchrone ; une commande de CLI
 * écrit un jeton dans un flot synchrone, où introduire une promesse
 * changerait l'ordre des messages affichés. Les deux formes appliquent le même
 * raisonnement, écrit ici une seule fois — deux copies divergeraient, et l'on
 * sait exactement comment : l'une porterait le mode 0600, l'autre non.
 *
 * @module
 */

/** Mode attendu d'un fichier qui porte un secret : lisible par son seul propriétaire. */
export const MODE_SECRET = 0o600;

/**
 * Le contenu du fichier, ou `null` s'il n'existe pas.
 *
 * @throws Toute erreur autre qu'`ENOENT` — un fichier illisible pour cause de
 *         droits n'est PAS un fichier absent, et le confondre ferait écraser un
 *         secret existant par un fichier neuf.
 */
export async function lireSiPresent(fichier: string): Promise<string | null> {
  try {
    return await readFile(fichier, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Forme synchrone de {@link lireSiPresent}. */
export function lireSiPresentSync(fichier: string): string | null {
  try {
    return readFileSync(fichier, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Le mode effectif du fichier n'est-il PAS restreint au propriétaire ?
 *
 * @returns `null` si le fichier a disparu ou n'est pas interrogeable (le chemin
 *          d'erreur normal parlera), sinon le mode effectif quand il diffère de
 *          0600 — et `undefined` quand tout va bien.
 */
export function modeNonRestreint(fichier: string): number | null | undefined {
  let mode: number;
  try {
    mode = statSync(fichier).mode & 0o777;
  } catch {
    return null;
  }
  return mode === MODE_SECRET ? undefined : mode;
}

/** Forme asynchrone de {@link modeNonRestreint}. */
export async function modeNonRestreintAsync(
  fichier: string,
): Promise<number | null | undefined> {
  let mode: number;
  try {
    mode = ((await stat(fichier)).mode & 0o777) as number;
  } catch {
    return null;
  }
  return mode === MODE_SECRET ? undefined : mode;
}

/**
 * La phrase à journaliser quand la restriction n'a PAS pris.
 *
 * Elle nomme la cause probable et ce qui reste à faire : un avertissement qui
 * dit seulement « mode inattendu » se lit comme du bruit et finit ignoré.
 */
export function messageNonRestreint(fichier: string, mode: number): string {
  return (
    `${fichier} porte un SECRET mais n'est PAS restreint au seul propriétaire ` +
    `(mode ${mode.toString(8).padStart(4, "0")}, attendu 0600). Le système de ` +
    `fichiers n'applique pas les permissions POSIX (NTFS, FAT/exFAT, NFS sans ` +
    `mapping d'identité), ou le fichier a été déposé par un tiers. La ` +
    `confidentialité dépend alors des seuls droits du dossier — restreignez-les : ` +
    (process.platform === "win32"
      ? `icacls "${fichier}" /inheritance:r /grant:r "%USERNAME%:R"`
      : `chmod 600 "${fichier}"`) +
    `.`
  );
}

/**
 * Écrit un secret : dossier créé, mode 0600, remplacement ATOMIQUE.
 *
 * Le mode est posé à la création du temporaire — et non après `rename` — pour
 * qu'il n'existe à aucun instant un fichier au contenu secret et au masque par
 * défaut. `chmod` est ensuite réappliqué sur la cible : un `rename` par-dessus
 * un fichier EXISTANT conserve, sur certains systèmes, le mode de la cible.
 */
export async function ecrireSecret(
  fichier: string,
  contenu: string,
): Promise<void> {
  await mkdir(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.${process.pid}.tmp`;
  await writeFile(tmp, contenu, { mode: MODE_SECRET });
  try {
    await rename(tmp, fichier);
  } catch (e) {
    // 🔴 LE TEMPORAIRE PORTE LE SECRET. S'il survit à l'échec, il reste sur le
    // disque, en clair, et personne ne le nettoiera. Le cas n'est pas
    // théorique : sous Windows, remplacer une cible OUVERTE par un autre
    // process échoue (là où POSIX remplace sans broncher) — et la cible est
    // typiquement un `.env` que l'utilisateur a sous les yeux dans son éditeur.
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

/** Forme synchrone de {@link ecrireSecret}. */
export function ecrireSecretSync(fichier: string, contenu: string): void {
  mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.${process.pid}.tmp`;
  writeFileSync(tmp, contenu, { mode: MODE_SECRET });
  try {
    renameSync(tmp, fichier);
  } catch (e) {
    // Voir `ecrireSecret` : le temporaire porte le secret, il ne survit pas à
    // un échec.
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* rien de mieux à faire — l'erreur d'origine est plus utile */
    }
    throw e;
  }
  // Un `rename` sur une cible existante peut en garder le mode : on le réaffirme.
  // L'échec n'est pas fatal — `modeNonRestreint` le CONSTATERA et le dira.
  try {
    chmodSync(fichier, MODE_SECRET);
  } catch {
    /* constaté ailleurs, jamais supposé */
  }
}
