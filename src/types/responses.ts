export interface AgentResponse<T = unknown> {
  status: 'success' | 'error';
  data: T;
  metadata: ResponseMetadata;
  suggestions?: Suggestion[];
}

export interface ResponseMetadata {
  tool: string;
  executionMs: number;
  timestamp: string;
  cached?: boolean;
  pagination?: Pagination;
}

export interface Pagination {
  total: number;
  returned: number;
  hasMore: boolean;
}

export interface Suggestion {
  tool: string;
  reason: string;
  parameters?: Record<string, unknown>;
}

export interface ErrorData {
  code: string;
  message: string;
  details?: unknown;
}

export type McpToolResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

export function makeResponse<T>(
  tool: string,
  data: T,
  startTime: number,
  extra?: {
    cached?: boolean;
    pagination?: Pagination;
    suggestions?: Suggestion[];
  },
): McpToolResponse {
  const response: AgentResponse<T> = {
    status: 'success',
    data,
    metadata: {
      tool,
      executionMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      ...(extra?.cached !== undefined && { cached: extra.cached }),
      ...(extra?.pagination && { pagination: extra.pagination }),
    },
    ...(extra?.suggestions && { suggestions: extra.suggestions }),
  };
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

export function makeError(
  tool: string,
  code: string,
  message: string,
  startTime: number,
  suggestions?: Suggestion[],
): McpToolResponse {
  const response: AgentResponse<ErrorData> = {
    status: 'error',
    data: { code, message },
    metadata: {
      tool,
      executionMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    },
    ...(suggestions && { suggestions }),
  };
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
