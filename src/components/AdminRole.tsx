import { createContext, useContext } from "react";

type RoleState = {
  isAdmin: boolean;
  isInstructor: boolean;
  isLoading: boolean;
};

export const AdminRoleContext = createContext<RoleState>({
  isAdmin: false,
  isInstructor: false,
  isLoading: true,
});

export function useAdminRole() {
  return useContext(AdminRoleContext);
}
