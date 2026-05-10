import path from 'path';

export const PUBMED_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
export const REQUEST_TIMEOUT = 30000;

export const CACHE_DIR = path.join(process.cwd(), 'cache');
export const PAPER_CACHE_DIR = path.join(CACHE_DIR, 'papers');
export const CACHE_VERSION = '2.0';
export const PAPER_CACHE_EXPIRY = 30 * 24 * 60 * 60 * 1000;

export const ABSTRACT_MODE = (process.env.ABSTRACT_MODE || 'quick').toLowerCase() === 'deep' ? 'deep' : 'quick';
export const ABSTRACT_MAX_CHARS = ABSTRACT_MODE === 'deep' ? 6000 : 1500;

export const FULLTEXT_MODE = (process.env.FULLTEXT_MODE || 'disabled').toLowerCase();
export const FULLTEXT_ENABLED = FULLTEXT_MODE === 'enabled' || FULLTEXT_MODE === 'auto';
export const FULLTEXT_AUTO_DOWNLOAD = FULLTEXT_MODE === 'auto';

export const FULLTEXT_CACHE_DIR = path.join(CACHE_DIR, 'fulltext');
export const PDF_CACHE_EXPIRY = 90 * 24 * 60 * 60 * 1000;
export const MAX_PDF_SIZE = 50 * 1024 * 1024;

export const PMC_BASE_URL = 'https://www.ncbi.nlm.nih.gov/pmc';
export const UNPAYWALL_API_URL = 'https://api.unpaywall.org/v2';

const VALID_MODES = ['stdio', 'streamableHttp'] as const;

const parseMode = (): 'stdio' | 'streamableHttp' => {
  const args = process.argv.slice(2);
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  if (modeArg) {
    const mode = modeArg.split('=')[1] as string;
    if (VALID_MODES.includes(mode as typeof VALID_MODES[number])) {
      return mode as 'stdio' | 'streamableHttp';
    }
    console.error(`[Config] Unknown mode '${mode}', falling back to stdio`);
    return 'stdio';
  }
  const envMode = process.env.MCP_TRANSPORT || 'stdio';
  if (VALID_MODES.includes(envMode as typeof VALID_MODES[number])) {
    return envMode as 'stdio' | 'streamableHttp';
  }
  console.error(`[Config] Unknown MCP_TRANSPORT '${envMode}', falling back to stdio`);
  return 'stdio';
};

export const MODE = parseMode();
export const PORT = parseInt(process.env.PORT || '8745', 10);
