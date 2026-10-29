import { sqliteTable, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core";
export const submissions = sqliteTable("submissions", {
  revision: integer("revision").primaryKey({ autoIncrement: true }),
  submissionId: text("submission_id").notNull(),
  baseRevision: integer("base_revision").notNull(),
  action: text("action").notNull(),
  state: text("state").notNull(),
  applied: integer("applied").notNull(),
  createdAt: text("created_at").notNull(),
}, table => [uniqueIndex("submission_id_unique").on(table.submissionId)]);
