import { productRepository } from "@/repositories/ProductRepository";
import { Product } from "@/model/Product";
import { ProductVariant } from "@/model/ProductVariant";
import { Img } from "@/model/Img";
import { nanoid } from "nanoid";
import { AppError } from "@/utils/apiResponse";
import { uploadCompressedImage } from "./StorageService";

/**
 * VariantService - Business logic for product variants
 * Delegates data access to productRepository
 */

const uploadVariantImage = async (
  file: File,
  productId: string,
  variantId: string,
): Promise<Img> => {
  const fileId = nanoid(8).toLowerCase();
  const filePath = `products/${productId}/variants/${variantId}/${fileId}_img.webp`;
  const url = await uploadCompressedImage(file, filePath);
  return { url, file: filePath, order: 0 };
};

export const addVariant = async (
  productId: string,
  variantData: Partial<ProductVariant>,
  newImageFiles: File[],
): Promise<ProductVariant> => {
  const product = await productRepository.findById(productId);
  if (!product) throw new AppError(`Product with ID ${productId} not found`, 404);

  const variantId = `var-${nanoid(8)}`.toLowerCase();
  const uploadPromises = newImageFiles.map((file) => uploadVariantImage(file, productId, variantId));
  const uploadedImages = await Promise.all(uploadPromises);
  const finalImages = [...(variantData.images || []), ...uploadedImages];
  finalImages.forEach((img, index) => (img.order = index));

  const newVariant: ProductVariant = {
    variantId: variantId,
    variantName: variantData.variantName || "",
    sizes: variantData.sizes || [],
    status: variantData.status || false,
    images: finalImages,
    isDeleted: false,
  };

  return newVariant;
};

export const updateVariant = async (
  productId: string,
  variantId: string,
  variantData: Partial<ProductVariant>,
  newImageFiles: File[],
): Promise<ProductVariant> => {
  const product = await productRepository.findById(productId);
  if (!product) throw new AppError(`Product with ID ${productId} not found`, 404);

  const existingVariants = product.variants || [];
  const variantIndex = existingVariants.findIndex((v) => v.variantId === variantId);
  if (variantIndex === -1) throw new AppError(`Variant with ID ${variantId} not found`, 404);

  const uploadPromises = newImageFiles.map((file) => uploadVariantImage(file, productId, variantId));
  const uploadedImages = await Promise.all(uploadPromises);
  const finalImages = [...(variantData.images || []), ...uploadedImages];
  finalImages.forEach((img, index) => (img.order = index));

  const updatedVariant: ProductVariant = {
    ...existingVariants[variantIndex],
    ...variantData,
    variantId,
    images: finalImages,
    isDeleted: false,
  };

  return updatedVariant;
};

export const deleteVariant = async (
  productId: string,
  variantId: string,
): Promise<boolean> => {
  const product = await productRepository.findById(productId);
  if (!product) throw new AppError(`Product with ID ${productId} not found`, 404);

  const existingVariants = product.variants || [];
  const variantIndex = existingVariants.findIndex((v) => v.variantId === variantId);
  if (variantIndex === -1) return false;

  const updatedVariantsArray = existingVariants.map((variant, index) => {
    if (index === variantIndex) return { ...variant, isDeleted: true };
    return variant;
  });

  await productRepository.updateVariants(productId, updatedVariantsArray);
  return true;
};

export const getProductVariantsForDropdown = async (productId: string) => {
  const product = await productRepository.findById(productId);
  if (!product) return [];

  return (product.variants || [])
    .filter((v) => v.isDeleted !== true && v.status === true)
    .map((v) => ({
      id: v.variantId,
      label: v.variantName,
      sizes: v.sizes,
    }));
};
