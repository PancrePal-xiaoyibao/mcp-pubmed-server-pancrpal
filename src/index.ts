#!/usr/bin/env node
import 'dotenv/config';
import { PubMedDataServer } from './server.js';

const server = new PubMedDataServer();
server.run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
