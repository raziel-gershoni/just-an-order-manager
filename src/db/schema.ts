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
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ---- Enums ----

export const languageEnum = pgEnum('language', ['en', 'he']);

export const memberRoleEnum = pgEnum('member_role', [
  'owner',
  'manager',
  'baker',
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
  },
  (table) => [
    primaryKey({ columns: [table.breadTypeId, table.breadSizeId] }),
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
  isRecurring: boolean('is_recurring').notNull().default(false),
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
