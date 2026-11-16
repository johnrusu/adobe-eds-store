/* eslint-disable quotes, operator-linebreak */
const fs = require("fs");
const path = require("path");

const STRIPE_HELPERS_PATH = path.join(__dirname, "stripe-helpers.js");
const STRIPE_HELPERS_IMPORT =
  /import \{([^}]*)\} from ['"]\.\.\/stripe-shared\/stripe-helpers\.js['"];/;

// The shared helpers as an expression that runs in the block's vm context and
// returns their exports. Their drop-in imports come from the test's __mocks.
function stripeHelpersExpression() {
  const source = fs.readFileSync(STRIPE_HELPERS_PATH, "utf8");
  const names = [
    ...source.matchAll(/export (?:async function|function|const|let) (\w+)/g),
  ].map((match) => match[1]);
  const body = source
    .replace(
      /import \{ events \} from ['"]@dropins\/tools\/event-bus\.js['"];/,
      "const { events } = __mocks;",
    )
    .replace(
      /import \* as checkoutApi from ['"]@dropins\/storefront-checkout\/api\.js['"];/,
      "const { checkoutApi } = __mocks;",
    )
    .replace(/export (async function|function|const|let) /g, "$1 ");

  return `(() => {\n${body}\nreturn { ${names.join(", ")} };\n})()`;
}

// Replace a block's import of the shared helpers with their code.
function inlineStripeHelpers(blockSource) {
  return blockSource.replace(
    STRIPE_HELPERS_IMPORT,
    (_match, names) => `const {${names}} = ${stripeHelpersExpression()};`,
  );
}

module.exports = { inlineStripeHelpers };
