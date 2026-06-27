/**
 * Modal de **création / édition** d'un endpoint webhook. Champs partagés (URL,
 * événements souscrits, description, actif). À la création, une seconde phase
 * affiche le **secret de signature 1×** (Standard Webhooks v1) ; à l'édition,
 * pas de secret (PATCH puis fermeture).
 *
 * Sécurité : l'URL est re-validée anti-SSRF **côté serveur** (`assertPublicUrl`)
 * — la validation client n'est qu'un garde-fou UX. Mutations en POST/PATCH HTTP
 * (pipeline complet, CSRF + clé d'idempotence portées par `ApiClient`).
 */
import { useMemo, useState } from "react";
import {
  Modal,
  Stack,
  Group,
  Text,
  TextInput,
  Textarea,
  Switch,
  Checkbox,
  TagsInput,
  Button,
  Alert,
  Box,
} from "@mantine/core";
import {
  IconWebhook,
  IconAlertTriangle,
  IconCheck,
  IconAsterisk,
} from "@tabler/icons-react";

import { useStore } from "../../stores";
import {
  WEBHOOKS_ENDPOINT,
  webhookEndpoint,
  WEBHOOK_EVENT_CATALOGUE,
  CATALOGUE_EVENTS,
  WILDCARD_EVENT,
  validateWebhookUrl,
  describeWebhooksError,
  type WebhookEndpoint,
  type WebhookSecretReveal,
} from "./webhooksModel";
import { WebhookSecretView } from "./SecretRevealModal";

export function WebhookFormModal({
  opened,
  onClose,
  endpoint,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  /** `null` = création ; sinon édition de cet endpoint. */
  endpoint: WebhookEndpoint | null;
  /** Appelé après création/édition réussie (recharge la liste). */
  onSaved: () => void;
}) {
  const store = useStore();
  const isEdit = endpoint !== null;

  // ── État du formulaire (réinitialisé à chaque ouverture via la clé du Modal) ──
  const [url, setUrl] = useState(endpoint?.url ?? "");
  const [wildcard, setWildcard] = useState(
    endpoint ? endpoint.events.includes(WILDCARD_EVENT) : false,
  );
  const [events, setEvents] = useState<string[]>(
    endpoint ? endpoint.events.filter((e) => e !== WILDCARD_EVENT) : [],
  );
  const [description, setDescription] = useState(endpoint?.description ?? "");
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Secret révélé après création (phase 2). `null` en édition. */
  const [created, setCreated] = useState<WebhookSecretReveal | null>(null);

  const catalogueSelected = useMemo(
    () => events.filter((e) => CATALOGUE_EVENTS.includes(e)),
    [events],
  );
  const freeEvents = useMemo(
    () => events.filter((e) => !CATALOGUE_EVENTS.includes(e)),
    [events],
  );

  function handleClose(): void {
    const didCreate = created !== null;
    onClose();
    if (didCreate) onSaved();
  }

  /** Liste finale d'événements envoyée au serveur (jamais vide). */
  function resolveEvents(): string[] {
    if (wildcard) return [WILDCARD_EVENT];
    return events;
  }

  async function submit(): Promise<void> {
    setError(null);
    const urlError = validateWebhookUrl(url);
    if (urlError) {
      setError(urlError);
      return;
    }
    const finalEvents = resolveEvents();
    if (finalEvents.length === 0) {
      setError(
        "Sélectionnez au moins un événement (ou « Tous les événements »).",
      );
      return;
    }
    setSubmitting(true);
    try {
      const desc = description.trim() === "" ? null : description.trim();
      if (isEdit) {
        await store.api.patchAbsolute(webhookEndpoint(endpoint.id), {
          url: url.trim(),
          events: finalEvents,
          description: desc,
          enabled,
        });
        onSaved();
        onClose();
      } else {
        const result = await store.api.postAbsolute<WebhookSecretReveal>(
          WEBHOOKS_ENDPOINT,
          { url: url.trim(), events: finalEvents, description: desc, enabled },
        );
        setCreated(result);
      }
    } catch (e) {
      setError(describeWebhooksError(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <IconWebhook size={18} />
          <Text fw={700}>
            {created
              ? "Webhook créé — copiez le secret"
              : isEdit
                ? "Modifier le webhook"
                : "Nouveau webhook"}
          </Text>
        </Group>
      }
      centered
      size="lg"
      closeOnClickOutside={created === null}
    >
      {created !== null ? (
        // ── Phase 2 : secret révélé (1×) ───────────────────────────────────────
        <Stack gap="md">
          <WebhookSecretView
            secret={created.secret}
            url={created.endpoint.url}
            context="created"
          />
          <Group justify="flex-end">
            <Button leftSection={<IconCheck size={16} />} onClick={handleClose}>
              J'ai copié le secret
            </Button>
          </Group>
        </Stack>
      ) : (
        // ── Phase 1 : formulaire ───────────────────────────────────────────────
        <Stack gap="md">
          <Box mih={44}>
            {error && (
              <Alert
                role="alert"
                variant="light"
                color="red"
                icon={<IconAlertTriangle size={16} />}
              >
                {error}
              </Alert>
            )}
          </Box>

          <TextInput
            label="URL de destination"
            description="Endpoint qui recevra les livraisons signées. Validé anti-SSRF côté serveur (pas d'IP privée/interne en prod). En dev, le récepteur de test local est sur le port http 5151."
            placeholder="http://127.0.0.1:5151/nodefony/test/webhooks/sink"
            required
            value={url}
            onChange={(e) => {
              setUrl(e.currentTarget.value);
              if (error) setError(null);
            }}
            data-autofocus
          />

          <Stack gap="xs">
            <Switch
              label="Tous les événements (*)"
              description="Livrer chaque événement d'audit (sauf les événements webhook eux-mêmes, anti-boucle)."
              checked={wildcard}
              onChange={(e) => setWildcard(e.currentTarget.checked)}
              thumbIcon={wildcard ? <IconAsterisk size={12} /> : undefined}
            />

            {!wildcard && (
              <Stack gap="sm">
                <Checkbox.Group
                  label="Événements souscrits"
                  description="Actions d'audit qui déclenchent une livraison. La liste s'enrichit côté serveur ; complétez librement ci-dessous si besoin."
                  value={catalogueSelected}
                  onChange={(checked) => setEvents([...checked, ...freeEvents])}
                >
                  <Stack gap="sm" mt="xs">
                    {WEBHOOK_EVENT_CATALOGUE.map((g) => (
                      <Box key={g.domain}>
                        <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                          {g.domain}
                        </Text>
                        <Stack gap={4} mt={4}>
                          {g.events.map((ev) => (
                            <Checkbox
                              key={ev.value}
                              value={ev.value}
                              label={ev.label}
                            />
                          ))}
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                </Checkbox.Group>

                <TagsInput
                  label="Événements personnalisés (optionnel)"
                  description="Toute action d'audit hors catalogue (ex. user.created, order.shipped si émise par votre app)."
                  placeholder="user.created, session.expired…"
                  value={freeEvents}
                  onChange={(free) =>
                    setEvents([...catalogueSelected, ...free])
                  }
                  clearable
                />
              </Stack>
            )}
          </Stack>

          <Textarea
            label="Description (optionnel)"
            description="Libellé humain pour reconnaître l'endpoint."
            placeholder="Notifie le SIEM des connexions échouées"
            value={description}
            maxLength={200}
            autosize
            minRows={1}
            maxRows={3}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />

          <Switch
            label="Actif"
            description="Un endpoint désactivé ne reçoit aucune livraison."
            checked={enabled}
            onChange={(e) => setEnabled(e.currentTarget.checked)}
          />

          <Group justify="flex-end" mt="xs">
            <Button variant="default" onClick={handleClose}>
              Annuler
            </Button>
            <Button
              leftSection={<IconWebhook size={16} />}
              loading={submitting}
              onClick={submit}
            >
              {isEdit ? "Enregistrer" : "Créer le webhook"}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
