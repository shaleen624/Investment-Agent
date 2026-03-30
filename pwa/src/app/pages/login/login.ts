import { Component, inject, signal } from '@angular/core';
import { FormsModule }             from '@angular/forms';
import { AuthService }             from '../../core/services/auth.service';

@Component({
  selector:    'app-login',
  standalone:  true,
  imports:     [FormsModule],
  templateUrl: './login.html',
  styleUrl:    './login.scss',
})
export class LoginPage {
  private auth = inject(AuthService);

  username = signal('');
  password = signal('');
  loading = signal(false);
  error = signal<string | null>(null);
  isLoginMode = signal(true);

  toggleMode() {
    this.isLoginMode.update(v => !v);
    this.error.set(null);
  }

  async onSubmit() {
    if (!this.username() || !this.password()) {
      this.error.set('Please enter username and password');
      return;
    }

    if (!this.isLoginMode() && this.password().length < 6) {
      this.error.set('Password must be at least 6 characters');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    const result = this.isLoginMode() 
      ? await this.auth.login(this.username(), this.password())
      : await this.auth.register(this.username(), this.password());

    if (!result.success) {
      this.error.set(result.error || (this.isLoginMode() ? 'Login failed' : 'Registration failed'));
    }
    this.loading.set(false);
  }
}