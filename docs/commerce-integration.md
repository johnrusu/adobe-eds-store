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

## Stripe checkout flow

The Stripe integration is intentionally attached to Adobe Commerce checkout
rather than rendered as a standalone authored block:

1. `build.mjs` extends the Checkout Drop-in GraphQL fragment with
   `oope_payment_method_config`.
2. `scripts/initializers/checkout.js` keeps the OOPE configuration on the
   transformed checkout model.
3. `blocks/commerce-checkout/containers.js` renders the Stripe Payment Element
   when Commerce returns the `oope_stripe` payment method.
4. `blocks/commerce-checkout/commerce-checkout.js` confirms Stripe payment
   before placing the Adobe Commerce order.
5. `blocks/stripe-payment/stripe-payment.js` reads the trusted App Builder
   action URLs from Commerce's `backend_integration_url` value. No action URL or
   Stripe secret is stored in storefront code.

The payment form appears only after all of these runtime prerequisites are met:

- the active Commerce environment exposes `oope_stripe`;
- its `backend_integration_url` JSON includes `getInitParamsUrl` and
  `createPaymentIntentUrl`;
- the cart has an email and complete shipping address;
- the App Builder actions accept requests from the storefront origin.

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

Use the `commerce-checkout` block. The Stripe block is injected into its payment
method slot and should not be authored as a second top-level block.

## Acceptance path

The end-to-end test sequence is:

1. Search the SaaS catalog.
2. Open a product and add a valid SKU to cart.
3. Change quantity or remove an item on `/cart`.
4. Continue to `/checkout`.
5. Supply email, shipping, delivery, and billing details.
6. Select Stripe, complete the Payment Element, and place the order.
7. Confirm both the Adobe Commerce order and Stripe PaymentIntent reach their
   successful states.
