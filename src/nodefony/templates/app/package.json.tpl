{
  "name": "{{appName}}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Application Nodefony — générée par `nodefony create app`",
  "main": "dist/index.js",
  "scripts": {
    "dev": "nodefony development",
    "build": "rolldown -c rolldown.config.ts",
    "start": "nodefony production",
    "stop": "nodefony stop",
    "status": "nodefony status",
    "test": "vitest run",
    "test:e2e": "npm run build && RUN_E2E=1 vitest run tests/e2e.test.ts",
    "typecheck": "tsgo --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "infra:up": "docker compose up -d",
    "infra:down": "docker compose down"
  },
  "dependencies": {
    "nodefony": "^{{nodefonyVersion}}",
    "@nodefony/http": "^{{nodefonyVersion}}",
    "@nodefony/framework": "^{{nodefonyVersion}}",
    "@nodefony/orm-core": "^{{nodefonyVersion}}",
    "@nodefony/drizzle": "^{{nodefonyVersion}}",
    "@nodefony/user": "^{{nodefonyVersion}}",
    "@nodefony/realtime": "^{{nodefonyVersion}}",
    "@nodefony/security": "^{{nodefonyVersion}}",
    "@nodefony/frontend": "^{{nodefonyVersion}}",
    "@nodefony/studio": "^{{nodefonyVersion}}",
    "@nodefony/redis": "^{{nodefonyVersion}}",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@typescript-eslint/eslint-plugin": "^8.63.0",
    "@typescript-eslint/parser": "^8.63.0",
    "@typescript/native-preview": "^7.0.0-dev.0",
    "eslint": "^10.6.0",
    "eslint-config-prettier": "^10.1.8",
    "prettier": "^3.9.5",
    "rolldown": "^1.1.5",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
