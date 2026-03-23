import { BaseRepository } from "./BaseRepository";
import type { Query } from "firebase-admin/firestore";
import type { Product, ProductVariant } from "@/interfaces";
import { FirestoreQueryBuilder } from "./utils/FirestoreQueryBuilder";
import { ProductFilterBuilder } from "./filters/ProductFilterBuilder";

/**
 * Query options for product fetching
 */
export interface ProductQueryOptions {
  tags?: string[];
  inStock?: boolean;
  page?: number;
  size?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}

/**
 * Extended filter options for post-fetch filtering
 */
export interface ProductFilterOptions extends ProductQueryOptions {
  sizes?: string[];
  gender?: string;
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  total: number;
  dataList: T[];
}

/**
 * Product Repository - handles all product data access
 */
export class ProductRepository extends BaseRepository<Product> {
  constructor() {
    super("products");
  }

  /**
   * Get active products query with listing filter
   */
  private getListedProductsQuery(): Query {
    return this.getActiveQuery().where("listing", "==", true);
  }

  /**
   * Filter active, non-deleted variants
   */
  private filterActiveVariants(
    variants: ProductVariant[] = []
  ): ProductVariant[] {
    return variants.filter((v) => v.status === true && v.isDeleted !== true);
  }

  /**
   * Strip buying price from product (security)
   */
  private sanitizeProduct<T extends { buyingPrice?: number }>(
    product: T
  ): Omit<T, "buyingPrice"> {
    const { buyingPrice, ...rest } = product;
    return rest;
  }

  /**
   * Prepare product for client response
   */
  private prepareProduct(data: Product): Omit<Product, "buyingPrice"> {
    return this.sanitizeProduct({
      ...data,
      variants: this.filterActiveVariants(data.variants),
      createdAt: null,
      updatedAt: null,
    });
  }

  // --- Helpers for In-Memory Filtering ---

  private filterByGender(products: Product[], gender: string): Product[] {
    if (!gender) return products;
    return products.filter((product) =>
      (product.gender || []).some(
        (g: string) => g.toLowerCase() === gender.toLowerCase()
      )
    );
  }

  private filterBySizes(products: Product[], sizes: string[]): Product[] {
    if (!sizes || sizes.length === 0) return products;
    return products.filter((product) => {
      const productSizes = new Set<string>();
      (product.variants || []).forEach((v: ProductVariant) => {
        (v.sizes || []).forEach((s: string) => productSizes.add(s));
      });
      return sizes.some((s) => productSizes.has(s));
    });
  }

  /**
   * Find all products with optional filters and pagination
   * Optimized using QueryBuilders
   */
  async findAll(
    options: ProductQueryOptions = {}
  ): Promise<PaginatedResult<Product>> {
    const { page = 1, size = 20 } = options;
    const builder = new FirestoreQueryBuilder(this.getListedProductsQuery());

    // Apply basic filters using Filter Builder logic (reusing basic parts)
    const filterBuilder = new ProductFilterBuilder(builder, options);
    filterBuilder.applyOptimizedFilters();

    const query = builder.build();
    const total = await this.countDocuments(query);

    builder.paginate(page, size);

    // Execute
    const snapshot = await builder.build().get();
    const dataList = snapshot.docs
      .map((doc) => this.prepareProduct(doc.data() as Product))
      .filter((p) => (p.variants?.length ?? 0) > 0);

    return { total, dataList };
  }

  /**
   * Find products with in-memory filtering for sizes and gender
   * Optimized to offload filtering to Firestore where possible
   */
  async findAllFiltered(
    options: ProductFilterOptions = {}
  ): Promise<PaginatedResult<Product>> {
    const { page = 1, size = 20 } = options;

    const builder = new FirestoreQueryBuilder(this.getListedProductsQuery());
    const filterBuilder = new ProductFilterBuilder(builder, options);

    // 1. Apply DB Filters
    filterBuilder.applyOptimizedFilters();

    // 2. Count Total
    const query = builder.build();
    const total = await this.countDocuments(query);

    // 3. Paginate & Fetch
    builder.paginate(page, size);
    const snapshot = await builder.build().get();

    let dataList = snapshot.docs
      .map((doc) => this.prepareProduct(doc.data() as Product))
      .filter((p) => (p.variants?.length ?? 0) > 0);

    // 4. Post-Fetch In-Memory Filtering
    if (filterBuilder.needsGenderPostFilter()) {
      dataList = this.filterByGender(dataList, options.gender!);
    }

    if (filterBuilder.needsSizePostFilter()) {
      dataList = this.filterBySizes(dataList, options.sizes!);
    }

    return { total, dataList };
  }

  /**
   * Find single product by ID
   */
  async findById(id: string): Promise<Product | null> {
    const builder = new FirestoreQueryBuilder(this.getListedProductsQuery())
      .where("id", "==", id)
      .limit(1);

    const snapshot = await builder.build().get();

    if (snapshot.empty) return null;
    return this.prepareProduct(snapshot.docs[0].data() as Product);
  }

  /**
   * Find multiple products by IDs
   */
  async findByIds(ids: string[]): Promise<Product[]> {
    if (!ids.length) return [];
    const docs = await this.findDocsByIds(ids, "id");
    return docs
      .map((doc) => this.prepareProduct(doc.data() as Product))
      .filter((p) => p.variants?.length > 0);
  }

  /**
   * Find new arrivals
   */
  async findNewArrivals(
    options: ProductQueryOptions = {}
  ): Promise<PaginatedResult<Product>> {
    // Logic: Look for CreatedAt > 90 days ago (3 months)
    const { page = 1, size = 20 } = options;
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const dateThreshold = ninetyDaysAgo.toISOString();

    let builder = new FirestoreQueryBuilder(this.getListedProductsQuery())
      .where("createdAt", ">=", dateThreshold)
      .orderBy("createdAt", "desc");

    // Count
    let total = await this.countDocuments(builder.build());

    // Fallback if no new arrivals
    if (total === 0 && page === 1) {
      // Reset builder to query by UpdatedAt
      builder = new FirestoreQueryBuilder(
        this.getListedProductsQuery()
      ).orderBy("updatedAt", "desc");
      total = await this.countDocuments(builder.build());
    }

    builder.paginate(page, size);
    const snapshot = await builder.build().get();

    const dataList = snapshot.docs
      .map((doc) => this.prepareProduct(doc.data() as Product))
      .filter((p) => (p.variants?.length ?? 0) > 0);

    return { total, dataList };
  }

  /**
   * Find discounted products
   */
  async findDiscounted(
    options: ProductFilterOptions = {}
  ): Promise<PaginatedResult<Product>> {
    const { page = 1, size = 20 } = options;

    const builder = new FirestoreQueryBuilder(this.getListedProductsQuery());
    const filterBuilder = new ProductFilterBuilder(builder, options);

    // 1. Discount filter is mandatory
    filterBuilder.applyDiscountFilter();

    // 2. Apply other optimized filters (Tags/Gender/Stock/Sort)
    filterBuilder.applyOptimizedFilters();

    // 3. Count
    const total = await this.countDocuments(builder.build());

    // 4. Paginate
    builder.paginate(page, size);
    const snapshot = await builder.build().get();

    let dataList = snapshot.docs
      .map((doc) => this.prepareProduct(doc.data() as Product))
      .filter((p) => (p.variants?.length ?? 0) > 0);

    // 5. Post-Fetch Filtering
    if (filterBuilder.needsGenderPostFilter()) {
      dataList = this.filterByGender(dataList, options.gender!);
    }

    if (filterBuilder.needsSizePostFilter()) {
      dataList = this.filterBySizes(dataList, options.sizes!);
    }

    return { total, dataList };
  }

  /**
   * Find similar products by category
   */
  async findSimilar(productId: string, limit: number = 8): Promise<Product[]> {
    const product = await this.findById(productId);
    if (!product) return [];

    const categoryTag = product.category?.toLowerCase();
    const brandTag = product.brand?.toLowerCase();
    const searchTags = [categoryTag, brandTag].filter(Boolean) as string[];

    if (searchTags.length === 0) return [];

    const builder = new FirestoreQueryBuilder(this.getListedProductsQuery())
      .where("tags", "array-contains-any", searchTags)
      .limit(limit + 1);

    const snapshot = await builder.build().get();

    return snapshot.docs
      .filter((doc) => (doc.data() as Product).id !== productId)
      .slice(0, limit)
      .map((doc) => this.prepareProduct(doc.data() as Product));
  }

  /**
   * Find recent items
   */
  async findRecent(limit: number = 8): Promise<Product[]> {
    const builder = new FirestoreQueryBuilder(
      this.getListedProductsQuery()
    ).limit(limit);
    const snapshot = await builder.build().get();

    return snapshot.docs.map((doc) =>
      this.prepareProduct(doc.data() as Product)
    );
  }

  /**
   * Get product stock
   */
  async getStock(
    productId: string,
    variantId: string,
    size: string,
    stockId: string
  ): Promise<number> {
    const builder = new FirestoreQueryBuilder(
      this.collection.firestore.collection("stock_inventory")
    )
      .where("productId", "==", productId)
      .where("variantId", "==", variantId)
      .where("stockId", "==", stockId)
      .where("size", "==", size)
      .limit(1);

    const snapshot = await builder.build().get();

    if (snapshot.empty) return 0;
    return snapshot.docs[0].data().quantity ?? 0;
  }

  /**
   * Find for sitemap
   */
  async findAllForSitemap(): Promise<{ id: string; updatedAt: any }[]> {
    const snapshot = await this.getListedProductsQuery().get();
    return snapshot.docs.map((doc) => ({
      id: doc.data().id,
      updatedAt: doc.data().updatedAt,
    }));
  }
}

// Singleton instance
export const productRepository = new ProductRepository();
