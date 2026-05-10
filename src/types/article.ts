export interface Article {
  pmid: string;
  title: string;
  authors: string[];
  journal: string;
  publicationDate: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  url: string;
  abstract: string | null;
  publicationTypes: string[];
  meshTerms: string[];
  keywords: string[];
  fullAbstract?: string;
}

export interface SearchResult {
  articles: Article[];
  total: number;
  query: string;
}

export interface StructuredAbstract {
  background?: string;
  methods?: string;
  results?: string;
  conclusions?: string;
  full?: string;
}

export interface OAInfo {
  isOpenAccess: boolean;
  sources: string[];
  downloadUrl: string | null;
  pmcid: string | null;
  doi: string;
}

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  sources?: string[];
  method?: string;
  error?: string;
  cached?: boolean;
}

export interface BatchDownloadItem {
  pmid: string;
  title: string;
  downloadUrl: string;
  oaInfo: OAInfo;
}
