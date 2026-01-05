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
  
  if (Array.isArray(obj)) {
    return obj.map(item => safeJson(item, depth + 1));
  }
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // 함수는 스킵
    if (typeof value === 'function') {
      result[key] = '[Function]';
      continue;
    }
    
    // 순환 참조 방지
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
    if (SENSITIVE_KEYS.some(sk => lk.includes(sk))) {
      result[key] = '***';
    } else {
      result[key] = maskSecrets(value);
    }
  }
  
  return result;
};

// =====================================================
// Helper: 블록 로그 출력
// =====================================================
const logBlock = (title, data, opts = {}) => {
  const { level = 'log' } = opts;
  const now = new Date().toISOString();
  
  let body = '';
  if (typeof data === 'string') {
    body = data;
  } else {
    body = JSON.stringify(maskSecrets(safeJson(data)), null, 2);
  }
  
  const block = `==================== [${title}] ====================
time: ${now}
${body}
=====================================================
`;
  
  if (level === 'warn') {
    console.warn(block);
  } else if (level === 'error') {
    console.error(block);
  } else {
    console.log(block);
  }
};

// =====================================================
// Service Implementation
// =====================================================
module.exports = cds.service.impl(async function () {
  
  // =====================================================
  // Bootstrap: req 객체 전체 구조 파악
  // =====================================================
  this.on('Bootstrap', async (req) => {
    logBlock('🔍 REQ_STRUCTURE_FULL', {
      // req 기본 정보
      method: req.method,
      path: req.path,
      url: req.url,
      headers: req.headers,
      
      // req.user 구조
      user: req.user ? {
        id: req.user.id,
        name: req.user.name,
        tenant: req.user.tenant,
        attr: req.user.attr,
        roles: req.user.roles,
        // req.user.is 함수가 있으면 어떤 역할들이 가능한지 테스트
        isFunction: typeof req.user.is === 'function' ? {
          SYSADMIN: req.user.is('SYSADMIN'),
          Administrator: req.user.is('Administrator'),
          Leader: req.user.is('Leader'),
          User: req.user.is('User'),
          'authenticated-user': req.user.is('authenticated-user')
        } : null
      } : null,
      
      // req.tenant
      tenant: req.tenant,
      
      // req.data
      data: req.data,
      
      // req.authInfo (있다면)
      authInfo: req.authInfo ? {
        // authInfo의 주요 속성만 (전체는 너무 클 수 있음)
        getToken: typeof req.authInfo.getToken === 'function' ? '[Function]' : null,
        getGrantType: typeof req.authInfo.getGrantType === 'function' ? '[Function]' : null,
        // 기타 속성들
        ...Object.keys(req.authInfo).reduce((acc, key) => {
          if (typeof req.authInfo[key] !== 'function') {
            acc[key] = req.authInfo[key];
          }
          return acc;
        }, {})
      } : null,
      
      // req._ (CAP 내부 속성, 있다면)
      _internal: req._ ? Object.keys(req._) : null
    });
    
    // 임시 반환값 (CDS 스키마에 맞춰서)
    return {
      user: {
        id: req.user?.id || 'unknown',
        name: req.user?.name || 'unknown',
        tenant: req.tenant || req.user?.tenant || 'default',
        email: req.user?.attr?.email || req.user?.id || 'unknown',
        raw: JSON.stringify(safeJson(req.user || {}))
      },
      roles: [],
      flags: {
        SYSADMIN: false,
        ADMIN: false,
        LEADER: false,
        USER: false,
        AUTHENTICATED: false
      },
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
  // 나머지 함수들도 임시로 구현 (에러 방지)
  // =====================================================
  this.on('Me', async (req) => {
    logBlock('🔍 REQ_STRUCTURE_ME', { req: safeJson(req) });
    return {
      id: req.user?.id || 'unknown',
      name: req.user?.name || 'unknown',
      tenant: req.tenant || req.user?.tenant || 'default',
      email: req.user?.attr?.email || req.user?.id || 'unknown',
      raw: JSON.stringify(safeJson(req.user || {}))
    };
  });
  
  this.on('MyRoles', async (req) => {
    logBlock('🔍 REQ_STRUCTURE_MYROLES', { req: safeJson(req) });
    return [];
  });
  
  this.on('WhoAmI', async (req) => {
    logBlock('🔍 REQ_STRUCTURE_WHOAMI', { req: safeJson(req) });
    return {
      SYSADMIN: false,
      ADMIN: false,
      LEADER: false,
      USER: false,
      AUTHENTICATED: false
    };
  });
  
  this.on('ServerTime', () => {
    return {
      now: new Date(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      iso: new Date().toISOString()
    };
  });
  
  this.on('Ping', () => 'pong');
  
  this.on('ResetSession', async (req) => {
    logBlock('🔍 REQ_STRUCTURE_RESET', { req: safeJson(req) });
    return true;
  });
  
  this.on('RequestAccessMail', async (req) => {
    logBlock('🔍 REQ_STRUCTURE_REQUEST_ACCESS', { 
      req: safeJson(req),
      reqData: req.data,
      reqUser: req.user ? safeJson(req.user) : null
    });
    return {
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: '구현 대기 중 (req 구조 파악 후 구현 예정)',
      retryAfterDays: 0
    };
  });
  
  this.on('SubmitTenantConfig', async (req) => {
    logBlock('🔍 REQ_STRUCTURE_SUBMIT_CONFIG', { 
      req: safeJson(req),
      reqData: req.data
    });
    return {
      ok: false,
      code: 'NOT_IMPLEMENTED',
      message: '구현 대기 중 (req 구조 파악 후 구현 예정)'
    };
  });
});
