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
    "typecheck": "tsgo --noEmit"
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
    "@typescript/native-preview": "^7.0.0-dev.0",
    "rolldown": "^1.1.5"
  }
}
