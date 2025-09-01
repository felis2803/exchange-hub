#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

const result = spawnSync('npx', ['ts-node', examplePath], { stdio: 'inherit' });

process.exit(result.status);
