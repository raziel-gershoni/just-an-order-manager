'use client';

import { createContext, useContext } from 'react';

export type GroupRole = 'owner' | 'manager' | 'baker';

interface GroupContext {
  activeGroupId: number | null;
  activeGroupRole: GroupRole | null;
  setActiveGroupId: (id: number) => void;
  setActiveGroupRole: (role: GroupRole | null) => void;
}

export const GroupCtx = createContext<GroupContext>({
  activeGroupId: null,
  activeGroupRole: null,
  setActiveGroupId: () => {},
  setActiveGroupRole: () => {},
});

export function useGroup() {
  return useContext(GroupCtx);
}
