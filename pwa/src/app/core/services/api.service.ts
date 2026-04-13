import { Injectable, inject }           from '@angular/core';
import { HttpClient, HttpParams }        from '@angular/common/http';
import { Observable }                    from 'rxjs';
import type {
  AgentStatus, PortfolioSummary, Holding,
  Goal, Brief, MarketSnapshot, NewsArticle, Recommendation,
  SipPlan, SipPerformance,
} from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = '/api';

  // ── Status ────────────────────────────────────────────────────────────────
  status(): Observable<AgentStatus> {
    return this.http.get<AgentStatus>(`${this.base}/status`);
  }

  // ── Portfolio ─────────────────────────────────────────────────────────────
  portfolioSummary(): Observable<PortfolioSummary> {
    return this.http.get<PortfolioSummary>(`${this.base}/portfolio/summary`);
  }
  holdings(type?: string): Observable<Holding[]> {
    const params = type ? new HttpParams().set('type', type) : undefined;
    return this.http.get<Holding[]>(`${this.base}/portfolio/holdings`, params ? { params } : undefined);
  }
  holding(id: number): Observable<Holding> {
    return this.http.get<Holding>(`${this.base}/portfolio/holdings/${id}`);
  }
  addHolding(h: Partial<Holding>): Observable<Holding> {
    return this.http.post<Holding>(`${this.base}/portfolio/holdings`, h);
  }
  updateHolding(id: number, h: Partial<Holding>): Observable<Holding> {
    return this.http.put<Holding>(`${this.base}/portfolio/holdings/${id}`, h);
  }
  deleteHolding(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/portfolio/holdings/${id}`);
  }
  importText(text: string): Observable<{ parsed: number; holdings: Holding[] }> {
    return this.http.post<any>(`${this.base}/portfolio/import/text`, { text });
  }
  importFile(file: File): Observable<{ parsed: number; holdings: Holding[] }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<any>(`${this.base}/portfolio/import/file`, fd);
  }
  refreshPrices(): Observable<{ updated: number; failed: number }> {
    return this.http.post<any>(`${this.base}/portfolio/prices/refresh`, {});
  }
  syncBroker(broker: 'kite'|'groww'): Observable<{ synced: number }> {
    return this.http.post<any>(`${this.base}/portfolio/sync/${broker}`, {});
  }

  sipPlans(all = false): Observable<SipPlan[]> {
    const params = all ? new HttpParams().set('all', 'true') : undefined;
    return this.http.get<SipPlan[]>(`${this.base}/portfolio/sip/plans`, params ? { params } : undefined);
  }
  sipPlan(id: number): Observable<SipPlan> {
    return this.http.get<SipPlan>(`${this.base}/portfolio/sip/plans/${id}`);
  }
  addSipPlan(plan: Partial<SipPlan>): Observable<SipPlan> {
    return this.http.post<SipPlan>(`${this.base}/portfolio/sip/plans`, plan);
  }
  updateSipPlan(id: number, plan: Partial<SipPlan>): Observable<SipPlan> {
    return this.http.put<SipPlan>(`${this.base}/portfolio/sip/plans/${id}`, plan);
  }
  deleteSipPlan(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/portfolio/sip/plans/${id}`);
  }
  sipPerformance(): Observable<SipPerformance> {
    return this.http.get<SipPerformance>(`${this.base}/portfolio/sip/performance`);
  }
  sipReminders(days = 3): Observable<SipPlan[]> {
    return this.http.get<SipPlan[]>(`${this.base}/portfolio/sip/reminders`, { params: { days: String(days) } });
  }
  runSipReminders(): Observable<{ checked: number; sent: number }> {
    return this.http.post<{ checked: number; sent: number }>(`${this.base}/notifications/sip-reminders/run`, {});
  }

  // ── Goals ─────────────────────────────────────────────────────────────────
  goals(all = false): Observable<Goal[]> {
    return this.http.get<Goal[]>(`${this.base}/goals`, { params: all ? { all: 'true' } : {} });
  }
  addGoal(g: Partial<Goal>): Observable<Goal> {
    return this.http.post<Goal>(`${this.base}/goals`, g);
  }
  updateGoal(id: number, g: Partial<Goal>): Observable<Goal> {
    return this.http.put<Goal>(`${this.base}/goals/${id}`, g);
  }
  deleteGoal(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/goals/${id}`);
  }

  // ── Briefs ────────────────────────────────────────────────────────────────
  briefs(type?: 'morning'|'evening', limit = 10): Observable<Brief[]> {
    const params: Record<string, string> = { limit: String(limit) };
    if (type) params['type'] = type;
    return this.http.get<Brief[]>(`${this.base}/briefs`, { params });
  }
  latestBrief(type: 'morning'|'evening'): Observable<Brief> {
    return this.http.get<Brief>(`${this.base}/briefs/latest`, { params: { type } });
  }
  brief(id: number): Observable<Brief> {
    return this.http.get<Brief>(`${this.base}/briefs/${id}`);
  }
  generateBrief(type: 'morning'|'evening', send = true): Observable<any> {
    return this.http.post(`${this.base}/briefs/generate`, { type, send });
  }
  briefRecommendations(id: number): Observable<Recommendation[]> {
    return this.http.get<Recommendation[]>(`${this.base}/briefs/${id}/recommendations`);
  }

  // ── Market ────────────────────────────────────────────────────────────────
  marketSnapshot(): Observable<MarketSnapshot> {
    return this.http.get<MarketSnapshot>(`${this.base}/market/snapshot`);
  }
  marketHistory(days = 7): Observable<MarketSnapshot[]> {
    return this.http.get<MarketSnapshot[]>(`${this.base}/market/snapshots`, { params: { days: String(days) } });
  }
  refreshMarket(): Observable<any> {
    return this.http.post(`${this.base}/market/refresh`, {});
  }
  recommendations(limit = 10): Observable<Recommendation[]> {
    return this.http.get<Recommendation[]>(`${this.base}/market/recommendations`, { params: { limit: String(limit) } });
  }

  // ── News ──────────────────────────────────────────────────────────────────
  news(limit = 20, hours = 24): Observable<NewsArticle[]> {
    return this.http.get<NewsArticle[]>(`${this.base}/news`, { params: { limit: String(limit), hours: String(hours) } });
  }
  fetchNews(): Observable<{ fetched: number }> {
    return this.http.post<any>(`${this.base}/news/fetch`, {});
  }

  // ── Notifications ─────────────────────────────────────────────────────────
  testNotifications(): Observable<Record<string, { ok: boolean; error?: string }>> {
    return this.http.post<any>(`${this.base}/notifications/test`, {});
  }
  profile(): Observable<any> {
    return this.http.get(`${this.base}/notifications/profile`);
  }
  updateProfile(data: any): Observable<any> {
    return this.http.put(`${this.base}/notifications/profile`, data);
  }
}
