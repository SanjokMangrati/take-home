import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { connect, migrate } from "./database.ts";
import { FileStore } from "./store.ts";

const DEFAULT_PORT = 3000;

const connectionString = process.env["DATABASE_URL"];
if (connectionString === undefined || connectionString === "") {
  throw new Error("DATABASE_URL is not set. Set it to the Postgres connection string.");
}

const port = Number(process.env["PORT"] ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`PORT must be a whole number above 0, not "${process.env["PORT"]}".`);
}

const database = connect({ connectionString });
await migrate(database);

const app = createApp({ store: new FileStore(database), clientDirectory: "dist" });
const server = serve({ fetch: app.fetch, port }, ({ port }) => {
  console.info(`Listening on http://localhost:${port}`);
});

function shutDown() {
  server.close(() => {
    database.end().finally(() => process.exit(0));
  });
}

process.once("SIGTERM", shutDown);
process.once("SIGINT", shutDown);
