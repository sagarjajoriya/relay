import { ForbiddenException, Injectable } from "@nestjs/common";
import { prisma, Prisma } from "@relay/db";
import type { SearchQuery, SearchResponse, SearchResultItem } from "@relay/contracts";

interface SearchRow {
  message_id: string;
  channel_id: string;
  channel_name: string;
  workspace_id: string;
  author_id: string;
  author_display_name: string;
  snippet: string;
  rank: number;
  created_at: Date;
}

@Injectable()
export class SearchService {
  async search(userId: string, workspaceId: string, query: SearchQuery): Promise<SearchResponse> {
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) {
      throw new ForbiddenException("You are not a member of this workspace");
    }

    // Visibility is enforced INSIDE the query, not filtered after: a private
    // message the user can't see must be unfindable, and post-filtering would
    // also break limit/offset math. websearch_to_tsquery parses user syntax
    // ("phrases", -exclusion, or) and never throws on malformed input.
    // Fetch limit+1 to compute hasMore without a count query.
    const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT
        m.id                AS message_id,
        c.id                AS channel_id,
        c.name              AS channel_name,
        c."workspaceId"     AS workspace_id,
        u.id                AS author_id,
        u."displayName"     AS author_display_name,
        ts_headline(
          'english', m.content, websearch_to_tsquery('english', ${query.q}),
          'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxWords=30, MinWords=10'
        )                   AS snippet,
        ts_rank(m.search_vector, websearch_to_tsquery('english', ${query.q}))::float8 AS rank,
        m."createdAt"       AS created_at
      FROM messages m
      JOIN channels c ON c.id = m."channelId"
      JOIN users u    ON u.id = m."authorId"
      WHERE c."workspaceId" = ${workspaceId}
        AND c."archivedAt" IS NULL
        AND m."deletedAt" IS NULL
        AND m.search_vector @@ websearch_to_tsquery('english', ${query.q})
        AND (
          c.type = 'PUBLIC'
          OR EXISTS (
            SELECT 1 FROM channel_members cm
            WHERE cm."channelId" = c.id AND cm."userId" = ${userId}
          )
        )
      ORDER BY rank DESC, m."createdAt" DESC
      LIMIT ${query.limit + 1} OFFSET ${query.offset}
    `);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    const results: SearchResultItem[] = page.map((r) => ({
      messageId: r.message_id,
      channelId: r.channel_id,
      channelName: r.channel_name,
      workspaceId: r.workspace_id,
      author: { id: r.author_id, displayName: r.author_display_name },
      snippet: r.snippet,
      rank: r.rank,
      createdAt: r.created_at.toISOString(),
    }));

    return { results, hasMore };
  }
}
