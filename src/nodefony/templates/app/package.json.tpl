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
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "nodefony": "^{{nodefonyVersion}}",
    "@nodefony/http": "^{{nodefonyVersion}}",
    "@nodefony/framework": "^{{nodefonyVersion}}",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "rolldown": "^1.1.5",
    "typescript": "^6.0.0"
  }
}
