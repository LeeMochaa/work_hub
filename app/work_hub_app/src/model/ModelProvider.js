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
// 전역 인증 관리자 (팝업 방식)
// -------------------------------------------------------
class AuthManager {
  constructor() {
    this.pendingRequests = []; // 실패한 요청 큐
    this.isAuthenticating = false; // 인증 진행 중 플래그
    this.authWindow = null; // 인증 창 참조
    this.setupMessageListener();
  }

  // 실패한 요청을 큐에 추가
  queueRequest(requestInfo) {
    return new Promise((resolve, reject) => {
      this.pendingRequests.push({
        ...requestInfo,
        resolve,
        reject
      });

      // 첫 번째 요청이면 인증 시작
      if (!this.isAuthenticating) {
        this.startAuthentication();
      }
    });
  }

  // 인증 시작
  startAuthentication() {
    if (this.isAuthenticating) return;

    this.isAuthenticating = true;

    // 현재 URL로 팝업을 띄움 (AppRouter가 세션 없음을 감지하고 로그인 페이지로 리다이렉트)
    const authUrl = window.location.href;

    // 새 탭/창에서 인증 창 열기
    this.authWindow = window.open(
      authUrl,
      'auth_popup', // 창 이름 지정 (App.js에서 감지용)
      'width=800,height=600,scrollbars=yes,resizable=yes'
    );

    if (!this.authWindow) {
      // 팝업이 차단된 경우
      console.warn('[AuthManager] 팝업이 차단되었습니다. 사용자에게 알림이 필요합니다.');
      alert('세션이 만료되었습니다. 팝업 차단을 해제하고 다시 시도해주세요.');
      this.isAuthenticating = false;
      return;
    }

    // 팝업이 닫혔는지 주기적으로 확인 (사용자가 그냥 닫아버린 경우 대비)
    const checkClosed = setInterval(() => {
      if (this.authWindow && this.authWindow.closed) {
        clearInterval(checkClosed);
        // 팝업이 닫혔는데 아직 인증 완료 처리가 안됐다면 실패 처리할 수도 있음
        // 하지만 여기서는 사용자가 로그인을 완료하고 팝업이 스스로 닫힌 경우를 가정
        // (postMessage 핸들러가 처리함)
      }
    }, 1000);
  }

  // 메시지 리스너 설정
  setupMessageListener() {
    window.addEventListener('message', (event) => {
      // 보안: 같은 origin에서만 메시지 수신
      if (event.origin !== window.location.origin) return;

      if (event.data === 'auth-complete') {
        console.log('[AuthManager] 인증 완료 메시지를 받았습니다.');
        this.onAuthComplete();
      }
    });
  }

  // 인증 완료 처리
  async onAuthComplete() {
    console.log('[AuthManager] 인증 완료. 대기 중인 요청들을 재시도합니다.');

    this.isAuthenticating = false;

    // 잠시 대기 (쿠키 전파 시간)
    await new Promise(resolve => setTimeout(resolve, 500));

    // 대기 중인 요청들을 재시도
    const requests = [...this.pendingRequests];
    this.pendingRequests = [];

    for (const request of requests) {
      try {
        // CSRF 토큰 갱신 (POST/PUT/PATCH/DELETE)
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
          try {
            // CSRF Fetch
            let baseUrl = request.baseUrl || window.location.origin;
            const csrfRes = await fetch(baseUrl, {
              method: 'HEAD',
              headers: { 'x-csrf-token': 'Fetch' },
              credentials: 'include'
            });
            const newToken = csrfRes.headers.get('x-csrf-token');
            if (newToken) {
              request.headers = request.headers || {};
              request.headers['x-csrf-token'] = newToken;
            }
          } catch (e) {
            console.warn('[AuthManager] CSRF refresh failed', e);
          }
        }

        // 요청 재시도
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          credentials: 'include'
        });

        if (response.ok) {
          // 성공
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const data = await response.json().catch(() => ({}));
            request.resolve(data);
          } else {
            request.resolve({});
          }
        } else {
          // 또 실패?
          request.reject(new Error(`[Retry] ${response.status} ${response.statusText}`));
        }
      } catch (error) {
        request.reject(error);
      }
    }
  }
}

const globalAuthManager = new AuthManager();

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

      // credentials: 'include' 추가 (세션 쿠키 포함)
      const res = await fetch(url, {
        ...init,
        credentials: 'include'
      });

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
            const retry = await fetch(url, {
              ...retryInit,
              credentials: 'include'
            });
            return retry;
          }
        } catch (e) {
          console.warn('[ODataClient] CSRF 재시도 실패:', e?.message);
        }
      }

      return res;
    }

    return fetch(url, {
      ...init,
      credentials: 'include'
    });
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




  // 401 Unauthorized 처리: 전역 인증 관리자를 통해 처리
  async handleUnauthorized(res, operation, requestInfo) {
    if (res.status === 401) {
      console.warn(`[ODataClient] 401 Unauthorized (${operation}) - 팝업 인증을 시도합니다.`);

      const requestInfoWithBase = {
        ...requestInfo,
        baseUrl: this.baseUrl
      };

      return globalAuthManager.queueRequest(requestInfoWithBase);
    }
    return null;
  }

  async select(entitySet, options) {
    const qs = buildQuery(options);
    const url = join(this.baseUrl, `${entitySet}${qs}`);
    const res = await this.fetch(url);
    if (!res.ok) {
      if (res.status === 401) {
        const retry = await this.handleUnauthorized(res, `SELECT ${entitySet}`, {
          url,
          method: 'GET',
          headers: {},
          body: null
        });
        if (retry) return retry;
      }
      throw new Error(`[SELECT ${entitySet}] ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async getByKey(entitySet, key, options) {
    const qs = buildQuery(options);
    const url = `${this.baseUrl}/${entitySet}${this.keyPredicate(key)}${qs}`;
    const res = await this.fetch(url);
    if (!res.ok) {
      if (res.status === 401) {
        const retry = await this.handleUnauthorized(res, `GET ${entitySet}`, {
          url,
          method: 'GET',
          headers: {},
          body: null
        });
        if (retry) return retry;
      }
      throw new Error(`[GET ${entitySet}] ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async create(entitySet, data) {
    const url = `${this.baseUrl}/${entitySet}`;
    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify(data);

    // CSRF 토큰 추가
    try {
      const csrfToken = await this.ensureCsrf();
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
      }
    } catch (e) {
      console.warn('[ODataClient] CSRF 토큰 확보 실패:', e?.message);
    }

    const res = await this.fetch(url, {
      method: 'POST',
      headers,
      body
    });

    if (!res.ok) {
      if (res.status === 401) {
        const retry = await this.handleUnauthorized(res, `CREATE ${entitySet}`, {
          url,
          method: 'POST',
          headers,
          body
        });
        if (retry) return retry;
      }
      throw new Error(`[CREATE ${entitySet}] ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async update(entitySet, key, data, opts) {
    const url = `${this.baseUrl}/${entitySet}${this.keyPredicate(key)}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(opts?.etag ? { 'If-Match': opts.etag } : { 'If-Match': '*' })
    };
    const body = JSON.stringify(data);

    // CSRF 토큰 추가
    try {
      const csrfToken = await this.ensureCsrf();
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
      }
    } catch (e) {
      console.warn('[ODataClient] CSRF 토큰 확보 실패:', e?.message);
    }

    const res = await this.fetch(url, {
      method: 'PATCH',
      headers,
      body
    });

    if (!res.ok) {
      if (res.status === 401) {
        const retry = await this.handleUnauthorized(res, `UPDATE ${entitySet}`, {
          url,
          method: 'PATCH',
          headers,
          body
        });
        if (retry) return retry;
      }
      throw new Error(`[UPDATE ${entitySet}] ${res.status} ${res.statusText}`);
    }
    return res.json().catch(() => ({}));
  }

  async delete(entitySet, key, opts) {
    const url = `${this.baseUrl}/${entitySet}${this.keyPredicate(key)}`;
    const headers = {
      ...(opts?.etag ? { 'If-Match': opts.etag } : { 'If-Match': '*' })
    };

    // CSRF 토큰 추가
    try {
      const csrfToken = await this.ensureCsrf();
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
      }
    } catch (e) {
      console.warn('[ODataClient] CSRF 토큰 확보 실패:', e?.message);
    }

    const res = await this.fetch(url, {
      method: 'DELETE',
      headers
    });

    if (!res.ok) {
      if (res.status === 401) {
        const retry = await this.handleUnauthorized(res, `DELETE ${entitySet}`, {
          url,
          method: 'DELETE',
          headers,
          body: null
        });
        if (retry !== null) return retry === true ? true : retry;
      }
      throw new Error(`[DELETE ${entitySet}] ${res.status} ${res.statusText}`);
    }
    return true;
  }

  async call(path, payload, method = 'POST', extraQuery) {
    const qs = buildQuery(extraQuery);
    const url = join(this.baseUrl, `${path}${qs}`);
    const headers = payload ? { 'Content-Type': 'application/json' } : {};
    const body = payload ? JSON.stringify(payload) : undefined;

    // CSRF 토큰 추가 (POST, PUT, PATCH, DELETE 메서드인 경우)
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        const csrfToken = await this.ensureCsrf();
        if (csrfToken) {
          headers['x-csrf-token'] = csrfToken;
        }
      } catch (e) {
        console.warn('[ODataClient] CSRF 토큰 확보 실패:', e?.message);
      }
    }

    const res = await this.fetch(url, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body
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
      if (res.status === 401) {
        const retry = await this.handleUnauthorized(res, `CALL ${path}`, {
          url,
          method,
          headers,
          body
        });
        if (retry) return retry;
      }

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
    // ✅ sessionStorage 캐시를 사용하지 않으므로 _cacheKey 제거
  }

  async bootstrap(options = {}) {
    // ✅ sessionStorage 캐시 완전 제거
    // 항상 서버에서 최신 인증 상태를 확인하도록 변경
    // BTP에서 로그아웃하면 모든 앱에서 인증이 안 되어야 하므로 캐시 사용 안 함

    // CAP function 호출 시 괄호 필요: Bootstrap() 형식
    // 서버에서 직접 가져오므로 항상 최신 인증 상태 반영
    const res = await this.base.call('Bootstrap()', undefined, 'GET');

    return res;
  }

  clearCache() {
    // sessionStorage 캐시를 사용하지 않으므로 아무것도 하지 않음
    // 호환성을 위해 메서드는 유지
  }

  async resetSession() {
    // resetSession은 서버 측 세션 초기화용
    // 클라이언트 측 캐시는 사용하지 않으므로 clearCache() 호출만
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
    // 캐시를 사용하지 않으므로 clearCache() 호출 불필요
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

