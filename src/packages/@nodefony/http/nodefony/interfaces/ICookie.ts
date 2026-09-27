// RFC 6265bis §5.4.7 — 3 valeurs canoniques (title-case). `boolean` et `"none"`
// (héritage lib `cookie`) retirés : `None` impose `Secure` → plus de drapeau.
export type SameSiteType = "Strict" | "Lax" | "None";
export type PriorityType = "High" | "Medium" | "Low" | undefined;

export interface ICookieOptions {
  maxAge?: number | undefined;
  path?: string | undefined;
  domain?: string | undefined;
  secure?: boolean | undefined;
  expires?: Date | string | number | undefined;
  sameSite?: SameSiteType | undefined;
  httpOnly?: boolean | undefined;
  signed?: boolean | undefined;
  secret?: string | undefined;
  priority?: PriorityType;
}

export interface IWsCookie {
  name: string;
  value: string;
  maxage?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httponly?: boolean;
  secure?: boolean;
}

export interface ICookie {
  name: string;
  value: unknown;
  options: ICookieOptions;
  signed?: boolean | undefined;
  originalMaxAge?: number | undefined;
  expires?: Date | undefined;
  maxAge?: number | undefined;
  path?: string | undefined;
  domain?: string | undefined;
  httpOnly?: boolean | undefined;
  secure?: boolean | undefined;
  sameSite?: SameSiteType | undefined;
  priority?: string | undefined;

  setValue(value: unknown): unknown;
  toString(): string;
  serialize(): string;
  serializeWebSocket(): IWsCookie;
  clearCookie(): void;
  sign(val: string, secret: string): string;
  // Les deux arguments retombent sur `this.value` / `this.options.secret` quand
  // ils sont omis ; l'échec de vérification vaut `false`, jamais `true`.
  unsign(val?: string, secret?: string): string | false;
  getMaxAge(): number | undefined;
}
