/**
 * Helpers de RENDU de la console API Keys — badges (icône + couleur + texte,
 * jamais la couleur seule = a11y WCAG). Données non maîtrisées (nom, préfixe,
 * scopes, porteur) rendues en TEXTE/Code, jamais en HTML.
 */
import type { ReactNode } from "react";
import { Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconCircleCheck,
  IconClock,
  IconBan,
  IconUser,
  IconRobot,
  IconDatabase,
} from "@tabler/icons-react";
import type { ApiKeyStatus, ApiKeysStatus } from "./apiKeysModel";

/** Driver du token store → libellé humain (mémoire volatile / SGBD / cache). */
const DRIVER_LABEL: Record<NonNullable<ApiKeysStatus["driver"]>, string> = {
  memory: "mémoire (volatile)",
  orm: "base SQL (ORM)",
  redis: "Redis",
};

const STATUS_META: Record<
  ApiKeyStatus,
  { color: string; label: string; Icon: typeof IconCircleCheck }
> = {
  active: { color: "teal", label: "Active", Icon: IconCircleCheck },
  expired: { color: "orange", label: "Expirée", Icon: IconClock },
  revoked: { color: "red", label: "Révoquée", Icon: IconBan },
};

/** Statut d'une clé (active / expirée / révoquée). */
export function KeyStatusBadge({
  status,
  size = "sm",
}: {
  status: ApiKeyStatus;
  size?: string;
}): ReactNode {
  const meta = STATUS_META[status];
  return (
    <Badge
      variant={status === "active" ? "light" : "outline"}
      color={meta.color}
      size={size}
      leftSection={<meta.Icon size={12} />}
      style={{ textTransform: "none" }}
    >
      {meta.label}
    </Badge>
  );
}

/** Liste des scopes (capacités) accordés à une clé, ou « tous » si aucun. */
export function ScopeChips({ scopes }: { scopes: string[] }): ReactNode {
  if (scopes.length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        tous (droits du porteur)
      </Text>
    );
  }
  return (
    <Group gap={4} wrap="wrap">
      {scopes.map((s) => (
        <Badge
          key={s}
          variant="outline"
          color="grape"
          size="sm"
          style={{ textTransform: "none" }}
        >
          {s}
        </Badge>
      ))}
    </Group>
  );
}

/** Porteur d'une clé (utilisateur ou service account) — mode Administration. */
export function SubjectChip({
  subjectId,
  subjectType,
}: {
  subjectId: string;
  subjectType: "user" | "service";
}): ReactNode {
  return (
    <Badge
      variant="light"
      color={subjectType === "service" ? "cyan" : "blue"}
      leftSection={
        subjectType === "service" ? (
          <IconRobot size={12} />
        ) : (
          <IconUser size={12} />
        )
      }
      style={{ textTransform: "none" }}
    >
      {subjectId}
    </Badge>
  );
}

/**
 * Badge **« où on écrit »** : le backend du token store qui porte réellement les
 * clés API (classe + driver mémoire/SGBD/cache). Info MAJEURE — il dit quelles
 * garanties s'appliquent (un store `memory` perd les clés au redémarrage ; un
 * store SQL/Redis les persiste). Calque du `StorageBadge` de la console Sessions.
 * Classe réelle + driver détaillé en tooltip. Rien si le statut est indisponible.
 */
export function StorageBadge({ status }: { status: ApiKeysStatus }): ReactNode {
  const driverLabel = status.driver ? DRIVER_LABEL[status.driver] : "inconnu";
  // Driver `memory` = volatile : on alerte (orange) ; SGBD/cache persistants = grape.
  const persistent = status.driver === "orm" || status.driver === "redis";
  return (
    <Tooltip
      withArrow
      openDelay={150}
      multiline
      label={
        <Stack gap={2}>
          <Text size="xs">Store : {status.store}</Text>
          <Text size="xs">Driver : {driverLabel}</Text>
          <Text size="xs">
            {persistent
              ? "Clés persistées (survivent au redémarrage) ✓"
              : "⚠ Store volatile — clés perdues au redémarrage"}
          </Text>
        </Stack>
      }
    >
      <Badge
        variant="light"
        color={persistent ? "grape" : "orange"}
        size="sm"
        leftSection={<IconDatabase size={12} />}
        style={{ textTransform: "none" }}
      >
        {status.store}
      </Badge>
    </Tooltip>
  );
}
