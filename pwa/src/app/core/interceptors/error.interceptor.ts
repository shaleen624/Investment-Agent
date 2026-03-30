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
      console.error('[HTTP]', req.url, err.status, err.error?.error || err.message);
      return throwError(() => err);
    })
  );
};
