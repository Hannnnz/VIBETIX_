import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService, Role } from '../services/auth.service';

/** Requires any signed-in user. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Survives a hard page refresh: the persisted Supabase session is
  // restored BEFORE the route decision — no more bounce-back to /login.
  await auth.ensureSession();
  const session = auth.getSession();
  if (!session) {
    router.navigate(['/login'], { replaceUrl: true });
    return false;
  }
  if (session.mustChangePassword && !state?.url?.startsWith('/change-password')) {
    router.navigate(['/change-password'], { replaceUrl: true });
    return false;
  }
  return true;
};

/** Requires one of the given roles; kicks wrong-role users back to their home. */
export const roleGuard =
  (allowed: Role[]): CanActivateFn =>
  async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    await auth.ensureSession();
    const session = auth.getSession();
    if (!session) {
      router.navigate(['/login'], { replaceUrl: true });
      return false;
    }
    if (session.mustChangePassword && !state?.url?.startsWith('/change-password')) {
      router.navigate(['/change-password'], { replaceUrl: true });
      return false;
    }
    if (allowed.includes(session.role)) {
      return true;
    }
    router.navigate([auth.roleHome], { replaceUrl: true });
    return false;
  };

/** Customer area only: admins/staff are redirected to their own area. */
export const customerGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  await auth.ensureSession();
  const session = auth.getSession();
  if (!session) {
    router.navigate(['/login'], { replaceUrl: true });
    return false;
  }
  if (session.mustChangePassword && !state?.url?.startsWith('/change-password')) {
    router.navigate(['/change-password'], { replaceUrl: true });
    return false;
  }
  if (session.role !== 'customer') {
    router.navigate([auth.roleHome], { replaceUrl: true });
    return false;
  }
  return true;
};
