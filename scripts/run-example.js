#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// register ts-node so we can execute TypeScript examples directly
require('ts-node/register');

const exampleName = process.argv[2];

if (!exampleName) {
  console.error('Please provide an example name.');
  console.error('Usage: npm run exp <example>');
  process.exit(1);
}

const examplePath = path.resolve(__dirname, '..', 'examples', exampleName, 'index.ts');

if (!fs.existsSync(examplePath)) {
  console.error(`Example "${exampleName}" not found at ${examplePath}`);
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  process.exit(1);
});

require(examplePath);
