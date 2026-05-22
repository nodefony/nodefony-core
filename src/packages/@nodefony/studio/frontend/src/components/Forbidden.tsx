import { observer } from "mobx-react-lite";
import { Stack, ThemeIcon, Title, Text, Button, Code } from "@mantine/core";
import { IconLock, IconHome } from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useAuth } from "../stores";

/**
 * Page 403 — accès refusé faute de rôle. Annonce explicite (role="alert") +
 * retour vers l'accueil autorisé de l'utilisateur.
 */
export const Forbidden = observer(({ roles }: { roles?: string[] }) => {
  const auth = useAuth();
  return (
    <Stack align="center" justify="center" h="60vh" gap="md" role="alert">
      <ThemeIcon size={64} radius="xl" variant="light" color="red">
        <IconLock size={34} />
      </ThemeIcon>
      <Title order={2}>403 — Accès refusé</Title>
      <Text c="dimmed" ta="center" maw={460}>
        Cette page requiert un rôle que ton compte ne possède pas.
        {roles && roles.length > 0 && (
          <>
            {" "}
            Rôle(s) requis : <Code>{roles.join(", ")}</Code>.
          </>
        )}
      </Text>
      <Button
        component={Link}
        to={auth.homePath}
        leftSection={<IconHome size={16} />}
      >
        Retour à l'accueil
      </Button>
    </Stack>
  );
});
