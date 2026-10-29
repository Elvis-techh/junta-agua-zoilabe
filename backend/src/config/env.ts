import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { HONDURAS_TIME_ZONE } from "../lib/time.js";

/** backend/data/zoilabe.db, from src/ (tsx) and from dist/ (the server) alike. */
export const DEFAULT_DATABASE_PATH = fileURLToPath(new URL("../../data/zoilabe.db", import.meta.url));

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  /** The address people open; invitation links point here. */
  appUrl: string;
  frontendOrigins: string[];
  /** The database file. Its folder holds its WAL companions too, and must be writable. */
  databasePath: string;
  /**
   * How Fastify derives `request.ip`, which the rate limits key on. `false`
   * trusts nothing (local development); on the droplet, Nginx's own address
   * ("127.0.0.1"), so a visitor cannot pick their own bucket by forging
   * X-Forwarded-For.
   */
  trustProxy: boolean | string;
  /** PIN attempts allowed per minute, per address — on top of the 5-wrong-PIN lock. */
  pinAttemptsPerMinute: number;
  /** The ceiling on every other request, per minute, per address. */
  requestsPerMinute: number;
  /** The board's calendar: Honduras. */
  timeZone: string;
};

const allowedEnvironments = new Set<AppConfig["nodeEnv"]>(["development", "test", "production"]);

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number, not "${raw}".`);
  }
  return value;
}

function parseTrustProxy(raw: string | undefined): boolean | string {
  if (raw === undefined || raw === "" || raw === "false") {
    return false;
  }
  return raw === "true" ? true : raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? "development") as AppConfig["nodeEnv"];
  if (!allowedEnvironments.has(nodeEnv)) {
    throw new Error(`NODE_ENV must be development, test or production, not "${env.NODE_ENV}".`);
  }

  const appUrl = (env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, "");
  if (nodeEnv === "production" && !appUrl.startsWith("https://")) {
    throw new Error("APP_URL must be an https:// address in production.");
  }

  return {
    nodeEnv,
    host: env.HOST ?? "127.0.0.1",
    port: positiveInteger("PORT", 3002),
    appUrl,
    frontendOrigins: (env.FRONTEND_ORIGINS ?? appUrl)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    databasePath: env.DATABASE_PATH ? resolve(env.DATABASE_PATH) : DEFAULT_DATABASE_PATH,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    pinAttemptsPerMinute: positiveInteger("PIN_ATTEMPTS_PER_MINUTE", 10),
    requestsPerMinute: positiveInteger("REQUESTS_PER_MINUTE", 300),
    timeZone: env.TIME_ZONE ?? HONDURAS_TIME_ZONE,
  };
}
