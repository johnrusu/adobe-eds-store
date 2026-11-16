/* eslint-disable quotes, operator-linebreak */
const fs = require("fs");
const path = require("path");

const STRIPE_HELPERS_PATH = path.join(__dirname, "stripe-helpers.js");
const STRIPE_CONSTANTS_PATH = path.join(__dirname, "constants.js");
const STRIPE_HELPERS_IMPORT =
  /import \{([^}]*)\} from ['"]\.\.\/stripe-shared\/stripe-helpers\.js['"];/;
const STRIPE_CONSTANTS_IMPORT =
  /import \{([^}]*)\} from ['"]\.\.\/stripe-shared\/constants\.js['"];/;
const SHARED_CONSTANTS_IMPORT = /import \{[^}]*\} from ['"]\.\/constants\.js['"];\n/;

// The names a module exports with `export const|let|function|async function`.
function exportedNames(source) {
  return [
    ...source.matchAll(/export (?:async function|function|const|let) (\w+)/g),
  ].map((match) => match[1]);
}

// A module's code without its `export` keywords.
function withoutExports(source) {
  return source.replace(/export (async function|function|const|let) /g, "$1 ");
}

// A constants module as an expression that runs in the block's vm context and
// returns its exports.
function constantsExpression(constantsPath) {
  const source = fs.readFileSync(constantsPath, "utf8");
  // A constants module can import the shared constants and re-export some of them.
  const reExported = [...source.matchAll(/export \{([^}]*)\};/g)].flatMap(
    (match) => match[1].split(",").map((name) => name.trim()).filter(Boolean),
  );
  const body = withoutExports(source)
    .replace(/export \{[^}]*\};\n?/g, "")
    .replace(
      STRIPE_CONSTANTS_IMPORT,
      (_match, names) => `const {${names}} = ${constantsExpression(STRIPE_CONSTANTS_PATH)};`,
    );

  return `(() => {\n${body}\nreturn { ${[...exportedNames(source), ...reExported].join(", ")} };\n})()`;
}

// The shared helpers as an expression that runs in the block's vm context and
// returns their exports. Their drop-in imports come from the test's __mocks.
function stripeHelpersExpression() {
  const source = fs.readFileSync(STRIPE_HELPERS_PATH, "utf8");
  const constantsSource = fs.readFileSync(STRIPE_CONSTANTS_PATH, "utf8");
  const body = withoutExports(source)
    .replace(
      /import \{ events \} from ['"]@dropins\/tools\/event-bus\.js['"];/,
      "const { events } = __mocks;",
    )
    .replace(
      /import \* as checkoutApi from ['"]@dropins\/storefront-checkout\/api\.js['"];/,
      "const { checkoutApi } = __mocks;",
    )
    .replace(SHARED_CONSTANTS_IMPORT, () => withoutExports(constantsSource));

  return `(() => {\n${body}\nreturn { ${exportedNames(source).join(", ")} };\n})()`;
}

// Replace a block's imports of the shared helpers and shared constants with their code.
function inlineStripeHelpers(blockSource) {
  return blockSource
    .replace(
      STRIPE_HELPERS_IMPORT,
      (_match, names) => `const {${names}} = ${stripeHelpersExpression()};`,
    )
    .replace(
      STRIPE_CONSTANTS_IMPORT,
      (_match, names) => `const {${names}} = ${constantsExpression(STRIPE_CONSTANTS_PATH)};`,
    );
}

// Replace a block's import of its own constants module with the module's code.
function inlineBlockConstants(blockSource, constantsPath) {
  return blockSource.replace(
    /import \{([^}]*)\} from ['"]\.\/constants\.js['"];/,
    (_match, names) => `const {${names}} = ${constantsExpression(constantsPath)};`,
  );
}

module.exports = { inlineStripeHelpers, inlineBlockConstants };
