"use server";

import { deleteDocument } from "@awdrent/core/documents";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorOf, mutate } from "@/server/actor";
import { requireCan } from "@/server/session";

export async function deleteDocumentAction(documentId: string): Promise<void> {
  const s = await requireCan("documents.delete");
  await mutate(() => deleteDocument(actorOf(s), z.uuid().parse(documentId)));
  revalidatePath("/", "layout");
}
