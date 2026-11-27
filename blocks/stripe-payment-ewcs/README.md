# Stripe EDS Block - Elements with Checkout Sessions

An injectable EDS block by Stripe that provides encapsulated, reusable payment functionality, such as
rendering the payment form, processing payments and handling payment errors.

This block uses Stripe's Elements with Checkout Sessions (EwCS) flow: the Payment Element is initialized from a
Checkout Session created by the Stripe app for Adobe Commerce. It is the Stripe payment block for new storefronts and
replaces the `stripe-payment` block, which uses PaymentIntents and is deprecated in this app. Both blocks give the
same orders, statuses, capture modes and redirect payment methods. Use one of the two blocks on a checkout page, not
both.

## Requirements

- A version of the Stripe app for Adobe Commerce that deploys the `checkout-session` and `checkout-session-return`
  actions.
- No change to the Commerce payment method registration or to the Stripe webhook endpoint.

## Installation and usage

### Add the block to your EDS storefront

If you have not set up your EDS storefront yet,

- [See an overview](https://experienceleague.adobe.com/developer/commerce/storefront/get-started/) of the EDS storefront architecture.
- [Install dependencies](https://github.com/adobe-commerce/aio-cli-plugin-commerce?tab=readme-ov-file#prerequisites) required to set up an EDS storefront locally.
- Set up the EDS storefront using the below commands:

  ```sh
  # Run these commands from your desired project directory
  aio login
  gh auth login
  aio commerce init
  git clone git@github.com:user/initialized-eds-storefront.git
  cd initialized-eds-storefront

  # Run from the EDS storefront root directory
  npm start
  ```

With your EDS storefront set up, copy the `blocks/stripe-payment-ewcs/` folder from the app into your EDS project's `blocks/stripe-payment-ewcs/` directory, and the `blocks/stripe-shared/` folder into `blocks/stripe-shared/`. The block imports its shared helpers (Stripe.js loader, App Builder requests, cart payment and address helpers) from there; the `stripe-payment` block uses the same folder.

### Extend the OOPE GraphQL Schema

Stripe requires initialization data from the Adobe Commerce GraphQL API.
You can extend the GraphQL schema to return that data by making the below adjustments:

1. In `build.mjs` at the root folder of your EDS Storefront, add the following code to extend the OOPE GraphQL schema:

```js
overrideGQLOperations([
  {
    npm: "@dropins/storefront-checkout",
    operations: [
      `
  fragment CHECKOUT_DATA_FRAGMENT on Cart {
    available_payment_methods {
      code
      title
      oope_payment_method_config {
        backend_integration_url
        custom_config {
          ... on CustomConfigKeyValue {
              key
              value
          }
        }
      }
    }
    selected_payment_method {
      code
      title
      oope_payment_method_config {
        backend_integration_url
        custom_config {
          ... on CustomConfigKeyValue {
              key
              value
          }
        }
      }
    }
  }
`,
    ],
  },
]);
```

2. Build the new schema by running `npm install` from the EDS storefront root directory. If successful, the new fragments will be added
   inside `scripts/__dropins__/storefront-checkout/fragments.js`.

3. The new data in the updated schema must be allowed through the checkout's data transformer.
   Edit your `scripts/initializers/checkout.js` to allow the data through the transformer.

```js
await initializeDropin(async () => {
  ...
  return initializers.mountImmediately(initialize, {
      langDefinitions,
      models: {
        CartModel: {
            transformer: (data) => {
              return {
                  availablePaymentMethods: data?.available_payment_methods,
                  selectedPaymentMethod: data?.selected_payment_method,
              };
            },
        },
      },
  });
})();
```

### Integrate the Stripe EDS block into your commerce-checkout block:

A boilerplate Commerce EDS storefront will use the `commerce-checkout` block which is located under
`blocks/commerce-checkout/commerce-checkout.js`. You can integrate this with
Stripe by making some simple adjustments.

First, import the Stripe block's javascript component:

```javascript
import * as stripe from "../stripe-payment-ewcs/stripe-payment-ewcs.js";
```

Next, find the payment methods renderer and add a slot for the `oope_stripe` payment method code:

```javascript
CheckoutProvider.render(PaymentMethods, {
  slots: {
    Methods: {
      ...
      oope_stripe: {
        render: stripe.renderStripePaymentMethod,
      },
      ...
    },
  },
})
```

Finally, extend your `handlePlaceOrder` method to call the Stripe drop-in methods:

```javascript
CheckoutProvider.render(PlaceOrder, {
  handlePlaceOrder: async ({ cartId, code }) => {
    ...
    if (code === 'oope_stripe') {
      if (!await stripe.handleStripePayment(cartId)) {
        return;
      }
    }
    ...
    await orderApi.placeOrder(cartId);
  },
})
```

### Switching from the `stripe-payment` block

The `stripe-payment` block is deprecated. Switch storefronts that still use it to this block.

The exported functions are the same (`renderStripePaymentMethod`, `handleStripePayment`, `validateStripePayment`),
and so are the GraphQL schema extension and the checkout integration above. To switch, copy this folder into the
storefront and change the import path in `commerce-checkout.js`.

### Runtime action URLs

The block reads the App Builder action URLs from the `oope_payment_method_config.backend_integration_url`
value returned by Commerce GraphQL. Do not hard-code or override these URLs in the storefront; configure the Stripe
app in Commerce/App Management so the storefront receives trusted runtime URLs from Commerce.

The `checkout-session` action is deployed in the same App Builder package as `payment-intent`. The block resolves
its URL from the `createPaymentIntentUrl` value Commerce returns, so the payment method registration is the same
for both blocks.

The block also forwards the authenticated customer token from the storefront auth drop-in and the active `store-view`
as the `Store` header to the App Builder `checkout-session` action.

### Payment lifecycle

1. When the payment method slot renders, the block calls the `checkout-session` action with the cart ID. The action
   reads the cart total from Commerce, creates a Checkout Session for it and returns the session client secret with
   the publishable key. The storefront never sends an amount.
2. The block mounts the Payment Element with `stripe.initCheckoutElementsSdk({ clientSecret })`. Saved payment
   methods are not shown and the Payment Element asks for no consent to save one (`enableRedisplay` and `enableSave`
   are `never`), as with the `stripe-payment` block. Below the form the block shows the amount due that it reads
   from the session, which Stripe.js requires before `actions.confirm()`.
3. When the cart total, the cart email or the shipping address changes, the block waits 500 ms for the checkout to
   settle and calls the action again. The action returns the same session while the cart still matches it, and a new
   one otherwise. The block then mounts the Payment Element of the new session, and payment details entered before
   that have to be entered again.
4. On Place Order, `handleStripePayment()` calls the action once more, so the session is checked against the cart
   as it is at that moment. If the session changed, the block mounts the new one and stops, without charging.
5. The block persists the session client secret on the Commerce cart and confirms with `actions.confirm()`, passing
   the billing address, and the shipping address for a cart that ships. From Place Order until the confirmation ends,
   for example during a 3D Secure challenge, checkout updates do not replace the session; they are applied after the
   attempt. A render of the payment slot in that time keeps the Payment Element being confirmed; the new slot gets its
   form after a failed attempt. Place Order first waits for a session refresh already in flight, then checks the form.
6. After a successful confirmation the storefront places the Commerce order. For redirect-based payment methods the
   shopper leaves the page on confirmation. Stripe returns them to the `checkout-session-return` action, and the
   app places the order from the Stripe webhook, as with the `stripe-payment` block.

**Updating overlay.** A change of the cart total, email or shipping address replaces the session, and with it the Payment Element and whatever the shopper typed in it. While that happens, the block covers `#stripe-payment-form` with a gray overlay ("Updating your total…", a `role="status"` live region), sets `aria-busy` on the form and makes the rest of it `inert`, so the shopper cannot fill in a form that is about to go. The overlay shows as soon as the checkout or cart update arrives, and already on the shopper's click on another shipping method when the checkout passes `beginPaymentFormUpdate` as the `onSelectionChange` of its `ShippingMethods` container (see `commerce-checkout/containers.js`). It goes once the new Payment Element reports `ready`, at once when App Builder answers with the same session or the refresh fails, and after 20 seconds at the latest. `handleStripePayment` waits for it, so Place Order never confirms the session of a previous total.

**Adaptive Pricing.** The block has no setting of its own. It passes `adaptivePricing: { allowed }` to `initCheckoutElementsSdk` with the `adaptive_pricing` field of the `checkout-session` response, which is `true` only when the App Management setting Adaptive Pricing is Enabled (the default, also when it was never saved), Capture mode is Automatic, and the cart currency, the store base currency and the Stripe account currency are the same. When it is allowed and the session lists `currencyOptions`, the block mounts the Currency Selector Element in `#stripe-currency-selector`, above the Payment Element, on the first load or on a later change of the session. The session total follows the shopper's currency choice. The selector is destroyed with the Payment Element when the session is replaced. The Commerce order stays in the cart currency, and so does the rest of the storefront.

The capture mode and the saved payment method setting are part of the Checkout Session, so the block has no
`init-params` call and no capture option of its own.

The amount of a Checkout Session is fixed, so the block sends no request until the cart has what makes its total final:
a cart that ships needs its shipping address and a selected shipping method, and a guest also needs an email and a name
(billing, else shipping). Until then the block shows the note that the payment form loads once the checkout details are
complete, and it requests the first session on the checkout update that completes them. A virtual cart needs no shipping
method, and a logged-in customer needs no email or name. This keeps a fresh checkout free of failed `checkout-session`
calls, as with the `stripe-payment` block, which only contacts App Builder (`init-params`) until Place Order, and it
keeps the Payment Element from mounting for a total that is about to change.

The selected shipping method is part of the cart inputs the block watches. The checkout reports it at once, while the
cart total follows with a later cart event, so a changed shipping cost replaces the session as soon as it is selected.
Card details entered before a replacement have to be entered again; Place Order then shows "Your order details
changed. Please enter your payment details again." only when the cart changed after the form was mounted.

For what the block cannot know, such as a shipping address that is still incomplete, the action answers with the `cart_incomplete` code. This only happens
for a guest when saving payment methods is enabled, because the Stripe customer needs an email, a name and, for a
cart that ships, a complete shipping address. In place of the loading state the block shows the action's message,
for example "Customer name is required to create a payment for this cart.", with a note that the payment form loads
once the checkout details are complete. It mounts the form on the next checkout update that completes the cart.

The Payment Element takes the name, email and address from the checkout form. It asks for a phone number only when
the selected payment method needs one, because a Checkout Session accepts a phone number on confirmation only when it
collects phone numbers itself.

Requests to App Builder time out after 15 seconds.

### Stripe.js release

The block loads Stripe.js `dahlia` from `https://js.stripe.com/dahlia/stripe.js`. It is the release of the Stripe API
version the `checkout-session` action creates sessions with (`2026-06-24.dahlia`). A versioned Stripe.js release uses
the API version of its release. The block starts the session with `stripe.initCheckoutElementsSdk()`, the Dahlia name
of the former `stripe.initCheckout()`, which throws on `dahlia`.

The block shares one Stripe.js loader (`window.__stripeJsLoadingPromise`) with the other Stripe blocks, and a block
that finds a load in progress, or `Stripe` already defined, uses it. So the first block to start loading Stripe.js
decides the release for the page. This block starts loading `dahlia` as soon as the checkout imports it, before any
payment method renders. The `express-checkout` block on the same checkout then finds that load and runs on `dahlia`.

The page still gets `v3` when it loads Stripe.js before the checkout imports this block, for example with a `<script>`
tag for `https://js.stripe.com/v3/` or an `express-checkout` block decorated earlier on the page. This block then logs
Stripe's error to the browser console and shows shoppers "Unable to load payment form". Use either this block or the
`stripe-payment` block on a page, not both.

The `express-checkout` block works on `dahlia` and is in use with this block on a live EDS storefront. `dahlia` uses
the API version of its release and does not accept the `apiVersion` option that `init-params` returns, so
`express-checkout` creates its Stripe instance without it. The block awaits `elements.update()`, which returns a
Promise on `dahlia`.

Not verified: whether two Stripe.js releases can run side by side on one page. Stripe's documentation does not say.

## Styling

Customize the appearance by modifying `blocks/stripe-payment-ewcs/stripe-payment-ewcs.css`.
