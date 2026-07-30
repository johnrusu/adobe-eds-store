import { initializers } from '@dropins/tools/initializer.js';
import { initialize, setEndpoint } from '@dropins/storefront-checkout/api.js';
import { initializeDropin } from './index.js';
import { CORE_FETCH_GRAPHQL, fetchPlaceholders } from '../commerce.js';

const transformPaymentMethod = (method) => {
  if (!method) return method;

  const {
    code,
    title,
    purchase_order_number: purchaseOrderNumber,
    oope_payment_method_config: oopePaymentMethodConfig,
  } = method;

  return {
    code,
    title,
    additionalData: null,
    ...(purchaseOrderNumber ? { purchase_order_number: purchaseOrderNumber } : {}),
    ...(oopePaymentMethodConfig ? { oope_payment_method_config: oopePaymentMethodConfig } : {}),
  };
};

const transformPaymentMethods = (methods) => methods?.map(transformPaymentMethod);

await initializeDropin(async () => {
  // Set Fetch GraphQL (Core)
  setEndpoint(CORE_FETCH_GRAPHQL);

  // Fetch placeholders
  const labels = await fetchPlaceholders('placeholders/checkout.json');
  const langDefinitions = {
    default: {
      ...labels,
    },
  };

  // Initialize checkout
  return initializers.mountImmediately(initialize, {
    langDefinitions,
    models: {
      CartModel: {
        transformer: (data) => ({
          ...data,
          availablePaymentMethods: transformPaymentMethods(data?.available_payment_methods),
          selectedPaymentMethod: transformPaymentMethod(data?.selected_payment_method),
        }),
      },
    },
  });
})();
