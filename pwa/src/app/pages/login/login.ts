import { Component, inject, signal } from '@angular/core';
import { firstValueFrom }           from 'rxjs';
import { Router }                   from '@angular/router';
import { FormsModule }             from '@angular/forms';
import { ApiService }              from '../../core/services/api.service';

@Component({
  selector:    'app-login',
  standalone:  true,
  imports:     [FormsModule],
  templateUrl: './login.html',
  styleUrl:    './login.scss',
})
export class LoginPage {
  private api = inject(ApiService);
  private router = inject(Router);

  username = signal('');
  password = signal('');
  loading = signal(false);
  error = signal<string | null>(null);

  async login() {
    if (!this.username() || !this.password()) {
      this.error.set('Please enter username and password');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(this.api.login(this.username(), this.password()));
      // Store auth token/session
      localStorage.setItem('auth_token', response.token);
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      this.error.set(err.message || 'Login failed');
    } finally {
      this.loading.set(false);
    }
  }

  async register() {
    if (!this.username() || !this.password()) {
      this.error.set('Please enter username and password');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const response = await firstValueFrom(this.api.register(this.username(), this.password()));
      // Auto login after registration
      localStorage.setItem('auth_token', response.token);
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      this.error.set(err.message || 'Registration failed');
    } finally {
      this.loading.set(false);
    }
  }
}