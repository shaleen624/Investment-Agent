import { ApplicationConfig, provideZoneChangeDetection, isDevMode, APP_INITIALIZER } from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors }    from '@angular/common/http';
import { provideAnimationsAsync }                 from '@angular/platform-browser/animations/async';
import { provideServiceWorker }                   from '@angular/service-worker';
import { routes }                                 from './app.routes';
import { errorInterceptor }                       from './core/interceptors/error.interceptor';
import { authInterceptor }                        from './core/interceptors/auth.interceptor';
import { AuthService }                            from './core/services/auth.service';

function initializeApp(auth: AuthService) {
  return () => auth.checkAuth();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withInterceptors([errorInterceptor, authInterceptor])),
    provideAnimationsAsync(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      deps: [AuthService],
      multi: true,
    },
  ],
};
