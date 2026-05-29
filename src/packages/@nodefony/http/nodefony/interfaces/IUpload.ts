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
  uploadDir?: string;
  /** Taille max d'UN fichier (octets) — `limits.fileSize` busboy. */
  maxFileSize?: number;
  /** Taille max CUMULÉE des fichiers d'une requête (octets) — appliquée par Nodefony. */
  maxTotalFileSize?: number;
  /** Nombre max de fichiers — `limits.files` busboy. */
  maxFiles?: number;
  /** Nombre max de champs texte — `limits.fields` busboy. */
  maxFields?: number;
  /** Taille max d'un champ texte (octets) — `limits.fieldSize` busboy. */
  maxFieldsSize?: number;
  /** Hash calculé pendant le stream (défaut `false` = aucun). */
  hashAlgorithm?: false | "sha1" | "md5" | "sha256";
  /** Encodage par défaut des parts texte. */
  encoding?: string;
}

export interface IUploadedFile {
  filename: string;
  size: number;
  prettySize: string;
  mimeType: string | null | undefined;
  hash: string | null | undefined;
  hashAlgorithm: false | "sha1" | "md5" | "sha256";
  lastModifiedDate: Date | null | undefined;

  move(target: string): IUploadedFile;
  /** Variante non bloquante de `move()` (recommandée dans le pipeline). */
  moveAsync(target: string): Promise<IUploadedFile>;
  getMimeType(): string | null | undefined;
  getSize(): number;
  getPrettySize(): string;
}

export interface IUploadService {
  path?: string | unknown;
  /** Construit un `UploadedFile` en async (stat non bloquant). */
  createUploadFile(file: unknown, name: string): Promise<IUploadedFile>;
}
