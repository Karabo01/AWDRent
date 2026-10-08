"use server";

import { checkImport, IMPORT_FILES, type ImportFiles, ImportInvalidError, type ImportReport, runImport } from "@awdrent/core/import";
import { revalidatePath } from "next/cache";
import { actorOf } from "@/server/actor";
import { requireCan } from "@/server/session";
import { readOnlyError } from "@/server/writes";

export interface ImportState {
  mode?: "check" | "run";
  report?: ImportReport;
  imported?: boolean;
  error?: string;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function readFiles(form: FormData): Promise<{ files: ImportFiles; names: string[] } | { error: string }> {
  const files: ImportFiles = {};
  const names: string[] = [];
  for (const key of IMPORT_FILES) {
    const file = form.get(key);
    if (!(file instanceof File) || file.size === 0) continue;
    if (file.size > MAX_FILE_BYTES) return { error: `${file.name} is larger than 2 MB. Split it into smaller files.` };
    files[key] = await file.text();
    names.push(file.name);
  }
  if (names.length === 0) return { error: "Choose at least one CSV file." };
  return { files, names };
}

/** "Check files" validates and writes nothing; "Import" checks again and imports all or nothing. */
export async function importAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const s = await requireCan("import.run");
  const mode = form.get("mode") === "run" ? "run" : "check";
  const read = await readFiles(form);
  if ("error" in read) return { mode, error: read.error };
  const actor = actorOf(s);
  if (mode === "check") return { mode, report: await checkImport(actor, read.files) };
  if (s.ctx.readOnly) return { mode, error: "This support session is read-only." };
  try {
    const report = await runImport(actor, read.files, read.names);
    revalidatePath("/", "layout");
    return { mode, report, imported: true };
  } catch (err) {
    if (err instanceof ImportInvalidError) return { mode, report: err.report };
    if (readOnlyError(err)) return { mode, error: "This support session is read-only." };
    return { mode, error: "The import could not be completed and nothing was saved. Check the files again; if it keeps failing, contact support." };
  }
}
