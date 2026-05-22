import type { ReactNode } from "react";
import { Alert, Button, Center, Loader, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconInbox, IconRefresh } from "@tabler/icons-react";

export interface DataStateProps {
  loading: boolean;
  error?: string | null;
  /** `true` si la donnée est chargée mais vide (liste 0 élément). */
  empty?: boolean;
  /** Relance — rendue comme bouton dans l'état erreur (et vide si fourni). */
  onRetry?: () => void;
  /** Message de l'état vide. */
  emptyMessage?: ReactNode;
  /** Hauteur min des états transitoires centrés (px). Défaut 200. */
  minHeight?: number;
  children: ReactNode;
}

/**
 * DataState — rend l'UN des 4 états d'un chargement : *error* (+ Réessayer),
 * *loading*, *empty*, ou le contenu. Supprime le boilerplate
 * `loading ? <Loader/> : error ? <Alert/> : …` répété dans chaque page.
 *
 * Ordre de priorité : error > loading > empty > children. À coupler avec
 * {@link useResource} :
 * ```tsx
 * const { data, loading, error, reload } = useResource(fetcher);
 * <DataState loading={loading} error={error} empty={!data?.length} onRetry={reload}>
 *   {data.map(…)}
 * </DataState>
 * ```
 *
 * Accessibilité : l'état chargement porte `aria-busy` + `aria-live="polite"`
 * (le lecteur d'écran annonce l'arrivée du contenu).
 */
export function DataState({
  loading,
  error,
  empty,
  onRetry,
  emptyMessage,
  minHeight = 200,
  children,
}: DataStateProps) {
  if (error) {
    return (
      <Alert
        color="red"
        variant="light"
        icon={<IconAlertTriangle size={16} />}
        title="Erreur de chargement"
      >
        <Stack gap="sm" align="flex-start">
          <Text size="sm">{error}</Text>
          {onRetry && (
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={14} />}
              onClick={onRetry}
            >
              Réessayer
            </Button>
          )}
        </Stack>
      </Alert>
    );
  }
  if (loading) {
    return (
      <Center mih={minHeight} aria-busy="true" aria-live="polite">
        <Loader />
      </Center>
    );
  }
  if (empty) {
    return (
      <Center mih={minHeight}>
        <Stack gap={4} align="center" c="dimmed">
          <IconInbox size={28} stroke={1.4} />
          <Text size="sm">{emptyMessage ?? "Aucune donnée."}</Text>
        </Stack>
      </Center>
    );
  }
  return <>{children}</>;
}
