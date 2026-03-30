import { HttpInterceptorFn } from '@angular/common/http';
import { inject }             from '@angular/core';
import { Router }             from '@angular/router';
import { catchError, throwError }   from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  return next(req).pipe(
    catchError(err => {
      if (err.status === 401) {
        // Auto logout on 401 Unauthorized
        localStorage.removeItem('auth_token');
        router.navigate(['/login']);
      }

      // This 404 is expected on fresh installs before first market snapshot exists.
      const isExpectedSnapshot404 =
        err.status === 404 &&
        req.url.includes('/api/market/snapshot') &&
        typeof err.error?.error === 'string' &&
        err.error.error.includes('No snapshot yet');

      if (!isExpectedSnapshot404) {
        console.error('[HTTP]', req.url, err.status, err.error?.error || err.message);
      }

      return throwError(() => err);
    })
  );
};
