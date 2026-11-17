/**
 * Joue la mise en état d'une cible d'infra dans son conteneur (`EnvGate.provision`).
 *
 * Module à part de `docker.ts`, qui ne rend que des verdicts sans effet de bord :
 * celui-ci MODIFIE le serveur. Appelé par `test:all` après la sonde de santé, et
 * par la forge (`provision-gate.ts`) sur ses conteneurs de service — une seule
 * exécution, deux portes.
 *
 * @usage import { provisionGate } from "./lib/provision.ts"
 */
import { spawnSync } from "node:child_process";
import { type EnvGate, provisionArgs } from "../vitest/gates.ts";

/** Issue d'une mise en état. */
export interface IProvisionResult {
  /** `true` si la cible n'en déclare pas, ou si la commande a réussi. */
  ok: boolean;
  /** Ce qui a été accordé (`null` si rien n'est déclaré). */
  what: string | null;
  /** Sortie d'erreur de la commande, quand elle a échoué. */
  error?: string;
}

/**
 * Joue `gate.provision` dans `container`.
 *
 * @param gate - la cible
 * @param container - nom ou identifiant du conteneur (défaut : `nodefony-<service>`)
 * @returns l'issue — jamais une exception : l'appelant tranche et le dit
 */
export function provisionGate(
  gate: EnvGate,
  container = `nodefony-${gate.service?.name ?? ""}`,
): IProvisionResult {
  const call = provisionArgs(gate, container);
  if (call === null) return { ok: true, what: null };
  const what = gate.provision?.().what ?? null;
  const res = spawnSync("docker", call.args, {
    encoding: "utf8",
    env: { ...process.env, ...call.env },
  });
  if (res.status === 0) return { ok: true, what };
  return {
    ok: false,
    what,
    error: (res.stderr || res.error?.message || `code ${res.status}`).trim(),
  };
}
