import { Alert, Badge, Card, Group, Stack, Text, Title } from "@mantine/core";
import { IconConnection } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: string;
  phase?: string;
  legacyRef?: string;
  children?: ReactNode;
}

/**
 * StubPage — squelette pour les pages pas encore implémentées.
 * Affiche le titre, la phase de roadmap qui la débloquera, et la référence
 * monitoring-bundle legacy si pertinent.
 */
export function StubPage({
  title,
  description,
  phase,
  legacyRef,
  children,
}: Props) {
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Title order={2}>{title}</Title>
          {description && (
            <Text c="dimmed" size="sm">
              {description}
            </Text>
          )}
        </Stack>
        {phase && (
          <Badge color="orange" variant="light" size="lg">
            {phase}
          </Badge>
        )}
      </Group>

      <Alert color="yellow" icon={<IconConnection size={18} />} variant="light">
        Page en attente d'implémentation. Stub généré à partir du legacy{" "}
        <Text span fw={600}>
          monitoring-bundle
        </Text>
        {legacyRef && (
          <>
            {" "}
            — ref :{" "}
            <Text span ff="monospace" size="sm">
              {legacyRef}
            </Text>
          </>
        )}
        .
      </Alert>

      {children && (
        <Card withBorder radius="md" p="md">
          {children}
        </Card>
      )}
    </Stack>
  );
}
