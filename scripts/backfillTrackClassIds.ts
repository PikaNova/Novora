import { neon } from "@neondatabase/serverless";
import type { MajorExam } from "../src/types/index.js";
import type { SchoolClass } from "../src/types/school.js";
import { recomputeMajorsTrackClassIds } from "../src/utils/trackClassIds.js";

type ExamDataRow = {
  majors: unknown;
  classes: unknown;
  initialization: unknown;
  updated_at: number;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main() {
  const commit = process.argv.includes("--commit");
  const databaseUrl = process.env.BACKFILL_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("BACKFILL_DATABASE_URL is required; DATABASE_URL is never used by this command.");
  }
  if (commit && process.env.BACKFILL_CONFIRM !== "novora-track-backfill") {
    throw new Error("Set BACKFILL_CONFIRM=novora-track-backfill before using --commit.");
  }

  const sql = neon(databaseUrl);
  const rows = (await sql`
    SELECT majors, classes, initialization, updated_at FROM exam_data WHERE id = 1
  `) as unknown as ExamDataRow[];
  if (!rows.length) {
    console.log("No exam_data row found. Nothing to do.");
    return;
  }

  const row = rows[0];
  const initialization = asRecord(row.initialization);
  const { majors, changes } = recomputeMajorsTrackClassIds(
    asArray<MajorExam>(row.majors),
    asArray<SchoolClass>(row.classes),
    initialization.subjectTrackModeEnabled !== false,
  );
  if (!changes.length) {
    console.log("No stale automatically generated track scopes found.");
    return;
  }

  console.log(`Found ${changes.length} track scope change(s):`);
  for (const change of changes) {
    console.log(
      `- [${change.majorName || change.majorId}] ${change.itemName || change.itemId}: ` +
        `${JSON.stringify(change.before ?? null)} -> ${JSON.stringify(change.after ?? null)}`,
    );
  }
  if (!commit) {
    console.log("Dry run only. Re-run with --commit and BACKFILL_CONFIRM=novora-track-backfill to write.");
    return;
  }

  const saved = await sql`
    UPDATE exam_data
    SET majors = ${JSON.stringify(majors)}::jsonb,
        updated_at = ${Date.now()}
    WHERE id = 1 AND updated_at = ${row.updated_at}
    RETURNING updated_at
  `;
  if (!saved.length) {
    throw new Error("The exam data changed during the dry run. Re-run to avoid overwriting newer data.");
  }
  console.log(`Committed ${changes.length} track scope change(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
