/* eslint-disable import/no-unresolved */
/* eslint-disable no-unused-vars */
/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
/* global Stripe */

// Dropin Tools
import { events } from '@dropins/tools/event-bus.js';

import { loadCSS } from '../../scripts/aem.js';
import {
  CART_EVENTS,
  CHECKOUT_EVENTS,
  ELEMENT_OPTION_MODE,
  ELEMENTS_CONTAINER_ID,
  LOADING_CLASS,
  PAYMENT_ELEMENT_EVENTS,
  PAYMENT_ELEMENT_LAYOUT_ACCORDION,
  PAYMENT_FORM_ID,
  REDIRECT_IF_REQUIRED,
  RUNTIME_URL_KEYS,
  STRIPE_MESSAGES,
  STRIPE_PAYMENT_METHOD_CODE,
} from '../stripe-shared/constants.js';
import {
  clearCheckoutAddressCache,
  clearElementsContainer,
  clearStripeError,
  createPaymentFormContent,
  destroyStripeElement,
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
  readCheckoutShippingAddress,
  removeEmptyStripeValues,
  resetPersistedStripePaymentMethod,
} from '../stripe-shared/stripe-helpers.js';
import {
  CART_INCOMPLETE_ERROR_CODE,
  CART_INCOMPLETE_HINT,
  CART_INCOMPLETE_NOTICE_CLASS,
  CHECKOUT_RESULT_SUCCESS,
  CHECKOUT_SESSION_ACTION,
  CHECKOUT_SESSION_CHANGE_EVENT,
  CURRENCY_SELECTOR_CONTAINER_ID,
  EWCS_MESSAGES,
  SESSION_SYNC_DELAY,
  SESSION_TOTAL_AMOUNT_CLASS,
  SESSION_TOTAL_CLASS,
  SESSION_TOTAL_LABEL,
  SESSION_TOTAL_LABEL_CLASS,
  STRIPE_JS_URL,
  STYLESHEET_URL,
} from './constants.js';

/**
 * Stripe Payment Block - Elements with Checkout Sessions (EwCS)
 *
 * This block integrates Stripe payment processing into the Adobe Commerce EDS checkout flow.
 * It is the Checkout Session counterpart of the stripe-payment block: the Payment Element is
 * initialized from a Checkout Session created by the App Builder checkout-session action,
 * instead of a PaymentIntent. Use one of the two blocks, not both.
 */

// Load the CSS for this block
loadCSS(STYLESHEET_URL);

// Global state
let checkoutData = null;
let cartData = null;
let stripe = null;
let stripePublishableKey = null;
let checkoutActions = null;
let paymentElement = null;
// Currency Selector Element of the mounted session, when Adaptive Pricing offers other currencies
let currencySelectorElement = null;
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

/**
 * Resolve the checkout-session action URL from the trusted Commerce payment configuration.
 * @returns {string} The action URL, in the origin and package of the payment-intent action.
 */
function getCheckoutSessionUrl() {
  const paymentConfig = getStripeRuntimeConfig(
    checkoutData?.availablePaymentMethods.find(isStripePaymentMethod),
    [RUNTIME_URL_KEYS.CREATE_PAYMENT_INTENT],
  );

  // Same origin and package as the payment-intent action Commerce returned.
  return new URL(CHECKOUT_SESSION_ACTION, paymentConfig.createPaymentIntentUrl).toString();
}

/**
 * List the shipping address fields the App Builder action sets on the PaymentIntent, and the
 * selected shipping method, which sets the shipping cost of the total. The checkout reports the
 * method at once, while the cart total follows with the cart event.
 * @returns {Array|null} The fields, or null without a shipping address.
 */
function getShippingAddressSignature() {
  const shippingAddress = readCheckoutShippingAddress(checkoutData);
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
    shippingAddress.selectedShippingMethod?.carrier?.code,
    shippingAddress.selectedShippingMethod?.code,
    shippingAddress.selectedShippingMethod?.amount?.value,
  ];
}

/**
 * Describe the cart inputs that make the App Builder action replace the Checkout Session:
 * the total, the email and the shipping address it sets on the PaymentIntent.
 * @returns {string} The signature.
 */
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

/**
 * Create the Checkout Session for the cart, or get the open one while the cart still matches it.
 * @returns {Promise<Object>} The session data of the checkout-session action.
 */
async function requestCheckoutSession() {
  const endpoint = getCheckoutSessionUrl();
  const cartId = getActiveCartId(null, cartData);

  if (!cartId) {
    throw new Error(STRIPE_MESSAGES.CART_ID_UNAVAILABLE_FOR_INIT);
  }

  const cartFullName = getAddressFullName(checkoutData?.billingAddress);
  const data = await postStripeAction(endpoint, { cartId, cartFullName });

  if (!data.id || !data.client_secret || !data.publishableKey) {
    throw new Error(STRIPE_MESSAGES.SESSION_CREATE_FAILED);
  }

  return data;
}

/**
 * Destroy the Currency Selector Element and remove its container.
 */
function destroyCurrencySelector() {
  destroyStripeElement(currencySelectorElement);
  currencySelectorElement = null;
  document.querySelector(`#${CURRENCY_SELECTOR_CONTAINER_ID}`)?.remove();
}

/**
 * Mount the Currency Selector Element above the Payment Element once Stripe offers other
 * currencies. The session lists them in currencyOptions, which can be empty until a later
 * change of the session (for example when the shopper's location is known).
 * @param {Object} checkout Checkout SDK instance of the session.
 * @param {Object} actions Checkout actions of the loaded Checkout Session.
 */
function mountCurrencySelectorWhenOffered(checkout, actions) {
  if (currencySelectorElement || !actions.getSession()?.currencyOptions?.length) {
    return;
  }

  const paymentForm = document.querySelector(`#${PAYMENT_FORM_ID}`);
  const elementsContainer = document.querySelector(`#${ELEMENTS_CONTAINER_ID}`);
  if (!paymentForm || !elementsContainer) {
    return;
  }

  const container = document.createElement('div');
  container.id = CURRENCY_SELECTOR_CONTAINER_ID;
  paymentForm.insertBefore(container, elementsContainer);
  currencySelectorElement = checkout.createCurrencySelectorElement();
  currencySelectorElement.mount(`#${CURRENCY_SELECTOR_CONTAINER_ID}`);
}

/**
 * Destroy the mounted Payment Element and forget its session.
 */
function destroyPaymentElement() {
  destroyStripeElement(paymentElement);
  destroyCurrencySelector();

  paymentElement = null;
  checkoutActions = null;
  checkoutSession = null;
  paymentFormComplete = false;
}

/**
 * Destroy the mounted Payment Element and forget everything tied to its session.
 */
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

/**
 * Build the options of the Payment Element. The checkout form owns the billing details and
 * passes them on confirmation. A Checkout Session takes a phone number on confirmation only when
 * it collects phone numbers, so the Payment Element asks for it when the selected payment method
 * needs one.
 * @returns {Object} The options.
 */
function getPaymentElementOptions() {
  // The checkout form owns the billing details. They are passed on confirmation.
  // A Checkout Session takes a phone number on confirmation only when it
  // collects phone numbers, so the Payment Element asks for it when the
  // selected payment method needs one.
  return {
    layout: PAYMENT_ELEMENT_LAYOUT_ACCORDION,
    fields: {
      billingDetails: {
        name: ELEMENT_OPTION_MODE.NEVER,
        email: ELEMENT_OPTION_MODE.NEVER,
        phone: ELEMENT_OPTION_MODE.AUTO,
        address: ELEMENT_OPTION_MODE.NEVER,
      },
    },
  };
}

/**
 * Show the session total. Stripe.js requires the integration to read it and show it
 * before actions.confirm() can be called.
 * @param {Object} actions Checkout actions of the loaded Checkout Session.
 */
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
  totalElement.querySelector(`.${SESSION_TOTAL_LABEL_CLASS}`).textContent = total ? SESSION_TOTAL_LABEL : '';
  totalElement.querySelector(`.${SESSION_TOTAL_AMOUNT_CLASS}`).textContent = total || '';
}

/**
 * Mount the Payment Element of a Checkout Session, replacing the one of a previous session.
 * @param {Object} sessionData Session data of the checkout-session action.
 * @returns {Promise<void>}
 */
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
    throw new Error(EWCS_MESSAGES.CHECKOUT_SESSIONS_UNSUPPORTED(STRIPE_JS_URL));
  }

  const adaptivePricingAllowed = sessionData.adaptive_pricing === true;
  const checkout = stripe.initCheckoutElementsSdk({
    clientSecret: sessionData.client_secret,
    // Only the checkout-session action decides: it enables Adaptive Pricing for a cart whose
    // currency is the store base currency and the Stripe account currency. The Commerce order
    // is placed in that currency, the shopper may pay in another one.
    adaptivePricing: { allowed: adaptivePricingAllowed },
    elementsOptions: {
      // Since Clover both default to 'auto'. The stripe-payment block neither
      // shows saved payment methods nor asks for consent to save one: the
      // app saves them for every payment when saving is enabled.
      savedPaymentMethod: {
        enableSave: ELEMENT_OPTION_MODE.NEVER,
        enableRedisplay: ELEMENT_OPTION_MODE.NEVER,
      },
    },
  });
  const loadActionsResult = await checkout.loadActions();

  if (loadActionsResult?.type !== CHECKOUT_RESULT_SUCCESS || !loadActionsResult.actions) {
    throw new Error(
      loadActionsResult?.error?.message || EWCS_MESSAGES.CHECKOUT_ACTIONS_LOAD_FAILED,
    );
  }

  destroyPaymentElement();

  // Make sure the loading container is removed before mounting
  clearElementsContainer(mountId);

  const element = checkout.createPaymentElement(getPaymentElementOptions());
  element.mount(mountId);

  // Track form completion status
  element.on(PAYMENT_ELEMENT_EVENTS.CHANGE, (event) => {
    paymentFormComplete = event.complete;
  });
  element.on(PAYMENT_ELEMENT_EVENTS.LOAD_ERROR, (event) => {
    console.error(EWCS_MESSAGES.PAYMENT_ELEMENT_LOAD_FAILED_LOG, event?.error);
    displayStripeError(STRIPE_MESSAGES.PAYMENT_FORM_LOAD_FAILED);
  });

  paymentElement = element;
  const loadedActions = loadActionsResult.actions;
  checkoutActions = loadedActions;
  showSessionTotal(checkoutActions);
  if (adaptivePricingAllowed) {
    mountCurrencySelectorWhenOffered(checkout, checkoutActions);
    // The shopper's currency choice changes the session total, so the total follows it.
    checkout.on(CHECKOUT_SESSION_CHANGE_EVENT, () => {
      // A replaced session no longer owns the form.
      if (checkoutActions !== loadedActions) {
        return;
      }
      mountCurrencySelectorWhenOffered(checkout, checkoutActions);
      showSessionTotal(checkoutActions);
    });
  }
  checkoutSession = {
    id: sessionData.id,
    clientSecret: sessionData.client_secret,
    emailRequired: Boolean(sessionData.email_required),
  };
}

/**
 * Replace the loading state with what the cart still lacks, as the action reported it.
 * The notice stays until the form mounts, which empties the container.
 * @param {string} [message] What the action reported the cart lacks.
 */
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

/**
 * Show the loading state while the first session is requested: the cart-incomplete notice
 * goes away, so the shopper sees that the payment form is on its way.
 */
function showPaymentFormLoading() {
  const container = document.querySelector(`#${ELEMENTS_CONTAINER_ID}`);
  if (!container) {
    return;
  }

  container.querySelector(`.${CART_INCOMPLETE_NOTICE_CLASS}`)?.remove();
  container.classList.add(LOADING_CLASS);
}

/**
 * Tell whether the first session can be requested. The amount of a session is fixed, so a cart
 * that ships waits for its shipping address and method: asking earlier creates a session for a
 * total that is about to change, and replacing it wipes the card details the shopper entered.
 * A guest also needs an email and a name before the app can create the session (it creates the
 * Stripe customer from them); asking earlier only gets a cart_incomplete error. The first session
 * waits for all of that, as the stripe-payment block waits for Place Order.
 * @returns {boolean} Whether the checkout has what the first session needs.
 */
function isReadyForFirstSession() {
  const needsShipping = !(cartData?.isVirtual || checkoutData?.isVirtual);
  if (needsShipping && !readCheckoutShippingAddress(checkoutData)?.selectedShippingMethod) {
    return false;
  }

  if (getCustomerTokenFromCookie()) {
    return true;
  }

  return Boolean(
    checkoutData?.email
      && (getAddressFullName(checkoutData.billingAddress)
        || getAddressFullName(readCheckoutShippingAddress(checkoutData))),
  );
}

/**
 * Tell whether the payment form can be synchronized with the cart now.
 * @returns {boolean}
 */
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

/**
 * Keep the mounted Payment Element on the Checkout Session that matches the cart.
 * @returns {Promise<void>}
 */
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

      if (!paymentElement && !isReadyForFirstSession()) {
        // No request yet. The form mounts on a later checkout update.
        showCartIncompleteNotice();
      } else if (!paymentElement || signature !== sessionSignature) {
        if (!paymentElement) {
          showPaymentFormLoading();
        }
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
      console.warn(EWCS_MESSAGES.SESSION_REFRESH_FAILED, error);
    } else if (error.code === CART_INCOMPLETE_ERROR_CODE) {
      // The checkout form is not filled in far enough yet. The form mounts on
      // a later checkout or cart update.
      showCartIncompleteNotice(error.message);
    } else {
      console.error(STRIPE_MESSAGES.PAYMENT_FORM_INIT_ERROR, error);
      document.querySelector(`#${ELEMENTS_CONTAINER_ID}`)
        ?.classList.remove(LOADING_CLASS);
      displayStripeError(STRIPE_MESSAGES.PAYMENT_FORM_LOAD_FAILED);
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

/**
 * Schedule a synchronization of the payment form, once the checkout has settled.
 */
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

/**
 * Read the billing address of the checkout in the shape Stripe.js expects.
 * @returns {{name: string, address: Object}}
 */
function getCurrentBillingAddress() {
  const billingAddress = checkoutData?.billingAddress || {};

  return {
    name: getAddressFullName(billingAddress),
    address: getStripeAddress(billingAddress),
  };
}

/**
 * Read the shipping address of the checkout in the shape Stripe.js expects.
 * @returns {Object} The name and address, empty for a cart that does not ship.
 */
function getCurrentShippingAddress() {
  const shippingAddress = readCheckoutShippingAddress(checkoutData);
  if (!shippingAddress || cartData?.isVirtual || checkoutData?.isVirtual) {
    return {};
  }

  return {
    name: getAddressFullName(shippingAddress),
    address: getStripeAddress(shippingAddress),
  };
}

/**
 * Build the parameters of the confirmation.
 * @returns {Object} The confirm parameters.
 */
function getConfirmParams() {
  const params = { redirect: REDIRECT_IF_REQUIRED };

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

/**
 * Check the session against the cart, persist it on the cart and confirm it.
 * @returns {Promise<boolean>} Whether the payment is confirmed.
 */
async function confirmCheckoutSessionPayment() {
  // The amount is fixed in the Checkout Session, so ask App Builder for the
  // session of the cart as it is now. It answers with the mounted session while
  // the cart still matches it, and with a new one otherwise.
  let currentSession;
  try {
    currentSession = await requestCheckoutSession();
  } catch (paymentSessionError) {
    displayStripeError(
      paymentSessionError.message || STRIPE_MESSAGES.SESSION_CREATE_FAILED,
    );
    return false;
  }

  if (!paymentElement || !checkoutActions || currentSession.id !== checkoutSession?.id) {
    const hadPaymentForm = Boolean(paymentElement);
    try {
      await mountCheckoutSession(currentSession);
      sessionSignature = getSessionSignature();
    } catch (mountError) {
      console.error(STRIPE_MESSAGES.PAYMENT_FORM_INIT_ERROR, mountError);
      displayStripeError(STRIPE_MESSAGES.NOT_INITIALIZED);
      return false;
    }
    displayStripeError(
      hadPaymentForm
        ? EWCS_MESSAGES.ORDER_DETAILS_CHANGED
        : STRIPE_MESSAGES.PAYMENT_DETAILS_INCOMPLETE,
    );
    return false;
  }

  const { clientSecret } = checkoutSession;
  const didPersistPaymentMethod = await persistStripePaymentMethod(clientSecret);
  if (!didPersistPaymentMethod) {
    displayStripeError(STRIPE_MESSAGES.PAYMENT_METHOD_NOT_SET);
    return false;
  }

  clearCheckoutAddressCache();

  let result;
  try {
    // Redirect-based payment methods leave the page here. Stripe returns the
    // shopper to the checkout-session-return action set on the session.
    result = await checkoutActions.confirm(getConfirmParams());
  } catch (confirmError) {
    displayStripeError(
      confirmError?.message || STRIPE_MESSAGES.CONFIRMATION_ERROR,
    );
    return false;
  }

  if (result?.type !== CHECKOUT_RESULT_SUCCESS) {
    displayStripeError(
      result?.error?.message || STRIPE_MESSAGES.CONFIRMATION_ERROR,
    );
    return false;
  }

  // The session is complete: it must not be requested again for this cart
  // while the storefront places the order.
  paymentConfirmed = true;
  return true;
}

/**
 * Handle the Stripe payment while the order is placed.
 * @param {string} cartId Cart ID of the checkout.
 * @returns {Promise<boolean>} Whether the storefront can place the order.
 */
async function handleStripePayment(cartId) {
  // Clear any previous errors
  clearStripeError();

  const resolvedCartId = getActiveCartId(cartId, cartData);

  if (!resolvedCartId) {
    displayStripeError(STRIPE_MESSAGES.CART_ID_UNAVAILABLE);
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
      displayStripeError(STRIPE_MESSAGES.PAYMENT_DETAILS_INCOMPLETE);
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

/**
 * Render the Stripe payment method slot.
 * @param {Object} ctx Slot context of the checkout payment methods.
 */
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

  const { $content } = createPaymentFormContent();
  ctx.replaceHTML($content);

  requestAnimationFrame(() => {
    checkoutData = events.lastPayload(CHECKOUT_EVENTS.UPDATED)
      || events.lastPayload(CHECKOUT_EVENTS.INITIALIZED)
      || checkoutData;
    syncPaymentForm();
  });
}

/**
 * Validate the Stripe payment form. Called by the checkout validation.
 * @returns {boolean} Whether the payment details are complete.
 */
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
  console.warn(EWCS_MESSAGES.STRIPE_JS_LOAD_FAILED_LOG, error);
});

// Listen for checkout initialization to set up Stripe payment
events.on(
  CHECKOUT_EVENTS.INITIALIZED,
  (data) => {
    checkoutData = data;
    if (!isStripePaymentMethodAvailable(checkoutData)) {
      return; // No Stripe payment method available, skip initialization
    }

    // Load Stripe.js for payment processing
    loadStripeJs(STRIPE_JS_URL).catch((error) => {
      console.warn(STRIPE_MESSAGES.STRIPE_JS_INIT_LOAD_FAILED, error);
    });
    schedulePaymentFormSync();
  },
  { eager: true },
);

// Listen for cart data
events.on(
  CART_EVENTS.INITIALIZED,
  (data) => {
    cartData = data;
    schedulePaymentFormSync();
  },
  { eager: true },
);

events.on(
  CART_EVENTS.UPDATED,
  (data) => {
    cartData = data;
    schedulePaymentFormSync();
  },
  { eager: true },
);

// Listen for checkout updates
events.on(CHECKOUT_EVENTS.UPDATED, (data) => {
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
