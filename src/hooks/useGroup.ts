'use client';

import { createContext, useContext } from 'react';

export type GroupRole = 'owner' | 'manager' | 'baker' | 'driver';

interface GroupContext {
  activeGroupId: number | null;
  activeGroupRole: GroupRole | null;
  /** May this user set up a new business? From /api/auth/me; false unless the server says so. */
  canCreateGroup: boolean;
  setActiveGroupId: (id: number) => void;
  setActiveGroupRole: (role: GroupRole | null) => void;
}

export const GroupCtx = createContext<GroupContext>({
  activeGroupId: null,
  activeGroupRole: null,
  canCreateGroup: false,
  setActiveGroupId: () => {},
  setActiveGroupRole: () => {},
});

export function useGroup() {
  return useContext(GroupCtx);
}
