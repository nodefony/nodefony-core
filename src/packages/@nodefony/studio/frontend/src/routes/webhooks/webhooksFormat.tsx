/**
 * Helpers de RENDU de la console Webhooks — badges (icône + couleur + texte,
 * jamais la couleur seule = a11y WCAG). Données non maîtrisées (url, events,
 * messages d'erreur) rendues en TEXTE/Code, jamais en HTML.
 */
import type { ReactNode } from "react";
import { Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import {
  IconCircleCheck,
  IconCircleX,
  IconClockPause,
  IconPlayerPause,
  IconAlertTriangle,
  IconDatabase,
  IconAsterisk,
} from "@tabler/icons-react";
import {
  deliveryHealth,
  WILDCARD_EVENT,
  type DeliveryHealth,
  type WebhookDriver,
  type WebhookEndpoint,
} from "./webhooksModel";

/** Driver du store webhook → libellé humain (mémoire volatile / SGBD). */
const DRIVER_LABEL: Record<NonNullable<WebhookDriver>, string> = {
  memory: "mémoire (volatile)",
  orm: "base SQL (ORM)",
};

/** État actif/désactivé d'un endpoint. */
export function EnabledBadge({
  enabled,
  size = "sm",
}: {
  enabled: boolean;
  size?: string;
}): ReactNode {
  return (
    <Badge
      variant={enabled ? "light" : "outline"}
      color={enabled ? "teal" : "gray"}
      size={size}
      leftSection={
        enabled ? <IconCircleCheck size={12} /> : <IconPlayerPause size={12} />
      }
      style={{ textTransform: "none" }}
    >
      {enabled ? "Actif" : "Désactivé"}
    </Badge>
  );
}

const DELIVERY_META: Record<
  DeliveryHealth,
  { color: string; label: string; Icon: typeof IconCircleCheck }
> = {
  never: { color: "gray", label: "Jamais livré", Icon: IconClockPause },
  ok: { color: "teal", label: "OK", Icon: IconCircleCheck },
  failing: { color: "red", label: "Échec", Icon: IconCircleX },
};

/**
 * Statut de la **dernière livraison** (jamais / OK / échec) — avec le code HTTP
 * et le message d'erreur en tooltip (l'erreur réelle, données serveur en texte).
 */
export function DeliveryBadge({
  endpoint,
  size = "sm",
}: {
  endpoint: WebhookEndpoint;
  size?: string;
}): ReactNode {
  const health = deliveryHealth(endpoint);
  const meta = DELIVERY_META[health];
  const code = endpoint.lastDeliveryStatus;
  const label =
    health === "ok" && code !== null
      ? `${code}`
      : health === "failing" && code !== null
        ? `Échec (${code})`
        : meta.label;
  const badge = (
    <Badge
      variant={
        health === "ok" ? "light" : health === "failing" ? "filled" : "outline"
      }
      color={meta.color}
      size={size}
      leftSection={<meta.Icon size={12} />}
      style={{ textTransform: "none" }}
    >
      {label}
    </Badge>
  );
  // Tooltip = code HTTP + message d'erreur réel (si présent).
  if (endpoint.lastDeliveryError || code !== null) {
    return (
      <Tooltip
        withArrow
        openDelay={150}
        multiline
        maw={340}
        label={
          <Stack gap={2}>
            {code !== null && <Text size="xs">Code HTTP : {code}</Text>}
            {endpoint.lastDeliveryError && (
              <Text size="xs">Erreur : {endpoint.lastDeliveryError}</Text>
            )}
          </Stack>
        }
      >
        {badge}
      </Tooltip>
    );
  }
  return badge;
}

/**
 * Échecs consécutifs — neutre à 0, orange dès 1, rouge proche du seuil
 * d'auto-désactivation. Le compteur n'a PAS de couleur d'alarme tant qu'il est à 0.
 */
export function FailureBadge({
  count,
  size = "sm",
}: {
  count: number;
  size?: string;
}): ReactNode {
  if (count === 0) {
    return (
      <Text size="sm" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
        0
      </Text>
    );
  }
  return (
    <Badge
      variant="light"
      color={count >= 5 ? "red" : "orange"}
      size={size}
      leftSection={<IconAlertTriangle size={12} />}
      style={{ textTransform: "none", fontVariantNumeric: "tabular-nums" }}
    >
      {count}
    </Badge>
  );
}

/** Liste des événements souscrits (`*` = tous, mis en avant). */
export function EventChips({ events }: { events: string[] }): ReactNode {
  if (events.includes(WILDCARD_EVENT)) {
    return (
      <Badge
        variant="light"
        color="grape"
        size="sm"
        leftSection={<IconAsterisk size={12} />}
        style={{ textTransform: "none" }}
      >
        Tous les événements
      </Badge>
    );
  }
  if (events.length === 0) {
    return (
      <Text size="sm" c="dimmed" fs="italic">
        aucun
      </Text>
    );
  }
  return (
    <Group gap={4} wrap="wrap">
      {events.map((e) => (
        <Badge
          key={e}
          variant="outline"
          color="grape"
          size="sm"
          style={{ textTransform: "none" }}
        >
          {e}
        </Badge>
      ))}
    </Group>
  );
}

/**
 * Badge **« où on écrit »** : le backend du store qui porte le registre des
 * endpoints (classe + driver mémoire/SGBD). Un store `memory` perd les endpoints
 * au redémarrage ; un store ORM les persiste.
 *
 * Dernier survivant des badges de store écrits par page : les autres consoles
 * (Sessions, Users, API Keys) passent par `BrickStoreChip`, alimenté par le
 * registre unique `/nodefony/kernel/api/stores`. Celui-ci reste parce qu'il vit
 * dans une COLONNE du tableau, pas dans l'en-tête de page — la puce générique
 * n'y a pas sa place. À basculer si la colonne disparaît.
 */
export function StorageBadge({
  store,
  driver,
}: {
  store: string;
  driver: WebhookDriver;
}): ReactNode {
  const driverLabel = driver ? DRIVER_LABEL[driver] : "inconnu";
  const persistent = driver === "orm";
  return (
    <Tooltip
      withArrow
      openDelay={150}
      multiline
      label={
        <Stack gap={2}>
          <Text size="xs">Store : {store}</Text>
          <Text size="xs">Driver : {driverLabel}</Text>
          <Text size="xs">
            {persistent
              ? "Endpoints persistés (survivent au redémarrage) ✓"
              : "⚠ Store volatile — endpoints perdus au redémarrage"}
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
        {store}
      </Badge>
    </Tooltip>
  );
}
