import type { Database } from "@agentOS/shared";
import { memories } from "@agentOS/shared";
import { and, asc, eq, isNull, or } from "drizzle-orm";

export type MemoryScope = "agent" | "user" | "project";
export interface MemoryInput {
  accountId: string;
  botId?: string;
  projectId?: string;
  scope: MemoryScope;
  content: string;
  source: string;
  sourceTurnId?: string;
  isUserAuthored?: boolean;
  staleAfter?: Date;
}

/** PostgreSQL-backed memory CRUD with account isolation on every operation. */
export class MemoryStore {
  constructor(private readonly db: Database) {}

  async create(input: MemoryInput) {
    const [row] = await this.db
      .insert(memories)
      .values({
        ...input,
        botId: input.botId ?? null,
        projectId: input.projectId ?? null,
        sourceTurnId: input.sourceTurnId ?? null,
        isUserAuthored: input.isUserAuthored ?? false,
        staleAfter: input.staleAfter ?? null,
      })
      .returning();
    return row;
  }

  async list(accountId: string, botId: string, projectId?: string) {
    return this.db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.accountId, accountId),
          or(
            eq(memories.scope, "user"),
            and(eq(memories.scope, "agent"), eq(memories.botId, botId)),
            projectId
              ? and(eq(memories.scope, "project"), eq(memories.projectId, projectId))
              : undefined,
          ),
        ),
      )
      .orderBy(asc(memories.createdAt));
  }

  async update(
    id: string,
    accountId: string,
    patch: Partial<Pick<MemoryInput, "content" | "source" | "staleAfter">>,
    automatic = false,
  ) {
    const predicate = and(
      eq(memories.id, id),
      eq(memories.accountId, accountId),
      automatic ? eq(memories.isUserAuthored, false) : undefined,
    );
    const [row] = await this.db
      .update(memories)
      .set({ ...patch, updatedAt: new Date() })
      .where(predicate)
      .returning();
    return row ?? null;
  }

  async delete(id: string, accountId: string, automatic = false) {
    const predicate = and(
      eq(memories.id, id),
      eq(memories.accountId, accountId),
      automatic ? eq(memories.isUserAuthored, false) : undefined,
    );
    const [row] = await this.db.delete(memories).where(predicate).returning({ id: memories.id });
    return Boolean(row);
  }

  async export(accountId: string) {
    return this.db
      .select()
      .from(memories)
      .where(eq(memories.accountId, accountId))
      .orderBy(asc(memories.createdAt));
  }
}
