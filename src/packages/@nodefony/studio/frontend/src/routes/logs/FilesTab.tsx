/**
 * **FilesTab** — onglet « Fichiers » de la page Logs, avec deux sous-modes :
 *  - **Suivi** (`tail -f` incrémental, temps réel) → {@link LogFiles} ;
 *  - **Rejeu** (magnétoscope chronologique du fichier) → {@link FileReplay}.
 *
 * Léger wrapper : chaque sous-composant charge sa propre liste de fichiers
 * (endpoint `/files`, peu coûteux) → 0 couplage, on bascule l'un/l'autre.
 */
import { useState } from "react";
import { Code, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconClockPlay, IconFolder, IconPlayerPlay } from "@tabler/icons-react";
import { LogFiles } from "../LogFiles";
import { FileReplay } from "./FileReplay";
import { InfoHint } from "../../components/ui";

type FilesMode = "follow" | "replay";

/** @param logDir - dossier des fichiers JSONL/.log (`null` en prod cloud-native). */
export function FilesTab({ logDir }: { logDir?: string | null }) {
  const [mode, setMode] = useState<FilesMode>("follow");
  return (
    <Stack gap="sm">
      {/* Où sont les fichiers — répond à « les logs sortent où ? ». */}
      <Group gap={6} wrap="nowrap">
        <IconFolder size={15} />
        <Text size="xs" c="dimmed">
          Dossier&nbsp;:
        </Text>
        {logDir ? (
          <Code>{logDir}</Code>
        ) : (
          <Text size="xs" c="dimmed">
            aucun — production cloud-native : logs → stdout → collecteur (pas de
            fichiers locaux)
          </Text>
        )}
      </Group>
      <Group gap="xs">
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => setMode(v as FilesMode)}
          data={[
            {
              value: "follow",
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconClockPlay size={14} />
                  <span>Suivi (tail)</span>
                </Group>
              ),
            },
            {
              value: "replay",
              label: (
                <Group gap={4} wrap="nowrap">
                  <IconPlayerPlay size={14} />
                  <span>Rejeu</span>
                </Group>
              ),
            },
          ]}
          aria-label="mode de lecture des fichiers de log"
        />
        <InfoHint
          text={
            mode === "follow"
              ? "Suivi : affiche les nouvelles lignes au fil de l'eau (comme tail -f)."
              : "Rejeu : relit le fichier comme un enregistrement, à son propre rythme (play/pause/vitesse)."
          }
        />
      </Group>
      {mode === "follow" ? <LogFiles /> : <FileReplay />}
    </Stack>
  );
}
