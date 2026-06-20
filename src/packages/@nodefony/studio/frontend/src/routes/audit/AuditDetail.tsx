/**
 * Fiche détail d'un événement d'audit — **Modal centré** (préférence projet : pas
 * de drawer). Affiche tous les champs en TEXTE (données non maîtrisées → jamais de
 * HTML) + le saut malin : si l'événement porte un `requestId`, bouton « Voir la
 * trace complète » → page TraceView (corrélation audit ↔ requête HTTP/WS).
 */
import type { ReactNode } from "react";
import {
  Modal,
  Stack,
  Group,
  Text,
  Code,
  Badge,
  Button,
  Divider,
  Box,
} from "@mantine/core";
import { IconRoute, IconLock, IconCookie } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

import { JsonViewer } from "../../components/ui";
import {
  CategoryBadge,
  OutcomeBadge,
  ActorText,
  formatDateTime,
} from "./auditFormat";
import type { AuditEvent } from "./auditModel";

export interface AuditDetailProps {
  event: AuditEvent | null;
  onClose: () => void;
}

/** Ligne label→valeur RICHE (valeur = ReactNode, jamais wrappée dans un `<p>`). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md" align="flex-start">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Box style={{ textAlign: "right", minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

/** Valeur texte simple ou « — » si absente. */
function Value({ children }: { children: string | null | undefined }) {
  if (!children) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    );
  }
  return (
    <Text size="sm" style={{ wordBreak: "break-word" }}>
      {children}
    </Text>
  );
}

export function AuditDetail({ event, onClose }: AuditDetailProps) {
  const navigate = useNavigate();
  if (!event) return null;

  const goToTrace = () => {
    if (!event.requestId) return;
    onClose();
    navigate(`/nodefony/logs/trace/${encodeURIComponent(event.requestId)}`);
  };

  return (
    <Modal
      opened={event !== null}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={700}>Événement d'audit</Text>
          <Code>{event.action}</Code>
        </Group>
      }
      size="lg"
      centered
    >
      <Stack gap="sm">
        <Field label="Horodatage">
          <Value>{formatDateTime(event.ts)}</Value>
        </Field>
        <Field label="Catégorie">
          <CategoryBadge category={event.category} />
        </Field>
        <Field label="Action">
          <Code>{event.action}</Code>
        </Field>
        <Field label="Issue">
          <OutcomeBadge outcome={event.outcome} />
        </Field>
        <Field label="Acteur">
          <ActorText actor={event.actor} />
        </Field>

        <Divider my={4} />

        <Field label="Ressource">
          <Value>{event.resource}</Value>
        </Field>
        <Field label="Raison (machine)">
          {event.reason ? <Code>{event.reason}</Code> : <Value>{null}</Value>}
        </Field>
        <Field label="Adresse IP">
          <Value>{event.ip}</Value>
        </Field>
        <Field label="User-Agent">
          <Value>{event.userAgent}</Value>
        </Field>

        {/* Présence de matériel sensible (jamais la valeur — règle d'or audit). */}
        {(event.flags?.hasAuthorization || event.flags?.hasCookie) && (
          <Field label="Présence">
            <Group gap={6} justify="flex-end">
              {event.flags?.hasAuthorization && (
                <Badge
                  variant="light"
                  color="grape"
                  leftSection={<IconLock size={11} />}
                  style={{ textTransform: "none" }}
                >
                  Authorization
                </Badge>
              )}
              {event.flags?.hasCookie && (
                <Badge
                  variant="light"
                  color="cyan"
                  leftSection={<IconCookie size={11} />}
                  style={{ textTransform: "none" }}
                >
                  Cookie
                </Badge>
              )}
            </Group>
          </Field>
        )}

        <Divider my={4} />

        <Field label="Requête (corrélation)">
          {event.requestId ? (
            <Group gap="xs" justify="flex-end" wrap="nowrap">
              <Code>{event.requestId}</Code>
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconRoute size={13} />}
                onClick={goToTrace}
              >
                Voir la trace
              </Button>
            </Group>
          ) : (
            <Value>{null}</Value>
          )}
        </Field>
        <Field label="Identifiant">
          <Code>{event.id}</Code>
        </Field>

        {event.metadata && Object.keys(event.metadata).length > 0 && (
          <Stack gap={4}>
            <Text size="sm" c="dimmed">
              Métadonnées
            </Text>
            <JsonViewer value={event.metadata} maxHeight={200} />
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
