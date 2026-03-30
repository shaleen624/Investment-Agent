import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService }                         from './api.service';
import { Router }                             from '@angular/router';
import { firstValueFrom }                     from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);

  private userSignal = signal<any>(null);
  user = this.userSignal.asReadonly();
  isLoggedIn = computed(() => !!this.userSignal());

  constructor() { }

  private extractApiError(err: any, fallback: string) {
    if (!err) return fallback;
    if (typeof err.error === 'string' && err.error.trim()) return err.error;
    if (err.error?.error) return err.error.error;
    if (err.message) return err.message;
    return fallback;
  }

  async checkAuth() {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      this.userSignal.set(null);
      return;
    }

    try {
      const response = await firstValueFrom(this.api.verify());
      if (response.valid) {
        this.userSignal.set(response.user);
      } else {
        this.logout();
      }
    } catch (err) {
      console.error('Auth verification failed:', err);
      this.logout();
    }
  }

  async login(username: string, password: string) {
    try {
      const response = await firstValueFrom(this.api.login(username, password));
      localStorage.setItem('auth_token', response.token);
      this.userSignal.set(response.user);
      this.router.navigate(['/dashboard']);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: this.extractApiError(err, 'Login failed') };
    }
  }

  async register(username: string, password: string) {
    try {
      const response = await firstValueFrom(this.api.register(username, password));
      localStorage.setItem('auth_token', response.token);
      this.userSignal.set(response.user);
      this.router.navigate(['/dashboard']);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: this.extractApiError(err, 'Registration failed') };
    }
  }

  logout() {
    localStorage.removeItem('auth_token');
    this.userSignal.set(null);
    this.router.navigate(['/login']);
    // Call API logout but don't wait for it
    this.api.logout().subscribe({ error: () => {} });
  }
}
