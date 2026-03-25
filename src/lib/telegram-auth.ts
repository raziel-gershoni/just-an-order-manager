import { createHmac } from 'crypto';
import { db } from '@/db';
import { users, groupMembers } from '@/db/schema';
import { eq } from 'drizzle-orm';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface InitData {
  user?: TelegramUser;
  auth_date: number;
  hash: string;
  [key: string]: unknown;
}

export interface AuthContext {
  telegramUser: TelegramUser;
  dbUser: {
    id: number;
    telegramId: string;
    name: string;
    language: 'en' | 'he';
  };
  memberships: {
    groupId: number;
    role: 'owner' | 'manager' | 'baker';
  }[];
}

function validateInitData(initDataRaw: string, botToken: string): InitData {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) throw new Error('Missing hash');

  params.delete('hash');
  const dataCheckArr = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const computedHash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (computedHash !== hash) {
    throw new Error('Invalid hash');
  }

  const authDate = Number(params.get('auth_date'));
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 3600) {
    throw new Error('Init data expired');
  }

  const userStr = params.get('user');
  const user = userStr ? JSON.parse(userStr) : undefined;

  return { user, auth_date: authDate, hash };
}

export async function authenticateRequest(
  request: Request
): Promise<AuthContext> {
  const authHeader = request.headers.get('authorization') || '';
  const [authType, authData] = authHeader.split(' ', 2);

  if (authType !== 'tma' || !authData) {
    throw new Error('Missing Telegram auth');
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not set');

  const initData = validateInitData(authData, botToken);
  if (!initData.user) throw new Error('No user in init data');

  const telegramId = String(initData.user.id);

  // Find or create user
  let [dbUser] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  if (!dbUser) {
    const name = [initData.user.first_name, initData.user.last_name]
      .filter(Boolean)
      .join(' ');

    [dbUser] = await db
      .insert(users)
      .values({ telegramId, name })
      .returning();
  }

  // Get memberships
  const memberships = await db
    .select({
      groupId: groupMembers.groupId,
      role: groupMembers.role,
    })
    .from(groupMembers)
    .where(eq(groupMembers.userId, dbUser.id));

  return {
    telegramUser: initData.user,
    dbUser: {
      id: dbUser.id,
      telegramId: dbUser.telegramId,
      name: dbUser.name,
      language: dbUser.language,
    },
    memberships,
  };
}
