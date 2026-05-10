import { FULLTEXT_ENABLED } from '../config.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

export function getToolDefinitions(): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: 'pubmed_search',
      description: [
        'Search PubMed biomedical literature database.',
        'Returns articles matching your query with metadata, abstracts, and citations.',
        'Supports Boolean operators (AND, OR, NOT), MeSH terms, and field tags like [Title], [Author].',
        'Use format="compact" for quick overviews when browsing, "detailed" for in-depth analysis.',
        'Use days_back to limit to recent publications.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'PubMed search query. Supports Boolean logic and MeSH terms.' },
          max_results: { type: 'number', description: 'Number of results to return (1-100).', default: 20, minimum: 1, maximum: 100 },
          days_back: { type: 'number', description: 'Only return articles published within the last N days. 0 = no limit.', default: 0, minimum: 0 },
          sort_by: { type: 'string', description: 'Sort order for results.', default: 'relevance', enum: ['relevance', 'date'] },
          format: { type: 'string', description: 'Response detail level. compact=minimal, standard=balanced, detailed=full metadata+structured abstract.', default: 'standard', enum: ['compact', 'standard', 'detailed'] },
        },
        required: ['query'],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    {
      name: 'pubmed_get_details',
      description: [
        'Retrieve complete metadata for specific PubMed articles by PMID.',
        'Accepts a single PMID or array of PMIDs (up to 20).',
        'Returns full article records including abstract, authors, journal, DOI, MeSH terms.',
        'Use when you have specific PMIDs from a previous search or citation and need the full record.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          pmids: {
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 20 }],
            description: 'Single PMID string or array of PMIDs.',
          },
          format: { type: 'string', description: 'Output format.', default: 'standard', enum: ['concise', 'standard', 'detailed'] },
        },
        required: ['pmids'],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    {
      name: 'pubmed_extract_info',
      description: [
        'Extract specific structured sections from a PubMed article.',
        'Use when you need only certain aspects (author details, structured abstract, keywords, DOI)',
        'rather than the full record. More token-efficient than get_details for targeted extraction.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          pmid: { type: 'string', description: 'PubMed article ID.' },
          sections: {
            type: 'array',
            items: { type: 'string', enum: ['basic_info', 'authors', 'abstract_summary', 'keywords', 'doi_link'] },
            description: 'Which sections to extract.',
            default: ['basic_info', 'abstract_summary', 'authors'],
          },
        },
        required: ['pmid'],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    {
      name: 'pubmed_find_related',
      description: [
        'Find articles related to a given PubMed article.',
        'Discovers similar papers or review articles to build a comprehensive literature picture.',
        'Use after identifying a key paper to expand your search in relevant directions.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          pmid: { type: 'string', description: 'PMID of the base article.' },
          type: { type: 'string', description: 'Type of relationship to search.', default: 'similar', enum: ['similar', 'reviews'] },
          max_results: { type: 'number', description: 'Maximum related articles to return.', default: 10, minimum: 1, maximum: 50 },
        },
        required: ['pmid'],
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    {
      name: 'pubmed_manage_cache',
      description: [
        'View cache statistics or perform maintenance.',
        'Use action="stats" to check hit rates and storage usage.',
        'Use action="clean" to remove expired entries, or action="clear" to wipe a specific cache layer.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'Cache operation to perform.', enum: ['stats', 'clean', 'clear'], default: 'stats' },
          target: { type: 'string', description: 'Which cache layer to operate on.', enum: ['memory', 'files', 'fulltext', 'all'], default: 'all' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
  ];

  if (FULLTEXT_ENABLED) {
    tools.push(
      {
        name: 'pubmed_detect_fulltext',
        description: [
          'Check if a PubMed article has freely available full-text (Open Access).',
          'Checks PMC, Unpaywall, and publisher sources.',
          'Returns OA status, available sources, and download URL if found.',
          'Use before attempting download to verify availability.',
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: {
            pmid: { type: 'string', description: 'PubMed article ID to check.' },
            auto_download: { type: 'boolean', description: 'Automatically download if OA is available.', default: false },
          },
          required: ['pmid'],
        },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      {
        name: 'pubmed_download_fulltext',
        description: [
          'Download full-text PDF for Open Access PubMed articles.',
          'Accepts single PMID or array of PMIDs (up to 10).',
          'Only works with OA articles — use pubmed_detect_fulltext first if unsure.',
          'Uses platform-native download tools (wget/curl/PowerShell).',
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: {
            pmids: {
              oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, maxItems: 10 }],
              description: 'Single PMID or array of PMIDs to download.',
            },
            force: { type: 'boolean', description: 'Re-download even if already cached.', default: false },
          },
          required: ['pmids'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      {
        name: 'pubmed_system_status',
        description: [
          'Check system environment, API key pool health, and download tool availability.',
          'Reports platform info, available download tools, API key status, and recommendations.',
          'Use to diagnose issues with downloads or API connectivity.',
        ].join(' '),
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
    );
  }

  return tools;
}
