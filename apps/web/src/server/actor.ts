import "server-only";
import { ForbiddenError } from "@awdrent/core/permissions";
import { type Actor, NotFoundError } from "@awdrent/core/portfolio";
import { notFound } from "next/navigation";
import type { FormState } from "./forms";
import type { StaffSession } from "./session";
import { readOnlyError } from "./writes";

export function actorOf(s: StaffSession): Actor {
  return { ctx: s.ctx, role: s.user.role, userId: s.user.id };
}

/**
 * For pages: run a core call, turning "not found" and "not allowed" into a
 * 404 so nothing reveals whether another agency's or agent's record exists.
 */
export async function load<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
}

/** For actions: same mapping, plus read-only support sessions as a form message. */
export async function mutate(fn: () => Promise<void>): Promise<FormState | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    const ro = readOnlyError(err);
    if (ro) return ro;
    throw err;
  }
}
