# Stripe EDS Shared Helpers

Helpers shared by the Stripe blocks of an EDS storefront: `stripe-payment` (PaymentIntents), `stripe-payment-ewcs`
(Elements with Checkout Sessions) and `express-checkout`. This folder is not a block. It has no `decorate` function and
renders nothing; the blocks import `stripe-helpers.js` from it.

Copy the folder into the storefront's `blocks` directory next to the blocks that use it, for example
`blocks/stripe-shared/`. The blocks import it as `../stripe-shared/stripe-helpers.js`.

## Requirements

- The `@dropins/tools` event bus and the `@dropins/storefront-checkout` drop-in, which the helpers import.
- The Stripe payment method (`oope_stripe`) registered in Adobe Commerce, with the App Builder action URLs in its
  payment configuration.

## Configuration

There are no options to set. The helpers read the following from the page:

| Source | Used for |
| --- | --- |
| `auth_dropin_user_token` cookie | The customer token sent to App Builder as `Authorization: Bearer <token>`. Guests send none. |
| `store-view` in `localStorage` | The store view sent to App Builder as the `Store` header. Defaults to `default`. |
| `backend_integration_url` of the `oope_stripe` payment method | The App Builder action URLs, as JSON. The block names the URLs it needs. |
| `sessionStorage` `DROPINS_CART_ID` and the cart events | The active cart ID, when the block has none. |

## Constants

`constants.js` holds every value the helpers and the Stripe blocks share: the payment method code, element IDs and
classes, timeouts, storage and cookie keys, event names, HTTP header names, the Payment Element option values, the
currency lists and the customer-facing messages (`STRIPE_MESSAGES`). Blocks import these instead of repeating the
strings; each block keeps only its own values in a `constants.js` next to it.

## Exports

| Export | Purpose |
| --- | --- |
| `STRIPE_PAYMENT_METHOD_CODE`, `ELEMENTS_CONTAINER_ID`, `STRIPE_REQUEST_TIMEOUT` | The payment method code (`oope_stripe`), the id of the Payment Element container (`stripe-elements-container`) and the 15 second request timeout. |
| `loadStripeJs(url)` | Loads Stripe.js from the given release URL. See [Stripe.js release](#stripejs-release). |
| `fetchStripeResource(resource, options)` | `fetch` that aborts after the timeout. |
| `postStripeAction(endpoint, body)` | POSTs to an App Builder action with the customer token and store view. |
| `getStripeActionHeaders()`, `getSelectedStoreView()` | The headers of a request to an App Builder action (JSON, customer token, store view), and the selected store view. `express-checkout` sends its own request with them, because it reads the response differently. |
| `getStripeRuntimeConfig(method, requiredUrls)` | Reads the action URLs from the payment method configuration. |
| `isStripePaymentMethod(method)`, `isStripePaymentMethodAvailable(checkoutData)` | Tell whether a payment method, or the checkout, offers Stripe. |
| `getActiveCartId(preferredCartId, cartData)` | The cart ID from the arguments, the cart events or session storage. |
| `getCustomerTokenFromCookie()` | The logged-in customer's token, or `null`. |
| `persistStripePaymentMethod(clientSecret)`, `resetPersistedStripePaymentMethod()` | Store the client secret on the Commerce cart payment, once per client secret, and forget it. |
| `displayStripeError(message)`, `clearStripeError()` | Show and remove the red `.stripe-error` message inside the Payment Element container. The message goes away after 10 seconds. |
| `getAddressFullName(address)`, `getStripeAddress(address)` | A checkout drop-in address as a full name, or in the shape Stripe.js expects. |
| `toStripeMinorUnits(value, currency)` | A cart amount in Stripe minor units, following Stripe's zero-decimal and three-decimal currency rules. |
| `removeEmptyStripeValues(value)` | Drops empty strings, `null`, `undefined` and empty objects from billing or shipping details. |

## Behavior

### Stripe.js release

The Stripe blocks on a page share one loading promise (`window.__stripeJsLoadingPromise`). A block that finds a load
in progress, or `Stripe` already defined, uses it. So the first block to start loading Stripe.js decides the release
for the whole page: `v3` for `stripe-payment`, `dahlia` for `stripe-payment-ewcs`. This is why a page must import only
one of those two blocks. The `express-checkout` block loads Stripe.js only when it mounts, and so runs on whichever
release is already loading.

### Requests to App Builder

`postStripeAction` sends JSON and returns the parsed response. A response that is not OK, or that has an `error`
field, throws an `Error` with the action's message, and the action's error code as `error.code`, for example
`cart_incomplete`. Requests that take longer than 15 seconds throw "Stripe did not respond in time. Please try again."

### Saving the payment method on the cart

`persistStripePaymentMethod` calls the checkout drop-in's `setPaymentMethod` with the client secret. It skips the call
when that client secret is already stored, and returns `false` when Commerce does not accept it.

## Error handling

- `getStripeRuntimeConfig` throws "Stripe payment method is not available." when the method is missing, and "Stripe
  payment configuration is invalid." when the configuration is missing, is not valid JSON or lacks a required URL. It
  logs the detail to the console.
- `displayStripeError` logs to the console when the Payment Element container is not on the page.
- `toStripeMinorUnits` throws "A Stripe amount is unavailable." for a value that is not a number.

## Tests

The blocks' tests load `stripe-helpers.harness.js`, which inlines these helpers into the block under test and
replaces the drop-in imports with mocks. Keep a helper here instead of copying it into a block.
