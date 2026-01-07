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

    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;

    const TenantConfig = cds.entities['TenantConfig'];

    let tenantConfig = null;
    if (tenantId && TenantConfig) {
      try {
        const tx = cds.transaction(req);
        tenantConfig = await tx.run(
          SELECT.one.from(TenantConfig).where({ id: tenantId })
        );
      } catch (e) {
        logOneLine('BOOTSTRAP_TENANTCONFIG_READ_FAIL', {
          tenantId,
          error: e.message
        }, { level: 'warn' });
      }
    }

    const isConfigured = !!tenantConfig?.isConfigured;
    const adminEmail = tenantConfig?.adminEmail || '';

    logOneLine('BOOTSTRAP', {
      tenantId,
      method: req.method,
      path: req.path,
      user: { id: req.user?.id, name: req.user?.name },
      computedFlags: flags,
      tenantConfigFound: !!tenantConfig,
      isConfigured,
      adminEmail
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
      adminEmail,
      isConfigured
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
    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;
    if (!tenantId) {
      return { ok: false, code: 'NO_TENANT', message: '테넌트 정보를 확인할 수 없습니다.' };
    }

    const flags = computeFlags(req);
    if (!flags.ADMIN && !flags.SYSADMIN) {
      return { ok: false, code: 'FORBIDDEN', message: 'Administrator 권한이 필요합니다.' };
    }

    const TenantConfig = cds.entities['TenantConfig'];
    if (!TenantConfig) {
      return { ok: false, code: 'NO_ENTITY', message: 'TenantConfig 엔티티를 찾을 수 없습니다.' };
    }

    const p = req.data || {};
    const companyName = String(p.companyName || '').trim();
    const timezone = String(p.timezone || 'Asia/Seoul').trim();
    const language = String(p.language || 'ko').trim();
    const adminEmail = String(p.adminEmail || '').trim();
    const companyLogoUrl = String(p.companyLogoUrl || '/api/logo').trim();

    if (!companyName) return { ok: false, code: 'VALIDATION', message: '회사명(companyName)은 필수입니다.' };
    if (!adminEmail) return { ok: false, code: 'VALIDATION', message: '권한 요청 수신 이메일(adminEmail)은 필수입니다.' };

    try {
      const tx = cds.transaction(req);

      const exists = await tx.run(
        SELECT.one.from(TenantConfig).columns('id').where({ id: tenantId })
      );

      if (!exists) {
        await tx.run(
          cds.ql.INSERT.into(TenantConfig).entries({
            id: tenantId,
            companyName,
            companyLogoUrl,
            timezone,
            language,
            adminEmail,
            isConfigured: true
          })
        );
      } else {
        await tx.run(
          cds.ql.UPDATE(TenantConfig).set({
            companyName,
            companyLogoUrl,
            timezone,
            language,
            adminEmail,
            isConfigured: true
          }).where({ id: tenantId })
        );
      }

      logOneLine('SUBMIT_TENANT_CONFIG_OK', { tenantId, companyName, timezone, language, adminEmail });

      return { ok: true };
    } catch (e) {
      logOneLine('SUBMIT_TENANT_CONFIG_FAIL', { tenantId, error: e.message }, { level: 'error' });
      return { ok: false, code: 'ERROR', message: e.message || '저장 중 오류가 발생했습니다.' };
    }
  });
});
