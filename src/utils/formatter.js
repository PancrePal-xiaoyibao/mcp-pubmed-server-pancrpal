import { ABSTRACT_MAX_CHARS } from '../config.js';

export function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
}

export function extractAbstractSections(abstract) {
    const sections = {};

    const sectionPatterns = [
        { name: "background", regex: /(?:BACKGROUND|BACKGROUND:|Introduction)/i },
        { name: "methods", regex: /(?:METHODS|METHODS:|Methodology)/i },
        { name: "results", regex: /(?:RESULTS|RESULTS:|Findings)/i },
        { name: "conclusions", regex: /(?:CONCLUSIONS|CONCLUSIONS:|Conclusion)/i }
    ];

    sectionPatterns.forEach(section => {
        const match = abstract.match(new RegExp(`${section.regex}(.+?)(?=${sectionPatterns.map(s => s.regex).join('|')}|$)`, 'is'));
        if (match) {
            sections[section.name] = match[1].trim();
        }
    });

    return Object.keys(sections).length > 0 ? sections : { full: abstract };
}

export function extractKeyPoints(abstract) {
    const sentences = abstract.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences.slice(0, 5).map(s => s.trim());
}

export function formatForLLM(articles, format = "llm_optimized", responseFormat = "standard") {
    if (format === "concise") {
        return articles.map(article => ({
            pmid: article.pmid,
            title: article.title,
            authors: article.authors.slice(0, 3).join(', ') + (article.authors.length > 3 ? ' et al.' : ''),
            journal: article.journal,
            date: article.publicationDate,
            url: article.url
        }));
    }

    if (format === "detailed") {
        return articles.map(article => ({
            ...article,
            structuredAbstract: article.abstract ? extractAbstractSections(article.abstract) : null
        }));
    }

    // 根据响应格式选择不同的优化策略
    if (responseFormat === "compact") {
        return articles.map(article => ({
            pmid: article.pmid,
            title: article.title,
            authors: article.authors.slice(0, 2).join(', ') + (article.authors.length > 2 ? ' et al.' : ''),
            journal: article.journal,
            date: article.publicationDate,
            url: article.url,
            abstract: article.abstract ? truncateText(article.abstract, 500) : null
        }));
    }

    if (responseFormat === "detailed") {
        return articles.map(article => {
            const structured = {
                identifier: `PMID: ${article.pmid}`,
                title: article.title,
                citation: `${article.authors.slice(0, 3).join(', ')}${article.authors.length > 3 ? ' et al.' : ''} ${article.journal}, ${article.publicationDate}`,
                url: article.url,
                volume: article.volume,
                issue: article.issue,
                pages: article.pages,
                doi: article.doi
            };

            if (article.abstract) {
                structured.abstract = truncateText(article.abstract, ABSTRACT_MAX_CHARS);
                structured.key_points = extractKeyPoints(article.abstract);
                structured.structured_sections = extractAbstractSections(article.abstract);
            }

            if (article.meshTerms && article.meshTerms.length > 0) {
                structured.keywords = article.meshTerms.slice(0, 15);
            }

            return structured;
        });
    }

    // 标准格式 (默认)
    return articles.map(article => {
        const structured = {
            pmid: article.pmid,
            title: article.title,
            citation: `${article.authors.slice(0, 3).join(', ')}${article.authors.length > 3 ? ' et al.' : ''} ${article.journal}, ${article.publicationDate}`,
            url: article.url
        };

        if (article.abstract) {
            structured.abstract = truncateText(article.abstract, ABSTRACT_MAX_CHARS);
            structured.key_points = extractKeyPoints(article.abstract);
        }

        if (article.meshTerms && article.meshTerms.length > 0) {
            structured.keywords = article.meshTerms.slice(0, 8);
        }

        return structured;
    });
}
