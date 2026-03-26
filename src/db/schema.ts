import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  decimal,
  timestamp,
  date,
  varchar,
  boolean,
  uniqueIndex,
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
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .notNull()
    .references(() => groups.id),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  address: varchar('address', { length: 500 }),
  city: varchar('city', { length: 255 }),
  telegramChatId: varchar('telegram_chat_id', { length: 50 }),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
  quantity: integer('quantity').notNull().default(1),
  pricePerUnit: decimal('price_per_unit', { precision: 10, scale: 2 }),
});

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
