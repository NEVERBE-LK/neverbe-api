import { BaseRepository } from "./BaseRepository";
import { Size } from "@/model/Size";

/**
 * Size Repository - handles size variations data access
 */
export class SizeRepository extends BaseRepository<Size> {
  constructor() {
    super("sizes");
  }

  /**
   * Find paginated and filtered sizes
   */
  async findPaginated(options: {
    page?: number;
    size?: number;
    search?: string;
    status?: string;
  }): Promise<{ dataList: Size[]; total: number }> {
    const { page = 1, size = 10, search = "", status } = options;
    let query = this.getNonDeletedQuery().orderBy("name");

    if (status === "active") query = query.where("status", "==", true);
    if (status === "inactive") query = query.where("status", "==", false);

    if (search.trim()) {
      const s = search.trim();
      query = query.where("name", ">=", s).where("name", "<=", s + "\uf8ff");
    }

    const total = (await query.count().get()).data().count;
    const snapshot = await query
      .offset((page - 1) * size)
      .limit(size)
      .get();

    return {
      dataList: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Size)),
      total
    };
  }

  /**
   * Get sizes for dropdown
   */
  async findForDropdown(): Promise<{ id: string; label: string }[]> {
    const snapshot = await this.getActiveQuery().get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      label: (doc.data() as Size).name,
    }));
  }
}

export const sizeRepository = new SizeRepository();
