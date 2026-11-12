import { randomUUID } from "node:crypto";
import { connect, type Database, migrate } from "../../src/server/database.ts";

export interface TestDatabase {
  readonly database: Database;
  readonly close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const connectionString = process.env["DATABASE_URL"];
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is not set. Start Postgres with: docker compose up -d db");
  }
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = connect({ connectionString, max: 1 });
  await admin.query(`create schema ${schema}`);
  const database = connect({ connectionString, options: `-c search_path=${schema}` });
  await migrate(database);
  return {
    database,
    close: async () => {
      await database.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    },
  };
}
