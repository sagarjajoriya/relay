import { BadRequestException } from "@nestjs/common";

interface CursorPayload {
  t: string; // createdAt ISO
  i: string; // message id (tiebreaker)
}

// The cursor encodes the full (createdAt, id) keyset even though Prisma's cursor
// pagination only consumes the id today. Keeping both keeps the wire format
// stable if we later drop to raw SQL tuple comparison for the same query.
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  const payload: CursorPayload = { t: row.createdAt.toISOString(), i: row.id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof parsed?.i !== "string" || typeof parsed?.t !== "string") {
      throw new Error("malformed");
    }
    return parsed;
  } catch {
    throw new BadRequestException("Invalid cursor");
  }
}
