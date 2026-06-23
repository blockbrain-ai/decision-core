#!/usr/bin/env node
process.env['LOG_LEVEL'] = process.env['LOG_LEVEL'] ?? 'silent';

const { runCli } = await import('./cli.js');
const code = await runCli(process.argv);
process.exitCode = code;
