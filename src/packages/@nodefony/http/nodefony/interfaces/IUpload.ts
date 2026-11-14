import type { FileClass } from "nodefony";
/**
 * Forme neutre d'un fichier multipart parsé (temp écrit sur disque), découplée
 * du parser sous-jacent. Remplace l'ex-couplage à `formidable.File` : le moteur
 * de parsing (busboy) n'apparaît plus dans le contrat consommé par
 * `UploadedFile`. Champs alignés sur ce que lit `UploadedFile.create`.
 */
export interface IParsedUploadFile {
  /** Chemin absolu du fichier temporaire écrit sur disque. */
  filepath: string;
  /** Nom de fichier temporaire généré (UUID + extension). */
  newFilename: string;
  /** Nom de fichier d'origine déclaré par le client (peut être null). */
  originalFilename: string | null;
  /** Type MIME déclaré dans la part multipart. */
  mimetype: string | null;
  /** Taille réellement écrite sur disque (octets). */
  size: number;
  /** Date d'écriture du temporaire. */
  mtime: Date | null;
  /** Algorithme de hash appliqué pendant le stream, ou `false` si aucun. */
  hashAlgorithm: false | "sha1" | "md5" | "sha256";
  /** Hash hexadécimal du contenu si `hashAlgorithm` configuré, sinon null. */
  hash: string | null;
}

/**
 * Options du sous-système d'upload (clé de config `upload`). Mappées sur les
 * `limits` de busboy + la gestion temp/hash propre à Nodefony.
 */
export interface IUploadOptions {
  /** Répertoire de dépôt des fichiers temporaires. */
  uploadDir?: string | undefined;
  /** Taille max d'UN fichier (octets) — `limits.fileSize` busboy. */
  maxFileSize?: number | undefined;
  /** Taille max CUMULÉE des fichiers d'une requête (octets) — appliquée par Nodefony. */
  maxTotalFileSize?: number | undefined;
  /** Nombre max de fichiers — `limits.files` busboy. */
  maxFiles?: number | undefined;
  /** Nombre max de champs texte — `limits.fields` busboy. */
  maxFields?: number | undefined;
  /** Taille max d'un champ texte (octets) — `limits.fieldSize` busboy. */
  maxFieldsSize?: number | undefined;
  /** Hash calculé pendant le stream (défaut `false` = aucun). */
  hashAlgorithm?: false | "sha1" | "md5" | "sha256" | undefined;
  /** Encodage par défaut des parts texte. */
  encoding?: string | undefined;
}

/**
 * Les bornes d'envoi qu'une ROUTE règle pour elle-même (option de route
 * `upload`). Chaque clé déclarée remplace celle de la configuration http,
 * dans les deux sens : un dépôt de vidéos relève `maxFileSize` sans le
 * relever pour les autres routes, un avatar l'abaisse à quelques centaines de
 * kilo-octets — et le fichier trop gros est coupé PENDANT le flux, avant
 * d'avoir rempli le disque. Une clé absente garde la valeur de la
 * configuration.
 *
 * Lues au moment de lire le corps, quand la route est déjà résolue : une route
 * qui ne déclare rien ne paie rien. Le dossier de dépôt et l'encodage restent
 * ceux de la configuration.
 */
export interface IRouteUploadOptions {
  /** Taille max d'UN fichier (octets). */
  readonly maxFileSize?: number | undefined;
  /** Taille max CUMULÉE des fichiers de la requête (octets). */
  readonly maxTotalFileSize?: number | undefined;
  /** Nombre max de fichiers. */
  readonly maxFiles?: number | undefined;
  /** Nombre max de champs texte. */
  readonly maxFields?: number | undefined;
  /** Taille max d'un champ texte (octets). */
  readonly maxFieldsSize?: number | undefined;
  /** Empreinte calculée pendant le flux (`false` = aucune). */
  readonly hashAlgorithm?: false | "sha1" | "md5" | "sha256" | undefined;
}

/**
 * Un fichier reçu dans un corps multipart, déjà écrit dans le dossier
 * d'upload sous un nom temporaire.
 *
 * Le temporaire est EFFACÉ à la fin de la requête (réponse envoyée ou client
 * parti) : pour garder le fichier, l'action le déplace avec `moveAsync()`
 * avant de répondre. Un refus (pare-feu, garde, erreur de l'action) ne laisse
 * donc rien sur le disque.
 */
export interface IUploadedFile {
  filename: string;
  size: number;
  prettySize: string;
  /**
   * Le type DÉCLARÉ par le client, sinon deviné de l'extension ; `false`
   * quand ni l'un ni l'autre ne le disent. Déclaratif : jamais une preuve du
   * contenu.
   */
  mimeType: string | false;
  hash: string | null | undefined;
  hashAlgorithm: false | "sha1" | "md5" | "sha256";
  lastModifiedDate: Date | null | undefined;

  /**
   * Déplace le fichier vers `target` (un fichier, ou un dossier existant) et
   * rend le fichier de DESTINATION — un `FileClass`, pas un fichier reçu : le
   * nom d'origine, la taille déclarée et l'empreinte restent sur celui-ci.
   */
  move(target: string): FileClass;
  /** Variante non bloquante de `move()` (recommandée dans le pipeline). */
  moveAsync(target: string): Promise<FileClass>;
  getMimeType(): string | false;
  getSize(): number;
  getPrettySize(): string;
}

export interface IUploadService {
  path?: unknown;
  /** Construit un `UploadedFile` en async (stat non bloquant). */
  createUploadFile(file: unknown, name: string): Promise<IUploadedFile>;
}
