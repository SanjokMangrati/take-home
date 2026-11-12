import { parentPort, workerData } from "node:worker_threads";
import { parseXer } from "../core/analyze.ts";
import type { ParseRequest, ParseResultMessage } from "./parse.ts";

const { bytes, hoursPerDay } = workerData as ParseRequest;
const message: ParseResultMessage = { parseResult: parseXer(bytes, hoursPerDay) };
parentPort?.postMessage(message);
