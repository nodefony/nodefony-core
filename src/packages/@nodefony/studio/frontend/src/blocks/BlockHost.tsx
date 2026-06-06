import { Group, Modal, Paper, Text, ThemeIcon } from "@mantine/core";
import { getWidget } from "../workspace/registry";
import type { WidgetRuntimeContext } from "../workspace/types";
import { BlockView } from "./BlockView";

/* ════════════════════════════════════════════════════════════════════════
 * Enveloppes par CONTENANT autres que le widget de bureau (= WidgetHost).
 *  - BlockDialog : ouvre un bloc en boîte de dialogue (Modal) autonome.
 *  - BlockPanel  : monte un bloc dans une page (Paper titré).
 * Les deux résolvent le bloc dans le registre unifié et délèguent à BlockView.
 * ════════════════════════════════════════════════════════════════════════ */

export interface BlockDialogProps {
  blockId: string | null;
  opened: boolean;
  onClose: () => void;
  ctx: WidgetRuntimeContext;
}

/** Ouvre un bloc en DIALOG (Modal centré). */
export function BlockDialog({
  blockId,
  opened,
  onClose,
  ctx,
}: BlockDialogProps) {
  const def = blockId ? getWidget(blockId) : undefined;
  const Icon = def?.icon;
  return (
    <Modal
      opened={opened && !!def}
      onClose={onClose}
      size="lg"
      centered
      radius="md"
      title={
        def ? (
          <Group gap="xs">
            {Icon ? (
              <ThemeIcon variant="light" color="gray" radius="md">
                <Icon size={18} />
              </ThemeIcon>
            ) : null}
            <Text fw={700}>{def.title}</Text>
          </Group>
        ) : null
      }
    >
      {def ? <BlockView def={def} ctx={ctx} container="dialog" /> : null}
    </Modal>
  );
}

export interface BlockPanelProps {
  blockId: string;
  ctx: WidgetRuntimeContext;
}

/** Monte un bloc dans une PAGE (Paper titré). */
export function BlockPanel({ blockId, ctx }: BlockPanelProps) {
  const def = getWidget(blockId);
  if (!def) return null;
  const Icon = def.icon;
  return (
    <Paper withBorder radius="md" p="md">
      <Group gap="xs" mb="sm">
        <ThemeIcon variant="light" color="gray" radius="md">
          <Icon size={16} />
        </ThemeIcon>
        <Text fw={700}>{def.title}</Text>
      </Group>
      <BlockView def={def} ctx={ctx} container="page" />
    </Paper>
  );
}
