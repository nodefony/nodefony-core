export interface IUploadedFile {
  filename: string;
  size: number;
  prettySize: string;
  mimeType: string | null | undefined;
  hash: string | null | undefined;
  hashAlgorithm: false | "sha1" | "md5" | "sha256";
  lastModifiedDate: Date | null | undefined;

  move(target: string): IUploadedFile;
  getMimeType(): string | null | undefined;
  getSize(): number;
  getPrettySize(): string;
}

export interface IUploadService {
  path?: string | unknown;
  createUploadFile(file: unknown, name: string): IUploadedFile;
}
