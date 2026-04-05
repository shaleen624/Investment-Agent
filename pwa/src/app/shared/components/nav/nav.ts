import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FormsModule }     from '@angular/forms';
import { ApiService }      from '../../../core/services/api.service';
import { AuthService }     from '../../../core/services/auth.service';
import { toSignal }        from '@angular/core/rxjs-interop';
import { catchError, of }  from 'rxjs';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

interface NavItem   { path: string; label: string; icon: SafeHtml; }
interface ModelOption { value: string; label: string; provider: string; free?: boolean; }

@Component({
  selector:    'app-nav',
  standalone:  true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports:     [RouterLink, RouterLinkActive, FormsModule],
  templateUrl: './nav.html',
  styleUrl:    './nav.scss',
})
export class NavComponent {
  private api       = inject(ApiService);
  private sanitizer = inject(DomSanitizer);
  auth = inject(AuthService);

  status = toSignal(
    this.api.status().pipe(catchError(() => of(null))),
    { initialValue: null }
  );

  llmConfig         = signal<any>(null);
  modelSelectorOpen = signal(false);
  saving            = signal(false);
  saveOk            = signal(false);
  selectedModel     = signal('');

  activeLabel = computed(() => {
    const cfg = this.llmConfig();
    if (!cfg) return '…';
    const val = cfg.active === 'openrouter' && cfg.model
      ? `openrouter:${cfg.model}` : cfg.active;
    return this.modelOptions.find(o => o.value === val)?.label ?? cfg.model ?? cfg.active;
  });

  modelOptions: ModelOption[] = [
    { value: 'deepseek', label: 'DeepSeek V3.2',   provider: 'NVIDIA NIM'  },
    { value: 'kimi',     label: 'Kimi K2',          provider: 'NVIDIA NIM'  },
    { value: 'openrouter:deepseek/deepseek-r1',                   label: 'DeepSeek R1',       provider: 'OpenRouter', free: true },
    { value: 'openrouter:deepseek/deepseek-v3-0324:free',         label: 'DeepSeek V3',       provider: 'OpenRouter', free: true },
    { value: 'openrouter:meta-llama/llama-4-maverick:free',       label: 'Llama 4 Maverick',  provider: 'OpenRouter', free: true },
    { value: 'openrouter:qwen/qwen3-235b-a22b:free',              label: 'Qwen3 235B',        provider: 'OpenRouter', free: true },
    { value: 'openrouter:mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small', provider: 'OpenRouter', free: true },
    { value: 'openrouter:google/gemini-2.5-pro-preview-03-25',   label: 'Gemini 2.5 Pro',    provider: 'OpenRouter' },
    { value: 'openrouter:anthropic/claude-sonnet-4-5',            label: 'Claude Sonnet 4.5', provider: 'OpenRouter' },
    { value: 'openrouter:openai/gpt-4o',                          label: 'GPT-4o',            provider: 'OpenRouter' },
    { value: 'claude',   label: 'Claude (direct)',  provider: 'Anthropic'   },
    { value: 'openai',   label: 'GPT-4o (direct)',  provider: 'OpenAI'      },
  ];

  get groupedOptions(): [string, ModelOption[]][] {
    const groups: Record<string, ModelOption[]> = {};
    for (const opt of this.modelOptions) { (groups[opt.provider] ??= []).push(opt); }
    return Object.entries(groups);
  }

  items: NavItem[] = [
    { path: 'dashboard', label: 'Dashboard', icon: this.svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>') },
    { path: 'holdings',  label: 'Holdings',  icon: this.svg('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>') },
    { path: 'briefs',    label: 'Briefs',    icon: this.svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>') },
    { path: 'market',    label: 'Market',    icon: this.svg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>') },
    { path: 'goals',     label: 'Goals',     icon: this.svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>') },
    { path: 'settings',  label: 'Settings',  icon: this.svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>') },
  ];

  constructor() {
    this.api.llmConfig().pipe(catchError(() => of(null))).subscribe(cfg => {
      this.llmConfig.set(cfg);
      if (cfg) {
        this.selectedModel.set(
          cfg.active === 'openrouter' && cfg.model ? `openrouter:${cfg.model}` : cfg.active
        );
      }
    });
  }

  toggleModelSelector() { this.modelSelectorOpen.update(v => !v); }

  applyModel(value: string) {
    if (!value || value === this.selectedModel()) { this.modelSelectorOpen.set(false); return; }
    this.selectedModel.set(value);
    this.saving.set(true);
    this.saveOk.set(false);
    this.modelSelectorOpen.set(false);

    const provider = value.startsWith('openrouter:') ? 'openrouter' : value;
    const model    = value.startsWith('openrouter:') ? value.slice('openrouter:'.length) : undefined;

    this.api.setLlmProvider(provider, model).subscribe({
      next: (res) => {
        this.llmConfig.update(c => ({ ...c, active: res.active, model: res.model }));
        this.saving.set(false);
        this.saveOk.set(true);
        setTimeout(() => this.saveOk.set(false), 2500);
      },
      error: () => this.saving.set(false),
    });
  }

  logout() { this.auth.logout(); }

  private svg(paths: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths}</svg>`
    );
  }
}
