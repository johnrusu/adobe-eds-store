/* eslint-disable import/no-unresolved */
/* eslint-disable no-unused-vars */
/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
/* global Stripe */

// Dropin Tools
import { events } from '@dropins/tools/event-bus.js';

import { loadCSS } from '../../scripts/aem.js';
import {
  ELEMENTS_CONTAINER_ID,
  STRIPE_PAYMENT_METHOD_CODE,
  clearStripeError,
  displayStripeError,
  getActiveCartId,
  getAddressFullName,
  getCustomerTokenFromCookie,
  getStripeAddress,
  getStripeRuntimeConfig,
  isStripePaymentMethod,
  isStripePaymentMethodAvailable,
  loadStripeJs,
  persistStripePaymentMethod,
  postStripeAction,
  removeEmptyStripeValues,
  resetPersistedStripePaymentMethod,
} from '../stripe-shared/stripe-helpers.js';

/**
 * Stripe Payment Block - Elements with Checkout Sessions (EwCS)
 *
 * This block integrates Stripe payment processing into the Adobe Commerce EDS checkout flow.
 * It is the Checkout Session counterpart of the stripe-payment block: the Payment Element is
 * initialized from a Checkout Session created by the App Builder checkout-session action,
 * instead of a PaymentIntent. Use one of the two blocks, not both.
 */

// Load the CSS for this block
loadCSS('/blocks/stripe-payment-ewcs/stripe-payment-ewcs.css');

// Checkout Sessions in Elements mode need this Stripe.js release. It matches the
// Stripe API version the checkout-session action creates the session with.
const STRIPE_JS_URL = 'https://js.stripe.com/dahlia/stripe.js';
// The checkout-session action is deployed in the same App Builder package as payment-intent.
const CHECKOUT_SESSION_ACTION = 'checkout-session';
const CART_INCOMPLETE_ERROR_CODE = 'cart_incomplete';
// Wait for the checkout to settle before replacing the session of a mounted form.
const SESSION_SYNC_DELAY = 500;
const PAYMENT_FORM_ID = 'stripe-payment-form';
const SESSION_TOTAL_CLASS = 'stripe-checkout-total';
const SESSION_TOTAL_LABEL_CLASS = 'stripe-checkout-total-label';
const SESSION_TOTAL_AMOUNT_CLASS = 'stripe-checkout-total-amount';
const LOADING_CLASS = 'stripe-elements-loading';
const CART_INCOMPLETE_NOTICE_CLASS = 'stripe-cart-incomplete';
const CART_INCOMPLETE_HINT = 'The payment form loads once the checkout details above are complete.';

// Global state
let checkoutData = null;
let cartData = null;
let stripe = null;
let stripePublishableKey = null;
let checkoutActions = null;
let paymentElement = null;
let paymentFormComplete = false;
// Checkout Session the mounted Payment Element belongs to: { id, clientSecret, emailRequired }
let checkoutSession = null;
// Cart inputs the Checkout Session was last requested for
let sessionSignature = null;
let paymentConfirmed = false;
// Set while Place Order checks, persists and confirms the session
let paymentConfirming = false;
// The slot rendered again while Place Order confirmed: its form is reset after the attempt
let slotRenderedDuringConfirmation = false;
let sessionSyncInFlight = false;
// Settles when the session sync in flight ends
let sessionSyncDone = Promise.resolve();
let sessionSyncQueued = false;
let sessionSyncTimer = null;
let renderGeneration = 0;

// Resolve the checkout-session action URL from the trusted Commerce payment configuration.
function getCheckoutSessionUrl() {
  const paymentConfig = getStripeRuntimeConfig(
    checkoutData?.availablePaymentMethods.find(isStripePaymentMethod),
    ['createPaymentIntentUrl'],
  );

  // Same origin and package as the payment-intent action Commerce returned.
  return new URL(CHECKOUT_SESSION_ACTION, paymentConfig.createPaymentIntentUrl).toString();
}

function getShippingAddressSignature() {
  const shippingAddress = checkoutData?.shippingAddress;
  if (!shippingAddress) {
    return null;
  }

  return [
    shippingAddress.firstName,
    shippingAddress.lastName,
    shippingAddress.street,
    shippingAddress.city,
    shippingAddress.region?.code,
    shippingAddress.postCode || shippingAddress.postcode,
    shippingAddress.country?.code || shippingAddress.country?.value || shippingAddress.countryCode,
    shippingAddress.telephone,
  ];
}

// Cart inputs that make the App Builder action replace the Checkout Session:
// the total, the email and the shipping address it sets on the PaymentIntent.
function getSessionSignature() {
  const total = cartData?.total?.includingTax;

  return JSON.stringify([
    getActiveCartId(null, cartData),
    total?.value ?? null,
    total?.currency ?? null,
    checkoutData?.email || null,
    getShippingAddressSignature(),
  ]);
}

// Create the Checkout Session for the cart, or get the open one while the cart still matches it.
async function requestCheckoutSession() {
  const endpoint = getCheckoutSessionUrl();
  const cartId = getActiveCartId(null, cartData);

  if (!cartId) {
    throw new Error(
      'Cart ID is not available for Stripe payment initialization.',
    );
  }

  const cartFullName = getAddressFullName(checkoutData?.billingAddress);
  const data = await postStripeAction(endpoint, { cartId, cartFullName });

  if (!data.id || !data.client_secret || !data.publishableKey) {
    throw new Error('Unable to create Stripe session.');
  }

  return data;
}

function destroyPaymentElement() {
  if (paymentElement) {
    try {
      paymentElement.destroy();
    } catch (error) {
      console.warn('Unable to destroy Stripe payment element:', error);
    }
  }

  paymentElement = null;
  checkoutActions = null;
  checkoutSession = null;
  paymentFormComplete = false;
}

function resetMountedPaymentElement() {
  destroyPaymentElement();

  if (sessionSyncTimer) {
    window.clearTimeout(sessionSyncTimer);
  }
  sessionSyncTimer = null;
  sessionSignature = null;
  resetPersistedStripePaymentMethod();
  paymentConfirmed = false;
}

function getPaymentElementOptions() {
  // The checkout form owns the billing details. They are passed on confirmation.
  // A Checkout Session takes a phone number on confirmation only when it
  // collects phone numbers, so the Payment Element asks for it when the
  // selected payment method needs one.
  return {
    layout: 'accordion',
    fields: {
      billingDetails: {
        name: 'never',
        email: 'never',
        phone: 'auto',
        address: 'never',
      },
    },
  };
}

// Stripe.js requires the integration to read the session total and show it
// before actions.confirm() can be called.
function showSessionTotal(actions) {
  const total = actions.getSession()?.total?.total?.amount;
  const paymentForm = document.querySelector(`#${PAYMENT_FORM_ID}`);
  if (!paymentForm) {
    return;
  }

  let totalElement = paymentForm.querySelector(`.${SESSION_TOTAL_CLASS}`);
  if (!totalElement) {
    totalElement = document.createElement('div');
    totalElement.className = SESSION_TOTAL_CLASS;
    const label = document.createElement('span');
    label.className = SESSION_TOTAL_LABEL_CLASS;
    const amount = document.createElement('span');
    amount.className = SESSION_TOTAL_AMOUNT_CLASS;
    totalElement.appendChild(label);
    totalElement.appendChild(amount);
    paymentForm.appendChild(totalElement);
  }
  totalElement.querySelector(`.${SESSION_TOTAL_LABEL_CLASS}`).textContent = total ? 'Amount due' : '';
  totalElement.querySelector(`.${SESSION_TOTAL_AMOUNT_CLASS}`).textContent = total || '';
}

// Mount the Payment Element of a Checkout Session, replacing the one of a previous session.
async function mountCheckoutSession(sessionData) {
  const mountId = `#${ELEMENTS_CONTAINER_ID}`;

  if (!stripe || stripePublishableKey !== sessionData.publishableKey) {
    stripe = Stripe(sessionData.publishableKey, sessionData.options || {});
    stripePublishableKey = sessionData.publishableKey;
    if (sessionData.appInfo) {
      stripe.registerAppInfo(sessionData.appInfo);
    }
  }

  if (typeof stripe.initCheckoutElementsSdk !== 'function') {
    throw new Error(
      `The loaded Stripe.js does not support Checkout Sessions in Elements mode. Load ${STRIPE_JS_URL} on this page.`,
    );
  }

  const checkout = stripe.initCheckoutElementsSdk({
    clientSecret: sessionData.client_secret,
    // The Commerce order is placed in the cart currency.
    adaptivePricing: { allowed: false },
    elementsOptions: {
      // Since Clover both default to 'auto'. The stripe-payment block neither
      // shows saved payment methods nor asks for consent to save one: the
      // app saves them for every payment when saving is enabled.
      savedPaymentMethod: {
        enableSave: 'never',
        enableRedisplay: 'never',
      },
    },
  });
  const loadActionsResult = await checkout.loadActions();

  if (loadActionsResult?.type !== 'success' || !loadActionsResult.actions) {
    throw new Error(
      loadActionsResult?.error?.message || 'Failed to load Stripe Checkout actions.',
    );
  }

  destroyPaymentElement();

  // Make sure the loading container is removed before mounting
  const container = document.querySelector(mountId);
  if (container && container.closest(`.${LOADING_CLASS}`)) {
    container
      .closest(`.${LOADING_CLASS}`)
      .classList.remove(LOADING_CLASS);
  }
  if (container) {
    container.innerHTML = '';
  }

  const element = checkout.createPaymentElement(getPaymentElementOptions());
  element.mount(mountId);

  // Track form completion status
  element.on('change', (event) => {
    paymentFormComplete = event.complete;
  });
  element.on('loaderror', (event) => {
    console.error('Stripe payment element failed to load:', event?.error);
    displayStripeError('Unable to load payment form. Please refresh and try again.');
  });

  paymentElement = element;
  checkoutActions = loadActionsResult.actions;
  showSessionTotal(checkoutActions);
  checkoutSession = {
    id: sessionData.id,
    clientSecret: sessionData.client_secret,
    emailRequired: Boolean(sessionData.email_required),
  };
}

// Replace the loading state with what the cart still lacks, as the action reported it.
// It stays until the form mounts, which empties the container.
function showCartIncompleteNotice(message) {
  const container = document.querySelector(`#${ELEMENTS_CONTAINER_ID}`);
  if (!container) {
    return;
  }

  container.classList.remove(LOADING_CLASS);
  let notice = container.querySelector(`.${CART_INCOMPLETE_NOTICE_CLASS}`);
  if (!notice) {
    notice = document.createElement('div');
    notice.className = CART_INCOMPLETE_NOTICE_CLASS;
    container.appendChild(notice);
  }
  notice.textContent = [message, CART_INCOMPLETE_HINT].filter(Boolean).join(' ');
}

// A guest needs an email and a name before the app can create the session (it creates the
// Stripe customer from them). Asking earlier only gets a cart_incomplete error, so the first
// session waits for them, as the stripe-payment block waits for Place Order.
function hasSessionContactDetails() {
  if (getCustomerTokenFromCookie()) {
    return true;
  }

  return Boolean(
    checkoutData?.email
      && (getAddressFullName(checkoutData.billingAddress)
        || getAddressFullName(checkoutData.shippingAddress)),
  );
}

function canSyncPaymentForm() {
  return Boolean(
    !paymentConfirmed
      && !paymentConfirming
      && checkoutData
      && isStripePaymentMethodAvailable(checkoutData)
      && getActiveCartId(null, cartData)
      && document.querySelector(`#${ELEMENTS_CONTAINER_ID}`),
  );
}

// Keep the mounted Payment Element on the Checkout Session that matches the cart.
async function syncPaymentForm() {
  if (!canSyncPaymentForm()) {
    return;
  }

  if (sessionSyncInFlight) {
    sessionSyncQueued = true;
    return;
  }

  sessionSyncInFlight = true;
  let finishSessionSync;
  sessionSyncDone = new Promise((resolve) => {
    finishSessionSync = resolve;
  });
  const generation = renderGeneration;

  try {
    do {
      sessionSyncQueued = false;
      const signature = getSessionSignature();

      if (!paymentElement && !hasSessionContactDetails()) {
        // No request yet. The form mounts on a later checkout update.
        showCartIncompleteNotice();
      } else if (!paymentElement || signature !== sessionSignature) {
        await loadStripeJs(STRIPE_JS_URL);
        const sessionData = await requestCheckoutSession();

        // The payment method slot was rendered again while waiting, or Place
        // Order started: the session must not change under the confirmation.
        if (generation !== renderGeneration || paymentConfirming) {
          return;
        }

        if (!paymentElement || sessionData.id !== checkoutSession?.id) {
          await mountCheckoutSession(sessionData);
        }
        sessionSignature = signature;
      }
    } while (sessionSyncQueued && generation === renderGeneration && !paymentConfirming);
  } catch (error) {
    if (generation !== renderGeneration) {
      return;
    }

    if (paymentElement) {
      // The mounted form stays usable; Place Order checks the session again.
      console.warn('Unable to refresh Stripe session:', error);
    } else if (error.code === CART_INCOMPLETE_ERROR_CODE) {
      // The checkout form is not filled in far enough yet. The form mounts on
      // a later checkout or cart update.
      showCartIncompleteNotice(error.message);
    } else {
      console.error('Error initializing Stripe payment form:', error);
      document.querySelector(`#${ELEMENTS_CONTAINER_ID}`)
        ?.classList.remove(LOADING_CLASS);
      displayStripeError('Unable to load payment form. Please refresh and try again.');
    }
  } finally {
    sessionSyncInFlight = false;
    finishSessionSync();
    // A render of the payment slot while this sync waited queued its own sync,
    // which only runs here: the loop above stops at the generation change.
    if (generation !== renderGeneration && sessionSyncQueued) {
      sessionSyncQueued = false;
      syncPaymentForm();
    }
  }
}

function schedulePaymentFormSync() {
  if (!canSyncPaymentForm()) {
    return;
  }

  // The slot render requests the first session at once. Later updates wait
  // for the checkout to settle, also while nothing is mounted yet, so a form
  // being filled in does not send a request for each field.
  if (paymentElement && getSessionSignature() === sessionSignature) {
    return;
  }

  if (sessionSyncTimer) {
    window.clearTimeout(sessionSyncTimer);
  }
  sessionSyncTimer = window.setTimeout(() => {
    sessionSyncTimer = null;
    syncPaymentForm();
  }, SESSION_SYNC_DELAY);
}

function getCurrentBillingAddress() {
  const billingAddress = checkoutData?.billingAddress || {};

  return {
    name: getAddressFullName(billingAddress),
    address: getStripeAddress(billingAddress),
  };
}

function getCurrentShippingAddress() {
  const shippingAddress = checkoutData?.shippingAddress;
  if (!shippingAddress || cartData?.isVirtual || checkoutData?.isVirtual) {
    return {};
  }

  return {
    name: getAddressFullName(shippingAddress),
    address: getStripeAddress(shippingAddress),
  };
}

function getConfirmParams() {
  const params = { redirect: 'if_required' };

  // Stripe already has the email unless the session was created without one.
  if (checkoutSession.emailRequired && checkoutData?.email) {
    params.email = checkoutData.email;
  }

  const billingAddress = removeEmptyStripeValues(getCurrentBillingAddress());
  if (Object.keys(billingAddress).length > 0) {
    params.billingAddress = billingAddress;
  }

  // Buy now, pay later methods and wallets read the shipping address.
  const shippingAddress = removeEmptyStripeValues(getCurrentShippingAddress());
  if (Object.keys(shippingAddress).length > 0) {
    params.shippingAddress = shippingAddress;
  }

  return params;
}

// Check the session against the cart, persist it on the cart and confirm it.
async function confirmCheckoutSessionPayment() {
  // The amount is fixed in the Checkout Session, so ask App Builder for the
  // session of the cart as it is now. It answers with the mounted session while
  // the cart still matches it, and with a new one otherwise.
  let currentSession;
  try {
    currentSession = await requestCheckoutSession();
  } catch (paymentSessionError) {
    displayStripeError(
      paymentSessionError.message || 'Unable to create Stripe session.',
    );
    return false;
  }

  if (!paymentElement || !checkoutActions || currentSession.id !== checkoutSession?.id) {
    const hadPaymentForm = Boolean(paymentElement);
    try {
      await mountCheckoutSession(currentSession);
      sessionSignature = getSessionSignature();
    } catch (mountError) {
      console.error('Error initializing Stripe payment form:', mountError);
      displayStripeError(
        'Stripe payment is not properly initialized. Please refresh and try again.',
      );
      return false;
    }
    displayStripeError(
      hadPaymentForm
        ? 'Your order details changed. Please enter your payment details again.'
        : 'Please complete your payment details',
    );
    return false;
  }

  const { clientSecret } = checkoutSession;
  const didPersistPaymentMethod = await persistStripePaymentMethod(clientSecret);
  if (!didPersistPaymentMethod) {
    displayStripeError('Failed to set the payment method.');
    return false;
  }

  let result;
  try {
    // Redirect-based payment methods leave the page here. Stripe returns the
    // shopper to the checkout-session-return action set on the session.
    result = await checkoutActions.confirm(getConfirmParams());
  } catch (confirmError) {
    displayStripeError(
      confirmError?.message || 'An error occurred during payment confirmation.',
    );
    return false;
  }

  if (result?.type !== 'success') {
    displayStripeError(
      result?.error?.message || 'An error occurred during payment confirmation.',
    );
    return false;
  }

  // The session is complete: it must not be requested again for this cart
  // while the storefront places the order.
  paymentConfirmed = true;
  return true;
}

// Handle Stripe payment processing during order placement
async function handleStripePayment(cartId) {
  // Clear any previous errors
  clearStripeError();

  const resolvedCartId = getActiveCartId(cartId, cartData);

  if (!resolvedCartId) {
    displayStripeError(
      'Cart ID is unavailable. Please refresh checkout and try again.',
    );
    return false;
  }

  // Checkout updates during a 3D Secure challenge or a slow confirmation must
  // not replace the session being confirmed.
  paymentConfirming = true;
  if (sessionSyncTimer) {
    window.clearTimeout(sessionSyncTimer);
    sessionSyncTimer = null;
  }

  try {
    // A sync that started before Place Order can still be mounting a session:
    // let it finish, so the form checked below is the one that gets confirmed.
    await sessionSyncDone;

    // Without a mounted form, the confirmation below requests the session: it
    // mounts the form, or shows why the cart cannot have one yet.
    if (paymentElement && !validateStripePayment()) {
      displayStripeError('Please complete your payment details');
      return false;
    }

    return await confirmCheckoutSessionPayment();
  } finally {
    paymentConfirming = false;
    if (slotRenderedDuringConfirmation) {
      slotRenderedDuringConfirmation = false;
      // The slot rendered again during the attempt. After a confirmed payment
      // the order is placed; otherwise the new slot gets its own form.
      if (!paymentConfirmed) {
        resetMountedPaymentElement();
        syncPaymentForm();
      }
    } else {
      // Updates that arrived meanwhile are applied once the attempt is over.
      schedulePaymentFormSync();
    }
  }
}

// Render function for the Stripe payment method slot
function renderStripePaymentMethod(ctx) {
  renderGeneration += 1;
  // Destroying the Payment Element under a confirmation in progress, for
  // example a 3D Secure challenge, would break it. The reset waits for the
  // attempt to end.
  if (paymentConfirming) {
    slotRenderedDuringConfirmation = true;
  } else {
    resetMountedPaymentElement();
  }

  const $content = document.createElement('div');
  $content.id = PAYMENT_FORM_ID; // Stripe form container

  // Ensure a child element exists for Stripe Elements
  const $stripeContainer = document.createElement('div');
  $stripeContainer.id = ELEMENTS_CONTAINER_ID;
  $stripeContainer.classList.add(LOADING_CLASS);

  $content.appendChild($stripeContainer);
  ctx.replaceHTML($content);

  requestAnimationFrame(() => {
    checkoutData = events.lastPayload('checkout/updated')
      || events.lastPayload('checkout/initialized')
      || checkoutData;
    syncPaymentForm();
  });
}

// Validate Stripe payment form - called by checkout validation
function validateStripePayment() {
  if (!paymentElement) {
    // Nothing to check for another payment method. With Stripe selected, the
    // form has not loaded yet, so there are no payment details to accept.
    return checkoutData?.selectedPaymentMethod?.code !== STRIPE_PAYMENT_METHOD_CODE;
  }

  if (!paymentFormComplete) {
    return false;
  }

  return true;
}

// Start loading Stripe.js when the checkout imports this block, before any
// other Stripe block can. The express-checkout block reuses a loading promise
// it finds, so it runs on this release instead of loading v3, with which
// initCheckoutElementsSdk throws.
loadStripeJs(STRIPE_JS_URL).catch((error) => {
  console.warn('Failed to load Stripe.js:', error);
});

// Listen for checkout initialization to set up Stripe payment
events.on(
  'checkout/initialized',
  (data) => {
    checkoutData = data;
    if (!isStripePaymentMethodAvailable(checkoutData)) {
      return; // No Stripe payment method available, skip initialization
    }

    // Load Stripe.js for payment processing
    loadStripeJs(STRIPE_JS_URL).catch((error) => {
      console.warn('Failed to load Stripe.js during initialization:', error);
    });
    schedulePaymentFormSync();
  },
  { eager: true },
);

// Listen for cart data
events.on(
  'cart/initialized',
  (data) => {
    cartData = data;
    schedulePaymentFormSync();
  },
  { eager: true },
);

events.on(
  'cart/updated',
  (data) => {
    cartData = data;
    schedulePaymentFormSync();
  },
  { eager: true },
);

// Listen for checkout updates
events.on('checkout/updated', (data) => {
  checkoutData = data;
  schedulePaymentFormSync();
});

// Export the functions that need to be used by other blocks
export {
  renderStripePaymentMethod,
  handleStripePayment,
  validateStripePayment,
};

// Default export for block initialization (if used as a block)
export default function decorate(block) {

}
