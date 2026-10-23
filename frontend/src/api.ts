/** A refusal from the API, with its Spanish message ready to show. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

const NO_SIGNAL = "No hay conexión. Revise la señal e intente de nuevo.";

export async function api<T>(method: "GET" | "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? null : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", NO_SIGNAL, {});
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof data.error === "string" ? data.error : "error",
      typeof data.message === "string" ? data.message : "No se pudo completar. Intente de nuevo.",
      data,
    );
  }
  return data as T;
}

export interface Me {
  id: string;
  name: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
}

export interface StaffUser {
  id: string;
  name: string;
  phone: string;
  roleCode: string;
  roleName: string;
  status: "invited" | "active" | "suspended" | "deactivated";
  locked: boolean;
  lastLoginAt: string | null;
  devices: number;
  invitationExpiresAt: string | null;
}

export interface Invitation {
  url: string;
  message: string;
  whatsappUrl: string;
  expiresAt: string;
}

export interface LogEntry {
  id: number;
  occurredAt: string;
  actorName: string;
  actorRole: string;
  area: string;
  action: string;
  summary: string;
  reason: string | null;
  hasDetail: boolean;
}
