import { z } from "zod";

export const searchQuerySchema = z.object({
  // Parsed with websearch_to_tsquery: supports "quoted phrases", -exclusion,
  // and OR — and never errors on malformed syntax.
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(500).default(0),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

// Delimiters wrapping matched terms in `snippet`. Control characters cannot
// appear in real message text, so clients can split on them and render the
// pieces as plain text nodes — no HTML parsing, no XSS surface.
export const SEARCH_MARK_START = "\u0002";
export const SEARCH_MARK_END = "\u0003";

export interface SearchResultItem {
  messageId: string;
  channelId: string;
  channelName: string;
  workspaceId: string;
  author: { id: string; displayName: string };
  snippet: string;
  rank: number;
  createdAt: string;
}

export interface SearchResponse {
  results: SearchResultItem[];
  // Offset pagination by design: results are a ranked snapshot with capped
  // depth — the timeline's keyset cursor doesn't compose with rank ordering.
  hasMore: boolean;
}
