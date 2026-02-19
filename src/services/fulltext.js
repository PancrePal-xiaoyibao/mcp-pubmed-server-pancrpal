import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import {
    CACHE_VERSION, REQUEST_TIMEOUT, FULLTEXT_MODE, FULLTEXT_ENABLED, FULLTEXT_AUTO_DOWNLOAD,
    FULLTEXT_CACHE_DIR, PDF_CACHE_EXPIRY, MAX_PDF_SIZE,
    PMC_BASE_URL, UNPAYWALL_API_URL
} from '../config.js';
import {
    detectSystemEnvironment, downloadWithPowerShell, downloadWithWgetOrCurl
} from './system.js';

export class FulltextService {
    init() {
        try {
            if (!fs.existsSync(FULLTEXT_CACHE_DIR)) {
                fs.mkdirSync(FULLTEXT_CACHE_DIR, { recursive: true });
                console.error(`[FullText] Created fulltext cache directory: ${FULLTEXT_CACHE_DIR}`);
            }

            const fulltextIndexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
            if (!fs.existsSync(fulltextIndexPath)) {
                const indexData = {
                    version: CACHE_VERSION,
                    created: new Date().toISOString(),
                    fulltext_papers: {},
                    stats: {
                        totalPDFs: 0,
                        totalSize: 0,
                        lastCleanup: new Date().toISOString()
                    }
                };
                fs.writeFileSync(fulltextIndexPath, JSON.stringify(indexData, null, 2));
                console.error(`[FullText] Created fulltext index: ${fulltextIndexPath}`);
            }

            console.error(`[FullText] Full-text mode initialized (mode: ${FULLTEXT_MODE})`);
        } catch (error) {
            console.error(`[FullText] Error initializing full-text mode:`, error.message);
        }
    }

    async detectOpenAccess(article) {
        const oaInfo = {
            isOpenAccess: false,
            sources: [],
            downloadUrl: null,
            pmcid: null,
            doi: article.doi
        };

        try {
            // 1. 检查PMC免费全文
            if (article.pmcid || article.publicationTypes?.includes('PMC')) {
                const pmcInfo = await this.checkPMCContent(article.pmid);
                if (pmcInfo.isAvailable) {
                    oaInfo.isOpenAccess = true;
                    oaInfo.sources.push('PMC');
                    oaInfo.downloadUrl = pmcInfo.downloadUrl;
                    oaInfo.pmcid = pmcInfo.pmcid;
                }
            }

            // 2. 检查DOI的Unpaywall
            if (article.doi && !oaInfo.isOpenAccess) {
                const unpaywallInfo = await this.checkUnpaywall(article.doi);
                if (unpaywallInfo.isOpenAccess) {
                    oaInfo.isOpenAccess = true;
                    oaInfo.sources.push('Unpaywall');
                    oaInfo.downloadUrl = unpaywallInfo.downloadUrl;
                }
            }

            // 3. 检查出版商直接OA
            if (!oaInfo.isOpenAccess && article.doi) {
                const publisherInfo = await this.checkPublisherOA(article.doi);
                if (publisherInfo.isOpenAccess) {
                    oaInfo.isOpenAccess = true;
                    oaInfo.sources.push('Publisher');
                    oaInfo.downloadUrl = publisherInfo.downloadUrl;
                }
            }

        } catch (error) {
            console.error(`[FullText] Error detecting OA for ${article.pmid}:`, error.message);
        }

        return oaInfo;
    }

    async checkPMCContent(pmid) {
        try {
            const pmcUrl = `${PMC_BASE_URL}/?term=${pmid}`;
            const response = await fetch(pmcUrl, { timeout: REQUEST_TIMEOUT });

            if (response.ok) {
                const html = await response.text();
                const pmcMatch = html.match(/PMC(\d+)/);
                if (pmcMatch) {
                    const pmcid = `PMC${pmcMatch[1]}`;
                    return {
                        isAvailable: true,
                        pmcid: pmcid,
                        downloadUrl: `${PMC_BASE_URL}/articles/${pmcid}/pdf/`
                    };
                }
            }
        } catch (error) {
            console.error(`[FullText] Error checking PMC for ${pmid}:`, error.message);
        }

        return { isAvailable: false };
    }

    async checkUnpaywall(doi) {
        try {
            const unpaywallUrl = `${UNPAYWALL_API_URL}/${doi}?email=${process.env.PUBMED_EMAIL || 'user@example.com'}`;
            const response = await fetch(unpaywallUrl, { timeout: REQUEST_TIMEOUT });

            if (response.ok) {
                const data = await response.json();
                if (data.is_oa && data.best_oa_location) {
                    return {
                        isOpenAccess: true,
                        downloadUrl: data.best_oa_location.url,
                        source: data.best_oa_location.source
                    };
                }
            }
        } catch (error) {
            console.error(`[FullText] Error checking Unpaywall for ${doi}:`, error.message);
        }

        return { isOpenAccess: false };
    }

    async checkPublisherOA(doi) {
        try {
            const doiUrl = `https://doi.org/${doi}`;
            const response = await fetch(doiUrl, {
                timeout: REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; PubMed-MCP-Server/2.0)'
                }
            });

            if (response.ok) {
                const html = await response.text();
                const pdfMatch = html.match(/href="([^"]*\.pdf[^"]*)"/i);
                if (pdfMatch) {
                    return {
                        isOpenAccess: true,
                        downloadUrl: pdfMatch[1]
                    };
                }
            }
        } catch (error) {
            console.error(`[FullText] Error checking publisher OA for ${doi}:`, error.message);
        }

        return { isOpenAccess: false };
    }

    async downloadPDF(pmid, downloadUrl, oaInfo) {
        try {
            console.error(`[FullText] Downloading PDF for ${pmid} from ${oaInfo.sources.join(', ')}`);

            const response = await fetch(downloadUrl, {
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; PubMed-MCP-Server/2.0)',
                    'Accept': 'application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength) > MAX_PDF_SIZE) {
                throw new Error(`PDF too large: ${contentLength} bytes (max: ${MAX_PDF_SIZE})`);
            }

            const buffer = await response.buffer();
            if (buffer.length > MAX_PDF_SIZE) {
                throw new Error(`PDF too large: ${buffer.length} bytes (max: ${MAX_PDF_SIZE})`);
            }

            const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
            fs.writeFileSync(pdfPath, buffer);

            await this.updateIndex(pmid, {
                pmid: pmid,
                downloadUrl: downloadUrl,
                sources: oaInfo.sources,
                filePath: `${pmid}.pdf`,
                fileSize: buffer.length,
                downloaded: new Date().toISOString(),
                pmcid: oaInfo.pmcid,
                doi: oaInfo.doi
            });

            console.error(`[FullText] PDF downloaded successfully: ${pmid} (${buffer.length} bytes)`);
            return {
                success: true,
                filePath: pdfPath,
                fileSize: buffer.length,
                sources: oaInfo.sources
            };

        } catch (error) {
            console.error(`[FullText] Error downloading PDF for ${pmid}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async smartDownloadPDF(pmid, downloadUrl, oaInfo) {
        const system = detectSystemEnvironment();
        const filename = `${pmid}.pdf`;
        const filePath = path.join(FULLTEXT_CACHE_DIR, filename);

        console.error(`[SmartDownload] Starting download for ${pmid} on ${system.platform}`);
        console.error(`[SmartDownload] URL: ${downloadUrl}`);
        console.error(`[SmartDownload] Command: ${system.downloadCommand}`);

        try {
            let downloadResult;

            if (system.isWindows) {
                downloadResult = await downloadWithPowerShell(downloadUrl, filePath, system);
            } else {
                downloadResult = await downloadWithWgetOrCurl(downloadUrl, filePath, system);
            }

            if (downloadResult.success) {
                await this.updateIndex(pmid, {
                    pmid: pmid,
                    downloadUrl: downloadUrl,
                    sources: oaInfo.sources,
                    filePath: filename,
                    fileSize: downloadResult.fileSize,
                    downloaded: new Date().toISOString(),
                    pmcid: oaInfo.pmcid,
                    doi: oaInfo.doi,
                    downloadMethod: system.downloadCommand
                });

                console.error(`[SmartDownload] Successfully downloaded ${pmid} (${downloadResult.fileSize} bytes)`);
            }

            return downloadResult;

        } catch (error) {
            console.error(`[SmartDownload] Error downloading ${pmid}:`, error.message);
            return {
                success: false,
                error: error.message,
                pmid: pmid
            };
        }
    }

    async batchDownloadPDFs(downloadList) {
        const system = detectSystemEnvironment();
        const results = [];

        console.error(`[BatchDownload] Starting batch download for ${downloadList.length} papers on ${system.platform}`);

        for (let i = 0; i < downloadList.length; i++) {
            const item = downloadList[i];
            console.error(`[BatchDownload] Processing ${i + 1}/${downloadList.length}: ${item.pmid}`);

            try {
                const delay = Math.random() * 2000 + 1000;
                await new Promise(resolve => setTimeout(resolve, delay));

                const result = await this.smartDownloadPDF(item.pmid, item.downloadUrl, item.oaInfo);
                results.push({
                    pmid: item.pmid,
                    title: item.title,
                    result: result
                });

                if (i < downloadList.length - 1) {
                    const interval = Math.random() * 3000 + 2000;
                    console.error(`[BatchDownload] Waiting ${Math.round(interval/1000)}s before next download...`);
                    await new Promise(resolve => setTimeout(resolve, interval));
                }

            } catch (error) {
                console.error(`[BatchDownload] Error processing ${item.pmid}:`, error.message);
                results.push({
                    pmid: item.pmid,
                    title: item.title,
                    result: {
                        success: false,
                        error: error.message
                    }
                });
            }
        }

        return results;
    }

    async updateIndex(pmid, fulltextInfo) {
        try {
            const indexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

            indexData.fulltext_papers[pmid] = {
                ...fulltextInfo,
                cached: new Date().toISOString()
            };

            indexData.stats.totalPDFs = Object.keys(indexData.fulltext_papers).length;
            indexData.stats.totalSize = Object.values(indexData.fulltext_papers)
                .reduce((sum, paper) => sum + (paper.fileSize || 0), 0);

            fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));

        } catch (error) {
            console.error(`[FullText] Error updating fulltext index:`, error.message);
        }
    }

    isPDFCached(pmid) {
        try {
            const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
            if (fs.existsSync(pdfPath)) {
                const stats = fs.statSync(pdfPath);
                const age = Date.now() - stats.mtime.getTime();
                if (age < PDF_CACHE_EXPIRY) {
                    return {
                        cached: true,
                        filePath: pdfPath,
                        fileSize: stats.size,
                        age: age
                    };
                } else {
                    fs.unlinkSync(pdfPath);
                    return { cached: false };
                }
            }
        } catch (error) {
            console.error(`[FullText] Error checking PDF cache for ${pmid}:`, error.message);
        }

        return { cached: false };
    }

    async extractPDFText(pmid) {
        try {
            const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
            if (!fs.existsSync(pdfPath)) {
                return null;
            }

            const stats = fs.statSync(pdfPath);
            return {
                pmid: pmid,
                filePath: pdfPath,
                fileSize: stats.size,
                extracted: false,
                note: "PDF text extraction requires additional library (pdf-parse)"
            };

        } catch (error) {
            console.error(`[FullText] Error extracting PDF text for ${pmid}:`, error.message);
            return null;
        }
    }
}
