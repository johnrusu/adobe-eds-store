/* global Stripe */

import { events } from '@dropins/tools/event-bus.js';
import * as cartApi from '@dropins/storefront-cart/api.js';
import * as checkoutApi from '@dropins/storefront-checkout/api.js';
import * as orderApi from '@dropins/storefront-order/api.js';
import {
  Icon,
  InLineAlert,
  provider as UI,
} from '@dropins/tools/components.js';
import { h } from '@dropins/tools/preact.js';

import { loadCSS } from '../../scripts/aem.js';

loadCSS('/blocks/express-checkout/stripe-express-checkout.css');

const STRIPE_PAYMENT_METHOD_CODE = 'oope_stripe';
const ELEMENT_CONTAINER_ID = 'stripe-express-checkout-element';
const BLOCKED_CLASS = 'stripe-express-checkout-blocked';
const HIDDEN_CLASS = 'stripe-express-checkout-hidden';
const LOADING_CLASS = 'stripe-express-checkout-loading';
const STRIPE_REQUEST_TIMEOUT = 15000;
const STRIPE_LOADING_PROMISE_KEY = '__stripeJsLoadingPromise';
const SUPPORTED_PAYMENT_STATUSES = new Set([
  'processing',
  'requires_capture',
  'succeeded',
]);
const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA',
  'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const STRIPE_THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'JOD', 'KWD', 'OMR', 'TND',
]);

let stripeLoadingPromise = null;
let stripe = null;
let elements = null;
let expressCheckoutElement = null;
let checkoutData = null;
let cartData = null;
let initParams = null;
let runtimeConfig = null;
let blockContainer = null;
let mountContainer = null;
let statusContainer = null;
let statusAlert = null;
let mountInProgress = false;
let modalOpen = false;
let confirmationInProgress = false;
let activeConfirmation = null;
let mountedConfigurationKey = null;
let currentAmount = null;
let currentCurrency = null;
let currentShippingRates = [];
let shippingMethodsByRateId = new Map();
let pendingShippingMethod = null;
let confirmedCartId = null;
let elementLoadFailed = false;
let walletShippingRequired = false;
let walletShippingAddressPersisted = false;
let walletReauthorizationRequired = false;
let validateCheckout = null;

const PAYMENT_STATUS = Object.freeze({
  info: {
    heading: 'Payment processing',
    icon: 'InfoFilled',
  },
  success: {
    heading: 'Payment successful',
    icon: 'CheckWithCircle',
    type: 'success',
  },
  error: {
    heading: 'Payment failed',
    icon: 'PaymentError',
    type: 'error',
  },
});

function clearPaymentStatus() {
  statusAlert?.remove();
  statusAlert = null;
  statusContainer?.replaceChildren();
}

async function setPaymentStatus(message, status = 'info') {
  if (!statusContainer) return null;

  const config = PAYMENT_STATUS[status] || PAYMENT_STATUS.info;
  clearPaymentStatus();
  try {
    statusAlert = await UI.render(InLineAlert, {
      heading: config.heading,
      description: message,
      ...(config.type ? { type: config.type } : {}),
      variant: 'primary',
      icon: h(Icon, { source: config.icon }),
      'aria-live': status === 'error' ? 'assertive' : 'polite',
      role: status === 'error' ? 'alert' : 'status',
    })(statusContainer);
  } catch (error) {
    console.warn('Unable to render Express Checkout payment status.', error);
  }

  return statusAlert;
}

async function fetchStripeResource(resource, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), STRIPE_REQUEST_TIMEOUT);

  try {
    return await fetch(resource, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Stripe did not respond in time. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function loadStripeJs() {
  if (stripeLoadingPromise) {
    return stripeLoadingPromise;
  }

  if (window[STRIPE_LOADING_PROMISE_KEY]) {
    stripeLoadingPromise = window[STRIPE_LOADING_PROMISE_KEY];
    return stripeLoadingPromise;
  }

  if (typeof Stripe !== 'undefined') {
    return Promise.resolve();
  }

  stripeLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/';
    const timeoutId = window.setTimeout(() => {
      stripeLoadingPromise = null;
      window[STRIPE_LOADING_PROMISE_KEY] = null;
      script.remove();
      reject(new Error('Stripe.js did not load in time.'));
    }, STRIPE_REQUEST_TIMEOUT);
    script.onload = () => {
      window.clearTimeout(timeoutId);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeoutId);
      stripeLoadingPromise = null;
      window[STRIPE_LOADING_PROMISE_KEY] = null;
      reject(new Error('Stripe.js failed to load.'));
    };
    document.head.appendChild(script);
  });
  window[STRIPE_LOADING_PROMISE_KEY] = stripeLoadingPromise;

  return stripeLoadingPromise;
}

function getCustomerTokenFromCookie() {
  const match = document.cookie.match(
    /(?:^|;\s*)auth_dropin_user_token=([^;]+)/,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function getActiveCartId(preferredCartId = null) {
  return (
    preferredCartId
    || cartData?.id
    || checkoutData?.id
    || events.lastPayload('cart/updated')?.id
    || events.lastPayload('cart/initialized')?.id
    || window.sessionStorage.getItem('DROPINS_CART_ID')
    || null
  );
}

function getStripePaymentMethod() {
  const paymentMethods = [
    checkoutData?.selectedPaymentMethod,
    ...(checkoutData?.availablePaymentMethods || []),
  ].filter(Boolean);

  return paymentMethods.find(
    (method) => method.code === STRIPE_PAYMENT_METHOD_CODE,
  );
}

function isStripePaymentMethodAvailable() {
  return Boolean(getStripePaymentMethod());
}

function parseRuntimeConfig() {
  const backendIntegrationUrl = getStripePaymentMethod()?.oope_payment_method_config
    ?.backend_integration_url;

  if (!backendIntegrationUrl) {
    throw new Error('Stripe runtime configuration is unavailable.');
  }

  const parsedConfig = JSON.parse(backendIntegrationUrl);
  if (!parsedConfig.getInitParamsUrl || !parsedConfig.createPaymentIntentUrl) {
    throw new Error('Stripe runtime configuration is incomplete.');
  }

  return parsedConfig;
}

function getCheckoutShippingAddress() {
  return (
    checkoutData?.shippingAddress
    || checkoutData?.shippingAddresses?.[0]
    || checkoutData?.shipping_address
    || checkoutData?.shipping_addresses?.[0]
    || null
  );
}

function getCheckoutBillingAddress() {
  return checkoutData?.billingAddress || checkoutData?.billing_address || null;
}

function getAddressCountry(address) {
  return (
    address?.country?.code
    || address?.country?.value
    || address?.countryCode
    || address?.country_code
    || ''
  );
}

function getAddressPostcode(address) {
  return address?.postCode || address?.postcode || address?.postal_code || '';
}

function getAddressStreet(address) {
  if (Array.isArray(address?.street)) {
    return address.street;
  }

  return [address?.line1, address?.line2].filter(Boolean);
}

function isCompleteCommerceAddress(address) {
  const street = getAddressStreet(address);
  return Boolean(
    (address?.firstName || address?.firstname)
    && (address?.lastName || address?.lastname)
    && street[0]
    && address?.city
    && getAddressCountry(address)
    && getAddressPostcode(address),
  );
}

function getSelectedShippingMethod(address = getCheckoutShippingAddress()) {
  return (
    address?.selectedShippingMethod || address?.selected_shipping_method || null
  );
}

function isVirtualCart() {
  return Boolean(checkoutData?.isVirtual || cartData?.isVirtual);
}

function shouldCollectShipping() {
  if (isVirtualCart()) {
    return false;
  }

  const shippingAddress = getCheckoutShippingAddress();
  return !(
    isCompleteCommerceAddress(shippingAddress)
    && getSelectedShippingMethod(shippingAddress)
  );
}

function isCompleteBillingAddress() {
  return isCompleteCommerceAddress(getCheckoutBillingAddress());
}

function getStripeFractionDigits(currency) {
  const normalizedCurrency = String(currency || '').toUpperCase();
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency)) return 0;
  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(normalizedCurrency)) return 3;
  return 2;
}

function toStripeMinorUnits(value, currency) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error('A Stripe amount is unavailable.');
  }

  return Math.round(numericValue * (10 ** getStripeFractionDigits(currency)));
}

function getCartMoney(source = cartData) {
  const candidates = [
    source?.total?.includingTax,
    source?.total?.excludingTax,
    source?.prices?.grandTotal,
    source?.prices?.grand_total,
    checkoutData?.prices?.grandTotal,
    checkoutData?.prices?.grand_total,
  ];
  const money = candidates.find(
    (candidate) => candidate
      && Number.isFinite(Number(candidate.value))
      && candidate.currency,
  );

  if (!money) {
    throw new Error('The authoritative cart amount is unavailable.');
  }

  return {
    amount: toStripeMinorUnits(money.value, money.currency),
    currency: String(money.currency).toLowerCase(),
  };
}

function getShippingMethodCarrierCode(method) {
  return method?.carrier?.code || method?.carrierCode || method?.carrier_code;
}

function getShippingMethodCode(method) {
  return method?.code || method?.methodCode || method?.method_code;
}

function getShippingMethodRateId(method) {
  return `${encodeURIComponent(getShippingMethodCarrierCode(method))}:${encodeURIComponent(getShippingMethodCode(method))}`;
}

function toStripeShippingRate(method) {
  const carrierCode = getShippingMethodCarrierCode(method);
  const methodCode = getShippingMethodCode(method);
  const amount = method?.amount || method?.amountInclTax;

  if (!carrierCode || !methodCode || !amount) {
    return null;
  }

  const id = getShippingMethodRateId(method);
  shippingMethodsByRateId.set(id, method);

  return {
    id,
    displayName: [method?.carrier?.title, method?.title]
      .filter(Boolean)
      .join(' - '),
    amount: toStripeMinorUnits(amount.value, amount.currency),
  };
}

function setAvailableShippingMethods(methods = []) {
  shippingMethodsByRateId = new Map();
  currentShippingRates = methods.map(toStripeShippingRate).filter(Boolean);
  return currentShippingRates;
}

function getSelectedShippingAmountCents() {
  const method = getSelectedShippingMethod();
  const amount = method?.amount || method?.amountInclTax;
  const value = Number(amount?.value);
  return Number.isFinite(value)
    ? toStripeMinorUnits(value, amount.currency)
    : 0;
}

function getAmountWithShippingRate(shippingRate) {
  const money = getCartMoney();
  const rateAmount = Number(shippingRate?.amount);
  const shippingCents = Number.isFinite(rateAmount) ? rateAmount : 0;
  return money.amount - getSelectedShippingAmountCents() + shippingCents;
}

async function previewWalletAmount(shippingRate) {
  if (!elements || !shippingRate) {
    return currentAmount;
  }
  const previewAmount = getAmountWithShippingRate(shippingRate);
  if (previewAmount === currentAmount) {
    return previewAmount;
  }
  await elements.update({ amount: previewAmount });
  currentAmount = previewAmount;
  return previewAmount;
}

function getAvailableShippingMethods() {
  const shippingAddress = getCheckoutShippingAddress();
  return (
    shippingAddress?.availableShippingMethods
    || shippingAddress?.available_shipping_methods
    || []
  );
}

function getElementsOptions() {
  const money = getCartMoney();
  const paymentMethodOptions = initParams?.elementsOptions?.paymentMethodOptions;

  return {
    mode: 'payment',
    amount: money.amount,
    currency: money.currency,
    ...(paymentMethodOptions ? { paymentMethodOptions } : {}),
  };
}

function getExpressCheckoutOptions() {
  const collectShipping = shouldCollectShipping();
  const options = {
    billingAddressRequired: !isCompleteBillingAddress(),
    emailRequired: !checkoutData?.email,
    phoneNumberRequired: collectShipping,
    shippingAddressRequired: collectShipping,
  };

  if (collectShipping) {
    options.shippingRates = setAvailableShippingMethods(
      getAvailableShippingMethods(),
    );
  } else {
    setAvailableShippingMethods([]);
  }

  return options;
}

function getConfigurationKey() {
  const options = getExpressCheckoutOptions();
  return JSON.stringify({
    cartId: getActiveCartId(),
    billingAddressRequired: options.billingAddressRequired,
    emailRequired: options.emailRequired,
    phoneNumberRequired: options.phoneNumberRequired,
    shippingAddressRequired: options.shippingAddressRequired,
  });
}

function getBlockingTarget() {
  return (
    mountContainer?.closest?.('.commerce-checkout')
    || mountContainer?.closest?.('form')
    || document.body
  );
}

function setCheckoutBlocked(blocked) {
  const target = getBlockingTarget();
  if (!target) {
    return;
  }

  target.classList.toggle(BLOCKED_CLASS, blocked);
  if (blocked) {
    target.setAttribute('aria-busy', 'true');
  } else {
    target.removeAttribute('aria-busy');
  }
}

function hideExpressCheckout(hideBlock = true) {
  if (!mountContainer) {
    return;
  }

  mountContainer.classList.add(HIDDEN_CLASS);
  mountContainer.classList.remove(LOADING_CLASS);
  mountContainer.hidden = true;
  if (blockContainer) {
    blockContainer.hidden = hideBlock;
  }
}

function showExpressCheckout() {
  if (!mountContainer || elementLoadFailed) {
    return;
  }

  mountContainer.classList.remove(HIDDEN_CLASS);
  mountContainer.classList.remove(LOADING_CLASS);
  mountContainer.hidden = false;
  if (blockContainer) {
    blockContainer.hidden = false;
  }
}

function destroyExpressCheckout() {
  if (expressCheckoutElement) {
    try {
      expressCheckoutElement.destroy();
    } catch (error) {
      console.warn('Unable to destroy Stripe Express Checkout Element.', error);
    }
  }

  expressCheckoutElement = null;
  elements = null;
  stripe = null;
  initParams = null;
  runtimeConfig = null;
  mountedConfigurationKey = null;
  currentAmount = null;
  currentCurrency = null;
  currentShippingRates = [];
  shippingMethodsByRateId = new Map();
  pendingShippingMethod = null;
  elementLoadFailed = false;
  walletShippingRequired = false;
  walletShippingAddressPersisted = false;
  walletReauthorizationRequired = false;
  modalOpen = false;
  confirmationInProgress = false;
  activeConfirmation = null;
  setCheckoutBlocked(false);
}

async function fetchInitParams(endpoint) {
  const response = await fetchStripeResource(endpoint);
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.publishableKey) {
    throw new Error('Stripe initialization parameters are unavailable.');
  }

  return data;
}

function getPaymentIntentHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const customerToken = getCustomerTokenFromCookie();
  if (customerToken) {
    headers.Authorization = `Bearer ${customerToken}`;
  }

  headers.Store = window.localStorage.getItem('store-view') || 'default';
  return headers;
}

async function createPaymentIntent(confirmationTokenId) {
  const cartId = getActiveCartId();
  const selectedStore = window.localStorage.getItem('store-view') || 'default';
  const response = await fetchStripeResource(runtimeConfig.createPaymentIntentUrl, {
    method: 'POST',
    headers: getPaymentIntentHeaders(),
    body: JSON.stringify({
      cartId,
      cartFullName: getCommerceCustomerName(),
      confirmationTokenId,
      storeCode: selectedStore,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.client_secret) {
    throw new Error(data?.error || data?.message || 'PaymentIntent failed.');
  }

  return data;
}

function splitCustomerName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length < 2) {
    return null;
  }

  return {
    firstName: parts.shift(),
    lastName: parts.join(' '),
  };
}

function getCommerceCustomerName() {
  const billingAddress = getCheckoutBillingAddress();
  const shippingAddress = getCheckoutShippingAddress();
  const firstName = billingAddress?.firstName
    || billingAddress?.firstname
    || shippingAddress?.firstName
    || shippingAddress?.firstname
    || '';
  const lastName = billingAddress?.lastName
    || billingAddress?.lastname
    || shippingAddress?.lastName
    || shippingAddress?.lastname
    || '';

  return `${firstName} ${lastName}`.trim();
}

const readWalletValue = (...values) => {
  const normalized = values
    .map((value) => String(value || '').trim())
    .find(Boolean);
  return normalized || '';
};

/**
 * Normalize ECE / Amazon Pay address payloads onto Stripe's `{ name, address }` shape.
 * Confirm events nest `address`; some wallets flatten fields or use Amazon keys.
 * Amazon Pay DE billing often leaves `line1` empty and puts the street in `line2`.
 */
function toWalletAddress(source) {
  if (!source) {
    return null;
  }

  const nested = source.address && typeof source.address === 'object'
    ? source.address
    : null;
  const streetLine1 = readWalletValue(
    nested?.line1,
    nested?.addressLine1,
    source.line1,
    source.addressLine1,
  );
  const streetLine2 = readWalletValue(
    nested?.line2,
    nested?.addressLine2,
    source.line2,
    source.addressLine2,
  );
  const address = {
    line1: streetLine1 || streetLine2,
    line2: streetLine1 ? streetLine2 || undefined : undefined,
    city: readWalletValue(nested?.city, source.city),
    state:
      readWalletValue(
        nested?.state,
        nested?.stateOrRegion,
        source.state,
        source.stateOrRegion,
      ) || undefined,
    country: readWalletValue(
      nested?.country,
      nested?.countryCode,
      source.country,
      source.countryCode,
    ),
    postal_code: readWalletValue(
      nested?.postal_code,
      nested?.postalCode,
      source.postal_code,
      source.postalCode,
    ),
  };
  const name = readWalletValue(source.name, nested?.name);
  const phone = readWalletValue(
    source.phone,
    source.phoneNumber,
    nested?.phone,
    nested?.phoneNumber,
  ) || undefined;

  if (
    !name
    && !address.line1
    && !address.city
    && !address.country
    && !address.postal_code
  ) {
    return null;
  }

  return { name, phone, address };
}

function isCompleteWalletAddress(walletAddress) {
  const address = walletAddress?.address;
  return Boolean(
    walletAddress?.name
      && address?.line1
      && address?.city
      && address?.country
      && address?.postal_code,
  );
}

const firstCompleteWallet = (...wallets) => wallets
  .find((wallet) => isCompleteWalletAddress(wallet)) || null;

function cartNeedsWalletAddresses() {
  return (
    (walletShippingRequired
      && !isCompleteCommerceAddress(getCheckoutShippingAddress()))
    || !isCompleteBillingAddress()
  );
}

function toCommerceAddress(walletAddress, phone) {
  const normalized = toWalletAddress(walletAddress);
  const name = splitCustomerName(normalized?.name);
  if (!name || !isCompleteWalletAddress(normalized)) {
    throw new Error('The wallet address is incomplete.');
  }

  const { address } = normalized;
  const telephone = phone || normalized.phone;
  return {
    firstName: name.firstName,
    lastName: name.lastName,
    street: [address.line1, address.line2].filter(Boolean),
    city: address.city,
    countryCode: address.country,
    postcode: address.postal_code,
    ...(address.state ? { region: address.state } : {}),
    ...(telephone ? { telephone } : {}),
  };
}

function toStripeBillingDetails(billingDetails) {
  if (!billingDetails) {
    return null;
  }

  const billingWallet = toWalletAddress(billingDetails);
  return {
    name: billingDetails.name,
    email: billingDetails.email,
    phone: billingDetails.phone,
    ...(isCompleteWalletAddress(billingWallet)
      ? { address: billingWallet.address }
      : {}),
  };
}

function toStripeShippingDetails(shippingAddress, phone) {
  const walletAddress = toWalletAddress(shippingAddress);
  if (!isCompleteWalletAddress(walletAddress)) {
    return null;
  }

  return {
    name: walletAddress.name,
    phone: phone || walletAddress.phone || null,
    address: walletAddress.address,
  };
}

function getEstimateShippingInput(address) {
  const normalized = toWalletAddress({ address })?.address || address;
  return {
    criteria: {
      country_code: normalized.country,
      ...(normalized.state ? { region_name: normalized.state } : {}),
      ...(normalized.postal_code ? { zip: normalized.postal_code } : {}),
    },
  };
}

function getShippingMethodInput(method) {
  return {
    carrierCode: getShippingMethodCarrierCode(method),
    methodCode: getShippingMethodCode(method),
  };
}

async function refreshAuthoritativeCart() {
  const refreshedCart = await cartApi.refreshCart();
  if (refreshedCart) {
    cartData = refreshedCart;
  }

  const refreshedCheckout = await checkoutApi.getCart();
  if (refreshedCheckout) {
    checkoutData = {
      ...checkoutData,
      ...refreshedCheckout,
      availablePaymentMethods:
        refreshedCheckout.availablePaymentMethods
        || checkoutData?.availablePaymentMethods,
    };
  }

  return getCartMoney();
}

async function updateElementsAmountFromCart() {
  const money = await refreshAuthoritativeCart();
  if (money.currency !== currentCurrency) {
    throw new Error('The cart currency changed during Express Checkout.');
  }

  if (money.amount !== currentAmount) {
    await elements.update({ amount: money.amount });
    currentAmount = money.amount;
  }

  return money;
}

async function handleShippingAddressChange(event) {
  try {
    let persistedCheckout = null;
    const walletAddress = toWalletAddress({
      name: event.name,
      address: event.address,
      phone: event.phone || event.phoneNumber,
    });

    if (isCompleteWalletAddress(walletAddress)) {
      persistedCheckout = await checkoutApi.setShippingAddress({
        address: toCommerceAddress(walletAddress, walletAddress.phone),
      });
      walletShippingAddressPersisted = true;
      if (persistedCheckout) {
        checkoutData = {
          ...checkoutData,
          ...persistedCheckout,
          availablePaymentMethods:
            persistedCheckout.availablePaymentMethods
            || checkoutData?.availablePaymentMethods,
        };
      }
    }

    const persistedMethods = persistedCheckout
      ? getAvailableShippingMethods()
      : [];
    let methods = persistedMethods;
    if (methods.length === 0 && event.address) {
      methods = (await checkoutApi.estimateShippingMethods(
        getEstimateShippingInput(event.address),
      )) || [];
    }
    const shippingRates = setAvailableShippingMethods(methods);
    if (shippingRates[0]) {
      [pendingShippingMethod] = methods;
      if (walletShippingAddressPersisted) {
        await checkoutApi.setShippingMethods([
          getShippingMethodInput(pendingShippingMethod),
        ]);
        await updateElementsAmountFromCart();
      } else {
        await previewWalletAmount(shippingRates[0]);
      }
    }
    event.resolve({ shippingRates });
  } catch (error) {
    console.warn('Unable to estimate wallet shipping methods.', error);
    event.reject();
  }
}

async function handleShippingRateChange(event) {
  try {
    const method = shippingMethodsByRateId.get(event.shippingRate?.id);
    if (!method) {
      event.reject();
      return;
    }

    pendingShippingMethod = method;
    if (
      walletShippingAddressPersisted
      || isCompleteCommerceAddress(getCheckoutShippingAddress())
    ) {
      await checkoutApi.setShippingMethods([getShippingMethodInput(method)]);
      await updateElementsAmountFromCart();
    } else {
      await previewWalletAmount(event.shippingRate);
    }

    event.resolve({ shippingRates: currentShippingRates });
  } catch (error) {
    console.warn('Unable to persist the wallet shipping method.', error);
    event.reject();
  }
}

async function persistBillingAddress(walletAddress, phone) {
  await checkoutApi.setBillingAddress({
    address: toCommerceAddress(walletAddress, phone),
  });
}

async function synchronizeWalletDetails(event, extraWallets = {}) {
  const isGuest = checkoutData?.isGuest
    ?? cartData?.isGuestCart
    ?? !getCustomerTokenFromCookie();
  const { billingDetails } = event;

  if (isGuest && !checkoutData?.email && billingDetails?.email) {
    await checkoutApi.setGuestEmailOnCart(billingDetails.email);
    checkoutData = { ...checkoutData, email: billingDetails.email };
  }

  const shippingWallet = walletShippingRequired
    ? firstCompleteWallet(
      extraWallets.shipping,
      toWalletAddress(event.shippingAddress),
      toWalletAddress(billingDetails),
    )
    : null;
  const billingWallet = firstCompleteWallet(
    extraWallets.billing,
    toWalletAddress(billingDetails),
    shippingWallet,
  );
  const phone = billingDetails?.phone || shippingWallet?.phone || billingWallet?.phone;

  if (isCompleteWalletAddress(shippingWallet)) {
    await checkoutApi.setShippingAddress({
      address: toCommerceAddress(shippingWallet, phone),
    });
    walletShippingAddressPersisted = true;
  }

  const selectedMethod = walletShippingRequired
    ? shippingMethodsByRateId.get(event.shippingRate?.id)
      || pendingShippingMethod
    : null;
  if (
    selectedMethod
    && (walletShippingAddressPersisted
      || isCompleteCommerceAddress(getCheckoutShippingAddress()))
  ) {
    await checkoutApi.setShippingMethods([
      getShippingMethodInput(selectedMethod),
    ]);
  }

  if (!isCompleteBillingAddress()) {
    if (isCompleteWalletAddress(billingWallet)) {
      await persistBillingAddress(billingWallet, phone);
    } else if (
      walletShippingAddressPersisted
      || isCompleteCommerceAddress(getCheckoutShippingAddress())
    ) {
      await checkoutApi.setBillingAddress({ sameAsShipping: true });
    }
  }

  return refreshAuthoritativeCart();
}

async function persistStripePaymentMethod(clientSecret) {
  const stripePaymentMethod = getStripePaymentMethod() || {
    code: STRIPE_PAYMENT_METHOD_CODE,
    title: 'Stripe Payment Method',
  };
  const checkoutValues = events.lastPayload('checkout/values') || {};
  events.emit('checkout/values', {
    ...checkoutValues,
    selectedPaymentMethod: stripePaymentMethod,
  });

  const updatedCheckout = await checkoutApi.setPaymentMethod({
    code: STRIPE_PAYMENT_METHOD_CODE,
    additional_data: [{ key: 'client_secret', value: clientSecret }],
  });

  if (updatedCheckout?.selectedPaymentMethod?.code !== STRIPE_PAYMENT_METHOD_CODE) {
    throw new Error('Adobe Commerce did not select Stripe as the payment method.');
  }

  checkoutData = {
    ...checkoutData,
    ...updatedCheckout,
    availablePaymentMethods:
      updatedCheckout.availablePaymentMethods
      || checkoutData?.availablePaymentMethods,
  };
  events.emit('checkout/values', {
    ...(events.lastPayload('checkout/values') || {}),
    selectedPaymentMethod: updatedCheckout.selectedPaymentMethod,
  });

  return updatedCheckout;
}

function notifyPaymentFailure(event, reason = 'fail') {
  if (typeof event?.paymentFailed === 'function') {
    event.paymentFailed({ reason });
  }
}

async function syncAmountAfterWalletUpdate(event) {
  const money = getCartMoney();
  if (
    money.currency !== currentCurrency
    || money.amount !== currentAmount
  ) {
    if (money.currency === currentCurrency) {
      await elements.update({ amount: money.amount });
      currentAmount = money.amount;
    }
    walletReauthorizationRequired = true;
    await setPaymentStatus(
      'The order total changed. Please reopen your wallet and approve the updated total.',
      'error',
    );
    notifyPaymentFailure(event, 'invalid_shipping_address');
    return false;
  }
  return true;
}

async function runConfirmation(event) {
  confirmationInProgress = true;
  modalOpen = true;
  setCheckoutBlocked(true);

  try {
    await setPaymentStatus(
      'We are processing your wallet details and payment.',
    );
    const cartId = getActiveCartId();
    if (!cartId) {
      throw new Error('The active cart is unavailable.');
    }

    if (validateCheckout && !(await validateCheckout())) {
      await setPaymentStatus(
        'Please accept the terms and conditions, then try Express Checkout again.',
        'error',
      );
      notifyPaymentFailure(event);
      return false;
    }

    if (walletReauthorizationRequired) {
      await setPaymentStatus(
        'The order total changed. Please reopen your wallet and approve the updated total.',
        'error',
      );
      notifyPaymentFailure(event, 'invalid_shipping_address');
      return false;
    }

    await synchronizeWalletDetails(event);
    if (!(await syncAmountAfterWalletUpdate(event))) {
      return false;
    }

    const submitResult = await elements.submit();
    if (submitResult?.error) {
      await setPaymentStatus(
        submitResult.error.message || 'The wallet could not submit this payment.',
        'error',
      );
      notifyPaymentFailure(event, 'invalid_payment_data');
      return false;
    }

    const billingDetails = toStripeBillingDetails(event.billingDetails);
    const shippingDetails = walletShippingRequired
      ? toStripeShippingDetails(
        event.shippingAddress,
        event.billingDetails?.phone,
      )
      : null;
    const confirmationTokenResult = await stripe.createConfirmationToken({
      elements,
      params: {
        ...(billingDetails
          ? { payment_method_data: { billing_details: billingDetails } }
          : {}),
        ...(shippingDetails ? { shipping: shippingDetails } : {}),
      },
    });

    if (
      confirmationTokenResult.error
      || !confirmationTokenResult.confirmationToken?.id
    ) {
      await setPaymentStatus(
        confirmationTokenResult.error?.message
          || 'The wallet payment details could not be confirmed.',
        'error',
      );
      notifyPaymentFailure(event, 'invalid_payment_data');
      return false;
    }

    const { confirmationToken } = confirmationTokenResult;
    const confirmationTokenId = confirmationToken.id;

    if (cartNeedsWalletAddresses()) {
      await synchronizeWalletDetails(event, {
        shipping: toWalletAddress(confirmationToken.shipping),
        billing: toWalletAddress(
          confirmationToken.payment_method_preview?.billing_details,
        ),
      });
      if (!(await syncAmountAfterWalletUpdate(event))) {
        return false;
      }
    }

    if (cartNeedsWalletAddresses()) {
      await setPaymentStatus(
        'The wallet did not provide a complete billing or shipping address.',
        'error',
      );
      notifyPaymentFailure(event, 'invalid_shipping_address');
      return false;
    }

    const paymentIntentData = await createPaymentIntent(confirmationTokenId);
    await persistStripePaymentMethod(paymentIntentData.client_secret);

    const confirmParams = { confirmation_token: confirmationTokenId };
    if (paymentIntentData.return_url) {
      confirmParams.return_url = paymentIntentData.return_url;
    }

    const confirmationResult = await stripe.confirmPayment({
      clientSecret: paymentIntentData.client_secret,
      confirmParams,
      redirect: 'if_required',
    });

    if (confirmationResult.error) {
      await setPaymentStatus(
        confirmationResult.error.message || 'Stripe could not confirm the payment.',
        'error',
      );
      notifyPaymentFailure(event);
      return false;
    }

    if (
      confirmationResult.paymentIntent?.status
      && !SUPPORTED_PAYMENT_STATUSES.has(confirmationResult.paymentIntent.status)
    ) {
      await setPaymentStatus(
        'The payment was not completed. Please try again or use the card form below.',
        'error',
      );
      notifyPaymentFailure(event);
      return false;
    }

    // Payment Methods can auto-sync its previously selected fallback method.
    // Reassert and verify Stripe immediately before Commerce creates the order.
    await persistStripePaymentMethod(paymentIntentData.client_secret);

    await setPaymentStatus(
      'Payment confirmed. We are creating your order.',
    );
    const order = await orderApi.placeOrder(cartId);
    if (!order) {
      throw new Error('Adobe Commerce did not create the order.');
    }
    confirmedCartId = cartId;
    await setPaymentStatus(
      'Your payment was successful and your order has been placed.',
      'success',
    );
    return true;
  } catch (error) {
    console.warn('Stripe Express Checkout confirmation failed.', error);
    await setPaymentStatus(
      error.message || 'Express Checkout could not complete the payment.',
      'error',
    );
    notifyPaymentFailure(event);
    return false;
  } finally {
    confirmationInProgress = false;
    modalOpen = false;
    setCheckoutBlocked(false);
  }
}

function handleConfirm(event) {
  if (!activeConfirmation) {
    activeConfirmation = runConfirmation(event).finally(() => {
      activeConfirmation = null;
    });
  }

  return activeConfirmation;
}

function handleModalDismissed() {
  modalOpen = false;
  if (!confirmationInProgress) {
    setCheckoutBlocked(false);
    synchronizeMountedElement();
  }
}

function registerExpressCheckoutHandlers() {
  expressCheckoutElement.on('click', (event) => {
    clearPaymentStatus();
    modalOpen = true;
    walletReauthorizationRequired = false;
    setCheckoutBlocked(true);
    // Amazon Pay requires its JS-only initialization callback immediately.
    // The default shipping amount is already included when Elements is created.
    if (walletShippingRequired && currentShippingRates.length > 0) {
      event.resolve({ shippingRates: currentShippingRates });
    } else {
      event.resolve();
    }
  });
  expressCheckoutElement.on('confirm', handleConfirm);
  expressCheckoutElement.on(
    'shippingaddresschange',
    handleShippingAddressChange,
  );
  expressCheckoutElement.on('shippingratechange', handleShippingRateChange);
  expressCheckoutElement.on('cancel', handleModalDismissed);
  expressCheckoutElement.on('escape', handleModalDismissed);
  expressCheckoutElement.on('loaderror', async (event) => {
    console.warn(
      'Stripe Express Checkout Element failed to load.',
      event.error,
    );
    elementLoadFailed = true;
    handleModalDismissed();
    hideExpressCheckout(false);
    await setPaymentStatus(
      'Express Checkout is unavailable. Please use the card payment form below.',
      'error',
    );
  });
  expressCheckoutElement.on('ready', (event) => {
    if (event.availablePaymentMethods) {
      clearPaymentStatus();
      showExpressCheckout();
    } else {
      clearPaymentStatus();
      hideExpressCheckout();
    }
  });
  expressCheckoutElement.on('availablepaymentmethodschange', (event) => {
    if (event.paymentMethods) {
      clearPaymentStatus();
      showExpressCheckout();
    } else {
      clearPaymentStatus();
      hideExpressCheckout();
    }
  });
}

async function mountExpressCheckout() {
  if (
    mountInProgress
    || expressCheckoutElement
    || !mountContainer
    || !checkoutData
    || !cartData
    || !isStripePaymentMethodAvailable()
  ) {
    return;
  }

  mountInProgress = true;
  clearPaymentStatus();
  if (blockContainer) {
    blockContainer.hidden = false;
  }
  mountContainer.hidden = false;
  mountContainer.classList.remove(HIDDEN_CLASS);
  mountContainer.classList.add(LOADING_CLASS);

  try {
    await loadStripeJs();
    runtimeConfig = parseRuntimeConfig();
    initParams = await fetchInitParams(runtimeConfig.getInitParamsUrl);
    stripe = Stripe(initParams.publishableKey, initParams.options);
    if (initParams.appInfo) {
      stripe.registerAppInfo(initParams.appInfo);
    }

    const expressCheckoutOptions = getExpressCheckoutOptions();
    const elementsOptions = getElementsOptions();
    if (
      expressCheckoutOptions.shippingAddressRequired
      && currentShippingRates[0]
    ) {
      elementsOptions.amount = getAmountWithShippingRate(
        currentShippingRates[0],
      );
    }
    currentAmount = elementsOptions.amount;
    currentCurrency = elementsOptions.currency;
    elements = stripe.elements(elementsOptions);
    walletShippingRequired = expressCheckoutOptions.shippingAddressRequired;
    expressCheckoutElement = elements.create(
      'expressCheckout',
      expressCheckoutOptions,
    );
    registerExpressCheckoutHandlers();
    expressCheckoutElement.mount(`#${ELEMENT_CONTAINER_ID}`);
    mountedConfigurationKey = getConfigurationKey();
  } catch (error) {
    console.warn(
      'Unable to initialize Stripe Express Checkout Element.',
      error,
    );
    hideExpressCheckout(false);
    await setPaymentStatus(
      'Express Checkout is unavailable. Please use the card payment form below.',
      'error',
    );
  } finally {
    mountInProgress = false;
  }
}

async function synchronizeMountedElement() {
  if (!mountContainer || modalOpen || confirmationInProgress) {
    return;
  }

  if (!isStripePaymentMethodAvailable()) {
    destroyExpressCheckout();
    clearPaymentStatus();
    hideExpressCheckout();
    return;
  }

  if (!expressCheckoutElement) {
    await mountExpressCheckout();
    return;
  }

  const nextConfigurationKey = getConfigurationKey();
  if (nextConfigurationKey !== mountedConfigurationKey) {
    destroyExpressCheckout();
    await mountExpressCheckout();
    return;
  }

  const money = getCartMoney();
  if (money.currency !== currentCurrency) {
    destroyExpressCheckout();
    await mountExpressCheckout();
  } else if (money.amount !== currentAmount) {
    await elements.update({ amount: money.amount });
    currentAmount = money.amount;
  }
}

function renderStripePaymentMethod(ctx, options = {}) {
  destroyExpressCheckout();
  clearPaymentStatus();
  validateCheckout = options.handleValidation || null;

  const content = document.createElement('div');
  content.className = 'stripe-express-checkout';
  blockContainer = content;
  const heading = document.createElement('h3');
  heading.className = 'stripe-express-checkout-heading';
  heading.textContent = 'Express checkout';
  mountContainer = document.createElement('div');
  mountContainer.id = ELEMENT_CONTAINER_ID;
  mountContainer.className = LOADING_CLASS;
  statusContainer = document.createElement('div');
  statusContainer.className = 'stripe-express-checkout-status';
  const separator = document.createElement('div');
  separator.className = 'stripe-express-checkout-separator';
  separator.textContent = 'Or pay another way';
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-label', 'Or pay another way');
  content.appendChild(heading);
  content.appendChild(mountContainer);
  content.appendChild(statusContainer);
  content.appendChild(separator);
  ctx.replaceHTML(content);

  requestAnimationFrame(() => {
    synchronizeMountedElement();
  });
}

async function handleStripePayment(cartId) {
  return Boolean(cartId && confirmedCartId === cartId);
}

function validateStripePayment() {
  if (!expressCheckoutElement) {
    return true;
  }

  return confirmedCartId === getActiveCartId();
}

events.on(
  'checkout/initialized',
  (data) => {
    checkoutData = data;
    synchronizeMountedElement();
  },
  { eager: true },
);

events.on('checkout/updated', (data) => {
  checkoutData = data;
  synchronizeMountedElement();
});

events.on(
  'cart/initialized',
  (data) => {
    cartData = data;
    synchronizeMountedElement();
  },
  { eager: true },
);

events.on(
  'cart/updated',
  (data) => {
    cartData = data;
    synchronizeMountedElement();
  },
  { eager: true },
);

events.on('cart/reset', () => {
  cartData = null;
  checkoutData = null;
  confirmedCartId = null;
  destroyExpressCheckout();
});

export {
  handleStripePayment,
  renderStripePaymentMethod,
  validateStripePayment,
};

export default function decorate(block, options = {}) {
  renderStripePaymentMethod({
    replaceHTML: (content) => block.replaceChildren(content),
  }, options);
}
