/**
 * **SourceTab** — l'onglet Source de la page des journaux : trois réponses en
 * trois cartes (où sont lus les journaux, qui les envoie, où ils sont gardés),
 * ce que l'application écrit d'autre, puis — replié — tout l'outillage
 * technique (pilotes, interrupteurs à chaud, compteurs, configuration).
 *
 * Les mots viennent de `describeSource` : la barre d'état, le bandeau des
 * Journaux et cet onglet disent la même chose, d'une seule règle.
 */
import { useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Collapse,
  Divider,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import type { ISourceDescription } from "./logFormat";
import type { BackplaneMeta } from "./logsTypes";
import { DestinationPing } from "./BackplanePanel";

export interface SourceTabProps {
  meta: BackplaneMeta | null;
  source: ISourceDescription;
  /** L'outillage technique, rendu sous « Détails techniques ». */
  details: ReactNode;
}

/** Première lettre en capitale : « la mémoire… » ouvre une carte. */
const capitalize = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1);

function SourceCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card withBorder radius="md" padding="md">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={6}>
        {title}
      </Text>
      <Stack gap={6}>{children}</Stack>
    </Card>
  );
}

export function SourceTab({ meta, source, details }: SourceTabProps) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        <SourceCard title="Où sont lus les journaux">
          <Text fw={700}>{capitalize(source.label)}</Text>
          {source.remote ? (
            <DestinationPing driverName={source.driverName} />
          ) : (
            source.feederText && (
              <Text size="sm" c="dimmed">
                {capitalize(source.feederText)}.
              </Text>
            )
          )}
        </SourceCard>
        <SourceCard title="Qui les envoie">
          <Text size="sm">{source.senderText}</Text>
        </SourceCard>
        <SourceCard title="Où ils sont gardés">
          <Text size="sm">{source.retentionText}</Text>
        </SourceCard>
      </SimpleGrid>

      {source.alsoWrites.length > 0 && (
        <Text size="sm">
          Cette application écrit aussi :{" "}
          <Text span fw={600}>
            {source.alsoWrites.join(" · ")}
          </Text>
        </Text>
      )}

      <Divider />
      <div>
        <Button
          variant="subtle"
          size="compact-sm"
          leftSection={
            open ? (
              <IconChevronDown size={16} />
            ) : (
              <IconChevronRight size={16} />
            )
          }
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="logs-source-details"
        >
          Détails techniques
        </Button>
        <Text size="xs" c="dimmed" ml={4}>
          Pilotes enregistrés, tampon mémoire interne, interrupteurs à chaud
          {meta?.environment === "development" ? " (développement)" : ""},
          compteurs et configuration.
        </Text>
      </div>
      <Collapse expanded={open} id="logs-source-details">
        <Stack gap="lg">{details}</Stack>
      </Collapse>
    </Stack>
  );
}
