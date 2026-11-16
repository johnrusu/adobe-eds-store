/* eslint-disable import/no-unresolved */
/* eslint-disable no-unused-vars */
/* eslint-disable no-console */
/* global Stripe */

// Dropin Tools
import { events } from '@dropins/tools/event-bus.js';

import { loadCSS } from '../../scripts/aem.js';
import {
  displayStripeError,
  clearElementsContainer,
  clearStripeError,
  createPaymentFormContent,
  destroyStripeElement,
  fetchStripeResource,
  getActiveCartId,
  getAddressFullName,
  getStripeAddress,
  getStripeRuntimeConfig,
  isStripePaymentMethod,
  isStripePaymentMethodAvailable,
  loadStripeJs,
  persistStripePaymentMethod,
  postStripeAction,
  removeEmptyStripeValues,
  resetPersistedStripePaymentMethod,
  toStripeMinorUnits,
} from '../stripe-shared/stripe-helpers.js';
import {
  CART_EVENTS,
  CHECKOUT_EVENTS,
  ELEMENT_OPTION_MODE,
  ELEMENTS_CONTAINER_ID,
  ELEMENTS_MODE_PAYMENT,
  ID_SELECTOR_PREFIX,
  LOADING_CLASS,
  PAYMENT_ELEMENT_EVENTS,
  PAYMENT_ELEMENT_LAYOUT_ACCORDION,
  REDIRECT_IF_REQUIRED,
  RUNTIME_URL_KEYS,
  STRIPE_MESSAGES,
} from '../stripe-shared/constants.js';
import {
  PAYMENT_ELEMENT_TYPE,
  PAYMENT_MESSAGES,
  STRIPE_JS_URL,
  STYLESHEET_URL,
} from './constants.js';

/**
 * Stripe Payment Block
 *
 * This block integrates Stripe payment processing into the Adobe Commerce EDS checkout flow.
 * It dynamically loads Stripe.js, initializes the payment form, and handles payment processing.
 */

// Load the CSS for this block
loadCSS(STYLESHEET_URL);

// Runtime URLs this block reads from the Commerce payment configuration
const RUNTIME_URLS = [RUNTIME_URL_KEYS.GET_INIT_PARAMS, RUNTIME_URL_KEYS.CREATE_PAYMENT_INTENT];

// Global state
let checkoutData = null;
let cartData = null;
let elements = null;
let paymentElement = null;
let stripe = null;
let paymentFormComplete = false;
let pendingClientSecret = null;
let pendingReturnUrl = null;
let paymentFormMounting = false;

/**
 * Read the cart total as an amount and currency for Stripe.
 * @param {Object} [cartDataParam] Cart data, the current cart by default.
 * @returns {{amount: number, currency: string}} The amount in minor units, and the
 * lowercase currency.
 */
function getStripeAmount(cartDataParam = cartData) {
  const total = cartDataParam?.total?.includingTax;
  const value = Number(total?.value);
  const currency = total?.currency?.toUpperCase();

  if (!Number.isFinite(value) || value <= 0 || !currency) {
    throw new Error(PAYMENT_MESSAGES.CART_TOTAL_UNAVAILABLE);
  }

  return {
    amount: toStripeMinorUnits(value, currency),
    currency: currency.toLowerCase(),
  };
}

/**
 * Tell whether the payment form can be mounted now.
 * @returns {boolean}
 */
function shouldRetryPaymentFormMount() {
  return Boolean(
    checkoutData
      && isStripePaymentMethodAvailable(checkoutData)
      && getActiveCartId(null, cartData)
      && document.querySelector(`#${ELEMENTS_CONTAINER_ID}`)
      && !paymentElement
      && !pendingClientSecret
      && !paymentFormMounting,
  );
}

/**
 * Mount the payment form when the checkout and the cart are ready for it.
 */
function retryPaymentFormMount() {
  if (!shouldRetryPaymentFormMount()) {
    return;
  }

  mountPaymentForm(`#${ELEMENTS_CONTAINER_ID}`);
}

/**
 * Destroy the mounted Payment Element and forget its Elements, client secret and return URL.
 */
function resetMountedPaymentElement() {
  destroyStripeElement(paymentElement);

  paymentElement = null;
  elements = null;
  paymentFormComplete = false;
  resetPersistedStripePaymentMethod();
  pendingClientSecret = null;
  pendingReturnUrl = null;
}

/**
 * Create the PaymentIntent only after checkout and Stripe forms pass validation.
 * @param {Object} cartDataParam Cart data.
 * @param {Object} checkoutDataParam Checkout data.
 * @returns {Promise<{client_secret: string|null, return_url?: string|null}>} The PaymentIntent
 * client secret and return URL.
 */
async function startPayment(cartDataParam, checkoutDataParam) {
  // Locate the Stripe payment method
  const paymentConfig = getStripeRuntimeConfig(
    checkoutDataParam.availablePaymentMethods.find(isStripePaymentMethod),
    RUNTIME_URLS,
  );

  const runtimeCreatePaymentIntentUrl = paymentConfig.createPaymentIntentUrl;
  const cartId = getActiveCartId(cartDataParam?.id, cartData);

  if (!cartId) {
    throw new Error(STRIPE_MESSAGES.CART_ID_UNAVAILABLE_FOR_INIT);
  }

  const cartFullName = getAddressFullName(checkoutDataParam?.billingAddress);
  const beginCreatePaymentIntent = await postStripeAction(
    runtimeCreatePaymentIntentUrl,
    {
      cartId,
      cartFullName,
    },
  );

  if (!beginCreatePaymentIntent || !beginCreatePaymentIntent.client_secret) {
    displayStripeError(PAYMENT_MESSAGES.PAYMENT_ERROR_SESSION_CREATE_FAILED);
    return { client_secret: null };
  }

  return {
    client_secret: beginCreatePaymentIntent.client_secret,
    return_url: beginCreatePaymentIntent.return_url || null,
  };
}

/**
 * Read the billing details of the checkout.
 * @returns {Object} Name, email, phone and Stripe address.
 */
function getCurrentBillingDetails() {
  const billingAddress = checkoutData?.billingAddress || {};

  return {
    name: getAddressFullName(billingAddress),
    email: checkoutData?.email || '',
    phone: billingAddress?.telephone || '',
    address: getStripeAddress(billingAddress),
  };
}

/**
 * Choose whether the Payment Element asks for a billing detail the checkout already has.
 * @param {string} value Value of the billing detail in the checkout.
 * @returns {string} Never when the checkout has the value, auto otherwise.
 */
function getBillingFieldMode(value) {
  return value ? ELEMENT_OPTION_MODE.NEVER : ELEMENT_OPTION_MODE.AUTO;
}

/**
 * Build the options of the Payment Element, asking only for the billing details the checkout lacks.
 * @returns {Object} The options.
 */
function getPaymentElementOptions() {
  const currentBillingDetails = getCurrentBillingDetails();

  return {
    layout: PAYMENT_ELEMENT_LAYOUT_ACCORDION,
    fields: {
      billingDetails: {
        name: ELEMENT_OPTION_MODE.NEVER,
        email: ELEMENT_OPTION_MODE.NEVER,
        phone: getBillingFieldMode(currentBillingDetails.phone),
        address: {
          line1: getBillingFieldMode(currentBillingDetails.address.line1),
          line2: getBillingFieldMode(currentBillingDetails.address.line2),
          city: getBillingFieldMode(currentBillingDetails.address.city),
          state: getBillingFieldMode(currentBillingDetails.address.state),
          country: getBillingFieldMode(currentBillingDetails.address.country),
          postalCode: getBillingFieldMode(currentBillingDetails.address.postal_code),
        },
      },
    },
    defaultValues: {
      billingDetails: getCurrentBillingDetails(),
    },
  };
}

/**
 * Update the mounted Payment Element with the billing details of the checkout.
 */
function updateStripeBillingDetails() {
  if (paymentElement && paymentElement.update) {
    paymentElement.update(getPaymentElementOptions());
  }
}

/**
 * Update the Elements amount to the cart total, until a PaymentIntent exists.
 */
function updateStripeCartTotal() {
  if (!elements || pendingClientSecret || !elements.update) {
    return;
  }

  try {
    elements.update(getStripeAmount());
  } catch (error) {
    console.warn(PAYMENT_MESSAGES.PAYMENT_AMOUNT_UPDATE_FAILED, error);
  }
}

/**
 * Load Stripe.js and its init params, then mount the Payment Element.
 * @param {string} mountId Selector of the element to mount in.
 * @returns {Promise<void>}
 */
async function mountPaymentForm(mountId) {
  if (paymentElement || paymentFormMounting) {
    return;
  }

  paymentFormMounting = true;
  const mountIdWithoutHash = mountId.startsWith(ID_SELECTOR_PREFIX)
    ? mountId.substring(ID_SELECTOR_PREFIX.length)
    : mountId;

  let initParams;

  try {
    // Ensure Stripe.js is loaded before continuing
    await loadStripeJs(STRIPE_JS_URL);

    // Retrieve Stripe config dynamically
    const paymentConfig = getStripeRuntimeConfig(
      checkoutData.availablePaymentMethods.find(isStripePaymentMethod),
      RUNTIME_URLS,
    );

    // Fetch the Stripe Init Params
    const stripeInitParams = await fetchStripeResource(paymentConfig.getInitParamsUrl);

    if (!stripeInitParams.ok) {
      throw new Error(
        PAYMENT_MESSAGES.INIT_PARAMS_LOAD_FAILED(stripeInitParams.statusText),
      );
    }

    initParams = await stripeInitParams.json();
  } catch (error) {
    console.error(PAYMENT_MESSAGES.STRIPE_KEY_FETCH_FAILED, error);
    // Display the error using our helper function
    displayStripeError(
      STRIPE_MESSAGES.PAYMENT_FORM_LOAD_FAILED,
      mountIdWithoutHash,
    );
    paymentFormMounting = false;
    return;
  }

  try {
    stripe = Stripe(initParams.publishableKey, initParams.options);
    stripe.registerAppInfo(initParams.appInfo);
    // Must match the PaymentIntent's capture_method (manual capture mode).
    const { captureMethod } = initParams.elementsOptions || {};
    elements = stripe.elements({
      mode: ELEMENTS_MODE_PAYMENT,
      ...getStripeAmount(),
      ...(captureMethod ? { captureMethod } : {}),
    });

    // Make sure the loading container is removed before mounting
    clearElementsContainer(mountId);

    const options = getPaymentElementOptions();
    paymentElement = elements.create(PAYMENT_ELEMENT_TYPE, options);
    paymentElement.mount(mountId);

    // Track form completion status
    paymentElement.on(PAYMENT_ELEMENT_EVENTS.CHANGE, (event) => {
      paymentFormComplete = event.complete;
    });

    // Set up event listener for future checkout updates
    events.on(CHECKOUT_EVENTS.UPDATED, updateStripeBillingDetails);
    paymentFormMounting = false;
  } catch (error) {
    console.error(STRIPE_MESSAGES.PAYMENT_FORM_INIT_ERROR, error);
    // Display the error using our helper function
    displayStripeError(
      PAYMENT_MESSAGES.PAYMENT_FORM_INIT_FAILED,
      mountIdWithoutHash,
    );
    paymentFormMounting = false;
  }
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

  if (!validateStripePayment()) {
    displayStripeError(STRIPE_MESSAGES.PAYMENT_DETAILS_INCOMPLETE);
    return false;
  }

  if (!stripe || !elements) {
    displayStripeError(STRIPE_MESSAGES.NOT_INITIALIZED);
    return false;
  }

  try {
    const { error: submitError } = await elements.submit();
    if (submitError) {
      displayStripeError(submitError.message || STRIPE_MESSAGES.PAYMENT_DETAILS_INCOMPLETE);
      return false;
    }
  } catch (elemSubmitError) {
    const errorMessage = elemSubmitError?.message || PAYMENT_MESSAGES.SUBMIT_UNKNOWN_ERROR;
    displayStripeError(errorMessage);
    return false;
  }

  if (!pendingClientSecret) {
    try {
      const paymentIntentData = await startPayment(cartData, checkoutData);
      pendingClientSecret = paymentIntentData?.client_secret || null;
      pendingReturnUrl = paymentIntentData?.return_url || null;
    } catch (paymentSessionError) {
      displayStripeError(
        paymentSessionError.message || STRIPE_MESSAGES.SESSION_CREATE_FAILED,
      );
      return false;
    }
  }

  if (!pendingClientSecret) {
    displayStripeError(PAYMENT_MESSAGES.PAYMENT_SESSION_UNAVAILABLE);
    return false;
  }

  const clientSecret = pendingClientSecret;
  const didPersistPaymentMethod = await persistStripePaymentMethod(clientSecret);
  if (!didPersistPaymentMethod) {
    displayStripeError(STRIPE_MESSAGES.PAYMENT_METHOD_NOT_SET);
    return false;
  }

  const { error, paymentIntent } = await stripe.confirmPayment({
    elements,
    redirect: REDIRECT_IF_REQUIRED,
    clientSecret,
    confirmParams: {
      ...(pendingReturnUrl ? { return_url: pendingReturnUrl } : {}),
      payment_method_data: {
        billing_details: removeEmptyStripeValues(getCurrentBillingDetails()),
      },
    },
  });

  if (error) {
    displayStripeError(
      error.message || STRIPE_MESSAGES.CONFIRMATION_ERROR,
    );
    return false;
  }

  return true;
}

/**
 * Render the Stripe payment method slot.
 * @param {Object} ctx Slot context of the checkout payment methods.
 */
function renderStripePaymentMethod(ctx) {
  resetMountedPaymentElement();

  const { $content, $stripeContainer } = createPaymentFormContent();
  ctx.replaceHTML($content);

  requestAnimationFrame(async () => {
    try {
      await loadStripeJs(STRIPE_JS_URL);
      checkoutData = events.lastPayload(CHECKOUT_EVENTS.UPDATED)
        || events.lastPayload(CHECKOUT_EVENTS.INITIALIZED)
        || checkoutData;
      retryPaymentFormMount();
    } catch (error) {
      $stripeContainer.classList.remove(LOADING_CLASS);
      displayStripeError(
        STRIPE_MESSAGES.PAYMENT_FORM_LOAD_FAILED,
        ELEMENTS_CONTAINER_ID,
      );
      console.error(PAYMENT_MESSAGES.PAYMENT_FORM_INIT_FAILED_LOG, error);
    }
  });
}

/**
 * Update the billing details of a mounted form and start loading Stripe.js.
 */
function initializeStripePayment() {
  // Update billing details if stripe payment is already initialized
  if (paymentElement) {
    updateStripeBillingDetails();
  }

  // Load Stripe.js for payment processing
  loadStripeJs(STRIPE_JS_URL).catch((error) => {
    console.warn(STRIPE_MESSAGES.STRIPE_JS_INIT_LOAD_FAILED, error);
  });
}

/**
 * Validate the Stripe payment form. Called by the checkout validation.
 * @returns {boolean} Whether the payment details are complete, or there is no Stripe form.
 */
function validateStripePayment() {
  if (!paymentElement) {
    return true; // Not a Stripe payment, validation passes
  }

  if (!paymentFormComplete) {
    return false;
  }

  return true;
}

// Listen for checkout initialization to set up Stripe payment
events.on(
  CHECKOUT_EVENTS.INITIALIZED,
  (data) => {
    checkoutData = data;
    if (!isStripePaymentMethodAvailable(checkoutData)) {
      return; // No Stripe payment method available, skip initialization
    }
    initializeStripePayment();
  },
  { eager: true },
);

// Listen for cart data
events.on(
  CART_EVENTS.INITIALIZED,
  (data) => {
    cartData = data;
    retryPaymentFormMount();
  },
  { eager: true },
);

events.on(
  CART_EVENTS.UPDATED,
  (data) => {
    cartData = data;
    updateStripeCartTotal();
    retryPaymentFormMount();
  },
  { eager: true },
);

// Listen for checkout updates
events.on(CHECKOUT_EVENTS.UPDATED, (data) => {
  checkoutData = data;
  if (!isStripePaymentMethodAvailable(checkoutData)) {
    return;
  }
  initializeStripePayment();
  retryPaymentFormMount();
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
