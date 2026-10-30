import { and, eq, isNull } from "drizzle-orm";

import { INVITATION_LIFETIME_MS, issueToken, revokeTokens } from "../auth/session.js";
import type { Tx } from "../db/client.js";
import { accessTokens } from "../db/schema.js";
import { formatHondurasDateTime } from "./time.js";

export interface Invitation {
  /** The personal link. Shown once; only its hash is kept. */
  url: string;
  /** The message, ready to paste into WhatsApp. */
  message: string;
  /** Opens WhatsApp on the person's number with the message filled in. */
  whatsappUrl: string;
  expiresAt: Date;
}

/**
 * Make a new invitation link for a staff account, replacing any unused one.
 *
 * The token goes after `#` in the link, so it never reaches a server log:
 * browsers do not send the part after `#` with the request.
 *
 * The app does not send the message itself (App Plan: version 1 leaves out
 * automatic WhatsApp sending); it opens WhatsApp for the person to press send.
 */
export function createInvitation(
  tx: Tx,
  user: { id: string; name: string; phone: string },
  createdBy: string | null,
  appUrl: string,
): Invitation {
  const unused = tx
    .select({ id: accessTokens.id })
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.userId, user.id),
        eq(accessTokens.kind, "invitation"),
        isNull(accessTokens.usedAt),
        isNull(accessTokens.revokedAt),
      ),
    )
    .all();
  if (unused.length > 0) {
    revokeTokens(tx, { ids: unused.map((row) => row.id) }, createdBy);
  }

  const { token, expiresAt } = issueToken(tx, {
    userId: user.id,
    kind: "invitation",
    lifetimeMs: INVITATION_LIFETIME_MS,
    createdBy,
  });

  const url = `${appUrl}/invitacion#${token}`;
  const message =
    `Hola ${user.name}. Esta es su invitación a la app de la Junta de Agua de Zoilabe. ` +
    `Ábrala en su propio teléfono. Sirve una sola vez, hasta el ${formatHondurasDateTime(expiresAt)}:\n${url}`;

  return {
    url,
    message,
    whatsappUrl: `https://wa.me/504${user.phone}?text=${encodeURIComponent(message)}`,
    expiresAt,
  };
}
