export type Lang = 'en' | 'he';

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

  // ---- UI strings ----

  // Navigation
  'nav.home': { en: 'Home', he: 'בית' },
  'nav.orders': { en: 'Orders', he: 'הזמנות' },
  'nav.customers': { en: 'Customers', he: 'לקוחות' },
  'nav.settings': { en: 'Settings', he: 'הגדרות' },

  // Dashboard
  'dash.welcome': { en: 'Welcome!', he: '!ברוכים הבאים' },
  'dash.create_group': { en: 'Create your bakery group', he: 'צרו את קבוצת המאפייה' },
  'dash.group_name': { en: 'Group name...', he: '...שם הקבוצה' },
  'dash.create': { en: 'Create', he: 'צור' },
  'dash.new_order': { en: 'New Order', he: 'הזמנה חדשה' },
  'dash.record_payment': { en: 'Record Payment', he: 'רשום תשלום' },
  'dash.today': { en: 'Today', he: 'היום' },
  'dash.upcoming': { en: 'Upcoming', he: 'בקרוב' },
  'dash.outstanding': { en: 'Outstanding Balances', he: 'יתרות חוב' },
  'dash.no_orders_today': { en: 'No orders for today', he: 'אין הזמנות להיום' },
  'dash.loaves': { en: 'loaves', he: 'כיכרות' },

  // Orders
  'orders.title': { en: 'Orders', he: 'הזמנות' },
  'orders.new': { en: 'New', he: 'חדש' },
  'orders.new_order': { en: 'New Order', he: 'הזמנה חדשה' },
  'orders.tab_today': { en: 'Today', he: 'היום' },
  'orders.tab_week': { en: 'This Week', he: 'השבוע' },
  'orders.tab_all': { en: 'All', he: 'הכל' },
  'orders.empty': { en: 'No orders yet', he: 'אין עדיין הזמנות' },
  'orders.empty_hint': { en: 'Create your first order to get started', he: 'צרו את ההזמנה הראשונה כדי להתחיל' },
  'orders.order_num': { en: 'Order', he: 'הזמנה' },
  'orders.mark_as': { en: 'Mark as', he: 'סמן כ' },
  'orders.record_charge': { en: 'Record Charge', he: 'רשום חיוב' },
  'orders.charge_prompt': { en: 'Record charge of', he: 'רשום חיוב של' },
  'orders.for_this_order': { en: 'for this order?', he: '?עבור הזמנה זו' },
  'orders.created': { en: 'Order created!', he: '!הזמנה נוצרה' },
  'orders.create_failed': { en: 'Failed to create order', he: 'יצירת ההזמנה נכשלה' },

  // Order form
  'form.customer': { en: 'Customer', he: 'לקוח' },
  'form.search_customer': { en: 'Search customer...', he: '...חפש לקוח' },
  'form.add_customer': { en: 'Add New Customer', he: 'הוסף לקוח חדש' },
  'form.customer_name': { en: 'Customer name', he: 'שם הלקוח' },
  'form.add': { en: 'Add', he: 'הוסף' },
  'form.change': { en: 'Change', he: 'שנה' },
  'form.bread_type': { en: 'Bread Type', he: 'סוג לחם' },
  'form.quantity': { en: 'Quantity', he: 'כמות' },
  'form.delivery': { en: 'Delivery', he: 'מסירה' },
  'form.notes': { en: 'Notes (optional)', he: '(הערות (אופציונלי' },
  'form.notes_placeholder': { en: 'Special requests...', he: '...בקשות מיוחדות' },
  'form.create_order': { en: 'Create Order', he: 'צור הזמנה' },
  'form.creating': { en: 'Creating...', he: '...יוצר' },

  // Customers
  'customers.title': { en: 'Customers', he: 'לקוחות' },
  'customers.search': { en: 'Search...', he: '...חיפוש' },
  'customers.empty': { en: 'No customers yet', he: 'אין עדיין לקוחות' },
  'customers.empty_hint': { en: 'Add your first customer when creating an order', he: 'הוסיפו לקוח ראשון בעת יצירת הזמנה' },
  'customers.balance': { en: 'Balance', he: 'יתרה' },
  'customers.phone': { en: 'Phone', he: 'טלפון' },
  'customers.order_history': { en: 'Orders', he: 'הזמנות' },
  'customers.payment_history': { en: 'Payments', he: 'תשלומים' },
  'customers.address': { en: 'Address', he: 'כתובת' },
  'customers.city': { en: 'City', he: 'עיר' },
  'customers.edit': { en: 'Edit', he: 'עריכה' },
  'customers.saved': { en: 'Customer saved!', he: '!הלקוח נשמר' },
  'customers.save_failed': { en: 'Failed to save', he: 'השמירה נכשלה' },
  'customers.not_found': { en: 'Customer not found', he: 'לקוח לא נמצא' },

  // Payments
  'payments.title': { en: 'Record Payment', he: 'רשום תשלום' },
  'payments.payment_plus': { en: 'Payment (+)', he: '(+) תשלום' },
  'payments.charge_minus': { en: 'Charge (-)', he: '(-) חיוב' },
  'payments.amount': { en: 'Amount', he: 'סכום' },
  'payments.description': { en: 'Description (optional)', he: '(תיאור (אופציונלי' },
  'payments.description_hint': { en: 'e.g., Cash payment', he: 'למשל, תשלום במזומן' },
  'payments.record': { en: 'Record', he: 'רשום' },
  'payments.recording': { en: 'Recording...', he: '...רושם' },
  'payments.success': { en: 'Payment recorded!', he: '!התשלום נרשם' },
  'payments.failed': { en: 'Failed to record payment', he: 'רישום התשלום נכשל' },
  'payments.cancel': { en: 'Cancel', he: 'ביטול' },

  // Settings
  'settings.title': { en: 'Settings', he: 'הגדרות' },
  'settings.group_name': { en: 'Group Name', he: 'שם הקבוצה' },
  'settings.save': { en: 'Save', he: 'שמור' },
  'settings.members': { en: 'Members', he: 'חברים' },
  'settings.invite': { en: 'Invite Member', he: 'הזמן חבר' },
  'settings.create_invite': { en: 'Create Invite Link', he: 'צור קישור הזמנה' },
  'settings.bread_types': { en: 'Bread Types', he: 'סוגי לחם' },
  'settings.add_bread': { en: 'Add Bread Type', he: 'הוסף סוג לחם' },
  'settings.name': { en: 'Name', he: 'שם' },
  'settings.price': { en: 'Price', he: 'מחיר' },
  'settings.edit': { en: 'Edit', he: 'ערוך' },
  'settings.disable': { en: 'Disable', he: 'השבת' },
  'settings.enable': { en: 'Enable', he: 'הפעל' },
  'settings.inactive': { en: 'inactive', he: 'לא פעיל' },

  // Join
  'join.title': { en: 'Group Invite', he: 'הזמנה לקבוצה' },
  'join.join_group': { en: 'Join', he: 'הצטרף ל' },
  'join.as_role': { en: 'as', he: 'בתור' },
  'join.accept': { en: 'Accept', he: 'אשר' },
  'join.decline': { en: 'Decline', he: 'דחה' },
  'join.invalid': { en: 'This invite is no longer valid.', he: '.ההזמנה הזו כבר לא תקפה' },
  'join.failed': { en: 'Failed to respond to invite', he: 'המענה להזמנה נכשל' },

  // General
  'general.loading': { en: 'Loading...', he: '...טוען' },
  'general.back': { en: 'Back', he: 'חזרה' },
  'general.not_found': { en: 'Not found', he: 'לא נמצא' },
  'general.orders_fulfilled': { en: 'Orders fulfilled', he: 'הזמנות שסופקו' },
  'general.revenue': { en: 'Revenue', he: 'הכנסות' },
  'general.outstanding': { en: 'Outstanding balances', he: 'יתרות חוב' },

  // Date
  'date.today': { en: 'Today', he: 'היום' },
  'date.tomorrow': { en: 'Tomorrow', he: 'מחר' },
  'date.friday': { en: 'Friday', he: 'שישי' },

  // Notifications (bot)
  'notify.new_order': { en: 'New Order!', he: 'הזמנה חדשה!' },
  'notify.order_ready': { en: 'Order Ready!', he: 'הזמנה מוכנה!' },
  'notify.customer': { en: 'Customer', he: 'לקוח' },
  'notify.quantity': { en: 'Quantity', he: 'כמות' },
  'notify.delivery_date': { en: 'Delivery', he: 'מסירה' },
  'notify.bread_type': { en: 'Type', he: 'סוג' },
  'notify.notes': { en: 'Notes', he: 'הערות' },
  'notify.loaves': { en: 'loaves', he: 'כיכרות' },
  'notify.total_today': { en: 'Total orders for today', he: 'סה"כ הזמנות להיום' },
  'notify.morning_summary': { en: "Today's Baking Summary", he: 'סיכום אפייה להיום' },
  'notify.weekly_summary': { en: 'Weekly Summary', he: 'סיכום שבועי' },
  'notify.no_orders_today': { en: 'No orders for today', he: 'אין הזמנות להיום' },
  'notify.prepayment': { en: 'paid', he: 'שילם/ה' },
  'notify.credit_for': { en: 'credit for', he: 'קרדיט עבור' },
  'notify.member_joined': { en: 'joined the group as', he: 'הצטרף/ה לקבוצה בתור' },
  'notify.balance_alert': { en: 'owes', he: 'חייב/ת' },

  // Bot
  'bot.welcome': { en: 'Welcome to Sourdough Manager!', he: 'ברוכים הבאים למנהל השאור!' },
  'bot.open_manager': { en: 'Open Manager', he: 'פתח מנהל' },
  'bot.create_group': { en: 'Create a new group', he: 'צור קבוצה חדשה' },
  'bot.join_group': { en: 'I have an invite', he: 'יש לי הזמנה' },
  'bot.no_orders': { en: 'No orders found', he: 'לא נמצאו הזמנות' },
  'bot.mark_ready': { en: 'Mark as Ready', he: 'סמן כמוכן' },
  'bot.mark_delivered': { en: 'Mark as Delivered', he: 'סמן כנמסר' },
  'bot.language_updated': { en: 'Language updated!', he: 'השפה עודכנה!' },
  'bot.invite_join': { en: 'Join group', he: 'הצטרף לקבוצה' },
  'bot.invite_as': { en: 'as', he: 'בתור' },
  'bot.accept': { en: 'Accept', he: 'אשר' },
  'bot.decline': { en: 'Decline', he: 'דחה' },

  // Payment types
  'payment.payment': { en: 'Payment', he: 'תשלום' },
  'payment.charge': { en: 'Charge', he: 'חיוב' },
  'payment.adjustment': { en: 'Adjustment', he: 'התאמה' },
};

export function t(key: string, lang: Lang): string {
  return translations[key]?.[lang] ?? key;
}
