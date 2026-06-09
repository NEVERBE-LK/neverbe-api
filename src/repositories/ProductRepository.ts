import { BaseRepository } from "./BaseRepository";
import type { Query } from "firebase-admin/firestore";
import type { Product, ProductVariant } from "@/interfaces";
import { FirestoreQueryBuilder } from "./utils/FirestoreQueryBuilder";
import { ProductFilterBuilder } from "./filters/ProductFilterBuilder";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Query options for product fetching
 */
export interface ProductQueryOptions {
  tags?: string[];
  brand?: string;
  category?: string;
  inStock?: boolean;
  page?: number;
  size?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  includeSensitiveData?: boolean;
}

/**
 * Extended filter options for post-fetch filtering
 */
export interface ProductFilterOptions extends ProductQueryOptions {
  sizes?: string[];
  gender?: string;
  occasion?: string;
  style?: string;
  includeSensitiveData?: boolean;
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
  private prepareProduct(data: Product, includeSensitiveData: boolean = false): Product | Omit<Product, "buyingPrice"> {
    const variants = this.filterActiveVariants(data.variants);
    const productData = {
      ...data,
      variants,
      createdAt: null,
      updatedAt: null,
    };

    if (includeSensitiveData) return productData;
    return this.sanitizeProduct(productData);
  }

  // --- Helpers for In-Memory Filtering ---

  private filterByGender(products: Product[], gender: string): Product[] {
    if (!gender) return products;
    const lowerGender = gender.toLowerCase();
    return products.filter((product) =>
      (product.tags || []).some(
        (t: string) => t.toLowerCase() === lowerGender
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
      .map((doc) => this.prepareProduct(doc.data() as Product, options.includeSensitiveData))
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
      .map((doc) => this.prepareProduct(doc.data() as Product, options.includeSensitiveData))
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
  async findById(id: string, includeSensitiveData: boolean = false): Promise<Product | null> {
    const builder = new FirestoreQueryBuilder(this.getListedProductsQuery())
      .where("id", "==", id)
      .limit(1);

    const snapshot = await builder.build().get();

    if (snapshot.empty) return null;
    return this.prepareProduct(snapshot.docs[0].data() as Product, includeSensitiveData);
  }

  /**
   * Find multiple products by IDs
   */
  async findByIds(ids: string[], includeSensitiveData: boolean = false): Promise<Product[]> {
    if (!ids.length) return [];
    const docs = await this.findDocsByIds(ids, "id");
    return docs
      .map((doc) => this.prepareProduct(doc.data() as Product, includeSensitiveData))
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

    // 1. Get active promos to find targeted products
    const { promotionRepository } = await import("./PromotionRepository");
    const activePromos = await promotionRepository.findActive();
    const promoProductIds = new Set<string>();
    
    activePromos.forEach(p => {
        if (p.applicableProducts) p.applicableProducts.forEach(id => promoProductIds.add(id));
        if (p.applicableProductVariants) p.applicableProductVariants.forEach(pv => promoProductIds.add(pv.productId));
        if (p.conditions) {
            p.conditions.forEach(c => {
               if (c.type === "SPECIFIC_PRODUCT") {
                   if (c.value) promoProductIds.add(c.value as string);
                   if (c.productIds) c.productIds.forEach(id => promoProductIds.add(id));
               }
            });
        }
    });

    const builder = new FirestoreQueryBuilder(this.getListedProductsQuery());
    const filterBuilder = new ProductFilterBuilder(builder, options);

    // 2. Apply other optimized filters (Tags/Gender/Stock/Sort) - EXCLUDING discount filter
    // We don't call applyDiscountFilter() because we will filter in-memory
    filterBuilder.applyOptimizedFilters();

    // 3. Fetch all matching base filters
    const snapshot = await builder.build().get();

    let allDocs = snapshot.docs
      .map((doc) => this.prepareProduct(doc.data() as Product))
      .filter((p) => (p.variants?.length ?? 0) > 0);

    // 4. In-Memory Filter Deals (discount > 0 OR targeted by promo)
    allDocs = allDocs.filter(p => (p.discount && p.discount > 0) || promoProductIds.has(p.id));

    // 5. Post-Fetch Filtering
    if (filterBuilder.needsGenderPostFilter()) {
      allDocs = this.filterByGender(allDocs, options.gender!);
    }

    if (filterBuilder.needsSizePostFilter()) {
      allDocs = this.filterBySizes(allDocs, options.sizes!);
    }

    // 6. Manual Pagination
    const total = allDocs.length;
    const startIndex = (page - 1) * size;
    const dataList = allDocs.slice(startIndex, startIndex + size);

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
   * Create a new product
   */
  async create(id: string, data: Partial<Product>): Promise<Product> {
    await this.collection.doc(id).set({
      ...data,
      id,
      productId: id,
      isDeleted: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const doc = await this.collection.doc(id).get();
    return doc.data() as Product;
  }

  /**
   * Update an existing product
   */
  async update(id: string, data: Partial<Product>, tx?: FirebaseFirestore.Transaction | FirebaseFirestore.WriteBatch): Promise<void> {
    const docRef = this.collection.doc(id);
    const updateData = {
      ...data,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (tx) {
      (tx as any).update(docRef, updateData);
    } else {
      await docRef.set(updateData, { merge: true });
    }
  }

  /**
   * Get all products for ERP with search and filters
   */
  async findAllPaginated(options: {
    page?: number;
    size?: number;
    search?: string;
    brand?: string;
    category?: string;
    status?: boolean;
    listing?: boolean;
  }): Promise<{ dataList: Product[]; total: number }> {
    const { page = 1, size = 20, search, brand, category, status, listing } = options;
    
    let query: Query = this.getNonDeletedQuery();

    if (brand) query = query.where("brand", "==", brand);
    if (category) query = query.where("category", "==", category);
    if (typeof status === "boolean") query = query.where("status", "==", status);
    if (typeof listing === "boolean") query = query.where("listing", "==", listing);

    // Fetch all products matching database filters sorted by creation date
    const snapshot = await query.orderBy("createdAt", "desc").get();
    let allProducts = snapshot.docs.map((doc) => doc.data() as Product);

    // Apply text search in-memory to support case-insensitive substring contains matching
    if (search) {
      const searchTerms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
      if (searchTerms.length > 0) {
        allProducts = allProducts.filter((product) => {
          const nameLower = (product.name || "").toLowerCase();
          const tagsLower = (product.tags || []).map((t) => t.toLowerCase());
          const brandLower = (product.brand || "").toLowerCase();
          const catLower = (product.category || "").toLowerCase();

          // Match if all search terms are found in name, brand, category, or tags
          return searchTerms.every(
            (term) =>
              nameLower.includes(term) ||
              brandLower.includes(term) ||
              catLower.includes(term) ||
              tagsLower.some((t) => t.includes(term))
          );
        });
      }
    }

    const total = allProducts.length;
    const startIndex = (page - 1) * size;
    const dataList = allProducts.slice(startIndex, startIndex + size);

    let totalStock = 0;
    let activeProducts = 0;
    let totalMarginSum = 0;
    let marginCount = 0;

    allProducts.forEach((p) => {
      totalStock += p.totalStock || 0;
      if (p.status === true) activeProducts++;
      
      const selling = p.sellingPrice || 0;
      const discount = p.discount || 0;
      const buying = p.buyingPrice || 0;
      const finalPrice = selling * (1 - discount / 100);
      if (finalPrice > 0 && buying > 0) {
        const profit = finalPrice - buying;
        const margin = (profit / finalPrice) * 100;
        totalMarginSum += margin;
        marginCount++;
      }
    });

    const avgMargin = marginCount > 0 ? Math.round(totalMarginSum / marginCount) : 0;

    return {
      dataList,
      total,
      stats: {
        totalProducts: total,
        activeProducts,
        totalStock,
        avgMargin,
      },
    };
  }

  /**
   * Get product stock
   */
  async getStock(
    productId: string,
    variantId: string | null,
    size: string,
    stockId: string
  ): Promise<number> {
    // Try as string first (standard)
    let snapshot = await this.collection.firestore
      .collection("stock_inventory")
      .where("productId", "==", productId)
      .where("variantId", "==", variantId)
      .where("stockId", "==", stockId)
      .where("size", "==", size)
      .limit(1)
      .get();

    // If not found and size is numeric, try as number
    if (snapshot.empty && !isNaN(Number(size))) {
      snapshot = await this.collection.firestore
        .collection("stock_inventory")
        .where("productId", "==", productId)
        .where("variantId", "==", variantId)
        .where("stockId", "==", stockId)
        .where("size", "==", Number(size))
        .limit(1)
        .get();
    }

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

  /**
   * Find products with low stock across all variants/sizes
   */
  async findLowStockAlerts(
    threshold: number = 5,
    limit: number = 10
  ): Promise<any[]> {
    const inventoryQuery = this.collection.firestore
      .collection("stock_inventory")
      .where("quantity", "<=", threshold)
      .where("quantity", ">", 0)
      .orderBy("quantity", "asc")
      .limit(limit);

    const snapshot = await inventoryQuery.get();
    if (snapshot.empty) return [];

    const productIds = Array.from(new Set(snapshot.docs.map(doc => doc.data().productId).filter(Boolean)));
    const products = await this.findByIds(productIds as string[]);
    const productMap = new Map(products.map(p => [p.id, p]));

    return snapshot.docs.map(doc => {
      const data = doc.data();
      const product = productMap.get(data.productId);
      return {
        productId: data.productId,
        productName: product?.name || "Unknown Product",
        variantName: data.variantName || "",
        size: data.size || "",
        currentStock: data.quantity || 0,
        thumbnail: product?.thumbnail?.url,
      };
    });
  }

  /**
   * Search active products by name (case-insensitive)
   */
  async searchActive(query: string, limit: number = 100): Promise<Product[]> {
    const q = query.toLowerCase();
    const snapshot = await this.getActiveQuery()
      .where("status", "==", true)
      .where("nameLower", ">=", q)
      .where("nameLower", "<=", q + "\uf8ff")
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
  }

  /**
   * Update variants for a product
   */
  async updateVariants(productId: string, variants: any[]): Promise<void> {
    await this.collection.doc(productId).update({
      variants,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  /**
   * Update total stock in a transaction
   */
  async updateTotalStock(tx: FirebaseFirestore.Transaction, productId: string, diff: number): Promise<void> {
    const ref = this.collection.doc(productId);
    const snap = await tx.get(ref);
    if (snap.exists) {
      const data = snap.data() as Product;
      const newTotal = (data.totalStock ?? 0) - diff;
      (tx as any).update(ref, {
        totalStock: newTotal,
        inStock: newTotal > 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  /**
   * Soft-delete a product
   */
  async delete(id: string): Promise<void> {
    await this.collection.doc(id).update({
      isDeleted: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
}

// Singleton instance
export const productRepository = new ProductRepository();
