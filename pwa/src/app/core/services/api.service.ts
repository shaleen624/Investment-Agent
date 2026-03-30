import { Injectable, inject }           from '@angular/core';
import { HttpClient, HttpParams }        from '@angular/common/http';
import { Observable }                    from 'rxjs';
import type {
  AgentStatus, PortfolioSummary, Holding,
  Goal, Brief, MarketSnapshot, NewsArticle, Recommendation,
} from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = '/api';

  // ── Authentication ────────────────────────────────────────────────────────
  login(username: string, password: string): Observable<{ token: string; user: any }> {
    return this.http.post<any>(`${this.base}/auth/login`, { username, password });
  }

  register(username: string, password: string): Observable<{ token: string; user: any }> {
    return this.http.post<any>(`${this.base}/auth/register`, { username, password });
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.base}/auth/logout`, {});
  }

  verify(): Observable<{ valid: boolean; user: any }> {
    return this.http.get<any>(`${this.base}/auth/verify`);
  }

  // ── Status ────────────────────────────────────────────────────────────────
  status(): Observable<AgentStatus> {
    return this.http.get<AgentStatus>(`${this.base}/status`);
  }

  // ── Portfolio ─────────────────────────────────────────────────────────────
  portfolioSummary(): Observable<PortfolioSummary> {
    return this.http.get<PortfolioSummary>(`${this.base}/portfolio/summary`);
  }
  holdings(type?: string): Observable<Holding[]> {
    const options = type ? { params: { type } } : {};
    return this.http.get<Holding[]>(`${this.base}/portfolio/holdings`, options);
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

  // ── Goals ─────────────────────────────────────────────────────────────────
  goals(all = false): Observable<Goal[]> {
    const options = all ? { params: { all: 'true' } } : {};
    return this.http.get<Goal[]>(`${this.base}/goals`, options);
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
