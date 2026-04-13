import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe, NgClass, KeyValuePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import type { NotificationLogEntry } from '../../core/models';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [FormsModule, DatePipe, NgClass, KeyValuePipe],
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
})
export class NotificationsPage {
  private api = inject(ApiService);

  logs = signal<NotificationLogEntry[]>([]);
  loading = signal(true);
  sending = signal(false);
  message = signal('');
  sendResult = signal<Record<string, { ok: boolean; error?: string }> | null>(null);

  constructor() {
    this.loadLogs();
  }

  loadLogs() {
    this.loading.set(true);
    this.api.notificationsLog(100).pipe(catchError(() => of([]))).subscribe((entries) => {
      this.logs.set(entries);
      this.loading.set(false);
    });
  }

  sendAlert() {
    const text = this.message().trim();
    if (!text) return;
    this.sending.set(true);
    this.sendResult.set(null);

    this.api.sendAlert(text).subscribe({
      next: (result) => {
        this.sendResult.set(result);
        this.message.set('');
        this.sending.set(false);
        this.loadLogs();
      },
      error: () => {
        this.sendResult.set({ system: { ok: false, error: 'Failed to send alert' } });
        this.sending.set(false);
      },
    });
  }

  statusClass(status: string) {
    return status === 'sent' ? 'positive' : 'negative';
  }
}
