/**
 * Éditeur des index de TABLE (`--index`, `--unique`) — chaque index se compose
 * en SÉLECTIONNANT ses colonnes parmi les champs déclarés, au lieu d'une liste
 * « colA,colB » à taper.
 *
 * Il écrit la réponse `list` telle que la commande l'attend (une entrée
 * « colA,colB » par index) ; l'analyseur du générateur juge le reste (colonne
 * inconnue, répétée, implicite absente) à la préview.
 */
import { useState } from "react";

/**
 * Une ligne de l'éditeur : ses colonnes, et une IDENTITÉ qui survit au retrait
 * d'une ligne voisine. Clé par rang, retirer le premier index faisait hériter
 * au suivant du `MultiSelect` du disparu — sa saisie de recherche, sa liste
 * ouverte.
 */
interface IIndexRow {
  id: number;
  cols: string[];
}

/** Compteur d'identités, partagé par toutes les instances : seule l'unicité compte. */
let nextRowId = 0;
const toRow = (cols: string[]): IIndexRow => ({ id: nextRowId++, cols });
import {
  ActionIcon,
  Button,
  Group,
  MultiSelect,
  Stack,
  Text,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";

interface EntityIndexesEditorProps {
  label: string;
  /** Colonnes qu'un index peut couvrir : champs déclarés + colonnes implicites. */
  columns: string[];
  /** Réponse courante — une entrée « colA,colB » par index. */
  value: string[];
  onChange: (value: string[]) => void;
}

export function EntityIndexesEditor({
  label,
  columns,
  value,
  onChange,
}: EntityIndexesEditorProps) {
  // Lignes en état LOCAL : un index qu'on vient d'ajouter n'a encore aucune
  // colonne, et l'envoyer tel quel ferait refuser la préview (entrée vide).
  // On n'émet que les index qui ont au moins une colonne.
  const [indexes, setIndexes] = useState<IIndexRow[]>(() =>
    value.map((entry) => toRow(entry.split(",").filter(Boolean))),
  );
  const write = (next: IIndexRow[]): void => {
    setIndexes(next);
    onChange(
      next.filter((r) => r.cols.length > 0).map((r) => r.cols.join(",")),
    );
  };

  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      {indexes.length === 0 && (
        <Text size="xs" c="dimmed">
          Aucun — un index qui porte PLUSIEURS colonnes se compose ici.
        </Text>
      )}
      {indexes.map((row, i) => (
        <Group key={row.id} gap="xs" align="flex-end" wrap="nowrap">
          <MultiSelect
            aria-label={`${label} ${i + 1}`}
            data={columns}
            value={row.cols}
            onChange={(next) =>
              write(
                indexes.map((r) =>
                  r.id === row.id ? { ...r, cols: next } : r,
                ),
              )
            }
            placeholder={
              columns.length
                ? "colonnes, dans l'ordre"
                : "déclarez d'abord des champs"
            }
            disabled={columns.length === 0}
            style={{ flex: 1 }}
          />
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Retirer ${label.toLowerCase()} ${i + 1}`}
            onClick={() => write(indexes.filter((r) => r.id !== row.id))}
            mb={6}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button
          variant="light"
          size="compact-sm"
          leftSection={<IconPlus size={14} />}
          disabled={columns.length < 2}
          onClick={() => write([...indexes, toRow([])])}
        >
          Ajouter
        </Button>
      </Group>
    </Stack>
  );
}
