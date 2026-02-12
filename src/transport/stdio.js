import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ABSTRACT_MODE, ABSTRACT_MAX_CHARS, ABSTRACT_MODE_NOTE,
    FULLTEXT_MODE, FULLTEXT_ENABLED, FULLTEXT_AUTO_DOWNLOAD
} from '../config.js';

export async function startStdio(server) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("PubMed Data Server v2.0 running on stdio");
    console.error(`[AbstractMode] ${ABSTRACT_MODE} (max_chars=${ABSTRACT_MAX_CHARS}) - ${ABSTRACT_MODE_NOTE}`);
    if (FULLTEXT_ENABLED) {
        console.error(`[FullTextMode] ${FULLTEXT_MODE} - ${FULLTEXT_AUTO_DOWNLOAD ? 'Auto-download enabled' : 'Manual download only'}`);
    }
}
