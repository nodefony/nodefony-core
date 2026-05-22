import { Center, Paper, Stack, Title, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { NodefonyLogo } from "../components/NodefonyLogo";

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
          <Stack gap={8} align="center">
            <NodefonyLogo height={52} />
            <Title order={3}>
              Nodefony{" "}
              <Text span c="brand" inherit>
                Studio
              </Text>
            </Title>
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
