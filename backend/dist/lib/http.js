/** An error a route throws on purpose: its status and Spanish message reach the screen as they are. */
export class HttpError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, 
    /** More for the screen to act on, sent beside `error` and `message`. */
    details = {}) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
/** Parse a request body or query with zod, or answer 400 with the first problem in plain words. */
export function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success) {
        const first = result.error.issues[0];
        throw new HttpError(400, "invalid_request", first?.message ?? "Revise los datos e intente de nuevo.");
    }
    return result.data;
}
//# sourceMappingURL=http.js.map