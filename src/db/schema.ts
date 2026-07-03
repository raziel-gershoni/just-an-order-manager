import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  decimal,
  numeric,
  timestamp,
  date,
  varchar,
  boolean,
  jsonb,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

// Ordered list controlling section order + visibility on the public site.
export type SectionConfig = { key: string; visible: boolean };

// ---- Enums ----

export const languageEnum = pgEnum('language', ['en', 'he']);

export const memberRoleEnum = pgEnum('member_role', [
  'owner',
  'manager',
  'baker',
  'driver',
]);

export const inviteStatusEnum = pgEnum('invite_status', [
  'pending',
  'accepted',
  'declined',
  'expired',
]);

export const deliveryTypeEnum = pgEnum('delivery_type', [
  'weekly',
  'shabbat',
  'specific_date',
  'asap',
]);

export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'confirmed',
  'baking',
  'ready',
  'delivered',
  'cancelled',
]);

export const paymentTypeEnum = pgEnum('payment_type', [
  'payment',
  'charge',
  'adjustment',
]);

export const ingredientKindEnum = pgEnum('ingredient_kind', [
  'flour',
  'water',
  'salt',
  'starter',
  'other',
]);

export const reminderOccasionEnum = pgEnum('reminder_occasion', [
  'week_start',
  'shabbat',
]);

export const reminderSendStatusEnum = pgEnum('reminder_send_status', [
  'sent',
  'failed',
]);

// ---- Tables ----

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramId: varchar('telegram_id', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  language: languageEnum('language').notNull().default('he'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const groups = pgTable('groups', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdBy: integer('created_by')
    .notNull()
    .references(() => users.id),
  additionsSurcharge: decimal('additions_surcharge', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  // Bakery branding (uploaded from bakery settings; reused by the public site).
  logoUrl: varchar('logo_url', { length: 1000 }),
  logoPathname: varchar('logo_pathname', { length: 500 }),
  // Delivery settings (zoned pricing).
  deliveryEnabled: boolean('delivery_enabled').notNull().default(false),
  deliveryHomeCity: varchar('delivery_home_city', { length: 255 }),
  deliveryFee: decimal('delivery_fee', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  deliveryFreeOver: decimal('delivery_free_over', { precision: 10, scale: 2 }),
  deliveryCities: jsonb('delivery_cities').$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const groupMembers = pgTable(
  'group_members',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    role: memberRoleEnum('role').notNull(),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('group_members_group_user_idx').on(table.groupId, table.userId),
  ]
);

export const groupInvites = pgTable('group_invites', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  invitedBy: integer('invited_by')
    .notNull()
    .references(() => users.id),
  inviteCode: varchar('invite_code', { length: 20 }).notNull().unique(),
  role: memberRoleEnum('role').notNull(),
  status: inviteStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

export const breadTypes = pgTable('bread_types', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  // Public-site fields: owner-set badge + a chosen library image (thumbnail).
  badgeType: varchar('badge_type', { length: 20 }),
  badgeLabel: varchar('badge_label', { length: 40 }),
  badgeIcon: varchar('badge_icon', { length: 20 }),
  imageId: integer('image_id').references(() => mediaAssets.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const breadSizes = pgTable('bread_sizes', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  name: varchar('name', { length: 100 }).notNull(),
  weightGrams: integer('weight_grams'),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const breadTypeSizes = pgTable(
  'bread_type_sizes',
  {
    breadTypeId: integer('bread_type_id')
      .notNull()
      .references(() => breadTypes.id),
    breadSizeId: integer('bread_size_id')
      .notNull()
      .references(() => breadSizes.id),
    priceOverride: decimal('price_override', { precision: 10, scale: 2 }),
    sortOrder: integer('sort_order').notNull().default(0),
    // Public-site: a badge can also sit on a specific (type, size) pair.
    badgeType: varchar('badge_type', { length: 20 }),
    badgeLabel: varchar('badge_label', { length: 40 }),
    badgeIcon: varchar('badge_icon', { length: 20 }),
  },
  (table) => [
    primaryKey({ columns: [table.breadTypeId, table.breadSizeId] }),
  ]
);

// Bulk-pricing tiers for a size (e.g. bun: 6 → ₪40, 30 → ₪150). A null
// breadTypeId is the size-wide default; a set breadTypeId overrides the price
// for that one bread — mirroring breadSizes.price (default) + breadTypeSizes
// .priceOverride (per-type) for single prices. The engine (src/lib/pricing.ts)
// charges the cheapest combination of tiers + singles per order.
export const breadSizeTiers = pgTable(
  'bread_size_tiers',
  {
    id: serial('id').primaryKey(),
    groupId: integer('group_id')
      .notNull()
      .references(() => groups.id),
    breadSizeId: integer('bread_size_id')
      .notNull()
      .references(() => breadSizes.id),
    breadTypeId: integer('bread_type_id').references(() => breadTypes.id),
    minQty: integer('min_qty').notNull(),
    price: decimal('price', { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('bread_size_tiers_uniq').on(
      table.breadSizeId,
      table.breadTypeId,
      table.minQty
    ),
  ]
);

export const breadAdditions = pgTable('bread_additions', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id').notNull().references(() => groups.id),
  name: varchar('name', { length: 100 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const breadTypeAdditions = pgTable(
  'bread_type_additions',
  {
    breadTypeId: integer('bread_type_id')
      .notNull()
      .references(() => breadTypes.id),
    breadAdditionId: integer('bread_addition_id')
      .notNull()
      .references(() => breadAdditions.id),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.breadTypeId, table.breadAdditionId] }),
  ]
);

export const breadRecipes = pgTable('bread_recipes', {
  breadTypeId: integer('bread_type_id')
    .primaryKey()
    .references(() => breadTypes.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const breadRecipeIngredients = pgTable('bread_recipe_ingredients', {
  id: serial('id').primaryKey(),
  breadTypeId: integer('bread_type_id')
    .notNull()
    .references(() => breadRecipes.breadTypeId, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  kind: ingredientKindEnum('kind').notNull(),
  pctOfFinished: numeric('pct_of_finished', { precision: 7, scale: 4 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  name: varchar('name', { length: 255 }).notNull(),
  address: varchar('address', { length: 500 }),
  city: varchar('city', { length: 255 }),
  telegramChatId: varchar('telegram_chat_id', { length: 50 }),
  notes: text('notes'),
  deliveryNotes: text('delivery_notes'),
  isActive: boolean('is_active').notNull().default(true),
  reminderOptOut: boolean('reminder_opt_out').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const customerPhones = pgTable('customer_phones', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  phone: varchar('phone', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  deliveryType: deliveryTypeEnum('delivery_type').notNull(),
  deliveryDate: date('delivery_date'),
  status: orderStatusEnum('order_status').notNull().default('pending'),
  notes: text('notes'),
  totalOverride: decimal('total_override', { precision: 10, scale: 2 }),
  paid: boolean('paid').notNull().default(false),
  isDelivery: boolean('is_delivery').notNull().default(false),
  deliveryFee: decimal('delivery_fee', { precision: 10, scale: 2 })
    .notNull()
    .default('0'),
  isRecurring: boolean('is_recurring').notNull().default(false),
  // The "deals off" switch — when false, bulk tiers are ignored and lines
  // charge plain single prices.
  dealsEnabled: boolean('deals_enabled').notNull().default(true),
  // When false, additions are free — the additions surcharge is not added to
  // the total.
  additionsCharged: boolean('additions_charged').notNull().default(true),
  // Frozen computed goods subtotal (before delivery fee / totalOverride) at
  // save time, so a placed order never re-prices if tiers change later.
  goodsSnapshot: decimal('goods_snapshot', { precision: 10, scale: 2 }),
  // Human-readable pricing breakdown rows (Allocation[]) for the detail view.
  pricingBreakdown: jsonb('pricing_breakdown'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id')
    .notNull()
    .references(() => orders.id),
  breadTypeId: integer('bread_type_id')
    .notNull()
    .references(() => breadTypes.id),
  breadSizeId: integer('bread_size_id').references(() => breadSizes.id),
  quantity: integer('quantity').notNull().default(1),
  pricePerUnit: decimal('price_per_unit', { precision: 10, scale: 2 }),
});

export const orderItemAdditions = pgTable(
  'order_item_additions',
  {
    orderItemId: integer('order_item_id')
      .notNull()
      .references(() => orderItems.id),
    breadAdditionId: integer('bread_addition_id')
      .notNull()
      .references(() => breadAdditions.id),
  },
  (table) => [
    primaryKey({ columns: [table.orderItemId, table.breadAdditionId] }),
  ]
);

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  type: paymentTypeEnum('payment_type').notNull(),
  orderId: integer('order_id').references(() => orders.id),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const reminderTemplates = pgTable('reminder_templates', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  label: varchar('label', { length: 255 }).notNull(),
  metaTemplateName: varchar('meta_template_name', { length: 255 }).notNull(),
  occasion: reminderOccasionEnum('occasion').notNull(),
  bodyPreview: text('body_preview'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const reminderSends = pgTable('reminder_sends', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  customerId: integer('customer_id')
    .notNull()
    .references(() => customers.id),
  phoneId: integer('phone_id')
    .notNull()
    .references(() => customerPhones.id),
  templateId: integer('template_id')
    .notNull()
    .references(() => reminderTemplates.id),
  occasion: reminderOccasionEnum('occasion').notNull(),
  status: reminderSendStatusEnum('status').notNull(),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
});

// ---- Public site (landing page / pricelist) ----

// Shared media library. One upload is reusable as a bread thumbnail, the hero
// image, and/or a gallery image. Backed by Vercel Blob.
export const mediaAssets = pgTable('media_assets', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  blobUrl: varchar('blob_url', { length: 1000 }).notNull(),
  blobPathname: varchar('blob_pathname', { length: 500 }).notNull(),
  alt: varchar('alt', { length: 255 }),
  width: integer('width'),
  height: integer('height'),
  showInGallery: boolean('show_in_gallery').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Owner-editable marketing content for the public site. One row per group.
export const bakeryProfile = pgTable('bakery_profile', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .unique()
    .references(() => groups.id),
  // Reserved for future per-bakery public URLs (/[slug]); unused for now.
  slug: varchar('slug', { length: 80 }).unique(),
  isPublished: boolean('is_published').notNull().default(false),
  displayName: varchar('display_name', { length: 255 }),
  tagline: varchar('tagline', { length: 255 }),
  heroHeadline: varchar('hero_headline', { length: 255 }),
  eyebrow: varchar('eyebrow', { length: 120 }),
  story: text('story'),
  // Array of short strings, e.g. ["תסיסה 24 שעות", "קמח מקומי"].
  trustItems: jsonb('trust_items').$type<string[]>(),
  heroImageId: integer('hero_image_id').references(() => mediaAssets.id, {
    onDelete: 'set null',
  }),
  logoImageId: integer('logo_image_id').references(() => mediaAssets.id, {
    onDelete: 'set null',
  }),
  whatsappPhone: varchar('whatsapp_phone', { length: 32 }),
  contactPhone: varchar('contact_phone', { length: 32 }),
  instagram: varchar('instagram', { length: 64 }),
  address: varchar('address', { length: 255 }),
  mapUrl: varchar('map_url', { length: 1000 }),
  bakeDays: varchar('bake_days', { length: 64 }),
  pickupArea: varchar('pickup_area', { length: 120 }),
  // Ordered list of { key, visible } controlling section order + visibility.
  sections: jsonb('sections').$type<SectionConfig[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
