const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const path = require('path');
const fs = require('fs');

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
// Helper: xsappname 가져오기
// =====================================================
const getXsappnameFromEnv = () => {
  try {
    if (process.env.VCAP_SERVICES) {
      const vcap = JSON.parse(process.env.VCAP_SERVICES);
      const xsuaa = (vcap.xsuaa || [])[0];
      return xsuaa?.credentials?.xsappname || null;
    }
  } catch (e) {
    console.warn('[Auth] VCAP_SERVICES parse failed:', e.message);
  }
  return null;
};

// =====================================================
// Helper: user scopes 추출
// =====================================================
const extractUserScopes = (req) => {
  const scopes = new Set();
  
  // xssec user.scopes 배열
  if (Array.isArray(req.user?.scopes)) {
    req.user.scopes.forEach((s) => scopes.add(String(s)));
  }
  
  // roles 배열
  if (Array.isArray(req.user?.roles)) {
    req.user.roles.forEach((s) => scopes.add(String(s)));
  }
  
  // roles 객체 map (XSUAA 패턴: {"openid":1,"User":1})
  if (req.user?.roles && typeof req.user.roles === 'object' && !Array.isArray(req.user.roles)) {
    Object.keys(req.user.roles).forEach((k) => scopes.add(String(k)));
  }
  
  return scopes;
};

// =====================================================
// Helper: user flags 계산
// =====================================================
const computeFlags = (req) => {
  const isFn = typeof req.user?.is === 'function';
  const is = (role) => (isFn ? !!req.user.is(role) : false);

  // xsappname 가져오기 (work_hub 또는 실제 앱 이름)
  const xsappname = getXsappnameFromEnv();
  
  // workhub의 scope 이름들 (xsappname 포함)
  const workhubSYSADMIN = xsappname ? `${xsappname}.SYSADMIN` : 'work_hub.SYSADMIN';
  const workhubAdministrator = xsappname ? `${xsappname}.Administrator` : 'work_hub.Administrator';
  const workhubLeader = xsappname ? `${xsappname}.Leader` : 'work_hub.Leader';
  const workhubUser = xsappname ? `${xsappname}.User` : 'work_hub.User';

  // extractUserScopes를 사용하여 실제 scope 확인
  const scopes = extractUserScopes(req);
  
  // 디버깅: 실제 scope 목록 로깅
  if (scopes.size > 0) {
    logOneLine('[ComputeFlags] User scopes', {
      xsappname,
      scopes: Array.from(scopes),
      workhubScopes: {
        SYSADMIN: workhubSYSADMIN,
        Administrator: workhubAdministrator,
        Leader: workhubLeader,
        User: workhubUser
      }
    }, { level: 'log' });
  }
  
  // workhub의 scope인지 확인하는 helper
  // 다른 시스템의 scope는 무시하고 오직 workhub의 scope만 체크
  // ⚠️ 중요: is() 메서드를 fallback으로 사용하되, 정확한 전체 scope 이름으로만 체크
  const hasWorkhubScope = (scopeName) => {
    // 1순위: scope Set에 정확한 scope 이름이 있는지 확인 (가장 안전한 방법)
    if (scopes.has(scopeName)) {
      return true;
    }
    
    // 2순위: req.user.is() 사용하되 전체 scope 이름으로만 체크
    // 예: is('work_hub.User')는 OK, is('User')는 위험 (다른 시스템 scope 매칭될 수 있음)
    // 전체 scope 이름으로 체크하면 정확하게 workhub scope만 체크됨
    return is(scopeName);
  };
  
  const flags = {
    // workhub의 SYSADMIN scope만 체크 (다른 시스템의 SYSADMIN 무시)
    SYSADMIN: hasWorkhubScope(workhubSYSADMIN),

    // ✅ workhub의 Administrator scope만 체크 (다른 시스템의 Administrator 무시)
    ADMIN: hasWorkhubScope(workhubAdministrator),

    // workhub의 Leader scope만 체크 (다른 시스템의 Leader 무시)
    LEADER: hasWorkhubScope(workhubLeader),
    
    // workhub의 User scope만 체크 (다른 시스템의 User scope 무시)
    // ⚠️ 단순히 'User'로만 체크하면 다른 시스템의 'User' scope도 매칭되므로
    // 반드시 workhub의 전체 scope 이름(예: 'work_hub.User')으로 체크
    USER: hasWorkhubScope(workhubUser),

    // CAP/XSUAA에서 종종 authenticated-user scope가 있음
    AUTHENTICATED: is('authenticated-user') || !!req.user?.id
  };
  
  // 디버깅: 최종 flags 로깅
  logOneLine('[ComputeFlags] Final flags', flags, { level: 'log' });
  
  return flags;
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
// Helper: Email template helpers
// =====================================================
const loadEmailTemplate = (templateName) => {
  const templatePath = path.resolve(__dirname, 'email', `${templateName}.html`);
  try {
    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    logOneLine('EMAIL_TEMPLATE_LOAD_FAIL', { templateName, error: error.message }, { level: 'error' });
    throw error;
  }
};

const renderTemplate = (template, variables) => {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(regex, value ?? '');
  }
  return rendered;
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

    const p = req.data || {};
    // payload 구조: { config: { companyName, timezone, language, adminEmail, companyLogoUrl, btpCockpitUrl?, logo? } }
    const config = p.config || p;
    const companyName = String(config.companyName || '').trim();
    const timezone = String(config.timezone || 'Asia/Seoul').trim();
    const language = String(config.language || 'ko').trim();
    const adminEmail = String(config.adminEmail || '').trim();
    const companyLogoUrl = String(config.companyLogoUrl || '/odata/v4/auth/GetLogo()').trim();
    const btpCockpitUrl = String(config.btpCockpitUrl || '').trim();
    const logoData = config.logo || null;

    if (!companyName) return { ok: false, code: 'VALIDATION', message: '회사명(companyName)은 필수입니다.' };
    if (!adminEmail) return { ok: false, code: 'VALIDATION', message: '권한 요청 수신 이메일(adminEmail)은 필수입니다.' };

    // 로고 데이터가 있으면 검증 및 변환
    let logoBuffer = null;
    let logoContentType = null;
    let logoFilename = null;
    let logoSize = null;

    if (logoData && logoData.logoBase64) {
      const logoBase64 = logoData.logoBase64 || '';
      logoContentType = logoData.logoContentType || 'image/png';
      logoFilename = logoData.logoFilename || 'logo.png';

      if (!logoBase64) {
        return { ok: false, code: 'VALIDATION', message: '로고 데이터(logoBase64)가 필요합니다.' };
      }

      // base64 디코딩
      try {
        const base64Data = logoBase64.includes(',') ? logoBase64.split(',')[1] : logoBase64;
        logoBuffer = Buffer.from(base64Data, 'base64');
        logoSize = logoBuffer.length;
      } catch (e) {
        return { ok: false, code: 'INVALID_BASE64', message: '유효하지 않은 base64 데이터입니다.' };
      }

      // 파일 크기 체크 (5MB)
      if (logoBuffer.length > 5 * 1024 * 1024) {
        return { ok: false, code: 'FILE_TOO_LARGE', message: '파일 크기는 5MB를 초과할 수 없습니다.' };
      }

      // MIME 타입 체크
      const allowedMime = /^(image\/jpeg|image\/jpg|image\/png|image\/gif|image\/svg\+xml|image\/webp)$/i;
      if (!allowedMime.test(logoContentType)) {
        return { ok: false, code: 'INVALID_MIME', message: '이미지 파일만 업로드 가능합니다. (jpeg, jpg, png, gif, svg, webp)' };
      }
    }

    const TenantConfig = cds.entities['workhub.TenantConfig'] || cds.entities['TenantConfig'];
    if (!TenantConfig) {
      return { ok: false, code: 'NO_ENTITY', message: 'TenantConfig 엔티티를 찾을 수 없습니다.' };
    }

    try {
      const tx = cds.transaction(req);

      const exists = await tx.run(
        SELECT.one.from(TenantConfig).columns('id').where({ id: tenantId })
      );

      const updateData = {
        companyName,
        companyLogoUrl,
        timezone,
        language,
        adminEmail,
        btpCockpitUrl: btpCockpitUrl || null,
        isConfigured: true
      };

      // 로고가 있으면 포함
      if (logoBuffer) {
        updateData.logoContent = logoBuffer;
        updateData.logoContentType = logoContentType;
        updateData.logoFilename = logoFilename;
        updateData.logoSize = logoSize;
      }

      if (!exists) {
        await tx.run(
          cds.ql.INSERT.into(TenantConfig).entries({
            id: tenantId,
            ...updateData
          })
        );
      } else {
        await tx.run(
          cds.ql.UPDATE(TenantConfig).set(updateData).where({ id: tenantId })
        );
      }

      if (logoBuffer) {
        logOneLine('SUBMIT_TENANT_CONFIG_WITH_LOGO_OK', {
          tenantId,
          companyName,
          logoFilename,
          logoSize
        });
      } else {
        logOneLine('SUBMIT_TENANT_CONFIG_OK', {
          tenantId,
          companyName,
          timezone,
          language,
          adminEmail
        });
      }

      logOneLine('SUBMIT_TENANT_CONFIG_OK', { tenantId, companyName, timezone, language, adminEmail });

      return { ok: true };
    } catch (e) {
      logOneLine('SUBMIT_TENANT_CONFIG_FAIL', { tenantId, error: e.message }, { level: 'error' });
      return { ok: false, code: 'ERROR', message: e.message || '저장 중 오류가 발생했습니다.' };
    }
  });

  // =====================================================
  // SetEnvConfigured (환경 설정 완료 처리 - HTML 반환)
  // =====================================================
  this.on('SetEnvConfigured', async (req) => {
    const tenantId = req.data?.tenant || req.query?.tenant || req.tenant || req.user?.tenant || req.user?.attr?.zid || null;
    if (!tenantId) {
      const errorHtml = `
        <html><head><meta charset="UTF-8"><title>오류</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #d32f2f;">오류</h2>
          <p>테넌트 ID가 필요합니다.</p>
        </body></html>
      `;
      return req.reply(errorHtml, { type: 'text/html', status: 400 });
    }

    const TenantConfig = cds.entities['workhub.TenantConfig'] || cds.entities['TenantConfig'];
    if (!TenantConfig) {
      const errorHtml = `
        <html><head><meta charset="UTF-8"><title>오류</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #d32f2f;">오류</h2>
          <p>TenantConfig 엔티티를 찾을 수 없습니다.</p>
        </body></html>
      `;
      return req.reply(errorHtml, { type: 'text/html', status: 500 });
    }

    try {
      const tx = cds.transaction(req);

      const tenantConfig = await tx.run(
        SELECT.one.from(TenantConfig).where({ id: tenantId })
      );

      if (!tenantConfig) {
        const errorHtml = `
          <html><head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>테넌트 설정을 찾을 수 없습니다.</p>
          </body></html>
        `;
        return req.reply(errorHtml, { type: 'text/html', status: 404 });
      }

      await tx.run(
        UPDATE(TenantConfig).set({ envConfigured: true }).where({ id: tenantId })
      );

      logOneLine('SET_ENV_CONFIGURED_OK', { tenantId });

      const completeTemplate = loadEmailTemplate('env-setup-complete');
      const completeHtml = renderTemplate(completeTemplate, {
        tenant: tenantId,
        companyName: tenantConfig.companyName || '(없음)',
        completedAt: new Date().toLocaleString('ko-KR')
      });

      return req.reply(completeHtml, { type: 'text/html' });
    } catch (e) {
      logOneLine('SET_ENV_CONFIGURED_FAIL', { tenantId, error: e.message }, { level: 'error' });
      const errorHtml = `
        <html><head><meta charset="UTF-8"><title>오류</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #d32f2f;">오류</h2>
          <p>처리 중 오류가 발생했습니다: ${e.message}</p>
        </body></html>
      `;
      return req.reply(errorHtml, { type: 'text/html', status: 500 });
    }
  });

  // =====================================================
  // UploadLogo (로고 업로드 - ADMIN/SYSADMIN only)
  // =====================================================
  this.on('UploadLogo', async (req) => {
    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;
    if (!tenantId) {
      return { ok: false, code: 'NO_TENANT', message: '테넌트 ID를 확인할 수 없습니다.' };
    }

    const flags = computeFlags(req);
    if (!flags.ADMIN && !flags.SYSADMIN) {
      return { ok: false, code: 'FORBIDDEN', message: 'Administrator 또는 SYSADMIN 권한이 필요합니다.' };
    }

    const p = req.data || {};
    // payload 구조: { logo: { logoBase64, logoContentType, logoFilename } }
    const logoData = p.logo || {};
    const logoBase64 = logoData.logoBase64 || p.logoBase64 || '';
    const logoContentType = logoData.logoContentType || p.logoContentType || 'image/png';
    const logoFilename = logoData.logoFilename || p.logoFilename || 'logo.png';

    if (!logoBase64) {
      return { ok: false, code: 'VALIDATION', message: '로고 데이터(logoBase64)가 필요합니다.' };
    }

    // base64 디코딩
    let logoBuffer;
    try {
      // data:image/png;base64,xxx 형태일 수 있으니 처리
      const base64Data = logoBase64.includes(',') ? logoBase64.split(',')[1] : logoBase64;
      logoBuffer = Buffer.from(base64Data, 'base64');
    } catch (e) {
      return { ok: false, code: 'INVALID_BASE64', message: '유효하지 않은 base64 데이터입니다.' };
    }

    // 파일 크기 체크 (5MB)
    if (logoBuffer.length > 5 * 1024 * 1024) {
      return { ok: false, code: 'FILE_TOO_LARGE', message: '파일 크기는 5MB를 초과할 수 없습니다.' };
    }

    // MIME 타입 체크
    const allowedMime = /^(image\/jpeg|image\/jpg|image\/png|image\/gif|image\/svg\+xml|image\/webp)$/i;
    if (!allowedMime.test(logoContentType)) {
      return { ok: false, code: 'INVALID_MIME', message: '이미지 파일만 업로드 가능합니다. (jpeg, jpg, png, gif, svg, webp)' };
    }

    const TenantConfig = cds.entities['workhub.TenantConfig'] || cds.entities['TenantConfig'];
    if (!TenantConfig) {
      return { ok: false, code: 'NO_ENTITY', message: 'TenantConfig 엔티티를 찾을 수 없습니다.' };
    }

    try {
      const tx = cds.transaction(req);

      // row 없으면 먼저 생성(최소 row 확보)
      const exists = await tx.run(
        SELECT.one.from(TenantConfig).columns('id').where({ id: tenantId })
      );

      if (!exists) {
        await tx.run(
          INSERT.into(TenantConfig).entries({ id: tenantId, isConfigured: false })
        );
      }

      await tx.run(
        UPDATE(TenantConfig).set({
          logoContent: logoBuffer,
          logoContentType,
          logoFilename,
          logoSize: logoBuffer.length
        }).where({ id: tenantId })
      );

      logOneLine('UPLOAD_LOGO_OK', {
        tenantId,
        filename: logoFilename,
        contentType: logoContentType,
        size: logoBuffer.length
      });

      return {
        ok: true,
        message: '로고가 성공적으로 업로드되었습니다.',
        url: '/api/logo'
      };
    } catch (e) {
      logOneLine('UPLOAD_LOGO_FAIL', { tenantId, error: e.message }, { level: 'error' });
      return { ok: false, code: 'ERROR', message: e.message || '로고 업로드 중 오류가 발생했습니다.' };
    }
  });

  // =====================================================
  // GetLogo (로고 조회 - base64 data URI 반환)
  // =====================================================
  this.on('GetLogo', async (req) => {
    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;
    if (!tenantId) {
      return { ok: false, code: 'NO_TENANT', message: '테넌트 ID를 확인할 수 없습니다.', useDefault: true };
    }

    const TenantConfig = cds.entities['workhub.TenantConfig'] || cds.entities['TenantConfig'];
    if (!TenantConfig) {
      return { ok: false, code: 'NO_ENTITY', message: 'TenantConfig 엔티티를 찾을 수 없습니다.', useDefault: true };
    }

    try {
      const tx = cds.transaction(req);

      const row = await tx.run(
        SELECT.one.from(TenantConfig)
          .columns('logoContent', 'logoContentType', 'logoFilename', 'modifiedAt')
          .where({ id: tenantId })
      );

      if (!row?.logoContent) {
        return { ok: false, code: 'NOT_FOUND', message: '로고를 찾을 수 없습니다.', useDefault: true };
      }

      const logoBase64 = Buffer.from(row.logoContent).toString('base64');
      const contentType = row.logoContentType || 'image/png';
      const dataUri = `data:${contentType};base64,${logoBase64}`;

      logOneLine('GET_LOGO_OK', {
        tenantId,
        filename: row.logoFilename,
        contentType,
        size: row.logoContent?.length || 0
      });

      return {
        ok: true,
        logoBase64: dataUri,
        contentType,
        filename: row.logoFilename || 'logo.png',
        modifiedAt: row.modifiedAt ? new Date(row.modifiedAt).toISOString() : null,
        useDefault: false
      };
    } catch (e) {
      logOneLine('GET_LOGO_FAIL', { tenantId, error: e.message }, { level: 'error' });
      return { ok: false, code: 'ERROR', message: e.message || '로고 조회 중 오류가 발생했습니다.', useDefault: true };
    }
  });
});
