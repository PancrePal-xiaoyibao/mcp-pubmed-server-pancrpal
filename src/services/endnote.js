import fs from 'fs';
import path from 'path';
import {
    CACHE_VERSION, ENDNOTE_EXPORT_ENABLED, ENDNOTE_CACHE_DIR, ENDNOTE_EXPORT_FORMATS
} from '../config.js';

export class EndNoteService {
    init() {
        try {
            if (!fs.existsSync(ENDNOTE_CACHE_DIR)) {
                fs.mkdirSync(ENDNOTE_CACHE_DIR, { recursive: true });
                console.error(`[EndNote] Created endnote export directory: ${ENDNOTE_CACHE_DIR}`);
            }

            const endnoteIndexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
            if (!fs.existsSync(endnoteIndexPath)) {
                const indexData = {
                    version: CACHE_VERSION,
                    created: new Date().toISOString(),
                    exported_papers: {},
                    stats: {
                        totalExports: 0,
                        risFiles: 0,
                        bibtexFiles: 0,
                        lastExport: null
                    }
                };
                fs.writeFileSync(endnoteIndexPath, JSON.stringify(indexData, null, 2));
                console.error(`[EndNote] Created endnote export index: ${endnoteIndexPath}`);
            }

            console.error(`[EndNote] EndNote export mode initialized`);
        } catch (error) {
            console.error(`[EndNote] Error initializing EndNote export mode:`, error.message);
        }
    }

    async autoExport(articles) {
        if (!ENDNOTE_EXPORT_ENABLED) {
            return { success: false, message: "EndNote export is disabled" };
        }

        try {
            const exportResults = [];

            for (const article of articles) {
                const exportResult = await this.exportArticle(article);
                exportResults.push(exportResult);
            }

            await this.updateIndex(exportResults);

            return {
                success: true,
                exported: exportResults.filter(r => r.success).length,
                failed: exportResults.filter(r => !r.success).length,
                results: exportResults
            };

        } catch (error) {
            console.error(`[EndNote] Error in auto export:`, error.message);
            return { success: false, error: error.message };
        }
    }

    async exportArticle(article) {
        try {
            const pmid = article.pmid;
            const exportResults = {};

            // 导出RIS格式
            const risContent = this.generateRIS(article);
            const risFilePath = path.join(ENDNOTE_CACHE_DIR, `${pmid}.ris`);
            fs.writeFileSync(risFilePath, risContent, 'utf8');
            exportResults.ris = { success: true, filePath: risFilePath };

            // 导出BibTeX格式
            const bibtexContent = this.generateBibTeX(article);
            const bibtexFilePath = path.join(ENDNOTE_CACHE_DIR, `${pmid}.bib`);
            fs.writeFileSync(bibtexFilePath, bibtexContent, 'utf8');
            exportResults.bibtex = { success: true, filePath: bibtexFilePath };

            console.error(`[EndNote] Exported ${pmid} to RIS and BibTeX formats`);

            return {
                pmid: pmid,
                title: article.title,
                success: true,
                formats: exportResults,
                exported: new Date().toISOString()
            };

        } catch (error) {
            console.error(`[EndNote] Error exporting ${article.pmid}:`, error.message);
            return {
                pmid: article.pmid,
                title: article.title,
                success: false,
                error: error.message
            };
        }
    }

    generateRIS(article) {
        const ris = [];

        ris.push('TY  - JOUR');
        if (article.title) ris.push(`TI  - ${article.title}`);
        if (article.authors && article.authors.length > 0) {
            article.authors.forEach(author => ris.push(`AU  - ${author}`));
        }
        if (article.journal) ris.push(`T2  - ${article.journal}`);
        if (article.pubDate) ris.push(`PY  - ${article.pubDate}`);
        if (article.volume) ris.push(`VL  - ${article.volume}`);
        if (article.issue) ris.push(`IS  - ${article.issue}`);
        if (article.pages) ris.push(`SP  - ${article.pages}`);
        if (article.doi) ris.push(`DO  - ${article.doi}`);
        if (article.pmid) ris.push(`PMID - ${article.pmid}`);
        if (article.pmcid) ris.push(`PMC - ${article.pmcid}`);
        if (article.abstract) ris.push(`AB  - ${article.abstract}`);
        if (article.keywords && article.keywords.length > 0) {
            article.keywords.forEach(keyword => ris.push(`KW  - ${keyword}`));
        }
        if (article.url) ris.push(`UR  - ${article.url}`);
        ris.push('LA  - eng');
        ris.push('DB  - PubMed');
        ris.push('ER  - ');
        ris.push('');

        return ris.join('\n');
    }

    generateBibTeX(article) {
        const pmid = article.pmid;
        const firstAuthor = article.authors && article.authors.length > 0
            ? article.authors[0].replace(/\s+/g, '').toLowerCase()
            : 'unknown';
        const year = article.pubDate ? article.pubDate.split('-')[0] : 'unknown';
        const citeKey = `${firstAuthor}${year}${pmid}`;

        const bibtex = [];
        bibtex.push(`@article{${citeKey},`);
        bibtex.push(`  title = {${article.title || 'Unknown Title'}},`);
        if (article.authors && article.authors.length > 0) {
            bibtex.push(`  author = {${article.authors.join(' and ')}},`);
        }
        if (article.journal) bibtex.push(`  journal = {${article.journal}},`);
        if (article.pubDate) bibtex.push(`  year = {${article.pubDate}},`);
        if (article.volume) bibtex.push(`  volume = {${article.volume}},`);
        if (article.issue) bibtex.push(`  number = {${article.issue}},`);
        if (article.pages) bibtex.push(`  pages = {${article.pages}},`);
        if (article.doi) bibtex.push(`  doi = {${article.doi}},`);
        if (article.pmid) bibtex.push(`  pmid = {${article.pmid}},`);
        if (article.pmcid) bibtex.push(`  pmcid = {${article.pmcid}},`);
        if (article.abstract) bibtex.push(`  abstract = {${article.abstract}},`);
        bibtex.push(`  publisher = {PubMed},`);
        bibtex.push(`  url = {https://pubmed.ncbi.nlm.nih.gov/${pmid}/},`);
        bibtex.push(`}`);
        bibtex.push('');

        return bibtex.join('\n');
    }

    async updateIndex(exportResults) {
        try {
            const indexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

            exportResults.forEach(result => {
                if (result.success) {
                    indexData.exported_papers[result.pmid] = {
                        pmid: result.pmid,
                        title: result.title,
                        formats: result.formats,
                        exported: result.exported
                    };
                }
            });

            indexData.stats.totalExports = Object.keys(indexData.exported_papers).length;
            indexData.stats.risFiles = Object.values(indexData.exported_papers)
                .filter(paper => paper.formats && paper.formats.ris && paper.formats.ris.success).length;
            indexData.stats.bibtexFiles = Object.values(indexData.exported_papers)
                .filter(paper => paper.formats && paper.formats.bibtex && paper.formats.bibtex.success).length;
            indexData.stats.lastExport = new Date().toISOString();

            fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));

        } catch (error) {
            console.error(`[EndNote] Error updating export index:`, error.message);
        }
    }

    getStatus() {
        try {
            const indexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
            if (!fs.existsSync(indexPath)) {
                return {
                    enabled: ENDNOTE_EXPORT_ENABLED,
                    directory: ENDNOTE_CACHE_DIR,
                    totalExports: 0,
                    risFiles: 0,
                    bibtexFiles: 0,
                    lastExport: null
                };
            }

            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            return {
                enabled: ENDNOTE_EXPORT_ENABLED,
                directory: ENDNOTE_CACHE_DIR,
                totalExports: indexData.stats.totalExports,
                risFiles: indexData.stats.risFiles,
                bibtexFiles: indexData.stats.bibtexFiles,
                lastExport: indexData.stats.lastExport,
                supportedFormats: ENDNOTE_EXPORT_FORMATS
            };

        } catch (error) {
            console.error(`[EndNote] Error getting export status:`, error.message);
            return {
                enabled: ENDNOTE_EXPORT_ENABLED,
                error: error.message
            };
        }
    }
}
