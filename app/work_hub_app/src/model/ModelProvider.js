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

      // CSRF 토큰 확보 시도
      let csrfToken = null;
      try {
        csrfToken = await this.ensureCsrf();
      } catch (e) {
        console.warn('[ODataClient] CSRF 토큰 확보 실패:', e?.message);
        // CSRF 토큰이 없어도 일단 요청은 시도 (서버에서 403 반환하면 재시도)
      }

      if (csrfToken) {
        init.headers['x-csrf-token'] = csrfToken;
      }

      const res = await fetch(url, init);

      // 403 Forbidden이면 CSRF 토큰 문제일 수 있으므로 재시도
      if (res.status === 403) {
        try {
          // CSRF 토큰 갱신 시도
          await this.refreshCsrf();
          if (this.csrfToken) {
            const retryInit = {
              ...init,
              headers: {
                ...init.headers,
                'x-csrf-token': this.csrfToken
              }
            };
            const retry = await fetch(url, retryInit);
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

    // 응답이 JSON인지 확인
    const contentType = res.headers.get('content-type') || '';
    let json = {};
    
    // Response 스트림은 한 번만 읽을 수 있으므로, text()로 읽어서 처리
    try {
      // res.json() 대신 res.text()를 사용하여 Readable 스트림 문제 방지
      const text = await res.text();
      
      if (text && text.trim()) {
        try {
          // 텍스트를 JSON으로 파싱
          json = JSON.parse(text);
        } catch (e) {
          // 파싱 실패 시
          if (contentType.includes('application/json')) {
            // JSON이라고 했는데 파싱 실패하면 오류
            console.error(`[ODataClient] JSON 파싱 실패 (${path}):`, e.message);
            throw new Error(`JSON 파싱 실패: ${e.message}`);
          } else {
            // JSON이 아니면 텍스트 응답으로 처리
            console.warn(`[ODataClient] JSON 파싱 실패 (${path}), 텍스트 응답으로 처리:`, e.message);
            json = { raw: text };
          }
        }
      }
    } catch (e) {
      // 응답 읽기 실패
      console.warn(`[ODataClient] 응답 읽기 실패 (${path}):`, e.message);
      // 오류가 발생해도 빈 객체로 진행 (상태 코드로 판단)
    }

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

    // CAP function 호출 시 괄호 필요: Bootstrap() 형식
    const res = await this.base.call('Bootstrap()', undefined, 'GET');

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
    const res = await this.base.call('ResetSession()', undefined, 'GET');
    this.clearCache();
    return res;
  }

  me() { return this.base.call('Me()', undefined, 'GET'); }
  myRoles() { return this.base.call('MyRoles()', undefined, 'GET'); }
  whoAmI() { return this.base.call('WhoAmI()', undefined, 'GET'); }
  serverTime() { return this.base.call('ServerTime()', undefined, 'GET'); }
  ping() { return this.base.call('Ping', undefined, 'GET'); }

  async submitTenantConfig(config) {
    const payload = { config };
    const res = await this.base.call('SubmitTenantConfig', payload, 'POST');
    // 설정이 변경되었으므로 캐시 초기화
    this.clearCache();
    return res;
  }

  async uploadLogo(logoBase64, logoContentType, logoFilename) {
    const payload = {
      logo: {
        logoBase64,
        logoContentType,
        logoFilename
      }
    };
    return await this.base.call('UploadLogo', payload, 'POST');
  }

  async getLogo() {
    try {
      // CAP function 호출: GetLogo() 형식
      const res = await this.base.call('GetLogo()', undefined, 'GET');
      
      // 응답이 올바른 형식인지 확인
      if (!res || typeof res !== 'object') {
        throw new Error('로고 조회 실패: 잘못된 응답 형식');
      }
      
      if (!res.ok) {
        throw new Error(res.message || '로고를 가져올 수 없습니다.');
      }
      
      // base64 data URI 반환
      return res.logoBase64 || null;
    } catch (error) {
      // 오류 메시지 개선
      const message = error.message || '로고 조회 실패';
      throw new Error(`로고 조회 실패: ${message}`);
    }
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

