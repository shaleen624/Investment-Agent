import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DecimalPipe, NgClass, UpperCasePipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { InrPipe } from '../../shared/pipes/inr.pipe';
import type { Holding, SipPerformance, SipPlan } from '../../core/models';

@Component({
  selector: 'app-sip',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, DecimalPipe, UpperCasePipe, NgClass, InrPipe],
  templateUrl: './sip.html',
  styleUrl: './sip.scss',
})
export class SipPage {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);

  loading = signal(true);
  saving = signal(false);
  showModal = signal(false);
  isEditing = signal(false);
  selectedPlanId = signal<number | null>(null);

  plans = signal<SipPlan[]>([]);
  reminders = signal<SipPlan[]>([]);
  performance = signal<SipPerformance | null>(null);
  holdings = signal<Holding[]>([]);

  readonly frequencies: Array<SipPlan['frequency']> = ['weekly', 'monthly', 'quarterly'];

  form = this.fb.nonNullable.group({
    holding_id: 0,
    fund_name: ['', [Validators.required, Validators.minLength(2)]],
    folio_number: [''],
    amount: [1000, [Validators.required, Validators.min(100)]],
    frequency: ['monthly' as SipPlan['frequency'], Validators.required],
    sip_day: [5, [Validators.required, Validators.min(1), Validators.max(31)]],
    next_due_date: ['', Validators.required],
    start_date: [''],
    end_date: [''],
    auto_reminder: [true],
    reminder_days_before: [2, [Validators.required, Validators.min(0), Validators.max(15)]],
    notes: [''],
  });

  totalPnlClass = computed(() => {
    const perf = this.performance();
    if (!perf) return '';
    return perf.totalPnl >= 0 ? 'positive' : 'negative';
  });

  constructor() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.sipPlans().pipe(catchError(() => of([]))).subscribe((plans) => this.plans.set(plans));
    this.api.sipReminders(7).pipe(catchError(() => of([]))).subscribe((reminders) => this.reminders.set(reminders));
    this.api.sipPerformance().pipe(catchError(() => of(null))).subscribe((perf) => this.performance.set(perf));
    this.api.holdings('mutual_fund').pipe(catchError(() => of([]))).subscribe((holdings) => {
      this.holdings.set(holdings);
      this.loading.set(false);
    });
  }

  openAdd() {
    this.isEditing.set(false);
    this.selectedPlanId.set(null);
    this.form.reset({
      holding_id: 0,
      fund_name: '',
      folio_number: '',
      amount: 1000,
      frequency: 'monthly',
      sip_day: 5,
      next_due_date: new Date().toISOString().slice(0, 10),
      start_date: '',
      end_date: '',
      auto_reminder: true,
      reminder_days_before: 2,
      notes: '',
    });
    this.showModal.set(true);
  }

  openEdit(plan: SipPlan) {
    this.isEditing.set(true);
    this.selectedPlanId.set(plan.id);
    this.form.reset({
      holding_id: plan.holding_id ?? 0,
      fund_name: plan.fund_name,
      folio_number: plan.folio_number ?? '',
      amount: plan.amount,
      frequency: plan.frequency,
      sip_day: plan.sip_day,
      next_due_date: plan.next_due_date,
      start_date: plan.start_date ?? '',
      end_date: plan.end_date ?? '',
      auto_reminder: !!plan.auto_reminder,
      reminder_days_before: plan.reminder_days_before,
      notes: plan.notes ?? '',
    });
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
    this.selectedPlanId.set(null);
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    const v = this.form.getRawValue();
    const payload = {
      holding_id: v.holding_id || null,
      fund_name: v.fund_name,
      folio_number: v.folio_number || null,
      amount: Number(v.amount),
      frequency: v.frequency,
      sip_day: Number(v.sip_day),
      next_due_date: v.next_due_date,
      start_date: v.start_date || null,
      end_date: v.end_date || null,
      auto_reminder: v.auto_reminder,
      reminder_days_before: Number(v.reminder_days_before),
      notes: v.notes || null,
    };

    const req = this.isEditing() && this.selectedPlanId()
      ? this.api.updateSipPlan(this.selectedPlanId() as number, payload)
      : this.api.addSipPlan(payload);

    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.closeModal();
        this.load();
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }

  deletePlan(plan: SipPlan, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete SIP plan for ${plan.fund_name}?`)) return;
    this.api.deleteSipPlan(plan.id).subscribe(() => this.load());
  }

  triggerReminders() {
    this.api.runSipReminders().subscribe(() => this.load());
  }

  dueLabel(days?: number) {
    if (days == null) return 'Upcoming';
    if (days <= 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `Due in ${days} days`;
  }
}
