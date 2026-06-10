import { roleRepository } from "@/repositories/RoleRepository";
import { Role, Permission } from "@/model/Role";
import { AppError } from "@/utils/apiResponse";
import { formatEntityDates, formatListDates } from "./UtilService";

/**
 * RoleService - Business logic for roles and permissions
 * Delegates data access to roleRepository
 */

export const getAllPermissions = (): Permission[] => {
  return [
    // Security
    { key: "manage_roles", label: "Manage Roles & Permissions", group: "Security" },

    // Dashboard
    { key: "view_dashboard", label: "View Dashboard", group: "Dashboard" },

    // Users (under Security group now)
    { key: "view_users", label: "View Users", group: "Security" },
    { key: "create_users", label: "Create Users", group: "Security" },
    { key: "update_users", label: "Update Users", group: "Security" },
    { key: "delete_users", label: "Delete Users", group: "Security" },

    // Master Data
    { key: "view_master_data", label: "View Master Data", group: "Master Data" },
    { key: "create_master_data", label: "Create Master Data", group: "Master Data" },
    { key: "update_master_data", label: "Update Master Data", group: "Master Data" },
    { key: "delete_master_data", label: "Delete Master Data", group: "Master Data" },

    // Inventory
    { key: "view_inventory", label: "View Stock Overview", group: "Inventory" },
    { key: "update_inventory", label: "Update Stock", group: "Inventory" },
    { key: "view_adjustments", label: "View Adjustments", group: "Inventory" },
    { key: "create_adjustments", label: "Create Adjustments", group: "Inventory" },
    { key: "view_suppliers", label: "View Suppliers", group: "Inventory" },
    { key: "create_suppliers", label: "Create Suppliers", group: "Inventory" },
    { key: "update_suppliers", label: "Update Suppliers", group: "Inventory" },
    { key: "delete_suppliers", label: "Delete Suppliers", group: "Inventory" },
    { key: "view_purchase_orders", label: "View Purchase Orders", group: "Inventory" },
    { key: "create_purchase_orders", label: "Create Purchase Orders", group: "Inventory" },
    { key: "update_purchase_orders", label: "Update Purchase Orders", group: "Inventory" },
    { key: "view_grn", label: "View Goods Received", group: "Inventory" },
    { key: "create_grn", label: "Create GRN", group: "Inventory" },
    { key: "approve_po", label: "Approve Purchase Orders", group: "Inventory" },
    { key: "approve_grn", label: "Approve Goods Received Notes", group: "Inventory" },

    // Orders
    { key: "view_orders", label: "View Orders", group: "Orders" },
    { key: "create_orders", label: "Create Orders", group: "Orders" },
    { key: "update_orders", label: "Update Orders", group: "Orders" },
    { key: "delete_orders", label: "Delete/Cancel Orders", group: "Orders" },

    // Finance
    { key: "view_finance", label: "View Finance Dashboard", group: "Finance" },
    { key: "view_petty_cash", label: "View Petty Cash", group: "Finance" },
    { key: "create_petty_cash", label: "Create Petty Cash Entry", group: "Finance" },
    { key: "update_petty_cash", label: "Update Petty Cash", group: "Finance" },
    { key: "delete_petty_cash", label: "Delete Petty Cash", group: "Finance" },
    { key: "view_expense_categories", label: "View Expense Categories", group: "Finance" },
    { key: "manage_expense_categories", label: "Manage Expense Categories", group: "Finance" },
    { key: "view_bank_accounts", label: "View Bank Accounts", group: "Finance" },
    { key: "manage_bank_accounts", label: "Manage Bank Accounts", group: "Finance" },
    { key: "view_supplier_invoices", label: "View Supplier Invoices", group: "Finance" },
    { key: "create_supplier_invoices", label: "Create Supplier Invoices", group: "Finance" },
    { key: "update_supplier_invoices", label: "Update Supplier Invoices", group: "Finance" },

    // Campaign
    { key: "view_promotions", label: "View Promotions", group: "Campaign" },
    { key: "create_promotions", label: "Create Promotions", group: "Campaign" },
    { key: "update_promotions", label: "Update Promotions", group: "Campaign" },
    { key: "delete_promotions", label: "Delete Promotions", group: "Campaign" },
    { key: "view_coupons", label: "View Coupons", group: "Campaign" },
    { key: "create_coupons", label: "Create Coupons", group: "Campaign" },
    { key: "update_coupons", label: "Update Coupons", group: "Campaign" },
    { key: "delete_coupons", label: "Delete Coupons", group: "Campaign" },
    { key: "view_combos", label: "View Combos", group: "Campaign" },
    { key: "create_combos", label: "Create Combos", group: "Campaign" },
    { key: "update_combos", label: "Update Combos", group: "Campaign" },
    { key: "delete_combos", label: "Delete Combos", group: "Campaign" },

    // Website
    { key: "view_website", label: "View Website Manager", group: "Website" },
    { key: "update_website", label: "Update Website Content", group: "Website" },

    // Reports
    { key: "view_reports", label: "View Reports", group: "Reports" },
    { key: "export_reports", label: "Export Reports", group: "Reports" },

    // Settings
    { key: "view_settings", label: "View Settings", group: "Settings" },
    { key: "update_settings", label: "Update ERP Settings", group: "Settings" },
    { key: "view_shipping", label: "View Shipping Rates", group: "Settings" },
    { key: "update_shipping", label: "Update Shipping Rates", group: "Settings" },
    { key: "view_payment_methods", label: "View Payment Methods", group: "Settings" },
    { key: "manage_payment_methods", label: "Manage Payment Methods", group: "Settings" },
    { key: "view_tax_settings", label: "View Tax Settings", group: "Settings" },
    { key: "update_tax_settings", label: "Update Tax Settings", group: "Settings" },

    // POS
    { key: "access_pos", label: "Access POS System", group: "POS" },
    { key: "create_pos_orders", label: "Create POS Orders", group: "POS" },
    { key: "view_pos_orders", label: "View POS Orders", group: "POS" },
    { key: "manage_pos_cart", label: "Manage POS Cart", group: "POS" },
    { key: "view_pos_inventory", label: "View POS Inventory", group: "POS" },
    { key: "process_pos_exchange", label: "Process Item Exchanges", group: "POS" },
    { key: "view_pos_exchanges", label: "View Exchange History", group: "POS" },
    { key: "change_pos_location", label: "Change POS Location", group: "POS" },
    { key: "create_pos_pretty_cash", label: "Create POS Petty Cash Entry", group: "POS" },
    { key: "view_pos_pretty_cash", label: "View POS Petty Cash History", group: "POS" },
    { key: "update_pos_pretty_cash", label: "Update POS Petty Cash", group: "POS" },
    { key: "delete_pos_pretty_cash", label: "Delete POS Petty Cash", group: "POS" },

    // Communications
    { key: "view_communications", label: "View Communication Logs", group: "Communications" },
    { key: "send_custom_notifications", label: "Send Custom Notifications", group: "Communications" },
  ];
};

export const createRole = async (
  role: Omit<Role, "createdAt" | "updatedAt">
): Promise<string> => {
  const existing = await roleRepository.findById(role.id);
  if (existing) throw new AppError(`Role with ID ${role.id} already exists`, 409);

  return await roleRepository.create(role.id, role);
};

export const updateRole = async (
  roleId: string,
  updates: Partial<Role>
): Promise<void> => {
  const existing = await roleRepository.findById(roleId);
  if (!existing) throw new AppError(`Role with ID ${roleId} not found`, 404);

  await roleRepository.update(roleId, updates);
};

export const deleteRole = async (roleId: string): Promise<void> => {
  const role = await roleRepository.findById(roleId);
  if (!role) throw new AppError(`Role with ID ${roleId} not found`, 404);

  if (role.isSystem) throw new AppError("Cannot delete system role", 403);

  await roleRepository.delete(roleId);
};

export const getRole = async (roleId: string): Promise<Role | null> => {
  const role = await roleRepository.findById(roleId);
  return role ? formatEntityDates(role) : null;
};

export const getAllRoles = async (): Promise<Role[]> => {
  return formatListDates(await roleRepository.findAllRoles());
};
