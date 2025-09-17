module.exports = {
  meta: {
    type: 'layout',
    docs: {
      description: 'require empty line after super() call in constructor',
    },
    fixable: 'whitespace',
    schema: [],
  },
  create(context) {
    const sourceCode = context.getSourceCode();

    return {
      MethodDefinition(node) {
        if (node.kind !== 'constructor') return;

        const body = node.value && node.value.body;

        if (!body) return;

        const statements = body.body;

        if (statements.length < 2) return;

        const firstStatement = statements[0];

        if (
          firstStatement.type !== 'ExpressionStatement' ||
          firstStatement.expression.type !== 'CallExpression' ||
          firstStatement.expression.callee.type !== 'Super'
        ) {
          return;
        }

        const lastToken = sourceCode.getLastToken(firstStatement);
        const nextToken = sourceCode.getTokenAfter(lastToken, { includeComments: true });

        if (!nextToken) return;

        const textBetween = sourceCode.text.slice(lastToken.range[1], nextToken.range[0]);
        const lineBreaks = textBetween.match(/\n/g);

        if (!lineBreaks || lineBreaks.length < 2) {
          context.report({
            node: firstStatement,
            message: 'Expected empty line after super() call.',
            fix(fixer) {
              return fixer.insertTextAfter(lastToken, '\n');
            },
          });
        }
      },
    };
  },
};
