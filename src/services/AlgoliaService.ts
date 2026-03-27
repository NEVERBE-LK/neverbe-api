import { algoliasearch } from "algoliasearch";
import stringify from "json-stable-stringify";

let clientInstance: any = null;
const getClient = () => {
  if (!clientInstance) {
    const appId = process.env.ALGOLIA_APP_ID || "";
    const searchKey = process.env.ALGOLIA_SEARCH_API_KEY || "";
    clientInstance = algoliasearch(appId, searchKey);
  }
  return clientInstance;
};

// --- In-Memory Cache for Algolia ---
interface CacheEntry {
  data: any;
  expiry: number;
}
const SEARCH_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL
const MAX_CACHE_SIZE = 100; // Limit memory usage

const getCachedResult = (key: string) => {
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return entry.data;
};

const setCachedResult = (key: string, data: any) => {
  // Evict oldest if cache is full
  if (SEARCH_CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = SEARCH_CACHE.keys().next().value;
    if (firstKey) SEARCH_CACHE.delete(firstKey);
  }
  SEARCH_CACHE.set(key, {
    data,
    expiry: Date.now() + CACHE_TTL,
  });
};

export const searchProducts = async (
  query: string = "",
  params: {
    page?: number;
    hitsPerPage?: number;
    filters?: string;
  } = {},
) => {
  const cacheKey = `products_index:${query}:${stringify(params)}`;
  const cached = getCachedResult(cacheKey);
  
  if (cached) {
    console.log(`[Algolia Cache] HIT for query: "${query}"`);
    return cached;
  }

  console.log(`[Algolia Cache] MISS for query: "${query}" (Fetching...)`);
  
  const { page = 0, hitsPerPage = 20, filters = "" } = params;

  const result = await getClient().searchSingleIndex({
    indexName: "products_index",
    searchParams: {
      query,
      page,
      hitsPerPage,
      filters,
    },
  });

  const finalResult = {
    hits: result.hits,
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
  };

  setCachedResult(cacheKey, finalResult);
  return finalResult;
};

export const searchOrders = async (
  query: string = "",
  params: {
    page?: number;
    hitsPerPage?: number;
    filters?: string;
  } = {},
) => {
  const { page = 0, hitsPerPage = 20, filters = "" } = params;

  const result = await getClient().searchSingleIndex({
    indexName: "orders_index",
    searchParams: {
      query,
      page,
      hitsPerPage,
      filters,
    },
  });

  return {
    hits: result.hits,
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
  };
};

export const searchStockInventory = async (
  query: string = "",
  params: {
    page?: number;
    hitsPerPage?: number;
    filters?: string;
  } = {},
) => {
  const { page = 0, hitsPerPage = 20, filters = "" } = params;

  const result = await getClient().searchSingleIndex({
    indexName: "stock_inventory_index",
    searchParams: {
      query,
      page,
      hitsPerPage,
      filters,
    },
  });

  return {
    hits: result.hits,
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
  };
};

export const searchAdjustments = async (
  query: string = "",
  params: {
    page?: number;
    hitsPerPage?: number;
    filters?: string;
  } = {},
) => {
  const { page = 0, hitsPerPage = 20, filters = "" } = params;

  const result = await getClient().searchSingleIndex({
    indexName: "adjustments_index",
    searchParams: {
      query,
      page,
      hitsPerPage,
      filters,
    },
  });

  return {
    hits: result.hits,
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
  };
};

export const searchPromotions = async (
  query: string = "",
  params: {
    page?: number;
    hitsPerPage?: number;
    filters?: string;
  } = {},
) => {
  const { page = 0, hitsPerPage = 20, filters = "" } = params;

  const result = await getClient().searchSingleIndex({
    indexName: "promotions_index",
    searchParams: {
      query,
      page,
      hitsPerPage,
      filters,
    },
  });

  return {
    hits: result.hits,
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
  };
};

export const searchCoupons = async (
  query: string = "",
  params: {
    page?: number;
    hitsPerPage?: number;
    filters?: string;
  } = {},
) => {
  const { page = 0, hitsPerPage = 20, filters = "" } = params;

  const result = await getClient().searchSingleIndex({
    indexName: "coupons_index",
    searchParams: {
      query,
      page,
      hitsPerPage,
      filters,
    },
  });

  return {
    hits: result.hits,
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
  };
};
