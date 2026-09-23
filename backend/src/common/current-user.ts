import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface AuthUser { id: string; firebaseUid: string; email: string | null; displayName: string | null }

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  return context.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
