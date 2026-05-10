export type {
  Article,
  SearchResult,
  StructuredAbstract,
  OAInfo,
  DownloadResult,
  BatchDownloadItem,
} from './article.js';

export type {
  AgentResponse,
  ResponseMetadata,
  Pagination,
  Suggestion,
  ErrorData,
  McpToolResponse,
} from './responses.js';

export { makeResponse, makeError } from './responses.js';
