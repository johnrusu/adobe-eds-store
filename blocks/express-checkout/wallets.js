import { ELEMENT_CONTAINER_ID } from './constants.js';
import { AMAZON_PAY_DISABLED, createAmazonPayWallet } from './amazon-pay.js';

/**
 * A wallet's configuration and mounted resources. Policy callbacks are pure;
 * mounted resources are updated by the shared checkout lifecycle.
 * @typedef {Object} WalletDescriptor
 * @property {string} containerId Stable DOM mount ID.
 * @property {string} containerClassName Additional wallet-specific styling class.
 * @property {boolean} collectsShipping Whether Stripe requests shipping in the sheet.
 * @property {function(boolean): boolean} isEnabled Check eligibility for a virtual cart.
 * @property {function(Object, Object[]): Object} getOptions Build Stripe create options.
 * @property {Element|null} container Host DOM node.
 * @property {Object|null} element Mounted Express Checkout Element.
 * @property {Object|null} elements Owning Stripe Elements instance.
 * @property {boolean} available Most recently reported wallet availability.
 */

/** @type {WalletDescriptor} Payment-only wallet group backed by Magento shipping. */
export const primaryWallet = {
  containerId: ELEMENT_CONTAINER_ID,
  containerClassName: '',
  collectsShipping: false,
  isEnabled: () => true,
  getOptions: (fields) => ({
    ...fields,
    shippingAddressRequired: false,
    paymentMethods: AMAZON_PAY_DISABLED,
  }),
  container: null,
  element: null,
  elements: null,
  available: false,
};

/** @type {WalletDescriptor[]} Render and mount order matches the original checkout. */
export const wallets = [primaryWallet, createAmazonPayWallet()];
