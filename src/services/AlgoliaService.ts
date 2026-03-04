import { algoliasearch } from "algoliasearch";

let clientInstance: any = null;
const getClient = () => {
  if (!clientInstance) {
    const appId = process.env.ALGOLIA_APP_ID || "";
    const searchKey = process.env.ALGOLIA_SEARCH_API_KEY || "";
    clientInstance = algoliasearch(appId, searchKey);
  }
  return clientInstance;
};

export const searchProducts = async (
  query: string = "",
  params: {
    page?: number;
    hitsPerPage?: number;
    filters?: string;
  } = {},
) => {
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

  return {
    hits: result.hits,
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
  };
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
