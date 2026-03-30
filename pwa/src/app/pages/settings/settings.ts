import { Component, inject, signal } from '@angular/core';
import { NgClass, KeyValuePipe }      from '@angular/common';
import { FormsModule }               from '@angular/forms';
import { ApiService }                from '../../core/services/api.service';
import { catchError, of }            from 'rxjs';
import type { AgentStatus }          from '../../core/models';

@Component({
  selector:    'app-settings',
  standalone:  true,
  imports:     [NgClass, FormsModule, KeyValuePipe],
  templateUrl: './settings.html',
  styleUrl:    './settings.scss',
})
export class SettingsPage {
  private api = inject(ApiService);

  status    = signal<AgentStatus | null>(null);
  profile   = signal<any>({});
  loading   = signal(true);
  saving    = signal(false);
  testResult = signal<Record<string, any> | null>(null);
  testing    = signal(false);

  constructor() {
    this.api.status().pipe(catchError(() => of(null))).subscribe(s => {
      this.status.set(s);
    });
    this.api.profile().pipe(catchError(() => of({}))).subscribe(p => {
      this.profile.set(p);
      this.loading.set(false);
    });
  }

  saveProfile() {
    this.saving.set(true);
    this.api.updateProfile(this.profile()).subscribe({
      next: () => this.saving.set(false),
      error: () => this.saving.set(false),
    });
  }

  testNotifications() {
    this.testing.set(true);
    this.testResult.set(null);
    this.api.testNotifications().subscribe({
      next: res => { this.testing.set(false); this.testResult.set(res); },
      error: () => this.testing.set(false),
    });
  }

  setField(key: string, value: any) {
    this.profile.update(p => ({ ...p, [key]: value }));
  }
}
