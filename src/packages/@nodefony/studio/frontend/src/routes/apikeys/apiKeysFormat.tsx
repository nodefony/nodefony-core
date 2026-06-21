/**
 * Helpers de RENDU de la console API Keys — badges (icône + couleur + texte,
 * jamais la couleur seule = a11y WCAG). Données non maîtrisées (nom, préfixe,
 * scopes, porteur) rendues en TEXTE/Code, jamais en HTML.
 */
import type { ReactNode } from "react";
import { Badge, Group, Text } from "@mantine/core";
import {
  IconCircleCheck,
  IconClock,
  IconBan,
  IconUser,
  IconRobot,
} from "@tabler/icons-react";
import type { ApiKeyStatus } from "./apiKeysModel";

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
