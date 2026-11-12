import { Worker } from "node:worker_threads";
import type { ParseResult } from "../core/analyze.ts";

export interface ParseRequest {
  readonly bytes: Uint8Array;
  readonly hoursPerDay: number | null;
}

export interface ParseResultMessage {
  readonly parseResult: ParseResult;
}

export class ParserStoppedError extends Error {
  override readonly name = "ParserStoppedError";
}

const PARSE_WORKER = new URL("./parse-worker.ts", import.meta.url);
const MAX_PARALLEL_PARSES = 2;
const PARSE_TIMEOUT_SECONDS = 120;

let running = 0;
const waiting: (() => void)[] = [];

export async function parseInWorker(request: ParseRequest): Promise<ParseResult> {
  await takeTurn();
  try {
    return await runWorker(request);
  } finally {
    passTurn();
  }
}

function runWorker(request: ParseRequest): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(PARSE_WORKER, { workerData: request });
    const timeout = setTimeout(() => {
      reject(
        new ParserStoppedError(
          `The parser did not finish within ${PARSE_TIMEOUT_SECONDS} seconds.`,
        ),
      );
      worker.terminate();
    }, PARSE_TIMEOUT_SECONDS * 1000);
    worker.on("message", (message: unknown) => {
      if (isParseResultMessage(message)) {
        resolve(message.parseResult);
      }
    });
    worker.once("error", (error) => {
      reject(new ParserStoppedError("The parser failed.", { cause: error }));
    });
    worker.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new ParserStoppedError(`The parser exited with code ${code} before it returned a result.`),
      );
    });
  });
}

function isParseResultMessage(message: unknown): message is ParseResultMessage {
  return typeof message === "object" && message !== null && "parseResult" in message;
}

async function takeTurn(): Promise<void> {
  if (running < MAX_PARALLEL_PARSES) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function passTurn(): void {
  const next = waiting.shift();
  if (next === undefined) {
    running -= 1;
  } else {
    next();
  }
}
