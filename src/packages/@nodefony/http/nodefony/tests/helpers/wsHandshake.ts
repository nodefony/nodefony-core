/// <reference types="node" />
/**
 * Issue d'un handshake WebSocket vue sur le FIL : une ouverture, ou le statut
 * HTTP d'un refus (#596 — tout refus décidé avant l'acceptation est un statut,
 * RFC 6455 §4.2.2). Le client `ws` est pris exprès : lui seul expose ce statut
 * (`unexpected-response`), que le `WebSocket` standard cache derrière un `1006`.
 */
import type { IncomingHttpHeaders } from "node:http";
import WebSocket from "ws";
import { expect } from "vitest";

export type HandshakeOutcome =
  | { kind: "open"; ws: WebSocket }
  | {
      kind: "refused";
      status: number;
      statusMessage: string;
      headers: IncomingHttpHeaders;
    };

export interface IHandshakeOptions {
  protocols?: string | string[] | undefined;
  headers?: Record<string, string> | undefined;
  origin?: string | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Tente un handshake et rend ce que le client en a vu.
 *
 * @param url - adresse `ws:`/`wss:`
 * @param options - sous-protocoles, en-têtes, origine
 * @returns l'ouverture (socket à refermer par l'appelant) ou le refus
 * @throws si le serveur ne répond ni l'un ni l'autre dans le délai
 */
export function handshake(
  url: string,
  options: IHandshakeOptions = {},
): Promise<HandshakeOutcome> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options.protocols, {
      rejectUnauthorized: false,
      headers: options.headers ?? {},
      ...(options.origin !== undefined ? { origin: options.origin } : {}),
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`handshake ${url} sans issue`));
    }, options.timeoutMs ?? 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve({ kind: "open", ws });
    });
    ws.once("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      resolve({
        kind: "refused",
        status: res.statusCode ?? 0,
        statusMessage: res.statusMessage ?? "",
        headers: res.headers,
      });
      res.resume();
      ws.terminate();
    });
    ws.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Exige un REFUS au handshake et rend son statut — échoue franchement si la
 * socket s'est ouverte (le contrat que #596 a fermé : jamais d'ouverture
 * suivie d'une fermeture pour un refus).
 *
 * @param url - adresse `ws:`/`wss:`
 * @param options - sous-protocoles, en-têtes, origine
 * @returns le refus (statut, phrase, en-têtes)
 */
export async function expectHandshakeRefused(
  url: string,
  options: IHandshakeOptions = {},
): Promise<Extract<HandshakeOutcome, { kind: "refused" }>> {
  const outcome = await handshake(url, options);
  if (outcome.kind === "open") {
    outcome.ws.terminate();
    expect.fail(`handshake ${url} OUVERT alors qu'un refus était attendu`);
  }
  return outcome;
}
