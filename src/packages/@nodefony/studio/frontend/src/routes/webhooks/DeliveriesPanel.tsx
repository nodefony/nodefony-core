/**
 * Onglet « Livraisons récentes » du détail d'un endpoint — l'historique de ce que
 * Nodefony a ENVOYÉ (enveloppe `{id,timestamp,type,data}`) + la réponse observée
 * (status, corps tronqué, durée, erreur). Modèle GitHub/Stripe « Recent Deliveries ».
 * RAM par pod (éphémère). Données rendues en TEXTE/JSON (jamais d'HTML).
 */
import { useCallback } from "react";
import {
  Stack,
  Group,
  Text,
  Badge,
  Accordion,
  Button,
  Code,
  Box,
} from "@mantine/core";
import {
  IconRefresh,
  IconCircleCheck,
  IconCircleX,
  IconArrowUp,
  IconArrowDown,
} from "@tabler/icons-react";

import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import { DataState, JsonViewer } from "../../components/ui";
import {
  webhookDeliveriesEndpoint,
  describeWebhooksError,
  fmtDate,
  fmtSince,
  type WebhookDelivery,
} from "./webhooksModel";

/** Parse un corps JSON pour le JsonViewer ; renvoie `null` si non-JSON. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Badge statut d'une livraison (OK 2xx / Échec + code). */
function DeliveryStatusBadge({ d }: { d: WebhookDelivery }) {
  return (
    <Badge
      variant={d.ok ? "light" : "filled"}
      color={d.ok ? "teal" : "red"}
      size="sm"
      leftSection={
        d.ok ? <IconCircleCheck size={12} /> : <IconCircleX size={12} />
      }
      style={{ textTransform: "none", fontVariantNumeric: "tabular-nums" }}
    >
      {d.status !== null ? d.status : d.error ? "réseau" : "—"}
    </Badge>
  );
}

export function DeliveriesPanel({ id }: { id: string }) {
  const store = useStore();
  const fetcher = useCallback(async (): Promise<WebhookDelivery[]> => {
    try {
      const res = await store.api.getAbsolute<{
        deliveries: WebhookDelivery[];
      }>(webhookDeliveriesEndpoint(id));
      return res.deliveries ?? [];
    } catch (e) {
      throw new Error(describeWebhooksError(e));
    }
  }, [store, id]);
  const { data, loading, error, reload } = useResource(fetcher);
  const deliveries = data ?? [];

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {deliveries.length} livraison(s) récente(s) — gardées en mémoire (par
          pod, éphémère).
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          loading={loading}
          onClick={reload}
        >
          Recharger
        </Button>
      </Group>

      <DataState
        loading={loading && !data}
        error={error}
        empty={deliveries.length === 0}
        emptyMessage="Aucune livraison encore. Déclenche un événement souscrit (ex. un login échoué) pour en voir arriver."
        onRetry={reload}
      >
        <Accordion variant="separated" chevronPosition="left">
          {deliveries.map((d, i) => {
            const req = parseJson(d.requestBody);
            const res = d.responseBody ? parseJson(d.responseBody) : null;
            return (
              <Accordion.Item
                key={`${d.messageId}-${i}`}
                value={`${d.messageId}-${i}`}
              >
                <Accordion.Control>
                  <Group gap="sm" wrap="nowrap">
                    <DeliveryStatusBadge d={d} />
                    <Badge
                      variant="outline"
                      color="grape"
                      size="sm"
                      style={{ textTransform: "none" }}
                    >
                      {d.type}
                    </Badge>
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {d.durationMs} ms
                    </Text>
                    {d.attempt > 0 && (
                      <Badge variant="light" color="orange" size="xs">
                        retry #{d.attempt}
                      </Badge>
                    )}
                    <Box style={{ flex: 1 }} />
                    <Text size="xs" c="dimmed">
                      {fmtSince(d.ts)}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    <Group gap="lg">
                      <Text size="xs" c="dimmed">
                        Message&nbsp;<Code>{d.messageId}</Code>
                      </Text>
                      <Text size="xs" c="dimmed">
                        {fmtDate(d.ts)}
                      </Text>
                    </Group>
                    {d.error && (
                      <Text
                        size="sm"
                        c="red"
                        style={{ wordBreak: "break-word" }}
                      >
                        {d.error}
                      </Text>
                    )}
                    <Text size="xs" fw={600} c="dimmed">
                      <IconArrowUp size={11} /> Envoyé (payload signé)
                    </Text>
                    {req !== null ? (
                      <JsonViewer value={req} maxHeight={240} />
                    ) : (
                      <Code block>{d.requestBody}</Code>
                    )}
                    <Text size="xs" fw={600} c="dimmed">
                      <IconArrowDown size={11} /> Réponse du destinataire
                    </Text>
                    {d.responseBody === null ? (
                      <Text size="xs" c="dimmed" fs="italic">
                        (aucun corps de réponse)
                      </Text>
                    ) : res !== null ? (
                      <JsonViewer value={res} maxHeight={200} />
                    ) : (
                      <Code block>{d.responseBody}</Code>
                    )}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      </DataState>
    </Stack>
  );
}
