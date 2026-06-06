// RFC 6265bis §5.4.7 — 3 valeurs canoniques (title-case). `boolean` et `"none"`
// (héritage lib `cookie`) retirés : `None` impose `Secure` → plus de drapeau.
export type SameSiteType = "Strict" | "Lax" | "None";
export type PriorityType = "High" | "Medium" | "Low" | undefined;

export interface ICookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  secure?: boolean;
  expires?: Date | string | number;
  sameSite?: SameSiteType;
  httpOnly?: boolean;
  signed?: boolean;
  secret?: string;
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
  signed?: boolean;
  originalMaxAge?: number;
  expires?: Date;
  maxAge?: number;
  path?: string;
  domain?: string | undefined;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: SameSiteType;
  priority?: string;

  setValue(value: unknown): unknown;
  toString(): string;
  serialize(): string;
  serializeWebSocket(): IWsCookie;
  clearCookie(): void;
  sign(val: string, secret: string): string;
  unsign(val: string, secret: string): string | boolean;
  getMaxAge(): number | undefined;
}
