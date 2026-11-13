#!/usr/bin/env node
/**
 * Appelle une méthode gRPC d'une application Nodefony, en protocole Connect
 * (JSON sur HTTP) — la preuve qu'un service répond, sans `curl` ni guillemets.
 *
 * `curl -d '{"name":"Ada"}'` ne passe ni dans cmd.exe ni dans Windows PowerShell,
 * et `grpcurl` n'est pas installé partout. Ce script n'emploie que `fetch` de
 * Node : il marche à l'identique sur les trois plateformes, et il rend le CODE
 * gRPC du refus (`unauthenticated`, `permission_denied`…), pas seulement un
 * statut HTTP.
 *
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-add-grpc-service/scripts/call.mjs greet.v1.GreetService/Greet --field name=Ada
 * `@usage` node node_modules/@nodefony/devkit/skills/nodefony-add-grpc-service/scripts/call.mjs greet.v1.GreetService/Greet --file body.json
 * `@option` --field - un champ du message, `nom=valeur` (répétable ; la valeur est une chaîne)
 * `@option` --file - le message entier, lu dans un fichier JSON
 * `@option` --header - un en-tête, `nom=valeur` (répétable), par exemple `authorization=Bearer …`
 * `@option` --url - l'adresse de l'application (défaut http://127.0.0.1:5151)
 * `@option` --json - la réponse brute, sérialisée, pour rechaîner
 * `@requires` l'application démarrée
 * `@output` le statut HTTP, puis le message reçu ou le code gRPC du refus
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** L'adresse d'une application de développement, sans TLS. */
const DEFAULT_URL = "http://127.0.0.1:5151";

/** Une méthode gRPC : `paquet.Service/Méthode`, sans barre de tête. */
const METHOD_RE = /^[A-Za-z_][\w.]*\.[A-Za-z_]\w*\/[A-Za-z_]\w*$/u;

const USAGE = `
Appelle une méthode gRPC d'une application Nodefony, en Connect (JSON sur HTTP).

  call.mjs <paquet.Service/Méthode> [--field nom=valeur]...   le message, champ par champ
  call.mjs <paquet.Service/Méthode> --file message.json       le message, depuis un fichier
  call.mjs ... --header authorization=Bearer <jeton>          un en-tête (répétable)
  call.mjs ... --url http://127.0.0.1:5151                    l'application visée
  call.mjs ... --json                                         la réponse brute

Codes de sortie : 0 réponse · 1 refus ou erreur gRPC · 64 mauvais usage · 69 application injoignable
`.trim();

/**
 * Coupe `nom=valeur` au PREMIER `=` : une valeur peut en contenir (jeton base64).
 *
 * @param {string} pair - la paire saisie.
 * @returns {[string, string] | null} le nom et la valeur, ou `null` si la forme est fausse.
 */
const splitPair = (pair) => {
  const at = pair.indexOf("=");
  if (at <= 0) return null;
  return [pair.slice(0, at), pair.slice(at + 1)];
};

/**
 * Lit la ligne de commande.
 *
 * @param {string[]} argv - les arguments, sans `node` ni le script.
 * @returns {{ method: string, url: string, body: Record<string, unknown>, headers: Record<string, string>, json: boolean } | { error: string }}
 *   la demande, ou l'erreur d'usage à afficher.
 */
export function parseArgs(argv) {
  let method = null;
  let url = DEFAULT_URL;
  let json = false;
  let file = null;
  const fields = Object.create(null);
  const headers = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (
      arg === "--field" ||
      arg === "--header" ||
      arg === "--url" ||
      arg === "--file"
    ) {
      const value = argv[++i];
      if (value === undefined) return { error: `${arg} attend une valeur` };
      if (arg === "--url") url = value;
      else if (arg === "--file") file = value;
      else {
        const pair = splitPair(value);
        if (pair === null)
          return { error: `${arg} attend nom=valeur, reçu « ${value} »` };
        (arg === "--field" ? fields : headers)[pair[0]] = pair[1];
      }
      continue;
    }
    if (arg.startsWith("-")) return { error: `option inconnue : ${arg}` };
    if (method !== null)
      return { error: `une seule méthode par appel (reçu « ${arg} »)` };
    method = arg.replace(/^\/+/u, "");
  }
  if (method === null) return { error: "la méthode à appeler manque" };
  if (!METHOD_RE.test(method)) {
    return {
      error: `méthode « ${method} » : la forme est paquet.Service/Méthode, comme greet.v1.GreetService/Greet`,
    };
  }
  let body = fields;
  if (file !== null) {
    if (Object.keys(fields).length !== 0)
      return { error: "--file et --field s'excluent" };
    try {
      body = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      return {
        error: `--file ${file} : ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  return { method, url: url.replace(/\/+$/u, ""), body, headers, json };
}

/**
 * Envoie l'appel Connect unaire et lit la réponse.
 *
 * @param {{ method: string, url: string, body: unknown, headers: Record<string, string> }} request - la demande.
 * @returns {Promise<{ status: number, payload: unknown }>} le statut HTTP et le corps décodé (texte brut s'il n'est pas JSON).
 */
export async function callConnect(request) {
  const response = await fetch(`${request.url}/${request.method}`, {
    method: "POST",
    headers: {
      ...request.headers,
      "content-type": "application/json",
      "connect-protocol-version": "1",
    },
    body: JSON.stringify(request.body),
  });
  const text = await response.text();
  let payload = text;
  try {
    payload = text === "" ? {} : JSON.parse(text);
  } catch {
    // corps non JSON (une page d'erreur HTML) : rendu tel quel
  }
  return { status: response.status, payload };
}

/**
 * Le code gRPC d'un refus Connect (`{"code":"unauthenticated"}`), ou `null`.
 *
 * @param {unknown} payload - le corps décodé.
 * @returns {string | null} le code textuel.
 */
const connectCode = (payload) =>
  payload !== null &&
  typeof payload === "object" &&
  "code" in payload &&
  typeof payload.code === "string"
    ? payload.code
    : null;

/**
 * Exécute la commande.
 *
 * @param {string[]} argv - les arguments.
 * @returns {Promise<number>} le code de sortie.
 */
export async function main(argv) {
  const request = parseArgs(argv);
  if ("error" in request) {
    process.stderr.write(`${request.error}\n\n${USAGE}\n`);
    return 64;
  }
  let result;
  try {
    result = await callConnect(request);
  } catch (e) {
    const cause =
      e instanceof Error && e.cause instanceof Error
        ? e.cause.message
        : String(e);
    process.stderr.write(
      `L'application ne répond pas sur ${request.url} (${cause}).\n` +
        "Démarre-la : npx nodefony development — puis relance l'appel.\n",
    );
    return 69;
  }
  const { status, payload } = result;
  if (request.json) {
    process.stdout.write(`${JSON.stringify({ status, payload })}\n`);
  } else if (status === 200) {
    process.stdout.write(
      `HTTP 200 · ${request.method}\n${JSON.stringify(payload, null, 2)}\n`,
    );
  } else {
    const code = connectCode(payload);
    process.stdout.write(
      code === null
        ? `HTTP ${status} · ${request.method} — pas une réponse gRPC :\n${typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)}\n`
        : `HTTP ${status} · ${request.method} — refus gRPC « ${code} »${
            typeof payload === "object" &&
            payload !== null &&
            "message" in payload
              ? ` : ${String(payload.message)}`
              : ""
          }\n`,
    );
  }
  return status === 200 ? 0 : 1;
}

// Exécuté directement (et non importé par son test) : rendre le code. Chemins
// RÉELS des deux côtés — lancé par un lien (`/var/…` sous macOS), la
// comparaison brute échouait et le script ne faisait rien.
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await main(process.argv.slice(2));
}
