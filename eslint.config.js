const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettierPlugin = require('eslint-plugin-prettier');
const importPlugin = require('eslint-plugin-import');
const unusedImportsPlugin = require('eslint-plugin-unused-imports');

module.exports = [
    {
        ignores: ['dist/**', 'node_modules/**'],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...require('globals').es2021,
                ...require('globals').node,
                ...require('globals').jest,
            },
        },
        plugins: {
            prettier: prettierPlugin,
            import: importPlugin,
            'unused-imports': unusedImportsPlugin,
        },
        rules: {
            ...js.configs.recommended.rules,
            indent: 'off',
            quotes: ['error', 'single'],
            semi: ['error', 'always'],
            'comma-dangle': ['error', 'always-multiline'],
            'linebreak-style': ['error', 'unix'],
            'object-curly-spacing': ['error', 'always'],
            'no-trailing-spaces': 'error',
            'no-tabs': 'error',
            'no-mixed-spaces-and-tabs': 'error',
            'import/no-duplicates': 'error',
            'import/no-default-export': 'error',
            'import/first': 'error',
            'import/order': [
                'error',
                {
                    groups: [['builtin'], ['external'], ['sibling', 'index'], ['parent', 'internal', 'object', 'type']],
                    'newlines-between': 'always',
                },
            ],
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],
            'no-unused-vars': 'error',
            'no-unused-private-class-members': 'error',
            'no-extra-boolean-cast': 'off',
            'no-var': 'error',
            'prefer-const': 'error',
            eqeqeq: 'error',
            'arrow-parens': ['error', 'as-needed'],
            'lines-between-class-members': [
                'error',
                { enforce: [{ blankLine: 'always', prev: 'method', next: 'method' }] },
            ],
            'prettier/prettier': 'error',
            'padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: 'import', next: '*' },
                { blankLine: 'any', prev: 'import', next: 'import' },
                { blankLine: 'always', prev: '*', next: 'return' },
                { blankLine: 'always', prev: ['for', 'while', 'do'], next: '*' },
                { blankLine: 'always', prev: 'block-like', next: '*' },
                { blankLine: 'always', prev: '*', next: 'block-like' },
                { blankLine: 'always', prev: '*', next: ['const', 'let', 'var'] },
                { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
                {
                    blankLine: 'any',
                    prev: ['const', 'let', 'var'],
                    next: ['const', 'let', 'var'],
                },
            ],
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
    },
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: require('@typescript-eslint/parser'),
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...require('globals').es2021,
                ...require('globals').node,
                ...require('globals').jest,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            prettier: prettierPlugin,
            import: importPlugin,
            'unused-imports': unusedImportsPlugin,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...tsPlugin.configs.recommended.rules,
            indent: 'off',
            quotes: ['error', 'single'],
            semi: ['error', 'always'],
            'comma-dangle': ['error', 'always-multiline'],
            'linebreak-style': ['error', 'unix'],
            'object-curly-spacing': ['error', 'always'],
            'no-trailing-spaces': 'error',
            'no-tabs': 'error',
            'no-mixed-spaces-and-tabs': 'error',
            'import/no-duplicates': 'error',
            'import/no-default-export': 'error',
            'import/first': 'error',
            'import/order': [
                'error',
                {
                    groups: [['builtin'], ['external'], ['sibling', 'index'], ['parent', 'internal', 'object', 'type']],
                    'newlines-between': 'always',
                },
            ],
            'unused-imports/no-unused-imports': 'error',
            'unused-imports/no-unused-vars': [
                'error',
                {
                    vars: 'all',
                    varsIgnorePattern: '^_|^[A-Z][a-zA-Z0-9]*$',
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                },
            ],
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-unused-private-class-members': 'error',
            'no-extra-boolean-cast': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-array-constructor': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            '@typescript-eslint/no-empty-function': 'error',
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/naming-convention': 'off',
            'no-var': 'error',
            'prefer-const': 'error',
            eqeqeq: 'error',
            'arrow-parens': ['error', 'as-needed'],
            'lines-between-class-members': [
                'error',
                { enforce: [{ blankLine: 'always', prev: 'method', next: 'method' }] },
            ],
            '@typescript-eslint/consistent-type-imports': 'error',
            'prettier/prettier': 'error',
            'padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: 'import', next: '*' },
                { blankLine: 'any', prev: 'import', next: 'import' },
                { blankLine: 'always', prev: '*', next: 'return' },
                { blankLine: 'always', prev: ['for', 'while', 'do'], next: '*' },
                { blankLine: 'always', prev: 'block-like', next: '*' },
                { blankLine: 'always', prev: '*', next: 'block-like' },
                { blankLine: 'always', prev: '*', next: ['const', 'let', 'var'] },
                { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
                {
                    blankLine: 'any',
                    prev: ['const', 'let', 'var'],
                    next: ['const', 'let', 'var'],
                },
            ],
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'MethodDefinition[accessibility]',
                    message: 'Accessibility modifiers are not allowed. Use # for private methods.',
                },
                {
                    selector: 'PropertyDefinition[accessibility]',
                    message: 'Accessibility modifiers are not allowed. Use # for private fields.',
                },
                {
                    selector: 'TSParameterProperty[accessibility]',
                    message: 'Accessibility modifiers are not allowed. Use # for private fields.',
                },
                {
                    selector: ':matches(PropertyDefinition, TSParameterProperty)[readonly=true]',
                    message: 'Readonly modifier is not allowed. Use a # prefixed field with a getter instead.',
                },
            ],
        },
        linterOptions: {
            reportUnusedDisableDirectives: false,
        },
    },
    {
        files: ['**/*.d.ts', 'src/types.ts'],
        rules: {
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'unused-imports/no-unused-imports': 'off',
            'unused-imports/no-unused-vars': 'off',
        },
    },
];
