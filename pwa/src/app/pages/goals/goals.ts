import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule }                         from '@angular/forms';
import { ApiService }                          from '../../core/services/api.service';
import { InrPipe }                             from '../../shared/pipes/inr.pipe';
import type { Goal }                           from '../../core/models';
import { catchError, of }                      from 'rxjs';

@Component({
  selector:    'app-goals',
  standalone:  true,
  imports:     [FormsModule, InrPipe],
  templateUrl: './goals.html',
  styleUrl:    './goals.scss',
})
export class GoalsPage {
  private api = inject(ApiService);

  goals     = signal<Goal[]>([]);
  loading   = signal(true);
  showModal = signal(false);
  saving    = signal(false);
  isEditing = signal(false);
  editing   = signal<Partial<Goal>>({});

  short = computed(() => this.goals().filter(g => g.type === 'short_term' && g.is_active));
  long  = computed(() => this.goals().filter(g => g.type === 'long_term'  && g.is_active));

  constructor() { this.load(); }

  load() {
    this.loading.set(true);
    this.api.goals(true).pipe(catchError(() => of([]))).subscribe(g => {
      this.goals.set(g);
      this.loading.set(false);
    });
  }

  openAdd() {
    this.editing.set({ type: 'long_term', risk_tolerance: 'moderate', priority: 5, is_active: 1 });
    this.isEditing.set(false);
    this.showModal.set(true);
  }

  openEdit(g: Goal) {
    this.editing.set({ ...g });
    this.isEditing.set(true);
    this.showModal.set(true);
  }

  close() { this.showModal.set(false); }

  save() {
    const g = this.editing();
    if (!g.title) return;
    this.saving.set(true);
    const obs = this.isEditing() && g.id
      ? this.api.updateGoal(g.id, g)
      : this.api.addGoal(g);
    obs.subscribe({
      next: () => { this.saving.set(false); this.close(); this.load(); },
      error: () => this.saving.set(false),
    });
  }

  delete(g: Goal) {
    if (!confirm(`Delete goal "${g.title}"?`)) return;
    this.api.deleteGoal(g.id).subscribe(() => this.load());
  }

  daysLeft(g: Goal) {
    if (!g.target_date) return null;
    const diff = new Date(g.target_date).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }

  progressPct(g: Goal) {
    // Progress is illustrative — would need current savings tracked
    return 0;
  }

  riskColor(r: string) {
    if (r === 'conservative') return 'success';
    if (r === 'aggressive')   return 'danger';
    return 'warning';
  }

  set field(pair: { key: keyof Goal, value: any }) {
    this.editing.update(g => ({ ...g, [pair.key]: pair.value }));
  }
}
