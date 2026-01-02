import React, { createContext, useContext, useMemo, useRef } from "react";

/**
 * ModelProvider + useModel (JavaScript 버전)
 * - UI5의 모델처럼 React에서 `useModel('Auth')`, `useModel('Project')` 로 사용
 * - 공통 CRUD(SELECT/CREATE/UPDATE/DELETE), $select/$filter/$orderby/$expand/$top/$skip 지원
 * - CAP/AppRouter 환경에서 CSRF 토큰 자동 취득 및 갱신, 403 시 1회 재시도 (옵션)
 * - ETag(If-Match) 처리
 * - 서비스별 베이스 URL 라우팅 (예: /auth, /odata/v4/project, ...)
 */

// -------------------------------------------------------
// 유틸: 쿼리스트링 빌더 (OData V4 공통)
// -------------------------------------------------------
function buildQuery(params) {
  if (!params) return '';
  const q = {};
  const add = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) {
      if (v.length === 0) return;
      q[k] = v.join(',');
    } else if (typeof v === 'boolean') {
      q[k] = v ? 'true' : 'false';
    } else {
      q[k] = String(v);
    }
  };

  add('$select', params.select);
  add('$filter', Array.isArray(params.filter) ? params.filter.join(' and ') : params.filter);
  add('$orderby', params.orderby);
  add('$expand', params.expand);
  add('$top', params.top);
  add('$skip', params.skip);
  add('$count', params.count);
  add('$search', params.search);

  for (const k of Object.keys(params)) {
    if (k.startsWith('$')) continue;
    if (['select', 'filter', 'orderby', 'expand', 'top', 'skip', 'count', 'search'].includes(k)) continue;
    add(k, params[k]);
  }

  const parts = [];
  for (const [key, value] of Object.entries(q)) {
    parts.push(
      encodeURIComponent(key) + '=' + encodeURIComponent(value)
    );
  }
  const qs = parts.join('&');
  return qs ? `?${qs}` : '';
}

// -------------------------------------------------------
// OData V4 Client (CAP/AppRouter 전제)
// -------------------------------------------------------
export class ODataClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.csrfToken = null;
    this.csrfFetchInFlight = null;
  }

  async fetch(input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init?.method || 'GET').toUpperCase();
    const isMutating = method !== 'GET';

    if (isMutating) {
      init = init || {};
      init.headers = {
        ...(init.headers || {})
      };

      try {
        await this.ensureCsrf();
        if (this.csrfToken) {
          init.headers['x-csrf-token'] = this.csrfToken;
        }
      } catch (e) {
        console.warn('[ODataClient] CSRF 토큰 확보 실패, 토큰 없이 진행합니다:', e?.message);
      }

      const res = await fetch(url, init);

      if (res.status === 403) {
        try {
          await this.refreshCsrf();
          if (this.csrfToken) {
            const retry = await fetch(url, {
              ...init,
              headers: {
                ...init.headers,
                'x-csrf-token': this.csrfToken
              }
            });
            return retry;
          }
        } catch (e) {
          console.warn('[ODataClient] CSRF 재시도 실패:', e?.message);
        }
      }

      return res;
    }

    return fetch(url, init);
  }

  async ensureCsrf() {
    if (this.csrfToken !== null) return this.csrfToken;
    if (this.csrfFetchInFlight) return this.csrfFetchInFlight;
    this.csrfFetchInFlight = this.fetchCsrf();
    try {
      this.csrfToken = await this.csrfFetchInFlight;
      return this.csrfToken;
    } finally {
      this.csrfFetchInFlight = null;
    }
  }

  async refreshCsrf() {
    this.csrfToken = null;
    await this.ensureCsrf();
  }

  async fetchCsrf() {
    try {
      const res = await fetch(join(this.baseUrl, ''), {
        method: 'GET',
        headers: { 'x-csrf-token': 'Fetch' }
      });

      const token = res.headers.get('x-csrf-token');

      if (!token) {
        console.warn(
          '[ODataClient] CSRF token header 미존재. 이 서비스는 CSRF를 강제하지 않는 것으로 간주합니다:',
          this.baseUrl
        );
        return '';
      }

      return token;
    } catch (e) {
      console.warn('[ODataClient] CSRF token 요청 중 오류, 토큰 없이 진행합니다:', e?.message);
      return '';
    }
  }

  keyPredicate(key) {
    if (typeof key === 'string' || typeof key === 'number') return `(${encodeURIComponent(String(key))})`;
    const parts = Object.entries(key).map(([k, v]) => {
      const val = typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v);
      return `${k}=${val}`;
    });
    return `(${parts.join(',')})`;
  }

  async select(entitySet, options) {
    const qs = buildQuery(options);
    const res = await this.fetch(join(this.baseUrl, `${entitySet}${qs}`));
    if (!res.ok) throw new Error(`[SELECT ${entitySet}] ${res.status} ${res.statusText}`);
    return res.json();
  }

  async getByKey(entitySet, key, options) {
    const qs = buildQuery(options);
    const res = await this.fetch(`${this.baseUrl}/${entitySet}${this.keyPredicate(key)}${qs}`);
    if (!res.ok) throw new Error(`[GET ${entitySet}] ${res.status} ${res.statusText}`);
    return res.json();
  }

  async create(entitySet, data) {
    const res = await this.fetch(`${this.baseUrl}/${entitySet}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`[CREATE ${entitySet}] ${res.status} ${res.statusText}`);
    return res.json();
  }

  async update(entitySet, key, data, opts) {
    const res = await this.fetch(`${this.baseUrl}/${entitySet}${this.keyPredicate(key)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(opts?.etag ? { 'If-Match': opts.etag } : { 'If-Match': '*' })
      },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`[UPDATE ${entitySet}] ${res.status} ${res.statusText}`);
    return res.json().catch(() => ({}));
  }

  async delete(entitySet, key, opts) {
    const res = await this.fetch(`${this.baseUrl}/${entitySet}${this.keyPredicate(key)}`, {
      method: 'DELETE',
      headers: {
        ...(opts?.etag ? { 'If-Match': opts.etag } : { 'If-Match': '*' })
      }
    });
    if (!res.ok) throw new Error(`[DELETE ${entitySet}] ${res.status} ${res.statusText}`);
    return true;
  }

  async call(path, payload, method = 'POST', extraQuery) {
    const qs = buildQuery(extraQuery);
    const url = join(this.baseUrl, `${path}${qs}`);
    const res = await this.fetch(url, {
      method,
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = new Error(`[CALL ${path}] ${res.status} ${res.statusText}`);
      err.status = res.status;
      err.statusText = res.statusText;
      err.data = json;
      throw err;
    }

    return json;
  }
}

// -------------------------------------------------------
// 구체 모델: GenericModel, AuthModel
// -------------------------------------------------------
export class GenericModel {
  constructor(client) { this.client = client; }
  select = (entitySet, options) => this.client.select(entitySet, options);
  getByKey = (entitySet, key, options) => this.client.getByKey(entitySet, key, options);
  create = (entitySet, data) => this.client.create(entitySet, data);
  update = (entitySet, key, data, opts) => this.client.update(entitySet, key, data, opts);
  delete = (entitySet, key, opts) => this.client.delete(entitySet, key, opts);
  call = (path, payload, method = 'POST', q) => this.client.call(path, payload, method, q);
}

export class AuthModel {
  constructor(client) {
    this.base = new GenericModel(client);
    this._cacheKey = 'workhub.auth.bootstrap';
  }

  async bootstrap(options = {}) {
    const { force = false } = options;

    const hasSession =
      typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';

    if (!force && hasSession) {
      const cached = window.sessionStorage.getItem(this._cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          return parsed;
        } catch (e) {
          console.warn('[Auth] bootstrap 캐시 파싱 실패, 무시:', e);
        }
      }
    }

    const res = await this.base.call('Bootstrap', undefined, 'GET');

    if (hasSession) {
      try {
        window.sessionStorage.setItem(this._cacheKey, JSON.stringify(res));
      } catch (e) {
        console.warn('[Auth] bootstrap 캐시 저장 실패:', e);
      }
    }

    return res;
  }

  clearCache() {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(this._cacheKey);
    }
  }

  async resetSession() {
    const res = await this.base.call('ResetSession', undefined, 'GET');
    this.clearCache();
    return res;
  }

  me() { return this.base.call('Me', undefined, 'GET'); }
  myRoles() { return this.base.call('MyRoles', undefined, 'GET'); }
  whoAmI() { return this.base.call('WhoAmI', undefined, 'GET'); }
  serverTime() { return this.base.call('ServerTime', undefined, 'GET'); }
  ping() { return this.base.call('Ping', undefined, 'GET'); }

  async submitTenantConfig(config) {
    const payload = { config };
    const res = await this.base.call('SubmitTenantConfig', payload, 'POST');
    // 설정이 변경되었으므로 캐시 초기화
    this.clearCache();
    return res;
  }
}

// -------------------------------------------------------
// Model Registry & Provider
// -------------------------------------------------------
const ModelContext = createContext(null);

function defaultFactories() {
  return {
    Auth: () => new AuthModel(new ODataClient('odata/v4/auth')),
    Project: () => new GenericModel(new ODataClient('odata/v4/project')),
    Task: () => new GenericModel(new ODataClient('odata/v4/task')),
    Closing: () => new GenericModel(new ODataClient('odata/v4/closing')),
    Effort: () => new GenericModel(new ODataClient('odata/v4/effort')),
    WorkStatus: () => new GenericModel(new ODataClient('odata/v4/workstatus')),
    User: () => new GenericModel(new ODataClient('odata/v4/user')),
    Code: () => new GenericModel(new ODataClient('odata/v4/code')),
  };
}

export function ModelProvider({ children, factories }) {
  const cacheRef = useRef(new Map());

  const mergedFactories = useMemo(() => ({
    ...defaultFactories(),
    ...(factories || {})
  }), [factories]);

  const api = useMemo(() => ({
    getModel: (name) => {
      const cache = cacheRef.current;
      if (!cache.has(name)) {
        const factory = mergedFactories[name];
        if (!factory) throw new Error(`Unknown model: ${name}`);
        cache.set(name, factory());
      }
      return cache.get(name);
    } 
  }), [mergedFactories]);

  return <ModelContext.Provider value={api}>{children}</ModelContext.Provider>;
}

export function useModel(name) {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error('useModel must be used inside <ModelProvider>');
  return ctx.getModel(name);
}

function join(a, b = '') {
  const A = (a || '').replace(/\/+$/, '');      // 뒤 슬래시 제거
  const B = (b || '').replace(/^\/+/, '');      // 앞 슬래시 제거
  return A ? `${A}/${B}` : B;                  // base 없으면 상대경로 유지
}

