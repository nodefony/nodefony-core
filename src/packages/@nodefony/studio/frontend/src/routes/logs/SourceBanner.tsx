/**
 * **SourceBanner** — en-tête de l'onglet Journaux : dit, en une ligne, d'où
 * viennent les lignes affichées et qui les y a mises.
 *
 * Aucun badge de capacité ici : un exploitant veut savoir « d'où » et « par
 * qui », pas ce que le pilote sait faire. Le détail technique vit dans l'onglet
 * Source.
 */
import { Box, Group, Paper, Text } from "@mantine/core";
import { DocHint } from "../../components/ui";
import { LOGS_DOC, type ISourceDescription } from "./logFormat";
import { DriverIcon } from "./LogVisuals";

export interface SourceBannerProps {
  source: ISourceDescription;
}

export function SourceBanner({ source }: SourceBannerProps) {
  return (
    <Paper
      withBorder
      radius="md"
      p="sm"
      bg="var(--mantine-color-default-hover)"
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <DriverIcon name={source.driverName ?? "generic"} />
          <Box style={{ minWidth: 0 }}>
            <Text fw={700}>Source : {source.label}</Text>
            {source.feederText && (
              <Text size="sm" c="dimmed">
                {source.feederText}
              </Text>
            )}
          </Box>
        </Group>
        <DocHint
          title="D'où viennent ces lignes"
          version={LOGS_DOC}
          summary={`Les lignes ci-dessous sont lues dans ${source.label}. La recherche et les filtres portent sur tout ce que cette source a gardé, pas seulement sur la page affichée.`}
          sections={[
            {
              label: "Qui les y a mises",
              body:
                source.feeder === "collector"
                  ? "Un collecteur externe (Alloy, Promtail, Fluent Bit…) lit la sortie de l'application et l'envoie à cette source. L'application, elle, ne fait que relire."
                  : source.feeder === "app"
                    ? "L'application envoie elle-même ses journaux à cette source."
                    : "Ce processus garde lui-même ses dernières lignes. Rien n'est conservé ailleurs.",
            },
            {
              label: "Changer de source",
              body: "L'onglet Source montre où les journaux sont lus, qui les envoie et où ils sont gardés.",
            },
          ]}
        />
      </Group>
    </Paper>
  );
}
