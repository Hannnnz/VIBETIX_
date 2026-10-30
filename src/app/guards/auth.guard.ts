import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService, Role } from '../services/auth.service';

/** Requires any signed-in user. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Survives a hard page refresh: the persisted Supabase session is
  // restored BEFORE the route decision — no more bounce-back to /login.
  await auth.ensureSession();
  if (auth.getSession()) {
    return true;
  }
  router.navigate(['/login'], { replaceUrl: true });
  return false;
};

/** Requires one of the given roles; kicks wrong-role users back to their home. */
export const roleGuard =
  (allowed: Role[]): CanActivateFn =>
  async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    await auth.ensureSession();
    const session = auth.getSession();
    if (!session) {
      router.navigate(['/login'], { replaceUrl: true });
      return false;
    }
    if (allowed.includes(session.role)) {
      return true;
    }
    router.navigate([auth.roleHome], { replaceUrl: true });
    return false;
  };
