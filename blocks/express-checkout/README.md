# Stripe Express Checkout EDS block

This experimental EDS block renders Stripe's Express Checkout Element for the
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

## Folder installation

Copy this directory to the EDS storefront as:

```text
blocks/express-checkout/
  README.md
  stripe-express-checkout.css
  stripe-express-checkout.js
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

- Physical carts always mount with `shippingAddressRequired: true`. Amazon Pay's
  JS-only `onInitCheckout` uses PayAndShip and fails immediately
  (`originUrl is not present`, `ResponseNotReceivedError`) if the wallet skips
  shipping because Magento already has an address.
- Virtual carts do not collect shipping.
- Magento rates are passed as the wallet's default `shippingRates`. The default
  rate is included in the amount when Elements is created, including when
  Magento already selected a method but the cart drop-in total is still the
  item subtotal. Wallets that pre-authorize on open (Klarna, PayPal) need that
  amount before the sheet starts.
- The wallet `click` event always resolves immediately with `shippingRates` so
  it stays within Stripe's one-second Amazon Pay callback requirement.
- A complete `shippingaddresschange` address is first persisted with
  `setShippingAddress()`. The block then refreshes the cart and returns the
  authoritative Commerce rates to the wallet. The first returned rate is also
  selected immediately and Elements receives the refreshed Commerce total
  before wallet authorization.
- Browsers can redact `shippingaddresschange` addresses. A redacted address is
  used only with `estimateShippingMethods()` and is never persisted as if it
  were complete. The full address supplied by `confirm` is persisted before
  payment.
- Wallet payloads are normalized before persist. Amazon Pay may flatten fields,
  use Amazon address keys, or put the street in `line2` with an empty `line1`.
  Incomplete Amazon billing falls back to shipping (`sameAsShipping`) rather
  than failing confirm. If `confirm` is still short, the Confirmation Token
  address is used after `elements.submit()`.
- If the wallet supplies a complete shipping address, it is persisted even when
  Magento already had one. Incomplete Amazon billing still falls back to
  shipping (`sameAsShipping`).
- `shippingratechange` immediately calls `setShippingMethods()` when Commerce
  has a complete address or the complete wallet address was just persisted.
  Otherwise, the selection is retained and persisted immediately after the
  full address becomes available on confirm.
- After shipping changes, `refreshCart()` supplies the authoritative amount.
  If the amount changes only after wallet authorization, the current attempt is
  failed and Elements is updated so the shopper can authorize the corrected
  total on the next attempt.
- Cart totals and shipping rates are converted using Stripe's zero-, two-, or
  three-decimal currency rules before they are passed to Elements.

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

Run them from the storefront root:

```sh
npx -y jest@29 blocks/express-checkout/stripe-express-checkout.test.js --runInBand
```
