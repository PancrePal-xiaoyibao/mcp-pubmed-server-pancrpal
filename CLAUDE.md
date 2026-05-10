# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A PubMed MCP Server providing structured biomedical literature retrieval for LLM agents. TypeScript codebase with agentic-friendly response models. Focuses on data provision, not analysis.

## Commands

```bash
npm install          # Install dependencies
npm run build        # TypeScript -> dist/
npm run dev          # Dev mode with tsx --watch
npm run dev:http     # Dev mode with HTTP transport
npm start            # Production (stdio)
npm run start:http   # Production (HTTP)
npm run typecheck    # Type check without emitting
```

## Architecture

```
src/
├── index.ts                  # Entry point
├── config.ts                 # All config constants + env parsing
├── server.ts                 # PubMedDataServer orchestrator
├── types/
│   ├── article.ts            # Article, SearchResult, OAInfo types
│   ├── responses.ts          # AgentResponse<T>, makeResponse/makeError helpers
│   └── index.ts              # Re-exports
├── api/
│   ├── pubmed-client.ts      # PubMed EUtilities client (search/fetch/rate-limit)
│   └── key-pool.ts           # Multi-key pool (round-robin/failover/random)
├── cache/
│   ├── memory-cache.ts       # In-memory LRU cache (5min TTL, 100 max)
│   └── file-cache.ts         # File-based persistent cache (30-day expiry)
├── services/
│   ├── fulltext.ts           # OA detection (PMC/Unpaywall/Publisher) + PDF download
│   └── system.ts             # Platform detection + download tool availability
├── tools/
│   ├── definitions.ts        # MCP tool schemas (8 tools)
│   └── handlers.ts           # Tool routing + implementation
├── transport/
│   ├── stdio.ts              # stdio transport
│   └── streamable-http.ts    # Express-based HTTP transport
└── utils/
    └── formatter.ts          # Article formatting (compact/standard/detailed)
```

## MCP Tools (8 total)

| Tool | Purpose |
|------|---------|
| `pubmed_search` | Search PubMed with query, filters, sort |
| `pubmed_get_details` | Get full metadata for PMID(s) |
| `pubmed_extract_info` | Extract specific sections from an article |
| `pubmed_find_related` | Find similar/review articles |
| `pubmed_manage_cache` | Cache stats, clean, clear |
| `pubmed_detect_fulltext` | Check OA availability (if enabled) |
| `pubmed_download_fulltext` | Download OA PDF(s) (if enabled) |
| `pubmed_system_status` | System + API key diagnostics (if enabled) |

## Response Model

Every tool returns a consistent `AgentResponse<T>` envelope:
```typescript
{
  status: 'success' | 'error',
  data: T,                        // Typed payload
  metadata: {
    tool, executionMs, timestamp,
    cached?, pagination?
  },
  suggestions?: [{                // Next action hints for agents
    tool, reason, parameters?
  }]
}
```

## Key Config

- `ABSTRACT_MODE`: quick (1500 chars) | deep (6000 chars)
- `FULLTEXT_MODE`: disabled | enabled | auto
- `MCP_TRANSPORT`: stdio (default) | streamableHttp
- `PORT`: HTTP port (default 8745)
- Rate limit: 10 req/s with API key, 3 req/s without

## Development Notes

- All source is TypeScript in `src/`, compiled to `dist/`
- Native `fetch` (Node 18+), no `node-fetch` dependency
- Cache directory: `cache/papers/` (file cache), `cache/fulltext/` (PDFs)
- API keys loaded from `api-keys.json` > env vars > anonymous mode
- Fulltext tools only registered when FULLTEXT_MODE is enabled
