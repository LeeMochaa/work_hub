const cds = require('@sap/cds');
const { SELECT } = cds.ql;

// =====================================================
// Helper: Safe JSON stringify (순환 참조 방지)
// =====================================================
const safeJson = (obj, depth = 0) => {
  if (depth > 5) return '[Max Depth]';
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (typeof obj !== 'object') return String(obj);

  if (Array.isArray(obj)) return obj.map((item) => safeJson(item, depth + 1));

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'function') {
      result[key] = '[Function]';
      continue;
    }
    try {
      result[key] = safeJson(value, depth + 1);
    } catch (e) {
      result[key] = '[Circular]';
    }
  }
  return result;
};

// =====================================================
// Helper: 민감정보 마스킹
// =====================================================
const maskSecrets = (obj) => {
  const SENSITIVE_KEYS = [
    'pass', 'password', 'clientsecret', 'clientSecret', 'secret',
    'token', 'access_token', 'refresh_token', 'authorization',
    'verificationkey', 'privateKey'
  ];

  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(maskSecrets);

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const lk = String(key).toLowerCase();
    if (SENSITIVE_KEYS.some((sk) => lk.includes(sk))) {
      result[key] = '***';
    } else {
      result[key] = maskSecrets(value);
    }
  }
  return result;
};

// =====================================================
// Helper: "한 줄" 로그 출력 (CF 로그에서 한 칸으로 보이게)
// =====================================================
const logOneLine = (title, payload, opts = {}) => {
  const { level = 'log' } = opts;
  const now = new Date().toISOString();

  // ✅ 중요: pretty-print(null,2) 금지 → 줄바꿈 발생
  // ✅ JSON 한 줄로: CF 로그에서 한 줄(한 칸)로 보임
  const line = JSON.stringify(
    {
      ts: now,
      tag: title,
      ...maskSecrets(safeJson(payload))
    }
  );

  if (level === 'warn') console.warn(line);
  else if (level === 'error') console.error(line);
  else console.log(line);
};

// =====================================================
// Helper: user flags 계산
// =====================================================
const computeFlags = (req) => {
  const isFn = typeof req.user?.is === 'function';
  const is = (role) => (isFn ? !!req.user.is(role) : false);

  return {
    // 네 시스템에 SYSADMIN scope가 있으면 매핑, 없으면 그냥 false로 유지됨
    SYSADMIN: is('SYSADMIN'),

    // ✅ 프론트가 기대하는 "ADMIN"은 백엔드 role "Administrator"에서 매핑
    ADMIN: is('Administrator'),

    LEADER: is('Leader'),
    USER: is('User'),

    // CAP/XSUAA에서 종종 authenticated-user scope가 있음
    AUTHENTICATED: is('authenticated-user') || !!req.user?.id
  };
};

const buildUser = (req) => {
  const given = req.user?.attr?.givenName;
  const family = req.user?.attr?.familyName;

  // req.user.name이 undefined로 올 수 있으니 attr 기반으로 보정
  const name =
    req.user?.name ||
    ((given || family) ? `${given || ''} ${family || ''}`.trim() : undefined) ||
    req.user?.id ||
    'unknown';

  return {
    id: req.user?.id || 'unknown',
    name,
    tenant: req.tenant || req.user?.tenant || 'default',
    email: req.user?.attr?.email || req.user?.id || 'unknown',
    raw: JSON.stringify(safeJson(req.user || {}))
  };
};

const extractRoles = (req) => {
  // req.user.roles 가 object일 때 key만 뽑아서 배열로
  const rolesObj = req.user?.roles;
  if (!rolesObj || typeof rolesObj !== 'object') return [];
  return Object.keys(rolesObj);
};

// =====================================================
// Service Implementation
// =====================================================
module.exports = cds.service.impl(async function () {

  // =====================================================
  // Bootstrap
  // =====================================================
  this.on('Bootstrap', async (req) => {
    const flags = computeFlags(req);
    const user = buildUser(req);

    // ✅ 로그를 한 줄로 깔끔하게
    logOneLine('BOOTSTRAP', {
      method: req.method,
      path: req.path,
      url: req.url,
      tenant: req.tenant,
      headers: {
        // 보고 싶은 헤더만 추려서 (너무 많으면 로그가 길어짐)
        'x-forwarded-host': req.headers?.['x-forwarded-host'],
        'x-forwarded-path': req.headers?.['x-forwarded-path'],
        'x-forwarded-proto': req.headers?.['x-forwarded-proto'],
        'x-correlationid': req.headers?.['x-correlationid'],
        'x-vcap-request-id': req.headers?.['x-vcap-request-id']
      },
      user: {
        id: req.user?.id,
        name: req.user?.name,
        attr: req.user?.attr,
        // 디버깅용: is() 결과만 간단히
        is: (typeof req.user?.is === 'function') ? {
          SYSADMIN: req.user.is('SYSADMIN'),
          Administrator: req.user.is('Administrator'),
          Leader: req.user.is('Leader'),
          User: req.user.is('User'),
          'authenticated-user': req.user.is('authenticated-user')
        } : null
      },
      computedFlags: flags
    });

    return {
      user,
      roles: extractRoles(req),
      flags,
      serverTime: {
        now: new Date(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        iso: new Date().toISOString()
      },
      adminEmail: '',
      isConfigured: false
    };
  });

  // =====================================================
  // Me
  // =====================================================
  this.on('Me', async (req) => {
    const user = buildUser(req);
    logOneLine('ME', { user });
    return user;
  });

  // =====================================================
  // MyRoles
  // =====================================================
  this.on('MyRoles', async (req) => {
    const roles = extractRoles(req);
    logOneLine('MYROLES', { roles });
    return roles;
  });

  // =====================================================
  // WhoAmI (flags만 반환)
  // =====================================================
  this.on('WhoAmI', async (req) => {
    const flags = computeFlags(req);
    logOneLine('WHOAMI', { flags });
    return flags;
  });

  // =====================================================
  // ServerTime / Ping
  // =====================================================
  this.on('ServerTime', () => ({
    now: new Date(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    iso: new Date().toISOString()
  }));

  this.on('Ping', () => 'pong');

  // =====================================================
  // ResetSession
  // =====================================================
  this.on('ResetSession', async (req) => {
    logOneLine('RESET_SESSION', { user: req.user?.id, tenant: req.tenant });
    return true;
  });

  // =====================================================
  // RequestAccessMail (미구현)
  // =====================================================
  this.on('RequestAccessMail', async (req) => {
    logOneLine('REQUEST_ACCESS_MAIL', {
      user: req.user?.id,
      tenant: req.tenant,
      data: req.data
    });

    return {
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: '구현 대기 중',
      retryAfterDays: 0
    };
  });

  // =====================================================
  // SubmitTenantConfig (미구현)
  // =====================================================
  this.on('SubmitTenantConfig', async (req) => {
    logOneLine('SUBMIT_TENANT_CONFIG', {
      user: req.user?.id,
      tenant: req.tenant,
      data: req.data
    });

    return {
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: '구현 대기 중'
    };
  });
});
