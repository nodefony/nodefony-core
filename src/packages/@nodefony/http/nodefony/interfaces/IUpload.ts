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
