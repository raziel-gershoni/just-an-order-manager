type Lang = 'en' | 'he';

const translations: Record<string, Record<Lang, string>> = {
  // Order statuses
  'status.pending': { en: 'Pending', he: 'ממתין' },
  'status.confirmed': { en: 'Confirmed', he: 'אושר' },
  'status.baking': { en: 'Baking', he: 'באפייה' },
  'status.ready': { en: 'Ready', he: 'מוכן' },
  'status.delivered': { en: 'Delivered', he: 'נמסר' },
  'status.cancelled': { en: 'Cancelled', he: 'בוטל' },

  // Delivery types
  'delivery.weekly': { en: 'Weekly', he: 'שבועי' },
  'delivery.shabbat': { en: 'Shabbat', he: 'שבת' },
  'delivery.specific_date': { en: 'Specific Date', he: 'תאריך מסוים' },
  'delivery.asap': { en: 'ASAP', he: 'בהקדם' },

  // Roles
  'role.owner': { en: 'Owner', he: 'בעלים' },
  'role.manager': { en: 'Manager', he: 'מנהל' },
  'role.baker': { en: 'Baker', he: 'אופה' },

  // Notifications
  'notify.new_order': {
    en: 'New Order!',
    he: 'הזמנה חדשה!',
  },
  'notify.order_ready': {
    en: 'Order Ready!',
    he: 'הזמנה מוכנה!',
  },
  'notify.customer': { en: 'Customer', he: 'לקוח' },
  'notify.quantity': { en: 'Quantity', he: 'כמות' },
  'notify.delivery_date': { en: 'Delivery', he: 'מסירה' },
  'notify.bread_type': { en: 'Type', he: 'סוג' },
  'notify.notes': { en: 'Notes', he: 'הערות' },
  'notify.loaves': { en: 'loaves', he: 'כיכרות' },
  'notify.total_today': {
    en: 'Total orders for today',
    he: 'סה"כ הזמנות להיום',
  },
  'notify.morning_summary': {
    en: "Today's Baking Summary",
    he: 'סיכום אפייה להיום',
  },
  'notify.weekly_summary': {
    en: 'Weekly Summary',
    he: 'סיכום שבועי',
  },
  'notify.no_orders_today': {
    en: 'No orders for today',
    he: 'אין הזמנות להיום',
  },
  'notify.prepayment': {
    en: 'paid',
    he: 'שילם/ה',
  },
  'notify.credit_for': {
    en: 'credit for',
    he: 'קרדיט עבור',
  },
  'notify.member_joined': {
    en: 'joined the group as',
    he: 'הצטרף/ה לקבוצה בתור',
  },
  'notify.balance_alert': {
    en: 'owes',
    he: 'חייב/ת',
  },

  // Bot commands
  'bot.welcome': {
    en: 'Welcome to Sourdough Manager!',
    he: 'ברוכים הבאים למנהל השאור!',
  },
  'bot.open_manager': { en: 'Open Manager', he: 'פתח מנהל' },
  'bot.create_group': { en: 'Create a new group', he: 'צור קבוצה חדשה' },
  'bot.join_group': { en: 'I have an invite', he: 'יש לי הזמנה' },
  'bot.no_orders': { en: 'No orders found', he: 'לא נמצאו הזמנות' },
  'bot.mark_ready': { en: 'Mark as Ready', he: 'סמן כמוכן' },
  'bot.mark_delivered': { en: 'Mark as Delivered', he: 'סמן כנמסר' },
  'bot.language_updated': { en: 'Language updated!', he: 'השפה עודכנה!' },
  'bot.invite_join': {
    en: 'Join group',
    he: 'הצטרף לקבוצה',
  },
  'bot.invite_as': {
    en: 'as',
    he: 'בתור',
  },
  'bot.accept': { en: 'Accept', he: 'אשר' },
  'bot.decline': { en: 'Decline', he: 'דחה' },

  // Payment types
  'payment.payment': { en: 'Payment', he: 'תשלום' },
  'payment.charge': { en: 'Charge', he: 'חיוב' },
  'payment.adjustment': { en: 'Adjustment', he: 'התאמה' },

  // General
  'general.orders_fulfilled': { en: 'Orders fulfilled', he: 'הזמנות שסופקו' },
  'general.revenue': { en: 'Revenue', he: 'הכנסות' },
  'general.outstanding': { en: 'Outstanding balances', he: 'יתרות חוב' },
};

export function t(key: string, lang: Lang): string {
  return translations[key]?.[lang] ?? key;
}
