Title: Node.js language-specific guide

URL Source: https://docs.docker.com/guides/nodejs/deploy/

Published Time: 2026-09-07 13:38:47 +0200 +0200

Markdown Content:
Insights on the state of AI agents from 800+ builders and leaders. Download your copy
✕
Get started
Guides
Manuals
Reference
Gordon
Search
Home
/
Guides
/
Node.js
Node.js language-specific guide

This guide explains how to containerize Node.js applications using Docker.

Ask Gordon
Copy Markdown
View Markdown

Node.js is a JavaScript runtime for building server-side applications. This guide shows you how to containerize a TypeScript Node.js application using Docker, starting from a simple Express API and progressively adding features like a database.

This guide focuses on a backend Node.js API. If you're building a standalone frontend application, Docker has dedicated guides for React.js, Vue.js, Angular, and Next.js.

Acknowledgment

Docker thanks Kristiyan Velkov for his contribution to this guide.

What will you learn?

In this guide, you'll learn how to:

Containerize and run a Node.js application using Docker.
Set up a local development environment using containers.
Run tests inside a Docker container.

Start by containerizing a Node.js application.

Prerequisites
Basic understanding of JavaScript and TypeScript.
Basic knowledge of Node.js and npm.
Familiarity with Docker concepts such as images, containers, and Dockerfiles. If you're new to Docker, start with the Docker basics guide.
Containerize a Node.js application
Prerequisites
You have installed the latest version of Docker Desktop.
You're familiar with basic Docker concepts. If you're new to Docker, start with Build and share a containerized application.
Overview

Containerizing your application means packaging it together with its dependencies, configuration, and runtime into a single portable unit called a container image. Running that image creates a container, an isolated process that behaves the same on any machine, whether it's your laptop, a CI runner, or a production server.

In this section, you'll containerize a simple Express.js API written in TypeScript. You'll write a Dockerfile that describes how to build the image, add a compose.yaml file that defines how Docker runs your container, and then build and start the application with one command.

You'll use Docker Hardened Images as the base. These are minimal, secure Node.js images maintained by Docker.

This guide focuses on a backend Node.js API. If you're building a standalone frontend application, Docker has dedicated guides for React.js, Vue.js, Angular, and Next.js.

Create the application

The sample application is a minimal Express API with a single endpoint that returns a JSON greeting. Create the following files in a new nodejs-docker-example directory. To create all the files at once, switch to the Scaffold script tab in the file browser and copy the shell command.

nodejs-docker-example
Files
Scaffold script
nodejs-docker-example
src
index.ts
A
package.json
A
tsconfig.json
A
.gitignore
A
// A minimal Express application.

// The root endpoint (GET /) returns a JSON greeting.

// See https://expressjs.com/ for the framework reference.

import express, { type Request, type Response } from "express";

const app = express();

const port = parseInt(process.env.PORT ?? "3000", 10);

app.get("/", (_req: Request, res: Response) => {

res.json({ message: "Hello World" });

});

app.listen(port, () => {

console.log(`Server listening on port ${port}`);

});

If you have Node.js installed and want to verify the app works before containerizing it, you can run it locally.

To run in development mode with hot-reload:

$ npm install

$ npm run dev

To run the compiled production build (matching what the Dockerfile does):

$ npm install

$ npm run build

$ npm start

Then open http://localhost:3000 in your browser. You should see {"message":"Hello World"}.

If you don't have Node.js installed, skip ahead. The remaining steps run the application in a container, with no local Node.js required.

Create the Docker assets

Sign in to the DHI registry so Docker can pull the Node.js base images during the build. The available Node.js images are listed in the catalog.

$ docker login dhi.io

Add the following three files to your nodejs-docker-example directory. The Dockerfile describes how to build the image, compose.yaml defines how Docker runs the container, and .dockerignore keeps unwanted files out of the build context.

Tip

Gordon, Docker's AI assistant, can generate Docker assets for your project. Ask Gordon to create a Dockerfile, Compose file, and .dockerignore tailored to your application.

nodejs-docker-example
Files
Scaffold script
nodejs-docker-example
src
index.ts
package.json
tsconfig.json
Dockerfile
A
compose.yaml
A
.dockerignore
A
.gitignore
// A minimal Express application.

// The root endpoint (GET /) returns a JSON greeting.

// See https://expressjs.com/ for the framework reference.

import express, { type Request, type Response } from "express";

const app = express();

const port = parseInt(process.env.PORT ?? "3000", 10);

app.get("/", (_req: Request, res: Response) => {

res.json({ message: "Hello World" });

});

app.listen(port, () => {

console.log(`Server listening on port ${port}`);

});

The Dockerfile uses three stages. The builder stage installs all dependencies and compiles TypeScript. The deps stage does a fresh install of production-only dependencies. The runner stage copies the compiled output and production node_modules into a minimal runtime image that contains only Node.js.

To learn more about each file, see the following:

Dockerfile
.dockerignore
compose.yaml
Run the application

Inside the nodejs-docker-example directory, run the following command in a terminal.

$ docker compose up --build

Open a browser and view the application at http://localhost:3000. You should see {"message":"Hello World"}.

In the terminal, press ctrl+c to stop the application.

Run the application in the background

You can run the application detached from the terminal by adding the -d option. Inside the nodejs-docker-example directory, run the following command in a terminal.

$ docker compose up --build -d

Open a browser and view the application at http://localhost:3000.

In the terminal, run the following command to stop the application.

$ docker compose down

For more information about Compose commands, see the Compose CLI reference.

Use containers for Node.js development
Prerequisites

Complete Containerize a Node.js application.

Overview

Once your application runs in a container, the next step is making the container part of your everyday development workflow. Code changes should show up quickly, and services your app depends on, like databases, should run right alongside it.

In this section, you'll adapt the Dockerfile for local development by renaming the builder stage to dev and pointing Compose at it. You'll also update the application to connect to a PostgreSQL database, add a database service to compose.yaml, persist data in a named volume, enable Compose Watch so changes in your editor are picked up without a manual rebuild, and set up Node.js debugging so you can attach VS Code or Chrome DevTools to the running container.

Update the application

You'll update your application to connect to a PostgreSQL database. Continue working in your nodejs-docker-example directory.

Replace src/index.ts and package.json with the following contents. The file browser shows only the files that change in this step.

Note

The application won't run yet after this step. It tries to connect to a PostgreSQL database that doesn't exist. The next two sections add the database service and the Docker configuration needed to run everything together.

nodejs-docker-example
Files
Scaffold script
nodejs-docker-example
src
index.ts
M
package.json
M
// Express application backed by a PostgreSQL database.

// Creates a heroes table at startup.

// Endpoints: GET / (greeting), GET /health (health check), POST /heroes/ (create), GET /heroes/ (list).

// See https://expressjs.com/ and https://node-postgres.com/

import express, { type Request, type Response } from "express";

import { Pool } from "pg";

import { readFileSync } from "fs";

const app = express();

const port = parseInt(process.env.PORT ?? "3000", 10);

app.use(express.json());

function getPassword(): string {

const passwordFile = process.env.POSTGRES_PASSWORD_FILE;

if (passwordFile) {

    return readFileSync(passwordFile, "utf8").trim();

}

return process.env.POSTGRES_PASSWORD ?? "";

}

const pool = new Pool({

host: process.env.POSTGRES_SERVER,

port: 5432,

database: process.env.POSTGRES_DB,

user: process.env.POSTGRES_USER,

password: getPassword(),

});

pool

.query(

    `CREATE TABLE IF NOT EXISTS heroes (

      id SERIAL PRIMARY KEY,

      name TEXT NOT NULL,

      secret_name TEXT NOT NULL,

      age INTEGER

    )`,

)

.catch(console.error);

app.get("/", (_req: Request, res: Response) => {

res.json({ message: "Hello World" });

});

app.get("/health", (_req: Request, res: Response) => {

res.json({ status: "ok" });

});

app.post("/heroes/", async (req: Request, res: Response) => {

const { name, secret_name, age } = req.body as {

    name: string;

    secret_name: string;

    age?: number;

};

const result = await pool.query(

    "INSERT INTO heroes (name, secret_name, age) VALUES ($1, $2, $3) RETURNING *",

    [name, secret_name, age],

);

res.json(result.rows[0]);

});

app.get("/heroes/", async (_req: Request, res: Response) => {

const result = await pool.query("SELECT * FROM heroes");

res.json(result.rows);

});

app.listen(port, () => {

console.log(`Server listening on port ${port}`);

});
Update Docker assets

Replace Dockerfile and compose.yaml with the following.

nodejs-docker-example
Files
Scaffold script
nodejs-docker-example
Dockerfile
M
compose.yaml
M

# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.

# If you need more help, visit the Dockerfile reference guide at

# https://docs.docker.com/go/dockerfile-reference/

# This Dockerfile uses Docker Hardened Images (DHI) for enhanced security.

# For more information, see https://docs.docker.com/dhi/

# Development stage: install all dependencies, compile TypeScript, and

# serve with hot-reload. Used directly in development via compose.yaml.

FROM dhi.io/node:24-alpine3.23-dev AS dev

WORKDIR /app

# Install dependencies as a separate step to take advantage of Docker's

# caching. Leverage a cache mount to /root/.npm to speed up subsequent

# builds. Leverage a bind mount to package.json to avoid having to copy

# it into this layer.

RUN --mount=type=cache,target=/root/.npm \

    --mount=type=bind,source=package.json,target=package.json \

    npm install

# Once you create a package-lock.json by running npm install locally, switch to npm ci and bind both files:

# RUN --mount=type=cache,target=/root/.npm \

# --mount=type=bind,source=package.json,target=package.json \

# --mount=type=bind,source=package-lock.json,target=package-lock.json \

# npm ci

# Copy the source code into the container and compile TypeScript.

COPY . .

RUN npm run build

# Expose the port that the application listens on.

EXPOSE 3000

# Run the application in development mode.

CMD ["npm", "run", "dev"]

# Deps stage: install production dependencies only.

FROM dhi.io/node:24-alpine3.23-dev AS deps

WORKDIR /app

RUN --mount=type=cache,target=/root/.npm \

    --mount=type=bind,source=package.json,target=package.json \

    npm install --omit=dev

# Once you create a package-lock.json by running npm install locally, switch to npm ci and bind both files:

# RUN --mount=type=cache,target=/root/.npm \

# --mount=type=bind,source=package.json,target=package.json \

# --mount=type=bind,source=package-lock.json,target=package-lock.json \

# npm ci --omit=dev

# Runner stage: minimal runtime image with compiled app and production deps.

FROM dhi.io/node:24-alpine3.23 AS runner

ENV PATH=/app/node_modules/.bin:$PATH

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules

COPY --from=dev --chown=node:node /app/dist ./dist

# Expose the port that the application listens on.

EXPOSE 3000

# Run the application.

CMD ["node", "dist/index.js"]
About these changes

The builder stage from containerize is renamed to dev and gains EXPOSE 3000 and CMD ["npm", "run", "dev"], which runs tsx watch for hot-reload. The deps and runner stages are unchanged.

In compose.yaml, the new target: dev line tells Compose to build and run the dev stage during development. Unlike the production image, the development image includes tsx and other dev tooling. If you need a shell in a running production container, use Docker Debug instead.

The build step runs tsc, which compiles each TypeScript file into a corresponding JavaScript file. esbuild is a popular alternative that bundles everything into a single output file and builds significantly faster. To switch, replace the tsc call in package.json with an esbuild command and update the COPY --from=dev path in the runner stage to match esbuild's output.

Add a local database and persist data

You can use containers to set up local services, like a database. In this section, you'll update the compose.yaml file to define a database service and a volume to persist data, and add a db/password.txt file that holds the database password.

nodejs-docker-example
Files
Scaffold script
nodejs-docker-example
db
password.txt
A
compose.yaml
M
services:

# Application service. The `target: dev` line builds the development

# image (includes tsx and dev tooling); the runner stage of the

# Dockerfile is unused in development.

server:

    build:

      context: .

      target: dev

    ports:

      - 3000:3000

    environment:

      - POSTGRES_SERVER=db

      - POSTGRES_USER=postgres

      - POSTGRES_DB=example

      - POSTGRES_PASSWORD_FILE=/run/secrets/db-password

    depends_on:

      db:

        condition: service_healthy

    secrets:

      - db-password

# Database service. Reads the password from a Docker secret mounted at

# /run/secrets/db-password. Compose waits for the healthcheck to pass

# before starting the server, via the server's depends_on.

db:

    image: dhi.io/postgres:18

    restart: always

    user: postgres

    secrets:

      - db-password

    volumes:

      - db-data:/var/lib/postgresql

    environment:

      - POSTGRES_DB=example

      - POSTGRES_PASSWORD_FILE=/run/secrets/db-password

    expose:

      - 5432

    healthcheck:

      test: ["CMD", "pg_isready"]

      interval: 10s

      timeout: 5s

      retries: 5

volumes:

db-data:

secrets:

db-password:

    file: db/password.txt

Note

To learn more about the instructions in the Compose file, see Compose file reference.

Now, run the following docker compose up command to start your application.

$ docker compose up --build

Now test your API endpoint. Open a new terminal and make a request to the server using the curl commands.

Create an object with a POST request:

$ curl -X 'POST' \

'http://localhost:3000/heroes/' \

-H 'accept: application/json' \

-H 'Content-Type: application/json' \

-d '{

"name": "my hero",

"secret_name": "austing",

"age": 12

}'

You should receive the following response:

{

"id": 1,

"name": "my hero",

"secret_name": "austing",

"age": 12

}

Now make a GET request:

$ curl http://localhost:3000/heroes/

You should receive the same response because it's the only object in the database.

Press ctrl+c in the terminal to stop your application.

Automatically update services

Use Compose Watch to automatically update your running Compose services as you edit and save your code. For more details about Compose Watch, see Use Compose Watch.

Open your compose.yaml file in an IDE or text editor and add the highlighted Compose Watch instructions.

nodejs-docker-example
Files
Scaffold script
nodejs-docker-example
compose.yaml
M
services:

# Application service. The `target: dev` line builds the development

# image (includes tsx and dev tooling); the runner stage of the

# Dockerfile is unused in development.

server:

    build:

      context: .

      target: dev

    ports:

      - 3000:3000

    environment:

      - POSTGRES_SERVER=db

      - POSTGRES_USER=postgres

      - POSTGRES_DB=example

      - POSTGRES_PASSWORD_FILE=/run/secrets/db-password

    depends_on:

      db:

        condition: service_healthy

    secrets:

      - db-password

    develop:

      watch:

        - action: sync

          path: ./src

          target: /app/src

        - action: rebuild

          path: package.json

db:

    image: dhi.io/postgres:18

    restart: always

    user: postgres

    secrets:

      - db-password

    volumes:

      - db-data:/var/lib/postgresql

    environment:

      - POSTGRES_DB=example

      - POSTGRES_PASSWORD_FILE=/run/secrets/db-password

    expose:

      - 5432

    healthcheck:

      test: ["CMD", "pg_isready"]

      interval: 10s

      timeout: 5s

      retries: 5

volumes:

db-data:

secrets:

db-password:

    file: db/password.txt

Run the following command to run your application with Compose Watch.

$ docker compose watch

In a terminal, curl the application to get a response.

$ curl http://localhost:3000

{"message":"Hello World"}

Any changes to the application's source files on your local machine will now be immediately reflected in the running container.

Open nodejs-docker-example/src/index.ts in an IDE or text editor and update the Hello World string by adding a few more exclamation marks.

- res.json({ message: 'Hello World' });

* res.json({ message: 'Hello World!!!' });

Save the changes to src/index.ts and then wait a few seconds for the application to reload. Curl the application again and verify that the updated text appears.

$ curl http://localhost:3000

{"message":"Hello World!!!"}

Press ctrl+c in the terminal to stop your application.

Debug your application

tsx watch supports the Node.js inspector protocol, so you can attach a debugger from VS Code or Chrome DevTools and set breakpoints directly in your TypeScript source files.

Update the dev script in package.json to start the inspector. The --inspect=0.0.0.0:9229 flag tells Node.js to listen for debugger connections on all network interfaces at port 9229. Using 0.0.0.0 rather than localhost is necessary so the debugger is reachable from outside the container. Also expose the debug port in compose.yaml, and add a .vscode/launch.json file that tells VS Code how to attach to the running inspector.

nodejs-docker-example
Files
Scaffold script
nodejs-docker-example
.vscode
launch.json
A
package.json
M
compose.yaml
M
{

"name": "nodejs-docker-example",

"version": "1.0.0",

"description": "A minimal Node.js TypeScript application.",

"main": "dist/index.js",

"scripts": {

    "build": "tsc",

    "start": "node dist/index.js",

    "dev": "tsx watch --inspect=0.0.0.0:9229 src/index.ts"

},

"dependencies": {

    "express": "^4.21.2",

    "pg": "^8.16.0"

},

"devDependencies": {

    "@types/express": "^4.17.21",

    "@types/node": "^22.0.0",

    "@types/pg": "^8.11.0",

    "tsx": "^4.19.3",

    "typescript": "^5.8.3"

}

}

Rebuild and restart with the updated configuration:

$ docker compose up --build

When the inspector is ready, you'll see a line like the following in the logs:

Debugger listening on ws://0.0.0.0:9229/...
VS Code

With .vscode/launch.json in place, attach the debugger using the Debug panel.

Open the Debug panel (Ctrl+Shift+D on Windows and Linux, Cmd+Shift+D on Mac), select Attach to Docker Container, and press F5. You can now set breakpoints in your TypeScript source files under src/.

Chrome DevTools

You can also use the built-in Node.js inspector in Chrome without any editor setup.

Open Chrome and go to chrome://inspect.

Select Configure and add localhost:9229.

When your Node.js target appears in the list, select inspect.

Troubleshoot the debugger

If the debugger doesn't connect, verify the container is running and the port is mapped correctly:

$ docker compose ps

$ docker compose logs server

The logs should include a line like:

Debugger listening on ws://0.0.0.0:9229/...

If that line is missing, confirm the dev script in package.json includes --inspect=0.0.0.0:9229 and that 9229:9229 appears in the ports list for the server service in compose.yaml.

For more details about Node.js debugging, see the Node.js debugging guide.

Run Node.js tests in a container
Prerequisites

Complete all the previous sections of this guide, starting with Containerize a Node.js application.

Overview

Testing is a core part of building reliable software. Docker makes it easy to run your tests in the same environment used in CI and production, so failures are caught before they reach your users.

In this section, you'll add Vitest to the project and run tests both locally and inside a container.

Update the application

You'll refactor src/index.ts to export the Express app instance so tests can import it without starting a server. Add a test file and update package.json to add Vitest and a test runner for HTTP requests. The file browser shows only the files that change in this step.

nodejs-docker-example
Files
Scaffold script
nodejs-docker-example
src
index.ts
M
index.test.ts
A
package.json
M
// Express application backed by a PostgreSQL database.

// Creates a heroes table at startup.

// Endpoints: GET / (greeting), GET /health (health check), POST /heroes/ (create), GET /heroes/ (list).

// See https://expressjs.com/ and https://node-postgres.com/

import express, { type Request, type Response } from "express";

import { Pool } from "pg";

import { readFileSync } from "fs";

export const app = express();

const port = parseInt(process.env.PORT ?? "3000", 10);

app.use(express.json());

function getPassword(): string {

const passwordFile = process.env.POSTGRES_PASSWORD_FILE;

if (passwordFile) {

    return readFileSync(passwordFile, "utf8").trim();

}

return process.env.POSTGRES_PASSWORD ?? "";

}

const pool = new Pool({

host: process.env.POSTGRES_SERVER,

port: 5432,

database: process.env.POSTGRES_DB,

user: process.env.POSTGRES_USER,

password: getPassword(),

});

if (process.env.POSTGRES_SERVER) {

pool

    .query(

      `CREATE TABLE IF NOT EXISTS heroes (

        id SERIAL PRIMARY KEY,

        name TEXT NOT NULL,

        secret_name TEXT NOT NULL,

        age INTEGER

      )`,

    )

    .catch(console.error);

}

app.get("/", (_req: Request, res: Response) => {

res.json({ message: "Hello World" });

});

app.get("/health", (_req: Request, res: Response) => {

res.json({ status: "ok" });

});

app.post("/heroes/", async (req: Request, res: Response) => {

const { name, secret_name, age } = req.body as {

    name: string;

    secret_name: string;

    age?: number;

};

const result = await pool.query(

    "INSERT INTO heroes (name, secret_name, age) VALUES ($1, $2, $3) RETURNING *",

    [name, secret_name, age],

);

res.json(result.rows[0]);

});

app.get("/heroes/", async (_req: Request, res: Response) => {

const result = await pool.query("SELECT * FROM heroes");

res.json(result.rows);

});

// Only start the server when this file is run directly.

if (require.main === module) {

app.listen(port, () => {

    console.log(`Server listening on port ${port}`);

});

}
Run tests locally

Run the following command to run the tests locally:

$ npm install

$ npm test

You should see output like the following:

RUN v3.0.0 /app

✓ src/index.test.ts (1)

✓ GET / (1)

     ✓ returns a JSON greeting

Test Files 1 passed (1)

      Tests  1 passed (1)

Start at 12:00:00

Duration 500ms

Run tests in a container

Run the tests using the dev stage of your Dockerfile:

$ docker compose run --build --rm --no-deps server npm test

The --no-deps flag skips starting the database, since the unit tests don't require it. The --rm flag removes the container when the tests finish.

You should see the same test output as when running locally.

Run tests when building

To run tests during the Docker build process, add a test stage to your Dockerfile that runs after the dev stage.

FROM dhi.io/node:24-alpine3.23-dev AS dev

WORKDIR /app

RUN --mount=type=cache,target=/root/.npm \

    --mount=type=bind,source=package.json,target=package.json \

    npm install

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM dhi.io/node:24-alpine3.23-dev AS deps

WORKDIR /app

RUN --mount=type=cache,target=/root/.npm \

    --mount=type=bind,source=package.json,target=package.json \

    npm install --omit=dev

FROM dhi.io/node:24-alpine3.23 AS runner

ENV PATH=/app/node_modules/.bin:$PATH

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules

COPY --from=dev --chown=node:node /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]

FROM dev AS test

ENV CI=true

CMD ["npm", "test"]

Then build and run the test stage:

$ docker build --target test -t nodejs-app-test .

$ docker run --rm nodejs-app-test

Summary

In this section, you learned how to run tests when developing locally and inside a container.

Related information:

Dockerfile reference
Compose file reference
docker compose run CLI reference

Edit this page

Request changes

Table of contents
What will you learn?
Prerequisites
Containerize a Node.js application
Prerequisites
Overview
Create the application
Create the Docker assets
Run the application
Use containers for Node.js development
Prerequisites
Overview
Update the application
Update Docker assets
Add a local database and persist data
Automatically update services
Debug your application
Run Node.js tests in a container
Prerequisites
Overview
Update the application
Run tests locally
Run tests in a container
Run tests when building
Summary
Product offerings
Pricing
About us
llms.txt
llms-full.txt
Cookies Settings
|
Terms of Use
|
Status
|
Legal
Copyright © 2013-2026 Docker Inc. All rights reserved.
Give feedback
Was this page useful?
Select an option from 1 to 5, with 1 being Hate and 5 being Love
Hate
Love
Next
By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts.
Cookies Settings Reject All Accept All Cookies
