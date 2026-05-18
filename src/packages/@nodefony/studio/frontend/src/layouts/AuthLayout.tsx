import { Center, Paper, Stack, Title, Text } from "@mantine/core";
import { IconShield } from "@tabler/icons-react";
import type { ReactNode } from "react";

/**
 * AuthLayout — page centrée pour Login / SignUp / ForgotPassword.
 * Sidebar / header NON visibles.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Center mih="100vh" p="md">
      <Paper
        radius="lg"
        p="xl"
        withBorder
        shadow="md"
        w={{ base: "100%", sm: 460 }}
      >
        <Stack gap="lg">
          <Stack gap={4} align="center">
            <IconShield size={42} stroke={1.5} />
            <Title order={3}>Nodefony Studio</Title>
            <Text c="dimmed" size="sm">
              Admin web
            </Text>
          </Stack>
          {children}
        </Stack>
      </Paper>
    </Center>
  );
}
