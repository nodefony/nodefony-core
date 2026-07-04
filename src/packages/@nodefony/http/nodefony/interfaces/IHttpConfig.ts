import type { HttpConfig, HttpConfigInput } from "../config/config";

/**
 * Configuration validée de `@nodefony/http` (sortie du parse Zod + défauts
 * kernel appliqués par le builder). Source de vérité = `../config/config.ts`.
 */
export type IHttpConfig = HttpConfig;

/**
 * Configuration brute fournie par l'application (toutes sections optionnelles —
 * les sections omises reçoivent leurs défauts). Entrée du builder
 * {@link import("../config/defineModuleConfig").defineHttpConfig}.
 */
export type IHttpConfigInput = HttpConfigInput;
