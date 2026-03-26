import { relations } from 'drizzle-orm';
import {
  users,
  groups,
  groupMembers,
  groupInvites,
  breadTypes,
  customers,
  orders,
  orderItems,
  payments,
} from './schema';

export const usersRelations = relations(users, ({ many }) => ({
  createdGroups: many(groups),
  memberships: many(groupMembers),
  invitesSent: many(groupInvites),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  creator: one(users, {
    fields: [groups.createdBy],
    references: [users.id],
  }),
  members: many(groupMembers),
  invites: many(groupInvites),
  breadTypes: many(breadTypes),
  customers: many(customers),
  orders: many(orders),
  payments: many(payments),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, {
    fields: [groupMembers.groupId],
    references: [groups.id],
  }),
  user: one(users, {
    fields: [groupMembers.userId],
    references: [users.id],
  }),
}));

export const groupInvitesRelations = relations(groupInvites, ({ one }) => ({
  group: one(groups, {
    fields: [groupInvites.groupId],
    references: [groups.id],
  }),
  inviter: one(users, {
    fields: [groupInvites.invitedBy],
    references: [users.id],
  }),
}));

export const breadTypesRelations = relations(breadTypes, ({ one, many }) => ({
  group: one(groups, {
    fields: [breadTypes.groupId],
    references: [groups.id],
  }),
  orderItems: many(orderItems),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  group: one(groups, {
    fields: [customers.groupId],
    references: [groups.id],
  }),
  orders: many(orders),
  payments: many(payments),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  group: one(groups, {
    fields: [orders.groupId],
    references: [groups.id],
  }),
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
  payments: many(payments),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  breadType: one(breadTypes, {
    fields: [orderItems.breadTypeId],
    references: [breadTypes.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  group: one(groups, {
    fields: [payments.groupId],
    references: [groups.id],
  }),
  customer: one(customers, {
    fields: [payments.customerId],
    references: [customers.id],
  }),
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
}));
