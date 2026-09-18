/**
 * **`nodefony image:check` — refuser une image de conteneur qui embarque un
 * secret.**
 *
 * Une application qui se déploie pousse une image sur un registre. Si un secret
 * y entre, il est public : une couche reste téléchargeable même quand une couche
 * suivante efface le fichier. Ce contrôle existait, éprouvé, dans les scripts de
 * publication du dépôt du framework — donc **nulle part** pour qui installe
 * Nodefony depuis npm. Il vit ici, dans le produit, pour que toute application
 * puisse regarder sa propre image avant de la pousser.
 *
 * Ce n'est pas un scanner de secrets par contenu : la règle porte sur des NOMS
 * ({@link detectSuspectImageFiles}), et le balayage par contenu est le métier de
 * `gitleaks`, qui lit l'arbre et son historique.
 *
 * @module
 */
import fs from "node:fs";
import { SysExit } from "../sysexits";
import { stripGlobalCliFlags } from "../globalFlags";
import { printUsage, printUsageError, type IUsagePage } from "../usageReport";
import { detectSuspectImageFiles } from "./suspectFiles";
import { BlindCheckError, imageContents, saveImage } from "./tarLayers";

export { detectSuspectFiles, detectSuspectImageFiles } from "./suspectFiles";
export {
  BlindCheckError,
  imageContents,
  readTarHeader,
  saveImage,
  tarPathsFromStream,
  type IImageContents,
} from "./tarLayers";

const PAGE: IUsagePage = {
  command: "nodefony image:check",
  tagline:
    "refuse une image de conteneur qui embarque une clé, un secret ou un " +
    "fichier d'environnement",
  synopsis: [
    "nodefony image:check <image[:tag]>",
    "nodefony image:check --files <inventaire>",
  ],
  sections: [
    {
      title: "CE QU'ELLE REGARDE",
      paragraph:
        "Les COUCHES de l'image, une par une, jamais son arborescence " +
        "finale : une couche reste lisible par qui télécharge l'image, même " +
        "quand une couche suivante efface le fichier. Un `COPY secret` suivi " +
        "d'un `RUN rm` produit donc une image où le secret est absent du " +
        "système de fichiers et présent dans le registre — le cas le plus " +
        "fautif, et celui qu'un contrôle bâti sur le résultat final " +
        "déclarerait sain.",
    },
    {
      title: "CE QU'ELLE N'EST PAS",
      paragraph:
        "Un scanner de secrets par contenu. La règle porte sur des NOMS " +
        "connus (`.pem`, `.key`, `.env.local`, `keyset.json`, `id_rsa`…), " +
        "parce qu'une liste courte est une alerte qu'on ne prend jamais " +
        "l'habitude d'ignorer. Pour le contenu, employer `gitleaks` sur " +
        "l'arbre et son historique.",
    },
  ],
  options: [
    {
      term: "--files <inventaire>",
      text:
        "juger une liste de chemins déjà relevée, un par ligne — sans démon " +
        "docker",
    },
  ],
  examples: [
    {
      term: "nodefony image:check mon-app:1.2.3",
      text: "l'image qu'on s'apprête à pousser",
    },
    {
      term: "docker build -t mon-app:ci . && nodefony image:check mon-app:ci",
      text: "dans une chaîne d'intégration",
    },
  ],
  exitCodes: [
    { term: "1", text: "REFUS — au moins un fichier sensible, chacun nommé" },
    {
      term: "69",
      text:
        "le contrôle n'a PAS pu regarder (image absente, démon injoignable, " +
        "couche illisible) — à traiter comme un refus (EX_UNAVAILABLE)",
    },
  ],
};

/** Ce que la ligne de commande demande. */
export interface IImageCheckRequest {
  /** La référence de l'image à sauver, ou `null` en mode inventaire. */
  image: string | null;
  /** Le fichier d'inventaire, ou `null` quand on lit une vraie image. */
  files: string | null;
  /** L'utilisateur demande la page d'aide. */
  help: boolean;
}

/**
 * Parse l'argv après le mot `image:check`.
 *
 * @param argv - `process.argv` complet
 * @returns la demande, ou le motif du refus
 */
export function parseImageCheckArgv(
  argv: string[],
): IImageCheckRequest | { error: string } {
  const at = argv.indexOf("image:check");
  const rest = stripGlobalCliFlags(at === -1 ? [] : argv.slice(at + 1));
  const req: IImageCheckRequest = { image: null, files: null, help: false };

  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i] as string;
    if (word === "--help" || word === "-h") {
      req.help = true;
      continue;
    }
    if (word === "--files") {
      const value = rest[i + 1];
      if (!value || value.startsWith("-")) {
        return { error: "--files attend un chemin d'inventaire" };
      }
      req.files = value;
      i += 1;
      continue;
    }
    if (word.startsWith("-")) {
      return { error: `option inconnue : ${word}` };
    }
    if (req.image !== null) {
      return { error: `une seule image à la fois (reçu aussi « ${word} »)` };
    }
    req.image = word;
  }
  return req;
}

/**
 * Lit un inventaire de chemins écrit à raison d'un par ligne.
 *
 * C'est le point d'injection qui rend la RÈGLE éprouvable sans démon docker —
 * et c'est la règle qu'on veut voir mordre, pas la lecture d'un tar.
 *
 * @param file - le fichier d'inventaire
 * @returns les chemins, sans `/` initial
 * @throws BlindCheckError quand le fichier n'est pas lisible
 */
function pathsFromInventory(file: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new BlindCheckError(
      `inventaire illisible (${file}) : ${(error as Error).message}`,
    );
  }
  return text
    .split("\n")
    .map((line) => line.trim().replace(/^\.?\//, ""))
    .filter(Boolean);
}

/**
 * Rend le verdict sur une image, ou sur l'inventaire de ses chemins.
 *
 * 🔴 **Un contrôle qui n'a pas pu regarder n'est pas un contrôle favorable.**
 * Il rend `EX_UNAVAILABLE` (69), et non 0 : un appelant qui teste `!== 0`
 * refuse alors de publier, ce qui est le comportement voulu.
 *
 * @param argv - `process.argv` complet
 * @returns exit code sémantique (`OK`, `1` refus, `USAGE`, `UNAVAILABLE`)
 */
export async function runImageCheckCommand(argv: string[]): Promise<number> {
  const parsed = parseImageCheckArgv(argv);
  if ("error" in parsed) {
    return printUsageError(PAGE, parsed.error);
  }
  if (parsed.help) {
    return printUsage(PAGE);
  }

  let paths: string[];
  let origin: string;
  try {
    if (parsed.files !== null) {
      paths = pathsFromInventory(parsed.files);
      origin = `${paths.length} chemin(s) depuis ${parsed.files}`;
    } else if (parsed.image !== null) {
      const saved = saveImage(parsed.image);
      try {
        const read = await imageContents(saved.archive);
        paths = read.paths;
        origin = `${parsed.image} — ${read.layers} couche(s), ${paths.length} chemin(s)`;
      } finally {
        fs.rmSync(saved.dir, { recursive: true, force: true });
      }
    } else {
      return printUsageError(PAGE, "une image ou --files est requis");
    }
  } catch (error) {
    // Ne pas savoir regarder se DISTINGUE d'un verdict favorable, et le message
    // le dit : sinon une chaîne d'intégration publierait sur un contrôle aveugle
    // en croyant l'avoir passé.
    const message =
      error instanceof BlindCheckError
        ? error.message
        : `lecture impossible : ${(error as Error).message}`;
    process.stderr.write(`\n✗ CONTRÔLE AVEUGLE — ${message}\n\n`);
    return SysExit.UNAVAILABLE;
  }

  const suspects = detectSuspectImageFiles(paths);
  if (suspects.length > 0) {
    process.stderr.write(
      `\n✗ REFUS — matière sensible dans l'image (${origin})\n\n`,
    );
    for (const suspect of suspects) process.stderr.write(`    ${suspect}\n`);
    process.stderr.write(
      "\n  Une couche reste lisible par qui télécharge l'image, même effacée\n" +
        "  par une couche suivante : ces fichiers seraient PUBLICS, et un secret\n" +
        "  publié est compromis à la seconde où il est en ligne.\n" +
        "  → exclure du contexte de construction (`.dockerignore` de l'app),\n" +
        "    puis reconstruire. Ne pas se contenter d'un `rm` dans le Dockerfile.\n\n",
    );
    return 1;
  }
  process.stdout.write(`✓ image — rien de suspect (${origin})\n`);
  return SysExit.OK;
}
