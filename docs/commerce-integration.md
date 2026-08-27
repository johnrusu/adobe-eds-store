# Commerce and Stripe integration

## Foundation

This storefront is based on Adobe's `hlxsites/aem-boilerplate-commerce`
foundation. Commerce functionality is provided by browser-side Drop-ins and is
configured through `/config.json` or the EDS Configuration Service.

The active `config.json` targets the PaaS Magento GraphQL endpoint at
`adobe-enterprise2.developmentcloud.net`. Because that environment does not
expose Live Search / Catalog Service `productSearch`, the storefront enables
`commerce-catalog-bridge` to map PLP/search requests to Magento core `products`
GraphQL. When Catalog Service is available, point `commerce-endpoint` at the
SaaS catalog URL and set `commerce-catalog-bridge` to `false`.

On localhost, `npm start` also runs `scripts/dev-graphql-proxy.mjs` on
`127.0.0.1:3001`. It proxies Magento GraphQL (`/graphql`) to avoid CORS and
Magento media (`/media/*`) so product images do not time out in the browser.
Media responses are cached under `.media-cache/`.

On the checkout page only, localhost also displays a development warning with
dedicated-profile Chrome commands for debugging PaaS CORS. The warning is never
rendered on preview or production hosts.

## Stripe checkout flow

The Stripe integration is intentionally attached to Adobe Commerce checkout
rather than rendered as a standalone authored block:

1. `build.mjs` extends the Checkout Drop-in GraphQL fragment with
   `oope_payment_method_config`.
2. `scripts/initializers/checkout.js` keeps the OOPE configuration on the
   transformed checkout model.
3. `blocks/commerce-checkout/containers.js` renders Stripe Express Checkout
   before the regular payment methods and keeps the Stripe Payment Element in
   the `oope_stripe` payment-method slot. The development-only Check/Money
   Order method is disabled so Stripe is the regular checkout selection.
4. `blocks/commerce-checkout/commerce-checkout.js` confirms regular Stripe
   payment before placing the Adobe Commerce order. Express Checkout confirms
   its wallet attempt and places the order directly.
5. `blocks/stripe-payment/stripe-payment.js` and
   `blocks/express-checkout/stripe-express-checkout.js` read the trusted App
   Builder action URLs from Commerce's `backend_integration_url` value. No
   action URL or Stripe secret is stored in storefront code.

The Stripe payment surfaces appear only after their runtime prerequisites are
met:

- the active Commerce environment exposes `oope_stripe`;
- its `backend_integration_url` JSON includes `getInitParamsUrl` and
  `createPaymentIntentUrl`;
- the App Builder actions accept requests from the storefront origin.

Express Checkout collects missing email, billing, and shipping details from the
wallet. Wallet testing requires HTTPS and a storefront domain registered in
Stripe for both test and live mode. Its standard inline alert reports payment
processing, failures, and completion before the existing order-confirmation
view takes over.

## Page contracts for the next phase

### `/products/search`

Use the `product-list-page` Commerce block backed by the Product Discovery
Drop-in. The page needs the SaaS Catalog Service endpoint, store-view headers,
environment ID, and any environment-specific access header in the public
storefront configuration.

A local authored-content fixture is available at
`drafts/products/search.plain.html`. It requests up to 12 products from the
configured SaaS catalog.

### `/cart`

Use the `commerce-cart` block. Product cards and product-detail actions must add
items through the Cart Drop-in so the cart ID and event bus state are shared with
checkout.

### `/checkout`

Use the `commerce-checkout` block. Express Checkout and the regular Stripe
Payment Element are injected by that block and should not be authored as
separate top-level blocks.

## Acceptance path

The end-to-end test sequence is:

1. Search the SaaS catalog.
2. Open a product and add a valid SKU to cart.
3. Change quantity or remove an item on `/cart`.
4. Continue to `/checkout`.
5. Use an Express Checkout wallet, or supply email, shipping, delivery, and
   billing details for regular checkout.
6. For regular checkout, select Stripe, complete the Payment Element, and place
   the order.
7. Confirm both the Adobe Commerce order and Stripe PaymentIntent reach their
   successful states.
