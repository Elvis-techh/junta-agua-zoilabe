import type { z } from "zod";

/** An error a route throws on purpose: its status and Spanish message reach the screen as they are. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    /** More for the screen to act on, sent beside `error` and `message`. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Parse a request body or query with zod, or answer 400 with the first problem in plain words. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(400, "invalid_request", first?.message ?? "Revise los datos e intente de nuevo.");
  }
  return result.data;
}
