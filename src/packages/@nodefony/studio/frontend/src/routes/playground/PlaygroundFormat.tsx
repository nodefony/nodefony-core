/**
 * PlaygroundFormat — badges a11y (icône + couleur + TEXTE, jamais couleur seule)
 * pour les transports et les gardes d'une action. JSX → `.tsx`.
 */
import type { ReactNode } from "react";
import { Badge, Group, Tooltip } from "@mantine/core";
import type { PlaygroundAction } from "./PlaygroundModel";

/** Couleur Mantine par méthode HTTP (convention REST usuelle). */
const METHOD_COLORS: Record<string, string> = {
  GET: "teal",
  POST: "blue",
  PUT: "grape",
  PATCH: "violet",
  DELETE: "red",
  OPTIONS: "gray",
  HEAD: "gray",
  WEBSOCKET: "orange",
  ANY: "gray",
};

/** Badge d'une méthode/transport. */
export function MethodBadge({ method }: { method: string }) {
  return (
    <Badge
      size="sm"
      variant="light"
      color={METHOD_COLORS[method] ?? "gray"}
      radius="sm"
    >
      {method}
    </Badge>
  );
}

/**
 * Rangée de badges des GARDES d'une action — rend visible ce que le pipeline
 * appliquera (rôles, scopes, idempotence, CSRF, session, bypass). Chaque badge
 * porte un tooltip qui explique la garde (écran auto-explicatif).
 */
export function GuardBadges({ action }: { action: PlaygroundAction }) {
  const g = action.guards;
  const badges: ReactNode[] = [];
  if (g.security) {
    const roles = g.security.clauses.flatMap((c) => c.anyOf);
    badges.push(
      <Tooltip
        key="granted"
        label={`@IsGranted — exige ${roles.join(" ou ")} (403 sinon)`}
      >
        <Badge size="sm" variant="outline" color="yellow" radius="sm">
          🔒 {roles.join(" | ")}
        </Badge>
      </Tooltip>,
    );
  }
  if (g.scopes.length > 0) {
    badges.push(
      <Tooltip
        key="scopes"
        label="@RequireScope — ne bride que les jetons machine (clé API / JWT)"
      >
        <Badge size="sm" variant="outline" color="cyan" radius="sm">
          scope {g.scopes.join(", ")}
        </Badge>
      </Tooltip>,
    );
  }
  if (g.idempotent) {
    badges.push(
      <Tooltip
        key="idem"
        label={
          g.idempotent.required
            ? "@Idempotent strict — mutation sans Idempotency-Key rejetée (400) ; rejeu même clé = réponse mémorisée, 0 ré-exécution"
            : "@Idempotent souple — la clé est honorée si présente"
        }
      >
        <Badge size="sm" variant="outline" color="indigo" radius="sm">
          idempotent{g.idempotent.required ? "" : " (souple)"}
        </Badge>
      </Tooltip>,
    );
  }
  if (g.csrfProtect) {
    badges.push(
      <Tooltip
        key="csrf"
        label="@CsrfProtect — exige le synchronizer token sur la mutation"
      >
        <Badge size="sm" variant="outline" color="orange" radius="sm">
          CSRF
        </Badge>
      </Tooltip>,
    );
  }
  if (g.csrfExempt) {
    badges.push(
      <Tooltip
        key="csrf-exempt"
        label="@CsrfExempt — hors défense CSRF (auth conservée)"
      >
        <Badge size="sm" variant="outline" color="gray" radius="sm">
          CSRF exempt
        </Badge>
      </Tooltip>,
    );
  }
  if (g.session !== null && g.session !== undefined) {
    badges.push(
      <Tooltip key="session" label="@UseSession — session serveur activée">
        <Badge size="sm" variant="outline" color="green" radius="sm">
          session
        </Badge>
      </Tooltip>,
    );
  }
  if (g.bypassFirewall) {
    badges.push(
      <Tooltip
        key="bypass"
        label="bypassFirewall — route hors firewall (mécanisme d'auth lui-même)"
      >
        <Badge size="sm" variant="outline" color="red" radius="sm">
          hors firewall
        </Badge>
      </Tooltip>,
    );
  }
  if (badges.length === 0) return null;
  return <Group gap={6}>{badges}</Group>;
}

/** Badge de statut HTTP (vert 2xx, jaune 3xx/4xx, rouge 5xx / transport KO). */
export function StatusBadge({ status }: { status: number | null }) {
  const color =
    status === null
      ? "red"
      : status < 300
        ? "teal"
        : status < 500
          ? "yellow"
          : "red";
  return (
    <Badge size="lg" variant="light" color={color} radius="sm">
      {status === null ? "transport KO" : `HTTP ${status}`}
    </Badge>
  );
}
