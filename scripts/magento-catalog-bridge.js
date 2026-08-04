import { FetchGraphQL } from '@dropins/tools/fetch-graphql.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

const MAGENTO_PRODUCT_SEARCH = `query MagentoProductSearch(
  $search: String!
  $pageSize: Int!
  $currentPage: Int!
  $filter: ProductAttributeFilterInput
  $sort: ProductAttributeSortInput
) {
  products(
    search: $search
    pageSize: $pageSize
    currentPage: $currentPage
    filter: $filter
    sort: $sort
  ) {
    total_count
    page_info {
      current_page
      page_size
      total_pages
    }
    items {
      __typename
      sku
      name
      url_key
      stock_status
      small_image {
        url
        label
      }
      image {
        url
        label
      }
      price_range {
        minimum_price {
          regular_price {
            value
            currency
          }
          final_price {
            value
            currency
          }
        }
        maximum_price {
          regular_price {
            value
            currency
          }
          final_price {
            value
            currency
          }
        }
      }
    }
  }
}`;

const MAGENTO_PRODUCT_BY_SKU = `query MagentoProductBySku($skus: [String]) {
  products(filter: { sku: { in: $skus } }) {
    items {
      __typename
      sku
      name
      url_key
      stock_status
      description {
        html
      }
      short_description {
        html
      }
      small_image {
        url
        label
      }
      image {
        url
        label
      }
      media_gallery {
        url
        label
      }
      price_range {
        minimum_price {
          regular_price {
            value
            currency
          }
          final_price {
            value
            currency
          }
        }
        maximum_price {
          regular_price {
            value
            currency
          }
          final_price {
            value
            currency
          }
        }
      }
      ... on ConfigurableProduct {
        configurable_options {
          attribute_code
          label
          values {
            value_index
            label
            uid
          }
        }
        variants {
          product {
            sku
            name
            stock_status
            small_image {
              url
              label
            }
            image {
              url
              label
            }
            price_range {
              minimum_price {
                regular_price {
                  value
                  currency
                }
                final_price {
                  value
                  currency
                }
              }
            }
          }
          attributes {
            code
            label
            uid
            value_index
          }
        }
      }
    }
  }
}`;

const SKIP_FILTER_ATTRIBUTES = new Set(['visibility']);

const FILTER_ATTRIBUTE_MAP = {
  categoryPath: 'category_url_path',
  category_path: 'category_url_path',
  sku: 'sku',
  name: 'name',
  price: 'price',
};

/**
 * Detects when commerce-endpoint is Magento core GraphQL (no Catalog Service / Live Search).
 * @returns {boolean}
 */
export function shouldUseMagentoCatalogBridge() {
  const bridgeFlag = getConfigValue('commerce-catalog-bridge');
  if (bridgeFlag === true) return true;
  if (bridgeFlag === false) return false;

  const endpoint = getConfigValue('commerce-endpoint') || '';
  try {
    const { hostname } = new URL(endpoint);
    return !hostname.includes('catalog-service')
      && !hostname.includes('api.commerce.adobe.com');
  } catch {
    return false;
  }
}

function mapSort(sort = []) {
  if (!Array.isArray(sort) || sort.length === 0) {
    return { relevance: 'DESC' };
  }

  const magentoSort = {};
  sort.forEach(({ attribute, direction }) => {
    if (!attribute) return;
    const key = attribute === 'position' || attribute === 'name'
      || attribute === 'price' || attribute === 'relevance'
      ? attribute
      : null;
    if (key) {
      magentoSort[key] = (direction || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    }
  });

  return Object.keys(magentoSort).length ? magentoSort : { relevance: 'DESC' };
}

function mapFilters(filters = []) {
  const magentoFilter = {};

  filters.forEach((filter) => {
    if (!filter?.attribute || SKIP_FILTER_ATTRIBUTES.has(filter.attribute)) return;

    const attribute = FILTER_ATTRIBUTE_MAP[filter.attribute] || filter.attribute;

    if (attribute === 'price' && (filter.from !== undefined || filter.to !== undefined)) {
      magentoFilter.price = {
        ...(filter.from !== undefined && filter.from !== null ? { from: String(filter.from) } : {}),
        ...(filter.to !== undefined && filter.to !== null ? { to: String(filter.to) } : {}),
      };
      return;
    }

    if (filter.eq !== undefined) {
      magentoFilter[attribute] = { eq: String(filter.eq) };
      return;
    }

    if (Array.isArray(filter.in) && filter.in.length) {
      magentoFilter[attribute] = { in: filter.in.map(String) };
    }
  });

  return Object.keys(magentoFilter).length ? magentoFilter : undefined;
}

function money(amount) {
  return {
    amount: {
      value: amount?.value ?? 0,
      currency: amount?.currency || 'USD',
    },
  };
}

function isLocalDevHost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

function getLocalMediaProxyOrigin() {
  if (!isLocalDevHost()) return null;
  // Prefer the same hostname the page uses (localhost vs 127.0.0.1).
  return `http://${window.location.hostname}:3001`;
}

function isMagentoMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    if (!parsed.pathname.startsWith('/media/')) return false;
    // Already on local media proxy
    if (parsed.port === '3001' && isLocalDevHost()) return false;
    return true;
  } catch {
    return url.includes('/media/');
  }
}

/**
 * Magento media is reachable from Node but often times out in the browser.
 * On localhost, route /media/* through the local Magento proxy.
 */
export function rewriteMediaUrl(url) {
  if (!url || typeof url !== 'string') return url;

  let normalized = url;
  if (normalized.startsWith('//')) {
    normalized = `${window.location.protocol}${normalized}`;
  }

  const proxyOrigin = getLocalMediaProxyOrigin();
  if (!proxyOrigin) {
    // Still normalize protocol-relative Magento URLs outside localhost.
    if (url.startsWith('//')) return `${typeof window !== 'undefined' ? window.location.protocol : 'https:'}${url}`;
    return normalized;
  }

  try {
    const parsed = new URL(normalized, proxyOrigin);
    if (!parsed.pathname.startsWith('/media/')) return normalized;
    if (parsed.origin === proxyOrigin) return `${proxyOrigin}${parsed.pathname}`;
    // Drop optimizer query params Magento catalog media ignores.
    return `${proxyOrigin}${parsed.pathname}`;
  } catch {
    return normalized;
  }
}

/**
 * Last-resort rewrite for <img>/<link> tags so Magento media never hits the
 * slow upstream host directly in local browsers.
 */
export function installMagentoMediaUrlInterceptor() {
  if (!isLocalDevHost() || window.__magentoMediaInterceptorInstalled) return;
  window.__magentoMediaInterceptorInstalled = true;

  const patchSrcAccessor = (proto) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'src');
    if (!descriptor?.set || !descriptor?.get) return;
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        descriptor.set.call(this, isMagentoMediaUrl(value) ? rewriteMediaUrl(value) : value);
      },
    });
  };

  patchSrcAccessor(HTMLImageElement.prototype);
  patchSrcAccessor(HTMLLinkElement.prototype);

  // Rewrite any images already in the document (e.g. prerender / cached HTML).
  document.querySelectorAll('img[src*="/media/"], link[rel="preload"][href*="/media/"]').forEach((el) => {
    if (el.tagName === 'IMG' && isMagentoMediaUrl(el.getAttribute('src'))) {
      el.src = rewriteMediaUrl(el.getAttribute('src'));
    }
    if (el.tagName === 'LINK' && isMagentoMediaUrl(el.getAttribute('href'))) {
      el.href = rewriteMediaUrl(el.getAttribute('href'));
    }
  });
}

function normalizeMediaUrl(url) {
  return rewriteMediaUrl(url);
}

function rewriteMediaUrlsInTree(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(rewriteMediaUrlsInTree);
    return;
  }

  Object.keys(node).forEach((key) => {
    const value = node[key];
    if (typeof value === 'string' && value.includes('/media/')) {
      node[key] = rewriteMediaUrl(value);
      return;
    }
    if (value && typeof value === 'object') {
      rewriteMediaUrlsInTree(value);
    }
  });
}

function withMediaProxy(response) {
  if (response?.data) {
    rewriteMediaUrlsInTree(response.data);
  }
  return response;
}

function collectImages(item) {
  const images = [];
  const seen = new Set();

  const pushImage = (url, label, roles) => {
    const normalized = normalizeMediaUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    images.push({
      label: label || item.name || '',
      url: normalized,
      roles,
    });
  };

  (item.media_gallery || []).forEach((media, index) => {
    pushImage(media.url, media.label, index === 0 ? ['image', 'thumbnail'] : ['image']);
  });
  pushImage(item.image?.url, item.image?.label, ['image']);
  pushImage(item.small_image?.url, item.small_image?.label, ['thumbnail', 'small_image']);

  return images;
}

function toConfigurableOptions(item) {
  return (item.configurable_options || []).map((option) => ({
    id: option.attribute_code,
    title: option.label,
    required: true,
    multi: false,
    values: (option.values || []).map((value) => ({
      __typename: 'ProductViewOptionValueSwatch',
      id: value.uid,
      title: value.label,
      inStock: true,
      type: 'TEXT',
      value: value.label,
    })),
  }));
}

function toProductView(item, { detailed = false } = {}) {
  const isComplex = [
    'ConfigurableProduct',
    'GroupedProduct',
    'BundleProduct',
  ].includes(item.__typename);

  const minRegular = item.price_range?.minimum_price?.regular_price;
  const minFinal = item.price_range?.minimum_price?.final_price;
  const maxRegular = item.price_range?.maximum_price?.regular_price;
  const maxFinal = item.price_range?.maximum_price?.final_price;

  const productView = {
    __typename: isComplex ? 'ComplexProductView' : 'SimpleProductView',
    sku: item.sku,
    name: item.name,
    inStock: item.stock_status === 'IN_STOCK',
    url: item.sku ? `/products/default?sku=${encodeURIComponent(item.sku)}` : '',
    urlKey: item.url_key || '',
    attributes: [],
    images: collectImages(item),
    addToCartAllowed: true,
    description: item.description?.html || '',
    shortDescription: item.short_description?.html || '',
  };

  if (isComplex) {
    productView.priceRange = {
      minimum: {
        final: money(minFinal),
        regular: money(minRegular),
        roles: ['visible'],
      },
      maximum: {
        final: money(maxFinal),
        regular: money(maxRegular),
        roles: ['visible'],
      },
    };
    productView.options = detailed ? toConfigurableOptions(item) : [];
  } else {
    productView.price = {
      final: money(minFinal || maxFinal),
      regular: money(minRegular || maxRegular),
      roles: ['visible'],
    };
  }

  return productView;
}

function toCatalogSearchResponse(magentoData, variables) {
  const products = magentoData?.products;
  const pageInfo = products?.page_info || {};
  const pageSize = pageInfo.page_size || variables.pageSize || 12;
  const currentPage = pageInfo.current_page || variables.currentPage || 1;
  const totalCount = products?.total_count || 0;
  const totalPages = pageInfo.total_pages
    || Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    data: {
      attributeMetadata: {
        sortable: [
          { label: 'Relevance', attribute: 'relevance', numeric: false },
          { label: 'Product Name', attribute: 'name', numeric: false },
          { label: 'Price', attribute: 'price', numeric: true },
          { label: 'Position', attribute: 'position', numeric: true },
        ],
        filterableInSearch: [],
      },
      productSearch: {
        total_count: totalCount,
        items: (products?.items || []).map((item) => ({
          productView: toProductView(item),
          highlights: [],
        })),
        facets: [],
        page_info: {
          current_page: currentPage,
          page_size: pageSize,
          total_pages: totalPages,
          total_items: totalCount,
        },
      },
    },
  };
}

async function productSearchViaMagento(originalFetch, instance, variables = {}) {
  const pageSize = variables.pageSize || 12;
  const currentPage = variables.currentPage || 1;
  const magentoVariables = {
    search: variables.phrase ?? '',
    pageSize,
    currentPage,
    filter: mapFilters(variables.filter),
    sort: mapSort(variables.sort),
  };

  const response = await originalFetch.call(instance, MAGENTO_PRODUCT_SEARCH, {
    method: 'POST',
    variables: magentoVariables,
  });

  if (response?.errors?.length && !response?.data?.products) {
    return response;
  }

  return toCatalogSearchResponse(response.data, magentoVariables);
}

function toVariantProductView(variant) {
  const product = variant?.product;
  if (!product) return null;
  const amount = product.price_range?.minimum_price?.final_price
    || product.price_range?.minimum_price?.regular_price;
  const regular = product.price_range?.minimum_price?.regular_price || amount;

  return {
    __typename: 'SimpleProductView',
    sku: product.sku,
    name: product.name,
    inStock: product.stock_status === 'IN_STOCK',
    images: collectImages(product),
    price: {
      final: money(amount),
      regular: money(regular),
      roles: ['visible'],
    },
    selections: (variant.attributes || []).map((attr) => attr.uid),
  };
}

function findMatchingVariant(parent, optionIds = []) {
  const selected = new Set((optionIds || []).filter(Boolean));
  if (!selected.size || !parent?.variants?.length) return null;

  return parent.variants.find((variant) => {
    const uids = (variant.attributes || []).map((attr) => attr.uid);
    return [...selected].every((id) => uids.includes(id));
  }) || null;
}

function applySelectedVariant(productView, parent, optionIds = []) {
  const match = findMatchingVariant(parent, optionIds);
  if (!match?.product) return productView;

  const variantView = toVariantProductView(match);
  return {
    ...productView,
    ...variantView,
    __typename: 'ComplexProductView',
    sku: parent.sku,
    name: parent.name,
    variantSku: match.product.sku,
    variantName: match.product.name,
    options: productView.options,
    optionUIDs: optionIds,
    priceRange: productView.priceRange,
    images: variantView.images?.length ? variantView.images : productView.images,
  };
}

async function fetchMagentoProductsBySku(originalFetch, instance, skus = []) {
  const response = await originalFetch.call(instance, MAGENTO_PRODUCT_BY_SKU, {
    method: 'POST',
    variables: { skus },
  });

  if (response?.errors?.length && !response?.data?.products) {
    return { errorResponse: response, items: [] };
  }

  return {
    errorResponse: null,
    items: response?.data?.products?.items || [],
  };
}

async function productsBySkuViaMagento(originalFetch, instance, variables = {}) {
  const skus = (variables.skus || []).filter(Boolean);
  if (!skus.length && variables.sku) skus.push(variables.sku);

  const { errorResponse, items } = await fetchMagentoProductsBySku(originalFetch, instance, skus);
  if (errorResponse) return errorResponse;

  const bySku = new Map(items.map((item) => [String(item.sku).toLowerCase(), item]));

  // Preserve requested order; Magento `in` filter is unordered.
  const ordered = skus
    .map((sku) => bySku.get(String(sku).toLowerCase()))
    .filter(Boolean)
    .map((item) => toProductView(item, { detailed: true }));

  const result = { data: { products: ordered } };

  // Catalog Service refineProduct: merge selected variant into parent product view.
  if (variables.sku) {
    const parent = bySku.get(String(variables.sku).toLowerCase());
    if (parent) {
      const base = toProductView(parent, { detailed: true });
      result.data.refineProduct = applySelectedVariant(
        base,
        parent,
        variables.optionIds || [],
      );
      if (!result.data.products.length) {
        result.data.products = [base];
      }
    } else {
      result.data.refineProduct = null;
    }
  }

  return result;
}

async function variantsViaMagento(originalFetch, instance, variables = {}) {
  const { sku } = variables;
  if (!sku) {
    return { data: { variants: { variants: [] } } };
  }

  const { errorResponse, items } = await fetchMagentoProductsBySku(originalFetch, instance, [sku]);
  if (errorResponse) return errorResponse;

  const parent = items[0];
  const variants = (parent?.variants || [])
    .map((variant) => {
      const product = toVariantProductView(variant);
      return product ? { product, selections: product.selections } : null;
    })
    .filter(Boolean);

  return {
    data: {
      variants: {
        variants,
      },
    },
  };
}

function isCatalogProductsBySkuQuery(query) {
  return typeof query === 'string'
    && /\bproducts\s*\(\s*skus\s*:/.test(query);
}

function isRefineProductQuery(query) {
  return typeof query === 'string' && /\brefineProduct\s*\(/.test(query);
}

function isVariantsQuery(query) {
  return typeof query === 'string' && /\bvariants\s*\(\s*sku\s*:/.test(query);
}

function isPersonalizationStoreConfigQuery(query) {
  return typeof query === 'string' && query.includes('share_active_segments');
}

/**
 * Adobe Personalization expects StoreConfig fields that PaaS Magento does not expose.
 * Return disabled defaults so the drop-in does not throw.
 */
function personalizationStoreConfigStub() {
  return {
    data: {
      storeConfig: {
        share_active_segments: false,
        graphql_share_customer_group: false,
        share_applied_cart_rule: false,
        customer_access_token_lifetime: 1,
      },
    },
  };
}

/**
 * Auth drop-ins query CustomerGroup.uid (ACCS). PaaS Magento only exposes name.
 * Rewrite the selection set and map name → uid so sign-in can complete.
 */
function rewriteCustomerGroupUidQuery(query) {
  if (typeof query !== 'string' || !/\bgroup\s*\{\s*uid\s*\}/.test(query)) {
    return { query, mapGroupUid: false };
  }
  return {
    query: query.replace(/\bgroup\s*\{\s*uid\s*\}/g, 'group { name }'),
    mapGroupUid: true,
  };
}

/**
 * Newer account drop-ins query CustomerAddress.uid, while older PaaS Magento
 * schemas expose only CustomerAddress.id. Preserve the response shape expected
 * by the drop-in by aliasing id as uid for the affected account operations.
 */
function rewriteCustomerAddressUidQuery(query) {
  if (
    typeof query !== 'string'
    || !/\b(?:GET_CUSTOMER_ADDRESS|CREATE_CUSTOMER_ADDRESS)\b/.test(query)
    || !/\buid\b/.test(query)
  ) {
    return query;
  }

  return query.replace(/\buid\b/g, 'uid: id');
}

function mapCustomerGroupNameToUid(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(mapCustomerGroupNameToUid);
    return;
  }

  if (
    node.group
    && typeof node.group === 'object'
    && node.group.name !== undefined
    && node.group.uid === undefined
  ) {
    node.group.uid = node.group.name || '';
  }

  Object.values(node).forEach(mapCustomerGroupNameToUid);
}

/**
 * ACCS order fragments request fields PaaS Magento CustomerOrder/OrderTotal lack.
 * Strip them from the document, then restore safe defaults on the response.
 */
const UNSUPPORTED_ORDER_SCALARS = ['admin_assisted_order'];
const UNSUPPORTED_ORDER_SELECTIONS = ['grand_total_excl_tax'];

function findFieldSelectionStart(query, fieldName, fromIndex = 0) {
  let searchFrom = fromIndex;

  while (searchFrom < query.length) {
    const idx = query.indexOf(fieldName, searchFrom);
    if (idx === -1) return -1;

    const before = idx === 0 ? '' : query[idx - 1];
    const afterPos = idx + fieldName.length;
    const after = query[afterPos] || '';
    const isBoundaryBefore = idx === 0 || !/\w/.test(before);
    const isBoundaryAfter = !/\w/.test(after);

    if (isBoundaryBefore && isBoundaryAfter) {
      // Allow whitespace between the field name and "{"
      let cursor = afterPos;
      while (cursor < query.length && /\s/.test(query[cursor])) cursor += 1;
      if (query[cursor] === '{') return idx;
    }

    searchFrom = idx + fieldName.length;
  }

  return -1;
}

function stripSelectionSet(query, fieldName) {
  let result = query;
  let fieldStart = findFieldSelectionStart(result, fieldName);

  while (fieldStart !== -1) {
    let braceStart = fieldStart + fieldName.length;
    while (braceStart < result.length && result[braceStart] !== '{') braceStart += 1;

    let depth = 0;
    let end = braceStart;
    for (; end < result.length; end += 1) {
      if (result[end] === '{') depth += 1;
      else if (result[end] === '}') {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }

    result = `${result.slice(0, fieldStart)}${result.slice(end)}`;
    fieldStart = findFieldSelectionStart(result, fieldName);
  }

  return result;
}

function stripScalarField(query, fieldName) {
  let result = query;
  let idx = result.indexOf(fieldName);

  while (idx !== -1) {
    const before = idx === 0 ? '' : result[idx - 1];
    const afterPos = idx + fieldName.length;
    const after = result[afterPos] || '';
    const isBoundaryBefore = idx === 0 || !/\w/.test(before);
    const isBoundaryAfter = !/\w/.test(after);

    if (isBoundaryBefore && isBoundaryAfter) {
      let end = afterPos;
      while (end < result.length && /\s/.test(result[end])) end += 1;
      result = `${result.slice(0, idx)}${result.slice(end)}`;
      idx = result.indexOf(fieldName, idx);
    } else {
      idx = result.indexOf(fieldName, afterPos);
    }
  }

  return result;
}

function stripUnsupportedOrderFields(query) {
  if (typeof query !== 'string') {
    return { query, patched: false };
  }

  const needsPatch = UNSUPPORTED_ORDER_SCALARS.some((field) => query.includes(field))
    || UNSUPPORTED_ORDER_SELECTIONS.some((field) => query.includes(field));

  if (!needsPatch) {
    return { query, patched: false };
  }

  let nextQuery = query;
  UNSUPPORTED_ORDER_SCALARS.forEach((field) => {
    nextQuery = stripScalarField(nextQuery, field);
  });
  UNSUPPORTED_ORDER_SELECTIONS.forEach((field) => {
    nextQuery = stripSelectionSet(nextQuery, field);
  });

  return { query: nextQuery, patched: true };
}

function fillUnsupportedOrderFields(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(fillUnsupportedOrderFields);
    return;
  }

  // CustomerOrder-shaped objects
  if (
    Object.prototype.hasOwnProperty.call(node, 'is_virtual')
    && Object.prototype.hasOwnProperty.call(node, 'status')
    && node.admin_assisted_order === undefined
  ) {
    node.admin_assisted_order = false;
  }

  // OrderTotal-shaped objects
  if (
    node.grand_total
    && node.grand_total_excl_tax === undefined
    && (node.subtotal_excl_tax || node.total_tax || node.grand_total)
  ) {
    node.grand_total_excl_tax = node.grand_total;
  }

  Object.values(node).forEach(fillUnsupportedOrderFields);
}

/**
 * Magento can round selected_shipping_method.amount while leaving the matching
 * available_shipping_methods amount unrounded. The checkout drop-in includes
 * amount in its equality check, so that mismatch causes it to submit the same
 * shipping method after every checkout update.
 */
function normalizeSelectedShippingMethodAmount(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(normalizeSelectedShippingMethodAmount);
    return;
  }

  const availableMethods = node.available_shipping_methods;
  const selectedMethod = node.selected_shipping_method;
  if (Array.isArray(availableMethods) && selectedMethod) {
    const matchingMethod = availableMethods.find((method) => (
      method.carrier_code === selectedMethod.carrier_code
      && method.method_code === selectedMethod.method_code
    ));

    if (matchingMethod?.amount && selectedMethod.amount) {
      selectedMethod.amount.value = matchingMethod.amount.value;
    }
  }

  Object.values(node).forEach(normalizeSelectedShippingMethodAmount);
}

async function fetchWithMagentoCompat(originalFetch, instance, query, options) {
  const addressCompatibleQuery = rewriteCustomerAddressUidQuery(query);
  const groupRewrite = rewriteCustomerGroupUidQuery(addressCompatibleQuery);
  const orderRewrite = stripUnsupportedOrderFields(groupRewrite.query);
  const response = await originalFetch.call(instance, orderRewrite.query, options);

  if (response?.data) {
    normalizeSelectedShippingMethodAmount(response.data);
    if (groupRewrite.mapGroupUid) {
      mapCustomerGroupNameToUid(response.data);
    }
    if (orderRewrite.patched) {
      fillUnsupportedOrderFields(response.data);
    }
  }

  return withMediaProxy(response);
}

/**
 * Routes Catalog Service productSearch/products/variants calls through Magento core GraphQL.
 * Also patches PaaS schema gaps (CustomerGroup.uid, personalization StoreConfig)
 * and rewrites Magento media URLs through the local proxy on localhost.
 */
export function installMagentoCatalogBridge() {
  if (FetchGraphQL.prototype.__magentoCatalogBridgeInstalled) return;

  const originalFetch = FetchGraphQL.prototype.fetchGraphQl;

  FetchGraphQL.prototype.fetchGraphQl = async function magentoCatalogBridgeFetch(query, options) {
    if (typeof query === 'string' && /\bproductSearch\s*\(/.test(query)) {
      return withMediaProxy(
        await productSearchViaMagento(originalFetch, this, options?.variables || {}),
      );
    }
    if (isPersonalizationStoreConfigQuery(query)) {
      return personalizationStoreConfigStub();
    }
    if (isVariantsQuery(query)) {
      return withMediaProxy(
        await variantsViaMagento(originalFetch, this, options?.variables || {}),
      );
    }
    if (isCatalogProductsBySkuQuery(query) || isRefineProductQuery(query)) {
      return withMediaProxy(
        await productsBySkuViaMagento(originalFetch, this, options?.variables || {}),
      );
    }
    return fetchWithMagentoCompat(originalFetch, this, query, options);
  };

  FetchGraphQL.prototype.__magentoCatalogBridgeInstalled = true;
}
