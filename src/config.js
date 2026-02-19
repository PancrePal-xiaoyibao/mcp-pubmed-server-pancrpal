import path from 'path';

export const PUBMED_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
export const RATE_LIMIT_DELAY = 334; // PubMed rate limit: 3 requests per second
export const REQUEST_TIMEOUT = 30000; // 30秒请求超时

// 缓存配置
export const CACHE_DIR = path.join(process.cwd(), 'cache');
export const PAPER_CACHE_DIR = path.join(CACHE_DIR, 'papers');
export const CACHE_VERSION = '1.0';
export const PAPER_CACHE_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30天过期

// Abstract truncation modes (env-driven)
export const ABSTRACT_MODE = (process.env.ABSTRACT_MODE || 'quick').toLowerCase() === 'deep' ? 'deep' : 'quick';
export const ABSTRACT_MAX_CHARS = ABSTRACT_MODE === 'deep' ? 6000 : 1500;
export const ABSTRACT_MODE_NOTE = ABSTRACT_MODE === 'deep'
    ? 'Deep mode: up to 6000 chars per abstract. Requires large model context (>=120k tokens recommended for batch usage).'
    : 'Quick mode: up to 1500 chars per abstract (may be incomplete). Optimized for fast retrieval.';

// Full-text mode configuration
export const FULLTEXT_MODE = (process.env.FULLTEXT_MODE || 'disabled').toLowerCase();
export const FULLTEXT_ENABLED = FULLTEXT_MODE === 'enabled' || FULLTEXT_MODE === 'auto';
export const FULLTEXT_AUTO_DOWNLOAD = FULLTEXT_MODE === 'auto';

// Full-text cache configuration
export const FULLTEXT_CACHE_DIR = path.join(CACHE_DIR, 'fulltext');
export const PDF_CACHE_EXPIRY = 90 * 24 * 60 * 60 * 1000; // 90天过期
export const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB最大PDF大小

// EndNote导出配置
export const ENDNOTE_EXPORT_ENABLED = (process.env.ENDNOTE_EXPORT || 'enabled').toLowerCase() === 'enabled';
export const ENDNOTE_CACHE_DIR = path.join(CACHE_DIR, 'endnote');
export const ENDNOTE_EXPORT_FORMATS = ['ris', 'bibtex']; // 支持的导出格式

// OA detection URLs
export const PMC_BASE_URL = 'https://www.ncbi.nlm.nih.gov/pmc';
export const PMC_API_URL = 'https://www.ncbi.nlm.nih.gov/pmc/oai/oai.cgi';
export const UNPAYWALL_API_URL = 'https://api.unpaywall.org/v2';

// 传输模式配置
const VALID_MODES = ['stdio', 'streamableHttp'];

const parseMode = () => {
    const args = process.argv.slice(2);
    const modeArg = args.find(arg => arg.startsWith('--mode='));
    if (modeArg) {
        const mode = modeArg.split('=')[1];
        if (!VALID_MODES.includes(mode)) {
            console.error(`[Config] Warning: Unknown mode '${mode}', valid modes: ${VALID_MODES.join(', ')}. Falling back to stdio`);
            return 'stdio';
        }
        return mode;
    }
    // 支持环境变量作为备选
    const envMode = process.env.MCP_TRANSPORT || 'stdio';
    if (!VALID_MODES.includes(envMode)) {
        console.error(`[Config] Warning: Unknown MCP_TRANSPORT '${envMode}', falling back to stdio`);
        return 'stdio';
    }
    return envMode;
};

export const MODE = parseMode();
export const PORT = parseInt(process.env.PORT || '8745', 10);
