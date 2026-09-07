# Stripe Express Checkout EDS block

This EDS integration renders Stripe's Express Checkout Element for the
Adobe Commerce `oope_stripe` payment method. It collects wallet details with a
Confirmation Token, creates a PaymentIntent through the existing App Builder
action, confirms the PaymentIntent in Stripe.js, and places the Adobe Commerce
order only after payment confirmation succeeds.

## Payment lifecycle

1. Read trusted App Builder action URLs from
   `oope_payment_method_config.backend_integration_url`.
2. Fetch the publishable key and deferred-Elements options from `init-params`.
3. Initialize Elements with the authoritative EDS cart amount and currency,
   then mount `expressCheckout`.
4. Process wallet shipping events through the Adobe Checkout Drop-in APIs.
5. On wallet confirmation, call `elements.submit()` and
   `stripe.createConfirmationToken()`.
6. Send the cart ID and Confirmation Token ID to the existing `payment-intent`
   action. The action remains responsible for choosing the authoritative amount,
   currency, customer, capture mode, and idempotency key.
7. Persist the returned PaymentIntent client secret on the Commerce cart.
8. Confirm with `stripe.confirmPayment()` using `confirmation_token`.
9. Call the Order Drop-in `placeOrder()` function only after confirmation.

No raw card or wallet credentials pass through this block or Adobe Commerce.
Stripe.js remains loaded directly from `https://js.stripe.com/v3/`.

## Module structure

The public entry point remains `stripe-express-checkout.js`. Checkout imports and
the exported `decorate`, `renderStripePaymentMethod`, `handleStripePayment`, and
`validateStripePayment` contracts are unchanged.

- `stripe-express-checkout.js` coordinates configuration, wallet events,
  confirmation, order placement, and the checkout slot.
- `amazon-pay.js` owns Amazon eligibility, payment-method configuration, and
  compatibility with Amazon address fields and street-line fallbacks.
- `wallets.js` defines the payment-only wallet group and the ordered wallet
  descriptors. Each descriptor owns its container, Elements instance, mounted
  element, and availability. Shared lifecycle code consumes these descriptors.
- `addresses.js` reads Commerce addresses and converts wallet, Commerce, and
  Confirmation Token address shapes. Its wallet conversion delegates to the
  Amazon compatibility normalizer so field precedence stays consistent.
- `shipping.js` owns shipping rates, amount calculations,
  and synchronization through the Cart and Checkout Drop-ins.
- `money.js` provides the shared Stripe minor-unit currency conversion.
- `order-summary.js` maps Commerce totals and tax-display settings to ECE
  `lineItems`, with a nonnegative Grand Total fallback.
- `stripe-api.js` loads Stripe.js and calls the existing App Builder and Commerce
  payment APIs.
- `checkout-view.js` controls inline alerts, wallet visibility, and the checkout
  blocking overlay.
- `checkout-state.js` holds the single checkout surface's shared runtime state.
  It has the same page lifetime as the previous module-level variables.
- `constants.js` groups protocol values, event names, DOM hooks, storage keys,
  customer messages, and diagnostics. Amazon-specific values stay in its adapter.

Modules use native ES imports with no additional runtime dependencies or build
step. Keep shipping ownership and the confirmation sequence shared when adding
wallet policies. A wallet click must resolve before asynchronous Commerce work;
changing that ordering can prevent the payment sheet from opening.

## Folder installation

Copy this directory to the EDS storefront as:

```text
blocks/express-checkout/
  README.md
  addresses.js
  amazon-pay.js
  checkout-state.js
  checkout-view.js
  constants.js
  money.js
  order-summary.js
  shipping.js
  stripe-api.js
  stripe-express-checkout.css
  stripe-express-checkout.js
  wallets.js
```

The storefront must already provide these Drop-ins:

- `@dropins/tools`
- `@dropins/storefront-cart`
- `@dropins/storefront-checkout`
- `@dropins/storefront-order`

## Checkout integration

Import the block in the checkout integration layer:

```js
import renderExpressCheckout from '../express-checkout/stripe-express-checkout.js';
```

Append Express Checkout through the Payment Methods title slot. This keeps the
localized Payment heading first and the regular methods immediately after the
Express divider:

```js
CheckoutProvider.render(PaymentMethods, {
  slots: {
    Title: (ctx) => {
      const expressCheckout = document.createElement('div');
      ctx.appendChild(expressCheckout);
      renderExpressCheckout(expressCheckout);
    },
    Methods: paymentMethodHandlers,
  },
})(container);
```

The block renders **Express checkout**, the wallet buttons, and an **Or pay
another way** divider before the regular method selector and Payment Element.

Do not replace the `oope_stripe` payment-method slot. That slot continues to
render the regular Stripe Payment Element and use the normal Place Order button.
The Express Checkout `confirm` event owns only the wallet attempt and calls the
Order Drop-in after that payment succeeds. Its blocking overlay prevents the
normal Place Order button from being used during the wallet attempt.

Before order placement, the block updates the Checkout Drop-in's selected
payment value, persists `oope_stripe` on the Commerce cart, and verifies the
mutation response. It repeats that verification after Stripe confirmation so a
regular fallback method cannot overwrite the Express order's payment method.

The existing OOPE GraphQL schema and checkout transformer must expose
`availablePaymentMethods` and
`oope_payment_method_config.backend_integration_url`, as described by the
original Stripe EDS block.

## Existing action contract

The block expects `backend_integration_url` to contain:

```json
{
  "getInitParamsUrl": "https://runtime.example/init-params",
  "createPaymentIntentUrl": "https://runtime.example/payment-intent"
}
```

`init-params` returns:

```json
{
  "publishableKey": "pk_...",
  "options": {},
  "appInfo": {},
  "elementsOptions": {
    "paymentMethodOptions": {
      "us_bank_account": {
        "verification_method": "instant",
        "setup_future_usage": "off_session"
      }
    }
  }
}
```

Do not pass top-level Elements `captureMethod`. For manual capture, App Builder
nests `capture_method: "manual"` on authorize-only methods inside
`paymentMethodOptions` so wallets that cannot authorize separately remain
visible. Per-method `setup_future_usage` is omitted when saved payment methods
are disabled. These options, including US bank-account verification, must
match the PaymentIntent created by the backend.

The `payment-intent` request adds `confirmationTokenId` while retaining the
existing cart context:

```json
{
  "cartId": "masked-cart-id",
  "cartFullName": "Ada Lovelace",
  "confirmationTokenId": "ctoken_...",
  "storeCode": "default"
}
```

The current action may ignore `confirmationTokenId` because confirmation occurs
in Stripe.js. Keeping it in the request allows future server-side validation of
the Confirmation Token without another endpoint.

PaymentIntent requests from authenticated storefronts forward the
`auth_dropin_user_token` cookie as a Bearer token. They also forward the active
`store-view` in the `Store` header.

## Shipping behavior

- Link, Apple Pay, Google Pay, PayPal, and Klarna mount in a separate
  Express Checkout Element with `shippingAddressRequired: false` and
  `amazonPay: 'never'`. Those wallets show email/phone/payment only.
- Amazon Pay mounts in a second Element with `shippingAddressRequired: true`.
  Amazon's JS-only `onInitCheckout` is PayAndShip and fails with
  `No address present in onInit callback` if shipping is off. Stripe does not
  allow changing `shippingAddressRequired` on click.
- Amazon Pay still shows Amazon's own address book. That cannot be seeded with
  the Magento form address. Magento is not overwritten when it already has a
  complete address.
- Virtual carts do not collect shipping.
- Magento rates are passed as the wallet's default `shippingRates` and are
  included in the Elements amount. Wallets that pre-authorize on open (Klarna,
  PayPal) need that amount before the sheet starts. The selected Magento
  shipping option is used, not the first available rate. When Magento's cart
  total still has a cheaper default rate, that included amount is replaced with
  the selected option and the selected method is persisted before Link
  authorizes.
- Amazon Pay `click` resolves immediately with `shippingRates` so it stays
  within Stripe's one-second Amazon callback requirement. Link and the other
  Magento-owned wallets also resolve the click immediately; Magento shipping
  persist runs after the sheet is already opening.
- Confirm requires a complete Magento shipping address and selected method.
  If those are missing, the attempt fails and asks the shopper to finish
  shipping on the checkout page.
- Magento-owned wallets (Link, Apple Pay, Google Pay, PayPal, Klarna) also
  validate the Magento shipping and billing forms on click and confirm. A
  missing required phone number rejects the wallet click, keeps Magento's
  field error visible, and shows a clear Express Checkout message instead of
  a generic payment failure. Amazon Pay skips that Magento form check because
  it collects its own address.
- Link confirm does not collect shipping in the wallet. The Magento shipping
  address is attached to `createConfirmationToken()`, and a complete Magento
  shipping address also satisfies billing when Commerce is using
  bill-to-shipping. Amount mismatches are reported as a generic payment
  failure, not as an invalid shipping address.
- A complete `shippingaddresschange` address is persisted only when Magento
  does not already have a complete shipping address. Otherwise the wallet
  address is used only to `estimateShippingMethods()` for the sheet.
- Browsers can redact `shippingaddresschange` addresses. A redacted address is
  used only with `estimateShippingMethods()` and is never persisted as if it
  were complete.
- Wallet payloads are normalized before persist. Amazon Pay may flatten fields,
  use Amazon address keys, or put the street in `line2` with an empty `line1`.
  Incomplete Amazon billing falls back to shipping (`sameAsShipping`) rather
  than failing confirm. If `confirm` is still short, the Confirmation Token
  address is used after `elements.submit()`.
- `shippingratechange` persists a method only when the wallet just wrote the
  Magento address. If Magento already had a complete address and method, the
  wallet rate is previewed and left on the sheet.
- After shipping changes, `refreshCart()` supplies the authoritative amount.
  If the amount changes only after wallet authorization, the current attempt is
  failed and Elements is updated so the shopper can authorize the corrected
  total on the next attempt.
- Cart totals and shipping rates are converted using Stripe's zero-, two-, or
  three-decimal currency rules before they are passed to Elements.

## Wallet order details

ECE receives `lineItems` on creation, on every wallet click, and in shipping-change
responses. Click builds these rows synchronously from the latest cart state; it
does not fetch configuration or wait for a Commerce mutation. Line items are
updated through event resolution, not through unsupported Element update options.

The normal breakdown is Subtotal, Shipping & Handling (including the selected
method name), and Tax. The subtotal and shipping follow Commerce's tax-display
settings. For a setting that displays both prices, the summary uses the inclusive
amount because each ECE row has only one amount. Tax already included in either
row is removed from the separate Tax row.

Amounts are compared in integer currency minor units. Missing data, incompatible
currencies, negative components, or a breakdown that does not equal the Commerce
grand total produce a single Grand Total row. Discounts are not sent as negative
rows; a discounted cart uses the full breakdown only if its nonnegative amounts
already reconcile. This is the storefront's policy, not a Stripe API restriction.

For Commerce-selected methods with explicit inclusive and exclusive shipping
amounts, the wallet uses the authoritative cart grand total instead of estimating
shipping from total minus subtotal. The older amount estimate remains for partial
shipping snapshots. During an unpersisted wallet shipping preview, the summary
collapses to the displayed preview total until it matches Commerce again. The
existing confirmation check still requires the authorized and Commerce totals
to agree before payment proceeds.

## Amazon Pay testing

Amazon Pay must be tested from an HTTPS checkout origin registered in the
Stripe Dashboard for the current mode. Plain `http://localhost` is not a valid
Amazon Pay test environment. Disabling browser web security can help diagnose
CORS, but it does not replace HTTPS or Stripe domain registration.

## Loader and errors

The `click` callback adds a blocking overlay to the checkout form. `cancel` and
`escape` remove it when confirmation is not in progress. The block uses the
storefront's standard inline alert for processing, success, and payment failure
feedback. A Stripe `loaderror` is logged with `console.warn()`, hides the wallet
Element, and tells the shopper to use the regular card form.

## Capture modes

The block supports automatic and manual capture. The public `init-params`
response supplies nested `paymentMethodOptions` that match the PaymentIntent
action. The block forwards those options and ignores a top-level
`captureMethod` if one is still present:

- Automatic capture confirms to `succeeded` or `processing`; the existing
  order-placed handler links and invoices the payment.
- Manual capture confirms to `requires_capture`; the existing invoice handler
  captures the authorization and continues to own partial or recovery
  PaymentIntents.

## Testing

Unit tests live beside this block in `stripe-express-checkout.test.js`. They
cover deferred Elements, automatic and manual capture, Confirmation Tokens,
guest and authenticated carts, shipping events, remounting, the blocking
overlay, currency conversion, checkout validation, status feedback, and
customer-facing load errors.

The suite also covers distinct Elements instances for Amazon and the payment-only
wallet group, switching from Amazon to Link, updating both wallet totals, isolated
load failures, reset/remount cleanup, virtual carts, and Amazon address aliases.
The VM harness loads the local module graph and mocks only the external SDKs and
browser APIs; the extracted production modules execute in the tests.

Run them from the storefront root:

```sh
npx -y jest@29 blocks/express-checkout/stripe-express-checkout.test.js --runInBand
```
