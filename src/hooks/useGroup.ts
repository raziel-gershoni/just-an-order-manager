'use client';

import { createContext, useContext } from 'react';

interface GroupContext {
  activeGroupId: number | null;
  setActiveGroupId: (id: number) => void;
}

export const GroupCtx = createContext<GroupContext>({
  activeGroupId: null,
  setActiveGroupId: () => {},
});

export function useGroup() {
  return useContext(GroupCtx);
}
