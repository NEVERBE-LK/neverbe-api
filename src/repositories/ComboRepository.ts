import { BaseRepository } from "./BaseRepository";
import type { ComboProduct } from "@/interfaces";

/**
 * Combo Repository - handles combo/bundle product data access
 */
export class ComboRepository extends BaseRepository<ComboProduct> {
  constructor() {
    super("combo_products");
  }

  /**
   * Serialize combo for client
   */
  private serializeCombo(data: any): ComboProduct {
    return {
      ...data,
      startDate: this.serializeTimestamp(data.startDate),
      endDate: this.serializeTimestamp(data.endDate),
      createdAt: this.serializeTimestamp(data.createdAt),
      updatedAt: this.serializeTimestamp(data.updatedAt),
    } as ComboProduct;
  }

  /**
   * Find all active combos
   */
  async findActive(): Promise<ComboProduct[]> {
    const now = new Date();
    const snapshot = await this.collection
      .where("isActive", "==", true)
      .where("isDeleted", "!=", true)
      .get();

    return snapshot.docs
      .filter((doc) => {
        const data = doc.data();
        const rawStart = data.startDate;
        const rawEnd = data.endDate;

        const startDate = rawStart
          ? typeof rawStart.toDate === "function"
            ? rawStart.toDate()
            : rawStart instanceof Date
            ? rawStart
            : new Date(rawStart)
          : null;
          
        const endDate = rawEnd
          ? typeof rawEnd.toDate === "function"
            ? rawEnd.toDate()
            : rawEnd instanceof Date
            ? rawEnd
            : new Date(rawEnd)
          : null;

        if (startDate && now < startDate) return false;
        if (endDate && now > endDate) return false;

        return true;
      })
      .map((doc) =>
        this.serializeCombo({ id: doc.id, ...doc.data() })
      );
  }

  /**
   * Find combo by ID with populated product details
   */
  async findById(id: string): Promise<ComboProduct | null> {
    const doc = await this.collection.doc(id).get();

    if (!doc.exists) return null;

    const combo = { id: doc.id, ...doc.data() } as any;
    if (combo.isDeleted) return null;

    // Populate product details for each combo item
    const populatedItems = await Promise.all(
      (combo.items || []).map(async (item: any) => {
        try {
          const productDoc = await this.collection.firestore
            .collection("products")
            .doc(item.productId)
            .get();

          if (!productDoc.exists) {
            return { ...item, product: null };
          }

          const productData = productDoc.data();

          // Find specific variant if variantId is provided
          let variant = null;
          if (item.variantId && productData?.variants) {
            variant = productData.variants.find(
              (v: any) => v.variantId === item.variantId
            );
          }

          return {
            ...item,
            product: {
              id: productDoc.id,
              name: productData?.name,
              thumbnail: productData?.thumbnail,
              sellingPrice: productData?.sellingPrice,
              marketPrice: productData?.marketPrice,
              discount: productData?.discount || 0,
              variants: productData?.variants || [],
            },
            variant,
          };
        } catch (err) {
          console.error(
            `[ComboRepository] Error fetching product ${item.productId}:`,
            err
          );
          return { ...item, product: null };
        }
      })
    );

    return this.serializeCombo({
      ...combo,
      items: populatedItems,
    });
  }

  /**
   * Find all active combos with preview thumbnails
   */
  async findActiveWithThumbnails(): Promise<ComboProduct[]> {
    const combos = await this.findActive();

    return Promise.all(
      combos.map(async (combo: any) => {
        const firstItem = combo.items?.[0];
        if (!firstItem) return combo;

        try {
          const productDoc = await this.collection.firestore
            .collection("products")
            .doc(firstItem.productId)
            .get();

          if (!productDoc.exists) return combo;

          const productData = productDoc.data();
          return {
            ...combo,
            previewThumbnail:
              combo.thumbnail?.url || productData?.thumbnail?.url,
          };
        } catch {
          return combo;
        }
      })
    );
  }

  /**
   * Find paginated combos for ERP
   */
  async findPaginatedForErp(options: {
    page?: number;
    size?: number;
  }): Promise<{ dataList: ComboProduct[]; rowCount: number }> {
    const { page = 1, size = 20 } = options;
    const query = this.collection.where("isDeleted", "!=", true);

    const total = (await query.count().get()).data().count;
    const snapshot = await query
      .offset((page - 1) * size)
      .limit(size)
      .get();

    return {
      dataList: snapshot.docs.map(doc => this.serializeCombo({ id: doc.id, ...doc.data() })),
      rowCount: total
    };
  }

  /**
   * Create combo
   */
  async create(id: string, data: any): Promise<ComboProduct> {
    const now = new Date();
    const newCombo = {
      ...data,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.collection.doc(id).set(newCombo);
    return { id, ...newCombo } as unknown as ComboProduct;
  }

  /**
   * Update combo
   */
  async update(id: string, data: any): Promise<void> {
    await this.collection.doc(id).update({
      ...data,
      updatedAt: new Date(),
    });
  }

  /**
   * Soft delete combo
   */
  async softDelete(id: string): Promise<void> {
    await this.collection.doc(id).update({
      isDeleted: true,
      updatedAt: new Date(),
    });
  }
}

// Singleton instance
export const comboRepository = new ComboRepository();
