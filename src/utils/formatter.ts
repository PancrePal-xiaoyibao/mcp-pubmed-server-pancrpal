import { ABSTRACT_MAX_CHARS } from '../config.js';
import type { Article, StructuredAbstract } from '../types/article.js';

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export function extractAbstractSections(abstract: string): StructuredAbstract {
  const sections: StructuredAbstract = {};
  const patterns: Array<{ name: keyof StructuredAbstract; regex: RegExp }> = [
    { name: 'background', regex: /(?:BACKGROUND|Introduction)/i },
    { name: 'methods', regex: /(?:METHODS|Methodology)/i },
    { name: 'results', regex: /(?:RESULTS|Findings)/i },
    { name: 'conclusions', regex: /(?:CONCLUSIONS|Conclusion)/i },
  ];

  const allPatterns = patterns.map(p => p.regex.source).join('|');
  for (const { name, regex } of patterns) {
    const match = abstract.match(new RegExp(`${regex.source}:?\\s*(.+?)(?=${allPatterns}|$)`, 'is'));
    if (match) {
      sections[name] = match[1].trim();
    }
  }

  return Object.keys(sections).length > 0 ? sections : { full: abstract };
}

export function extractKeyPoints(abstract: string): string[] {
  return abstract
    .split(/[.!?]+/)
    .filter(s => s.trim().length > 20)
    .slice(0, 5)
    .map(s => s.trim());
}

interface FormattedCompact {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  date: string;
  url: string;
  abstract?: string | null;
}

interface FormattedStandard {
  pmid: string;
  title: string;
  citation: string;
  url: string;
  abstract?: string;
  keyPoints?: string[];
  keywords?: string[];
}

interface FormattedDetailed extends FormattedStandard {
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  structuredAbstract?: StructuredAbstract;
}

export type FormattedArticle = FormattedCompact | FormattedStandard | FormattedDetailed;

export function formatArticles(
  articles: Article[],
  format: 'compact' | 'standard' | 'detailed' = 'standard',
): FormattedArticle[] {
  if (format === 'compact') {
    return articles.map(a => ({
      pmid: a.pmid,
      title: a.title,
      authors: a.authors.slice(0, 2).join(', ') + (a.authors.length > 2 ? ' et al.' : ''),
      journal: a.journal,
      date: a.publicationDate,
      url: a.url,
      abstract: a.abstract ? truncateText(a.abstract, 500) : null,
    }));
  }

  if (format === 'detailed') {
    return articles.map(a => {
      const result: FormattedDetailed = {
        pmid: a.pmid,
        title: a.title,
        citation: `${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' et al.' : ''} ${a.journal}, ${a.publicationDate}`,
        url: a.url,
        volume: a.volume || undefined,
        issue: a.issue || undefined,
        pages: a.pages || undefined,
        doi: a.doi || undefined,
      };
      if (a.abstract) {
        result.abstract = truncateText(a.abstract, ABSTRACT_MAX_CHARS);
        result.keyPoints = extractKeyPoints(a.abstract);
        result.structuredAbstract = extractAbstractSections(a.abstract);
      }
      if (a.meshTerms?.length) {
        result.keywords = a.meshTerms.slice(0, 15);
      }
      return result;
    });
  }

  return articles.map(a => {
    const result: FormattedStandard = {
      pmid: a.pmid,
      title: a.title,
      citation: `${a.authors.slice(0, 3).join(', ')}${a.authors.length > 3 ? ' et al.' : ''} ${a.journal}, ${a.publicationDate}`,
      url: a.url,
    };
    if (a.abstract) {
      result.abstract = truncateText(a.abstract, ABSTRACT_MAX_CHARS);
      result.keyPoints = extractKeyPoints(a.abstract);
    }
    if (a.meshTerms?.length) {
      result.keywords = a.meshTerms.slice(0, 8);
    }
    return result;
  });
}
