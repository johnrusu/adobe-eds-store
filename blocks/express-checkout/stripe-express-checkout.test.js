/* eslint-env node, jest */
/* eslint-disable no-await-in-loop */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STRIPE_BLOCK_PATH = path.join(__dirname, 'stripe-express-checkout.js');

function flushPromises() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitForMount(block, expectedMounts = 1) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (block.expressCheckoutElement.mount.mock.calls.length >= expectedMounts) {
      return;
    }
    await flushPromises();
  }

  throw new Error(
    `Express Checkout Element did not mount (${block.expressCheckoutElement.mount.mock.calls.length}/${expectedMounts}).`,
  );
}

function createStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));

  return {
    getItem: jest.fn((key) => values.get(key) || null),
    setItem: jest.fn((key, value) => {
      values.set(key, String(value));
    }),
    removeItem: jest.fn((key) => {
      values.delete(key);
    }),
  };
}

function createElement(tagName) {
  const element = {
    tagName,
    children: [],
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    parentElement: null,
    attributes: {},
    scrollIntoView: jest.fn(),
    classList: {
      add: jest.fn((className) => {
        element.className = [element.className, className]
          .filter(Boolean)
          .join(' ');
      }),
      remove: jest.fn((className) => {
        element.className = element.className
          .split(' ')
          .filter((value) => value && value !== className)
          .join(' ');
      }),
      contains: jest.fn((className) => (element.className || '').split(' ').includes(className)),
      toggle: jest.fn((className, force) => {
        const tokens = (element.className || '').split(' ').filter(Boolean);
        const has = tokens.includes(className);
        const shouldHave = force === true || (force !== false && !has);
        element.className = shouldHave
          ? [...tokens.filter((token) => token !== className), className].join(
            ' ',
          )
          : tokens.filter((token) => token !== className).join(' ');
        return shouldHave;
      }),
    },
    appendChild: jest.fn((child) => {
      child.parentElement = element;
      element.children.push(child);
      return child;
    }),
    replaceChildren: jest.fn((...children) => {
      element.children.forEach((child) => {
        child.parentElement = null;
      });
      element.children = children;
      children.forEach((child) => {
        child.parentElement = element;
      });
    }),
    remove: jest.fn(() => {
      if (!element.parentElement) {
        return;
      }
      element.parentElement.children = element.parentElement.children.filter(
        (child) => child !== element,
      );
      element.parentElement = null;
    }),
    closest: jest.fn((selector) => {
      const className = selector.startsWith('.') ? selector.slice(1) : selector;
      let current = element;
      while (current) {
        if ((current.className || '').split(' ').includes(className)) {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }),
    querySelector: jest.fn((selector) => findElement(element, selector)),
    setAttribute: jest.fn((name, value) => {
      element.attributes[name] = String(value);
    }),
    removeAttribute: jest.fn((name) => {
      delete element.attributes[name];
    }),
    getAttribute: jest.fn((name) => element.attributes[name] || null),
  };

  return element;
}

function findElement(root, selector) {
  const isIdSelector = selector.startsWith('#');
  const selectorValue = selector.slice(1);
  const matches = (element) => {
    if (isIdSelector) {
      return element.id === selectorValue;
    }
    return (element.className || '').split(' ').includes(selectorValue);
  };

  const stack = [...root.children];
  while (stack.length > 0) {
    const element = stack.shift();
    if (matches(element)) {
      return element;
    }
    stack.push(...element.children);
  }

  return null;
}

function createDocument() {
  const body = createElement('body');
  const head = createElement('head');
  const checkoutRoot = createElement('div');
  checkoutRoot.className = 'commerce-checkout';
  body.appendChild(checkoutRoot);

  return {
    body,
    head,
    checkoutRoot,
    cookie: '',
    createElement: jest.fn(createElement),
    querySelector: jest.fn((selector) => findElement(body, selector)),
  };
}

function transformStripeBlockSource(source) {
  return source
    .replace(
      /import \{ events \} from ['"]@dropins\/tools\/event-bus\.js['"];/,
      'const { events } = __mocks;',
    )
    .replace(
      /import \* as cartApi from ['"]@dropins\/storefront-cart\/api\.js['"];/,
      'const { cartApi } = __mocks;',
    )
    .replace(
      /import \* as checkoutApi from ['"]@dropins\/storefront-checkout\/api\.js['"];/,
      'const { checkoutApi } = __mocks;',
    )
    .replace(
      /import \* as orderApi from ['"]@dropins\/storefront-order\/api\.js['"];/,
      'const { orderApi } = __mocks;',
    )
    .replace(
      /import \{\s*Icon,\s*InLineAlert,\s*provider as UI,\s*\} from ['"]@dropins\/tools\/components\.js['"];/,
      'const { Icon, InLineAlert, UI } = __mocks;',
    )
    .replace(
      /import \{ h \} from ['"]@dropins\/tools\/preact\.js['"];/,
      'const { h } = __mocks;',
    )
    .replace(
      /import \{ loadCSS \} from ['"]\.\.\/\.\.\/scripts\/aem\.js['"];/,
      'const { loadCSS } = __mocks;',
    )
    .replace(
      /export \{\s*handleStripePayment,\s*renderStripePaymentMethod,\s*validateStripePayment,\s*\};/,
      'Object.assign(__exports, { handleStripePayment, renderStripePaymentMethod, validateStripePayment });',
    )
    .replace(
      'export default function decorate(block, options = {}) {',
      'function decorate(block, options = {}) {',
    )
    .concat('\n__exports.default = decorate;\n');
}

function stripePaymentMethod() {
  return {
    code: 'oope_stripe',
    oope_payment_method_config: {
      backend_integration_url: JSON.stringify({
        getInitParamsUrl: 'https://commerce-config.example/init-params',
        createPaymentIntentUrl:
          'https://commerce-config.example/payment-intent',
      }),
    },
  };
}

function shippingMethod() {
  return {
    carrier: { code: 'flatrate', title: 'Flat Rate' },
    code: 'flatrate',
    title: 'Fixed',
    amount: { value: 5, currency: 'USD' },
  };
}

function commerceAddress() {
  return {
    firstName: 'Ada',
    lastName: 'Lovelace',
    telephone: '020 7946 0000',
    street: ['1 Algorithm Way', ''],
    city: 'London',
    region: { code: '' },
    country: { code: 'GB' },
    postcode: 'SW1A 1AA',
  };
}

function walletAddress() {
  return {
    name: 'Ada Lovelace',
    phone: '020 7946 0000',
    address: {
      line1: '1 Algorithm Way',
      city: 'London',
      country: 'GB',
      postal_code: 'SW1A 1AA',
    },
  };
}

function cartPayload(overrides = {}) {
  return {
    id: 'cart_123',
    isGuestCart: true,
    total: { includingTax: { value: 42, currency: 'USD' } },
    ...overrides,
  };
}

function checkoutPayload(overrides = {}) {
  return {
    email: 'customer@example.com',
    isGuest: true,
    availablePaymentMethods: [stripePaymentMethod()],
    billingAddress: commerceAddress(),
    shippingAddress: {
      ...commerceAddress(),
      selectedShippingMethod: shippingMethod(),
      availableShippingMethods: [shippingMethod()],
    },
    ...overrides,
  };
}

function incompleteCheckoutPayload() {
  return checkoutPayload({
    email: '',
    isGuest: true,
    billingAddress: null,
    shippingAddress: null,
  });
}

function initParamsPayload(overrides = {}) {
  return {
    publishableKey: 'pk_test_123',
    options: { locale: 'auto' },
    appInfo: { name: 'Stripe Adobe Commerce App Builder' },
    elementsOptions: {
      paymentMethodOptions: {
        us_bank_account: {
          verification_method: 'instant',
          setup_future_usage: 'off_session',
        },
      },
    },
    ...overrides,
  };
}

function loadStripeExpressCheckoutBlock({
  search = '',
  initParams = initParamsPayload(),
} = {}) {
  const handlers = new Map();
  const lastPayloads = new Map();

  const events = {
    on: jest.fn((eventName, handler, options = {}) => {
      handlers.set(eventName, [...(handlers.get(eventName) || []), handler]);
      if (options.eager && lastPayloads.has(eventName)) {
        handler(lastPayloads.get(eventName));
      }
    }),
    lastPayload: jest.fn((eventName) => lastPayloads.get(eventName)),
    emit: async (eventName, payload) => {
      lastPayloads.set(eventName, payload);
      await Promise.all(
        (handlers.get(eventName) || []).map((handler) => handler(payload)),
      );
      await flushPromises();
    },
  };

  const document = createDocument();
  const localStorage = createStorage({ 'store-view': 'de_store' });
  const sessionStorage = createStorage();
  const uiRender = jest.fn((_component, props) => async (container) => {
    const alert = createElement('div');
    alert.className = 'dropin-in-line-alert';
    alert.textContent = [props.heading, props.description]
      .filter(Boolean)
      .join(' ');
    container.appendChild(alert);
    return alert;
  });

  const expressCheckoutElement = {
    mount: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn(),
  };
  const elements = {
    create: jest.fn(() => expressCheckoutElement),
    submit: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const stripeInstance = {
    registerAppInfo: jest.fn(),
    elements: jest.fn(() => elements),
    createConfirmationToken: jest.fn().mockResolvedValue({
      confirmationToken: { id: 'ctoken_123' },
    }),
    confirmPayment: jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_123', status: 'succeeded' },
    }),
    createPaymentMethod: jest.fn(),
  };

  const fetch = jest.fn(async (url) => {
    if (url.endsWith('/init-params')) {
      return {
        ok: true,
        json: async () => initParams,
      };
    }

    if (url.endsWith('/payment-intent')) {
      return {
        ok: true,
        json: async () => ({
          client_secret: 'pi_123_secret_abc',
          return_url: 'https://runtime.example/payment-return?cart_id=cart_123',
        }),
      };
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  const context = {
    __exports: {},
    __mocks: {
      events,
      cartApi: {
        refreshCart: jest.fn().mockResolvedValue(null),
      },
      checkoutApi: {
        setPaymentMethod: jest.fn().mockResolvedValue({
          selectedPaymentMethod: {
            code: 'oope_stripe',
            title: 'Stripe Payment Method',
          },
        }),
        setShippingAddress: jest.fn().mockResolvedValue(null),
        estimateShippingMethods: jest
          .fn()
          .mockResolvedValue([shippingMethod()]),
        setShippingMethods: jest.fn().mockResolvedValue(null),
        setGuestEmailOnCart: jest.fn().mockResolvedValue(undefined),
        setBillingAddress: jest.fn().mockResolvedValue(null),
        getCart: jest.fn().mockResolvedValue(null),
      },
      orderApi: {
        placeOrder: jest.fn().mockResolvedValue({ number: '000000001' }),
      },
      Icon: jest.fn(),
      InLineAlert: jest.fn(),
      UI: { render: uiRender },
      h: jest.fn((component, props) => ({ component, props })),
      loadCSS: jest.fn(),
    },
    console,
    document,
    fetch,
    AbortController,
    requestAnimationFrame: (callback) => callback(),
    setTimeout: jest.fn(),
    URLSearchParams,
    Stripe: jest.fn(() => stripeInstance),
    window: {
      location: { search },
      localStorage,
      sessionStorage,
      setTimeout: jest.fn(),
      clearTimeout: jest.fn(),
    },
  };

  vm.createContext(context);
  const source = transformStripeBlockSource(
    fs.readFileSync(STRIPE_BLOCK_PATH, 'utf8'),
  );
  new vm.Script(source, { filename: STRIPE_BLOCK_PATH }).runInContext(context);

  return {
    exports: context.__exports,
    mocks: context.__mocks,
    events,
    document,
    checkoutRoot: document.checkoutRoot,
    localStorage,
    fetch,
    Stripe: context.Stripe,
    elements,
    expressCheckoutElement,
    stripeInstance,
    uiRender,
  };
}

async function renderAndMount(
  block,
  { cart, checkout, handleValidation } = {},
) {
  const ctx = {
    replaceHTML: jest.fn((content) => {
      block.checkoutRoot.appendChild(content);
    }),
  };

  block.exports.renderStripePaymentMethod(ctx, { handleValidation });
  await flushPromises();
  await block.events.emit('cart/initialized', cart || cartPayload());
  await block.events.emit(
    'checkout/initialized',
    checkout || checkoutPayload(),
  );
  await waitForMount(block);
  return ctx;
}

function getHandler(block, eventName) {
  const call = block.expressCheckoutElement.on.mock.calls.find(
    ([name]) => name === eventName,
  );
  return call?.[1];
}

function createConfirmEvent(overrides = {}) {
  return {
    billingDetails: {
      ...walletAddress(),
      email: 'customer@example.com',
    },
    shippingAddress: walletAddress(),
    shippingRate: { id: 'flatrate:flatrate', amount: 500 },
    paymentFailed: jest.fn(),
    ...overrides,
  };
}

describe('stripe-express-checkout EDS block', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    expect(console.error).not.toHaveBeenCalled();
    console.error.mockRestore();
    console.warn.mockRestore();
  });

  test('mounts deferred ECE from init-params and ignores an untrusted App Builder override', async () => {
    const block = loadStripeExpressCheckoutBlock({
      search:
        '?stripeAppBuilderBaseUrl=https://untrusted.example/api/v1/web/stripe/',
    });

    await renderAndMount(block);

    expect(block.fetch).toHaveBeenCalledWith(
      'https://commerce-config.example/init-params',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(block.fetch).not.toHaveBeenCalledWith(
      'https://commerce-config.example/payment-intent',
      expect.anything(),
    );
    expect(block.Stripe).toHaveBeenCalledWith('pk_test_123', { locale: 'auto' });
    expect(block.stripeInstance.registerAppInfo).toHaveBeenCalledWith({
      name: 'Stripe Adobe Commerce App Builder',
    });
    expect(block.stripeInstance.elements).toHaveBeenCalledWith({
      mode: 'payment',
      amount: 4200,
      currency: 'usd',
      paymentMethodOptions: {
        us_bank_account: {
          verification_method: 'instant',
          setup_future_usage: 'off_session',
        },
      },
    });
    expect(block.stripeInstance.elements.mock.calls[0][0].captureMethod).toBeUndefined();
    expect(block.elements.create).toHaveBeenCalledWith(
      'expressCheckout',
      expect.objectContaining({
        billingAddressRequired: false,
        emailRequired: false,
        phoneNumberRequired: true,
        shippingAddressRequired: true,
        shippingRates: [
          {
            id: 'flatrate:flatrate',
            displayName: 'Flat Rate - Fixed',
            amount: 500,
          },
        ],
      }),
    );
    expect(block.expressCheckoutElement.mount).toHaveBeenCalledWith(
      '#stripe-express-checkout-element',
    );
    const expressBlock = block.document.querySelector(
      '.stripe-express-checkout',
    );
    expect(expressBlock.children.map((child) => child.className)).toEqual([
      'stripe-express-checkout-heading',
      'stripe-express-checkout-loading',
      'stripe-express-checkout-status',
      'stripe-express-checkout-separator',
    ]);
    expect(expressBlock.children[0].textContent).toBe('Express checkout');
    expect(expressBlock.children[3].textContent).toBe('Or pay another way');
    expect(block.localStorage.setItem).not.toHaveBeenCalled();
  });

  test('applies nested manual capture from init-params', async () => {
    const block = loadStripeExpressCheckoutBlock({
      initParams: initParamsPayload({
        elementsOptions: {
          paymentMethodOptions: {
            us_bank_account: { verification_method: 'instant' },
            card: { capture_method: 'manual' },
          },
        },
      }),
    });

    await renderAndMount(block);

    expect(block.stripeInstance.elements).toHaveBeenCalledWith({
      mode: 'payment',
      amount: 4200,
      currency: 'usd',
      paymentMethodOptions: {
        us_bank_account: { verification_method: 'instant' },
        card: { capture_method: 'manual' },
      },
    });
    expect(block.stripeInstance.elements.mock.calls[0][0].captureMethod).toBeUndefined();
  });

  test.each([
    ['JPY', 4200, 4200],
    ['KWD', 42, 42000],
  ])('uses Stripe minor units for %s', async (currency, value, amount) => {
    const block = loadStripeExpressCheckoutBlock();

    await renderAndMount(block, {
      cart: cartPayload({
        total: { includingTax: { value, currency } },
      }),
    });

    expect(block.stripeInstance.elements).toHaveBeenCalledWith(
      expect.objectContaining({ amount, currency: currency.toLowerCase() }),
    );
  });

  test('does not pass a stale top-level Elements captureMethod', async () => {
    const block = loadStripeExpressCheckoutBlock({
      initParams: initParamsPayload({
        elementsOptions: {
          captureMethod: 'manual',
          paymentMethodOptions: {
            us_bank_account: { verification_method: 'instant' },
            card: { capture_method: 'manual' },
          },
        },
      }),
    });

    await renderAndMount(block);

    expect(block.stripeInstance.elements.mock.calls[0][0].captureMethod).toBeUndefined();
    expect(
      block.stripeInstance.elements.mock.calls[0][0].paymentMethodOptions.card,
    ).toEqual({ capture_method: 'manual' });
  });

  test('collects shipping in the wallet when the cart is missing address or method', async () => {
    const block = loadStripeExpressCheckoutBlock();

    await renderAndMount(block, { checkout: incompleteCheckoutPayload() });

    expect(block.elements.create).toHaveBeenCalledWith(
      'expressCheckout',
      expect.objectContaining({
        billingAddressRequired: true,
        emailRequired: true,
        phoneNumberRequired: true,
        shippingAddressRequired: true,
      }),
    );
  });

  test('persists a complete wallet address and resolves Commerce rates', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block, { checkout: incompleteCheckoutPayload() });
    block.mocks.cartApi.refreshCart.mockResolvedValue(cartPayload({
      total: { includingTax: { value: 47, currency: 'USD' } },
    }));
    block.mocks.checkoutApi.setShippingAddress.mockResolvedValue({
      shippingAddress: {
        ...commerceAddress(),
        availableShippingMethods: [shippingMethod()],
      },
    });

    const event = {
      name: 'Ada Lovelace',
      address: walletAddress().address,
      phone: '020 7946 0000',
      resolve: jest.fn(),
      reject: jest.fn(),
    };
    await getHandler(block, 'shippingaddresschange')(event);

    expect(block.mocks.checkoutApi.setShippingAddress).toHaveBeenCalledWith({
      address: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        street: ['1 Algorithm Way'],
        city: 'London',
        countryCode: 'GB',
        postcode: 'SW1A 1AA',
        telephone: '020 7946 0000',
      },
    });
    expect(block.mocks.checkoutApi.estimateShippingMethods).not.toHaveBeenCalled();
    expect(block.mocks.checkoutApi.setShippingMethods).toHaveBeenCalledWith([
      { carrierCode: 'flatrate', methodCode: 'flatrate' },
    ]);
    expect(block.elements.update).toHaveBeenCalledWith({ amount: 4700 });
    expect(event.resolve).toHaveBeenCalledWith({
      shippingRates: [
        {
          id: 'flatrate:flatrate',
          displayName: 'Flat Rate - Fixed',
          amount: 500,
        },
      ],
    });
    expect(event.reject).not.toHaveBeenCalled();
  });

  test('estimates rates for a redacted address without persisting it', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block, { checkout: incompleteCheckoutPayload() });

    const event = {
      name: '',
      address: { country: 'GB', postal_code: 'SW1A' },
      resolve: jest.fn(),
      reject: jest.fn(),
    };
    await getHandler(block, 'shippingaddresschange')(event);

    expect(block.mocks.checkoutApi.setShippingAddress).not.toHaveBeenCalled();
    expect(block.mocks.checkoutApi.estimateShippingMethods).toHaveBeenCalledWith(
      {
        criteria: {
          country_code: 'GB',
          zip: 'SW1A',
        },
      },
    );
    expect(event.resolve).toHaveBeenCalledWith({
      shippingRates: [
        {
          id: 'flatrate:flatrate',
          displayName: 'Flat Rate - Fixed',
          amount: 500,
        },
      ],
    });
  });

  test('persists the shipping method on shippingratechange when an address is on the cart', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block, { checkout: incompleteCheckoutPayload() });
    block.mocks.checkoutApi.setShippingAddress.mockResolvedValue({
      shippingAddress: {
        ...commerceAddress(),
        availableShippingMethods: [shippingMethod()],
      },
    });
    await getHandler(block, 'shippingaddresschange')({
      name: 'Ada Lovelace',
      address: walletAddress().address,
      phone: '020 7946 0000',
      resolve: jest.fn(),
      reject: jest.fn(),
    });
    block.mocks.checkoutApi.setShippingMethods.mockClear();
    block.mocks.cartApi.refreshCart.mockClear();

    const event = {
      shippingRate: { id: 'flatrate:flatrate', amount: 500 },
      resolve: jest.fn(),
      reject: jest.fn(),
    };
    await getHandler(block, 'shippingratechange')(event);

    expect(block.mocks.checkoutApi.setShippingMethods).toHaveBeenCalledWith([
      { carrierCode: 'flatrate', methodCode: 'flatrate' },
    ]);
    expect(block.mocks.cartApi.refreshCart).toHaveBeenCalled();
    expect(event.resolve).toHaveBeenCalled();
    expect(event.reject).not.toHaveBeenCalled();
  });

  test('previews a shipping rate without persisting it when the wallet address is still redacted', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block, { checkout: incompleteCheckoutPayload() });
    await getHandler(block, 'shippingaddresschange')({
      name: '',
      address: { country: 'GB', postal_code: 'SW1A' },
      resolve: jest.fn(),
      reject: jest.fn(),
    });

    const event = {
      shippingRate: { id: 'flatrate:flatrate', amount: 500 },
      resolve: jest.fn(),
      reject: jest.fn(),
    };
    await getHandler(block, 'shippingratechange')(event);

    expect(block.mocks.checkoutApi.setShippingMethods).not.toHaveBeenCalled();
    expect(block.elements.update).toHaveBeenCalledWith({ amount: 4700 });
    expect(event.resolve).toHaveBeenCalled();
  });

  test('confirms a guest cart with a Confirmation Token then places the order', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block, { checkout: incompleteCheckoutPayload() });
    block.mocks.checkoutApi.getCart.mockResolvedValue(checkoutPayload());
    block.mocks.cartApi.refreshCart.mockResolvedValue(cartPayload());

    const event = createConfirmEvent();
    await getHandler(block, 'confirm')(event);

    expect(block.stripeInstance.createPaymentMethod).not.toHaveBeenCalled();
    expect(block.mocks.checkoutApi.setGuestEmailOnCart).toHaveBeenCalledWith(
      'customer@example.com',
    );
    expect(block.elements.submit).toHaveBeenCalledTimes(1);
    expect(block.stripeInstance.createConfirmationToken).toHaveBeenCalledWith({
      elements: block.elements,
      params: {
        payment_method_data: {
          billing_details: {
            name: 'Ada Lovelace',
            email: 'customer@example.com',
            phone: '020 7946 0000',
            address: walletAddress().address,
          },
        },
        shipping: {
          name: 'Ada Lovelace',
          phone: '020 7946 0000',
          address: walletAddress().address,
        },
      },
    });
    expect(block.fetch).toHaveBeenCalledWith(
      'https://commerce-config.example/payment-intent',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Store: 'de_store',
        },
        body: JSON.stringify({
          cartId: 'cart_123',
          cartFullName: 'Ada Lovelace',
          confirmationTokenId: 'ctoken_123',
          storeCode: 'de_store',
        }),
      }),
    );
    expect(block.mocks.checkoutApi.setPaymentMethod).toHaveBeenCalledWith({
      code: 'oope_stripe',
      additional_data: [{ key: 'client_secret', value: 'pi_123_secret_abc' }],
    });
    expect(block.mocks.checkoutApi.setPaymentMethod).toHaveBeenCalledTimes(2);
    expect(block.stripeInstance.confirmPayment).toHaveBeenCalledWith({
      clientSecret: 'pi_123_secret_abc',
      confirmParams: {
        confirmation_token: 'ctoken_123',
        return_url: 'https://runtime.example/payment-return?cart_id=cart_123',
      },
      redirect: 'if_required',
    });
    expect(block.mocks.orderApi.placeOrder).toHaveBeenCalledWith('cart_123');
    expect(
      block.events.lastPayload('checkout/values').selectedPaymentMethod.code,
    ).toBe('oope_stripe');
    expect(event.paymentFailed).not.toHaveBeenCalled();
    const status = block.document.querySelector(
      '.stripe-express-checkout-status',
    );
    expect(status.children[0].textContent).toContain('Payment successful');
    expect(status.children[0].textContent).toContain('order has been placed');
    await expect(block.exports.handleStripePayment('cart_123')).resolves.toBe(
      true,
    );
  });

  test('does not replace an existing shipping address with wallet billing details', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block);

    await getHandler(block, 'confirm')(
      createConfirmEvent({ shippingAddress: null, shippingRate: null }),
    );

    expect(block.mocks.checkoutApi.setShippingAddress).not.toHaveBeenCalled();
    expect(block.mocks.checkoutApi.setShippingMethods).not.toHaveBeenCalled();
    expect(block.mocks.orderApi.placeOrder).toHaveBeenCalledWith('cart_123');
  });

  test('does not place an order when Commerce keeps a fallback payment method', async () => {
    const block = loadStripeExpressCheckoutBlock();
    block.mocks.checkoutApi.setPaymentMethod.mockResolvedValue({
      selectedPaymentMethod: {
        code: 'checkmo',
        title: 'Check / Money order',
      },
    });
    await renderAndMount(block);

    const event = createConfirmEvent();
    await getHandler(block, 'confirm')(event);

    expect(block.mocks.orderApi.placeOrder).not.toHaveBeenCalled();
    expect(event.paymentFailed).toHaveBeenCalledWith({ reason: 'fail' });
  });

  test('forwards the customer bearer token for a registered cart', async () => {
    const block = loadStripeExpressCheckoutBlock();
    block.document.cookie = 'auth_dropin_user_token=customer-token-123';
    await renderAndMount(block, {
      cart: cartPayload({ isGuestCart: false }),
      checkout: checkoutPayload({ isGuest: false }),
    });

    await getHandler(block, 'confirm')(createConfirmEvent());

    expect(block.mocks.checkoutApi.setGuestEmailOnCart).not.toHaveBeenCalled();
    expect(block.fetch).toHaveBeenCalledWith(
      'https://commerce-config.example/payment-intent',
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer customer-token-123',
          Store: 'de_store',
        },
        body: JSON.stringify({
          cartId: 'cart_123',
          cartFullName: 'Ada Lovelace',
          confirmationTokenId: 'ctoken_123',
          storeCode: 'de_store',
        }),
      }),
    );
  });

  test('does not start payment when checkout validation fails', async () => {
    const block = loadStripeExpressCheckoutBlock();
    const handleValidation = jest.fn().mockReturnValue(false);
    await renderAndMount(block, { handleValidation });

    const event = createConfirmEvent();
    await getHandler(block, 'confirm')(event);

    expect(handleValidation).toHaveBeenCalledTimes(1);
    expect(block.fetch).not.toHaveBeenCalledWith(
      'https://commerce-config.example/payment-intent',
      expect.anything(),
    );
    expect(block.mocks.orderApi.placeOrder).not.toHaveBeenCalled();
    expect(event.paymentFailed).toHaveBeenCalledWith({ reason: 'fail' });
  });

  test('blocks Place Order until Express Checkout has confirmed the cart', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block);

    expect(block.exports.validateStripePayment()).toBe(false);
    await expect(block.exports.handleStripePayment('cart_123')).resolves.toBe(
      false,
    );
    expect(block.stripeInstance.createConfirmationToken).not.toHaveBeenCalled();
    expect(block.mocks.orderApi.placeOrder).not.toHaveBeenCalled();
  });

  test('logs loaderror, hides ECE, and shows a customer-facing error', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block);

    await getHandler(block, 'loaderror')({ error: new Error('wallet failed') });

    expect(console.warn).toHaveBeenCalledWith(
      'Stripe Express Checkout Element failed to load.',
      expect.any(Error),
    );
    const mountEl = block.document.querySelector(
      '#stripe-express-checkout-element',
    );
    expect(mountEl.hidden).toBe(true);
    expect(mountEl.className).toContain('stripe-express-checkout-hidden');
    expect(mountEl.children).toHaveLength(0);
    expect(block.document.querySelector('.stripe-express-checkout').hidden)
      .toBe(false);
    const status = block.document.querySelector(
      '.stripe-express-checkout-status',
    );
    expect(status.children[0].textContent).toContain('Payment failed');
    expect(status.children[0].textContent).toContain(
      'Please use the card payment form below',
    );
  });

  test('hides the complete Express section when no wallet is available', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block);

    getHandler(block, 'ready')({ availablePaymentMethods: null });

    expect(block.document.querySelector('.stripe-express-checkout').hidden)
      .toBe(true);
  });

  test('blocks checkout on wallet click and unblocks on cancel and escape', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block);
    const clickEvent = { resolve: jest.fn() };

    getHandler(block, 'click')(clickEvent);

    expect(block.checkoutRoot.className).toContain(
      'stripe-express-checkout-blocked',
    );
    expect(block.checkoutRoot.attributes['aria-busy']).toBe('true');
    expect(clickEvent.resolve).toHaveBeenCalledWith({
      shippingRates: [
        {
          id: 'flatrate:flatrate',
          displayName: 'Flat Rate - Fixed',
          amount: 500,
        },
      ],
    });

    getHandler(block, 'cancel')();
    expect(block.checkoutRoot.className).not.toContain(
      'stripe-express-checkout-blocked',
    );
    expect(block.checkoutRoot.attributes['aria-busy']).toBeUndefined();

    getHandler(block, 'click')(clickEvent);
    getHandler(block, 'escape')();
    expect(block.checkoutRoot.className).not.toContain(
      'stripe-express-checkout-blocked',
    );
  });

  test('includes selected shipping when the cart total is still the item subtotal', async () => {
    const block = loadStripeExpressCheckoutBlock();
    const euroShipping = {
      ...shippingMethod(),
      amount: { value: 5, currency: 'EUR' },
    };
    await renderAndMount(block, {
      cart: cartPayload({
        total: { includingTax: { value: 39.01, currency: 'EUR' } },
        subtotal: { includingTax: { value: 39.01, currency: 'EUR' } },
      }),
      checkout: checkoutPayload({
        shippingAddress: {
          ...commerceAddress(),
          selectedShippingMethod: euroShipping,
          availableShippingMethods: [euroShipping],
        },
      }),
    });
    const clickEvent = { resolve: jest.fn() };

    getHandler(block, 'click')(clickEvent);

    expect(block.stripeInstance.elements).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4401, currency: 'eur' }),
    );
    expect(clickEvent.resolve).toHaveBeenCalledWith({
      shippingRates: [
        {
          id: 'flatrate:flatrate',
          displayName: 'Flat Rate - Fixed',
          amount: 500,
        },
      ],
    });
    expect(block.elements.update).not.toHaveBeenCalled();

    await block.events.emit('cart/updated', cartPayload({
      total: { includingTax: { value: 39.01, currency: 'EUR' } },
      subtotal: { includingTax: { value: 39.01, currency: 'EUR' } },
    }));

    expect(block.elements.update).not.toHaveBeenCalledWith({ amount: 3901 });
  });

  test('resolves wallet click immediately with default shipping in the amount', async () => {
    const block = loadStripeExpressCheckoutBlock();
    const checkout = checkoutPayload({
      shippingAddress: {
        ...commerceAddress(),
        selectedShippingMethod: null,
        availableShippingMethods: [shippingMethod()],
      },
    });
    await renderAndMount(block, { checkout });
    const clickEvent = { resolve: jest.fn() };

    getHandler(block, 'click')(clickEvent);

    expect(block.stripeInstance.elements).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4700 }),
    );
    expect(clickEvent.resolve).toHaveBeenCalledWith({
      shippingRates: [
        {
          id: 'flatrate:flatrate',
          displayName: 'Flat Rate - Fixed',
          amount: 500,
        },
      ],
    });
    expect(block.elements.update).not.toHaveBeenCalled();
  });

  test('keeps wallet shipping collection after Magento already has address and method', async () => {
    const block = loadStripeExpressCheckoutBlock();
    await renderAndMount(block, { checkout: incompleteCheckoutPayload() });
    expect(block.elements.create).toHaveBeenCalledWith(
      'expressCheckout',
      expect.objectContaining({ shippingAddressRequired: true }),
    );

    await block.events.emit('checkout/updated', checkoutPayload());
    await waitForMount(block, 2);

    expect(block.expressCheckoutElement.destroy).toHaveBeenCalled();
    expect(block.elements.create).toHaveBeenLastCalledWith(
      'expressCheckout',
      expect.objectContaining({
        shippingAddressRequired: true,
        shippingRates: [
          {
            id: 'flatrate:flatrate',
            displayName: 'Flat Rate - Fixed',
            amount: 500,
          },
        ],
      }),
    );
  });
});
