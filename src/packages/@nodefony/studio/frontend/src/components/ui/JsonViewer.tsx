import { useState } from "react";
import { ActionIcon, Code, Group, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";

export interface JsonViewerProps {
  value: unknown;
  /** Hauteur max scrollable (px). Défaut 420. */
  maxHeight?: number;
}

/**
 * JsonViewer — affiche un objet/réponse JSON indenté, read-only, avec bouton
 * « copier ». Utilisé par l'explorer Admin API (System) et tout panneau qui
 * dumpe une réponse data plane.
 *
 * Sécurité : rendu via `<Code>` (texte pur, jamais de HTML) → aucune injection
 * possible même si la réponse serveur contient du markup. C'est le rendu sûr à
 * privilégier pour afficher des données non maîtrisées.
 */
export function JsonViewer({ value, maxHeight = 420 }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);

  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }

  const copy = (): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div style={{ position: "relative" }}>
      <Group
        justify="flex-end"
        style={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}
      >
        <Tooltip label={copied ? "Copié" : "Copier le JSON"}>
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={copy}
            aria-label="Copier le JSON"
          >
            {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
          </ActionIcon>
        </Tooltip>
      </Group>
      <Code
        block
        style={{
          maxHeight,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {text}
      </Code>
    </div>
  );
}
