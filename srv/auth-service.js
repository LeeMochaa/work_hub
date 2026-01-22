const cds = require('@sap/cds');
const { SELECT, UPDATE, INSERT } = cds.ql;
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

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
// Helper: User Profile 추출 (dev-hub 방식)
// =====================================================
const getUserProfile = (req) => {
  const u = req.user || {};
  const attr = u.attr || {};

  const id =
    u.id ||
    u.name ||
    attr.user_name ||
    attr.ID ||
    'anonymous';

  const gn = attr.givenName || attr.given_name;
  const fn = attr.familyName || attr.family_name;

  let display = (gn || fn) ? [fn, gn].filter(Boolean).join('') : null;
  if (!display) display = attr.display_name || attr.name || id;

  const safeId = String(id || 'anonymous');
  const safeName = String(display || safeId);
  const tenant = req.tenant || u.tenant || attr.zid || '';

  let raw = undefined;
  try {
    raw = JSON.stringify(attr, null, 2);
  } catch (e) {
    console.warn('⚠️ JSON.stringify(u.attr) failed:', e.message);
  }

  return {
    id: safeId,
    name: safeName,
    tenant,
    email: attr.email || attr.emailAddress || safeId,
    raw
  };
};

// =====================================================
// Helper: 역할 목록 추출 (dev-hub 방식)
// =====================================================
const getRoles = (req) => {
  const roles = [];
  const has = (r) => req.user && req.user.is && req.user.is(r);

  // CAP/XSUAA의 req.user.is()는 자동으로 xsappname prefix를 붙여서 체크함
  // 예: is('User') → 'work_hub.User' scope를 찾음
  ['SYSADMIN', 'Administrator', 'Leader', 'User'].forEach(r => {
    if (has(r)) roles.push(r);
  });
  if (has('authenticated-user')) roles.push('authenticated-user');

  return roles;
};

// =====================================================
// Helper: 역할 플래그 계산 (dev-hub 방식)
// =====================================================
const getRoleFlags = (req) => {
  const is = (r) => (req.user && req.user.is && req.user.is(r)) || false;

  // CAP/XSUAA의 req.user.is()는 자동으로 xsappname prefix를 붙여서 체크함
  // 예: is('User') → 'work_hub.User' scope를 찾음
  return {
    SYSADMIN: is('SYSADMIN'),
    ADMIN: is('Administrator'),
    LEADER: is('Leader'),
    USER: is('User'),
    AUTHENTICATED: is('authenticated-user'),
  };
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

  const tz =
    process.env.TZ ||
    (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) ||
    'UTC';

  // =====================================================
  // Bootstrap (dev-hub 방식)
  // =====================================================
  // =====================================================
  // Bootstrap (Auto-Activation & Standard Auth)
  // =====================================================
  this.on('Bootstrap', async (req) => {
    // 1) 기본 정보 추출
    const user = getUserProfile(req);
    const roles = getRoles(req);
    const flags = getRoleFlags(req);
    const now = new Date();
    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;

    // 2) Auto-Activation Logic
    // BTP Role(WorkHub_User 이상)이 있는 사용자가 로그인하면
    // DB의 User 상태가 'REQUESTED'일 경우 'ACTIVE'로 자동 승격
    const hasValidRole = flags.USER || flags.LEADER || flags.ADMIN || flags.SYSADMIN;

    if (hasValidRole && user.id !== 'anonymous') {
      const User = cds.entities['User'] || cds.entities['workhub.User'];
      if (User) {
        try {
          const tx = cds.transaction(req);
          // 사용자 조회
          const dbUser = await tx.run(SELECT.one.from(User).where({ id: user.id }));

          if (dbUser) {
            // 이미 존재하고 상태가 REQUESTED라면 ACTIVE로 승격
            if (dbUser.user_status === 'REQUESTED') {
              await tx.run(UPDATE(User).set({ user_status: 'ACTIVE' }).where({ id: user.id }));
              logOneLine('AUTO_ACTIVATION_SUCCESS', { userId: user.id, oldStatus: 'REQUESTED', newStatus: 'ACTIVE' });
            }
            // (선택) 아예 없는 경우 자동 생성할 수도 있으나, 
            // 현재 로직은 'RequestAccess'를 거쳐 DB가 생성된 사용자를 가정함.
          }
        } catch (e) {
          logOneLine('AUTO_ACTIVATION_FAIL', { userId: user.id, error: e.message }, { level: 'error' });
        }
      }
    }

    // 3) Tenant Config (Cosmetic only)
    // isConfigured 체크를 통한 블로킹 로직 제거 -> 항상 true나 다름없음 (프론트 변경 최소화 위해 값은 유지)
    const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];
    let tenantConfig = null;
    let adminEmail = '';

    if (tenantId && TenantConfig) {
      try {
        const tx = cds.transaction(req);
        tenantConfig = await tx.run(SELECT.one.from(TenantConfig).where({ id: tenantId }));
        adminEmail = tenantConfig?.adminEmail || '';
      } catch (e) {
        // 무시 (설정 없음)
      }
    }

    logOneLine('BOOTSTRAP', {
      tenantId,
      user: { id: user.id, name: user.name },
      roles,
      flags,
      autoActivated: hasValidRole
    });

    return {
      user,
      roles,
      flags,
      serverTime: { tz, iso: now.toISOString() },
      adminEmail,
      isConfigured: true // 항상 true로 리턴하여 블로킹 제거
    };
  });

  // =====================================================
  // Me
  // =====================================================
  this.on('Me', async (req) => {
    const profile = getUserProfile(req);
    logOneLine('ME', { profile });
    return profile;
  });

  // =====================================================
  // MyRoles
  // =====================================================
  this.on('MyRoles', (req) => getRoles(req));

  // =====================================================
  // WhoAmI (flags만 반환)
  // =====================================================
  this.on('WhoAmI', (req) => getRoleFlags(req));

  // =====================================================
  // ServerTime / Ping
  // =====================================================
  this.on('ServerTime', () => {
    const now = new Date();
    return { now, timezone: tz, iso: now.toISOString() };
  });

  this.on('Ping', () => 'pong');

  // =====================================================
  // ResetSession
  // =====================================================
  this.on('ResetSession', async (req) => {
    logOneLine('RESET_SESSION', { user: req.user?.id, tenant: req.tenant });
    return true;
  });

  // =====================================================
  // RequestAccessMail
  // =====================================================
  // =====================================================
  // RequestAccessMail (Changed: Notify Admin to Assign Role)
  // =====================================================
  this.on('RequestAccessMail', async (req) => {
    const { email, name } = req.data || {};

    // 0) 이메일 필수 체크
    if (!email) {
      return { ok: false, code: 'NO_EMAIL', message: '이메일 정보가 없어 권한 요청을 처리할 수 없습니다.' };
    }

    try {
      // 1) UserService를 통해 유저 업서트 + 쿨다운 체크 (스팸 방지 유지)
      const userSrv = await cds.connect.to('UserService');
      const cooldown = await userSrv.checkAccessRequestCooldown(req, { cooldownDays: 30 });

      // ⏰ 30일 쿨다운 중
      if (!cooldown.ok) {
        return {
          ok: false,
          code: cooldown.code,
          message: cooldown.message,
          retryAfterDays: cooldown.retryAfterDays || 0
        };
      }

      // 2) 테넌트 정보/설정 로드
      const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;
      let adminEmail = process.env.ADMIN_EMAIL || 'leemocha@aspnc.com';
      let companyName = 'WorkHub';
      let btpCockpitUrl = null;

      if (tenantId) {
        const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];
        if (TenantConfig) {
          const tx = cds.transaction(req);
          const config = await tx.run(SELECT.one.from(TenantConfig).where({ id: tenantId }));
          if (config) {
            if (config.adminEmail) adminEmail = config.adminEmail;
            if (config.companyName) companyName = config.companyName;
            if (config.btpCockpitUrl) btpCockpitUrl = config.btpCockpitUrl;
          }
        }
      }

      // Default BTP Cockpit URL construction (if missing)
      if (!btpCockpitUrl) {
        const cockpitBaseUrl = process.env.BTP_COCKPIT_BASE_URL || 'https://emea.cockpit.btp.cloud.sap';
        const globalAccountId = process.env.BTP_GLOBAL_ACCOUNT_ID || '2fda4d86-31e5-48d8-979f-dabc0c506967';
        const subaccountId = tenantId || process.env.BTP_SUBACCOUNT_ID || '1c5002c7-4e64-492e-a642-190c096c038b';
        btpCockpitUrl = `${cockpitBaseUrl}/cockpit/#/globalaccount/${globalAccountId}/subaccount/${subaccountId}/service-instances`;
      }

      // 3) HTML 템플릿 생성 (승인 버튼 제거, BTP Cockpit 강조)
      const requestDate = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

      const btpCockpitButton = `<a href="${btpCockpitUrl}" target="_blank" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #0a6ed1 0%, #1e88e5 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">BTP Cockpit 열기 (역할 할당)</a>`;

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #333;">[WorkHub] 권한 요청 알림</h2>
          <p>안녕하세요, 관리자님.</p>
          <p>아래 사용자가 WorkHub 애플리케이션 접근 권한을 요청했습니다.</p>
          
          <div style="background: #f9f9f9; padding: 15px; border-radius: 4px; margin: 20px 0;">
            <p><strong>요청자:</strong> ${name || '알 수 없음'} (${email})</p>
            <p><strong>요청 시각:</strong> ${requestDate}</p>
            <p><strong>테넌트 ID:</strong> ${tenantId || '공용'}</p>
          </div>

          <p style="color: #666;">
            이 사용자가 앱을 사용하려면 <strong>BTP Cockpit</strong>에서 
            <code>WorkHub_User</code> (또는 적절한 역할 컬렉션)을 할당해야 합니다.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            ${btpCockpitButton}
          </div>
          
          <p style="font-size: 12px; color: #999; margin-top: 30px;">
            * 역할을 할당하면 사용자가 다음 로그인 시 자동으로 활성화(ACTIVE) 됩니다.
          </p>
        </div>
      `;

      // 4) 메일 발송
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'leemocha.aspn@gmail.com',
          pass: process.env.GMAIL_APP_PASS
        }
      });

      await transporter.sendMail({
        from: '"WorkHub Bot" <leemocha.aspn@gmail.com>',
        to: adminEmail,
        subject: `[WorkHub] 권한 요청: ${name || email}`,
        html: htmlContent
      });

      return {
        ok: true,
        code: 'OK',
        message: '관리자에게 권한 요청 메일을 발송했습니다. 승인 후 이용 가능합니다.',
        retryAfterDays: 30
      };

    } catch (e) {
      logOneLine('REQUEST_ACCESS_MAIL_FAIL', { error: e.message }, { level: 'error' });
      return { ok: false, code: 'ERROR', message: `메일 발송 실패: ${e.message}` };
    }
  });

  // =====================================================
  // SetEnvConfigured (HTML 반환)
  // =====================================================


  // =====================================================
  // SubmitTenantConfig
  // =====================================================
  this.on('SubmitTenantConfig', async (req) => {
    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;

    if (!tenantId) {
      return { ok: false, code: 'NO_TENANT', message: 'Tenant ID를 찾을 수 없습니다.' };
    }

    const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];

    if (!TenantConfig) {
      return { ok: false, code: 'NO_ENTITY', message: 'TenantConfig 엔티티를 찾을 수 없습니다.' };
    }

    const p = req.data || {};
    const config = p.config || p;
    const companyName = String(config.companyName || '').trim();
    const timezone = String(config.timezone || 'Asia/Seoul').trim();
    const language = String(config.language || 'ko').trim();
    const adminEmail = String(config.adminEmail || '').trim();
    const companyLogoUrl = String(config.companyLogoUrl || '/odata/v4/auth/GetLogo()').trim();
    const btpCockpitUrl = String(config.btpCockpitUrl || '').trim();
    // 프론트엔드에서 전달한 AppRouter URL (Consumer 또는 Provider)
    // 프론트엔드는 window.location.origin으로 현재 브라우저의 AppRouter URL을 전달함
    // 이 값이 있으면 이걸 우선 사용 (srv는 Provider에 배포되어 있으므로 Host 헤더는 Provider URL일 수 있음)
    const appRouterUrlFromConfig = (config.appRouterUrl && String(config.appRouterUrl).trim()) || null;
    const logoData = config.logo || null;

    if (!companyName) {
      return { ok: false, code: 'VALIDATION', message: '회사명(companyName)은 필수입니다.' };
    }
    if (!adminEmail) {
      return { ok: false, code: 'VALIDATION', message: '권한 요청 수신 이메일(adminEmail)은 필수입니다.' };
    }

    let logoBuffer = null;
    let logoContentType = null;
    let logoFilename = null;
    let logoSize = null;

    if (logoData && logoData.logoBase64) {
      const logoBase64 = logoData.logoBase64 || '';
      logoContentType = logoData.logoContentType || 'image/png';
      logoFilename = logoData.logoFilename || 'logo.png';

      try {
        const base64Data = logoBase64.includes(',') ? logoBase64.split(',')[1] : logoBase64;
        logoBuffer = Buffer.from(base64Data, 'base64');
        logoSize = logoBuffer.length;

        const validMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml'];
        if (!validMimeTypes.includes(logoContentType.toLowerCase())) {
          return { ok: false, code: 'VALIDATION', message: '지원하지 않는 이미지 형식입니다.' };
        }

        if (logoSize > 5 * 1024 * 1024) {
          return { ok: false, code: 'VALIDATION', message: '로고 파일 크기는 5MB를 초과할 수 없습니다.' };
        }
      } catch (e) {
        logOneLine('LOGO_DECODE_FAIL', { error: e.message }, { level: 'error' });
        return { ok: false, code: 'VALIDATION', message: '로고 데이터 디코딩에 실패했습니다.' };
      }
    }

    // AppRouter URL 추출
    // 중요: srv는 Provider에 배포되어 있으므로, req.headers['host']는 Provider URL일 수 있음
    // Consumer 계정에서 접근할 때는 프론트엔드(window.location.origin)가 Consumer AppRouter URL을 가짐
    // 따라서 프론트엔드에서 전달한 appRouterUrl을 최우선으로 사용해야 함
    // 
    // 우선순위: 1) 프론트엔드에서 전달한 appRouterUrl (반드시 우선), 2) 요청의 Host 헤더에서 추출 (fallback)
    let appRouterUrl = appRouterUrlFromConfig;

    // 프론트엔드에서 전달한 URL이 없으면 요청의 Host 헤더에서 추출 (fallback)
    if (!appRouterUrl && req) {
      const hostHeader = req.headers['host'] || req.headers['x-forwarded-host'];

      if (hostHeader) {
        const hostname = hostHeader.split(':')[0];
        let routerHost = hostname;

        // 서비스 호스트 패턴인지 확인 (-srv로 끝나는 경우)
        if (hostname.endsWith('-srv') || hostname.match(/-srv\./)) {
          routerHost = hostname.replace(/-srv(\.|$)/, '-router$1');
        }

        appRouterUrl = `https://${routerHost}`;
      } else if (req.headers['referer']) {
        // Host 헤더가 없으면 Referer 헤더에서 추출 시도
        try {
          const refererUrl = new URL(req.headers['referer']);
          const refererHost = refererUrl.hostname;
          let routerHost = refererHost;

          if (refererHost.endsWith('-srv') || refererHost.match(/-srv\./)) {
            routerHost = refererHost.replace(/-srv(\.|$)/, '-router$1');
          }

          appRouterUrl = `https://${routerHost}`;
        } catch (e) {
          // Referer 파싱 실패 시 무시
        }
      }
    }

    try {
      const tx = cds.transaction(req);
      const exists = await tx.run(SELECT.one.from(TenantConfig).columns('id', 'additionalConfig').where({ id: tenantId }));

      // additionalConfig 파싱 (기존 값 유지)
      let additionalConfigObj = {};
      if (exists?.additionalConfig) {
        try {
          additionalConfigObj = JSON.parse(exists.additionalConfig);
        } catch (e) {
          // 파싱 실패 시 빈 객체 사용
        }
      }

      // AppRouter URL을 additionalConfig에 저장
      if (appRouterUrl) {
        additionalConfigObj.appRouterUrl = appRouterUrl;
      }

      const updateData = {
        companyName,
        companyLogoUrl,
        timezone,
        language,
        adminEmail,
        btpCockpitUrl: btpCockpitUrl || null,
        additionalConfig: JSON.stringify(additionalConfigObj),
        isConfigured: true
      };

      if (logoBuffer) {
        updateData.logoContent = logoBuffer;
        updateData.logoContentType = logoContentType;
        updateData.logoFilename = logoFilename;
        updateData.logoSize = logoSize;
      }

      if (!exists) {
        await tx.run(INSERT.into(TenantConfig).entries({ id: tenantId, ...updateData }));
      } else {
        await tx.run(UPDATE(TenantConfig).set(updateData).where({ id: tenantId }));
      }

      await tx.commit();

      logOneLine('SUBMIT_TENANT_CONFIG', {
        tenantId,
        companyName,
        adminEmail,
        hasLogo: !!logoBuffer
      });

      return { ok: true, code: 'OK', message: '테넌트 설정이 저장되었습니다.' };
    } catch (e) {
      logOneLine('SUBMIT_TENANT_CONFIG_FAIL', { tenantId, error: e.message }, { level: 'error' });
      return { ok: false, code: 'ERROR', message: `설정 저장 실패: ${e.message}` };
    }
  });

  // =====================================================
  // UploadLogo
  // =====================================================
  this.on('UploadLogo', async (req) => {
    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;

    if (!tenantId) {
      return { ok: false, code: 'NO_TENANT', message: 'Tenant ID를 찾을 수 없습니다.', url: '' };
    }

    const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];

    if (!TenantConfig) {
      return { ok: false, code: 'NO_ENTITY', message: 'TenantConfig 엔티티를 찾을 수 없습니다.', url: '' };
    }

    const p = req.data || {};
    const logoData = p.logo || p;
    const logoBase64 = logoData.logoBase64 || '';
    const logoContentType = logoData.logoContentType || 'image/png';
    const logoFilename = logoData.logoFilename || 'logo.png';

    if (!logoBase64) {
      return { ok: false, code: 'VALIDATION', message: '로고 데이터(logoBase64)가 필요합니다.', url: '' };
    }

    try {
      const base64Data = logoBase64.includes(',') ? logoBase64.split(',')[1] : logoBase64;
      const logoBuffer = Buffer.from(base64Data, 'base64');
      const logoSize = logoBuffer.length;

      const validMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml'];
      if (!validMimeTypes.includes(logoContentType.toLowerCase())) {
        return { ok: false, code: 'VALIDATION', message: '지원하지 않는 이미지 형식입니다.', url: '' };
      }

      if (logoSize > 5 * 1024 * 1024) {
        return { ok: false, code: 'VALIDATION', message: '로고 파일 크기는 5MB를 초과할 수 없습니다.', url: '' };
      }

      const tx = cds.transaction(req);
      const exists = await tx.run(SELECT.one.from(TenantConfig).columns('id').where({ id: tenantId }));

      const updateData = {
        logoContent: logoBuffer,
        logoContentType,
        logoFilename,
        logoSize
      };

      if (!exists) {
        await tx.run(INSERT.into(TenantConfig).entries({ id: tenantId, ...updateData }));
      } else {
        await tx.run(UPDATE(TenantConfig).set(updateData).where({ id: tenantId }));
      }

      await tx.commit();

      const logoUrl = `/odata/v4/auth/GetLogo()`;
      logOneLine('UPLOAD_LOGO', { tenantId, logoSize, logoContentType });

      return { ok: true, code: 'OK', message: '로고가 업로드되었습니다.', url: logoUrl };
    } catch (e) {
      logOneLine('UPLOAD_LOGO_FAIL', { tenantId, error: e.message }, { level: 'error' });
      return { ok: false, code: 'ERROR', message: `로고 업로드 실패: ${e.message}`, url: '' };
    }
  });

  // =====================================================
  // GetLogo
  // =====================================================
  this.on('GetLogo', async (req) => {
    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;

    if (!tenantId) {
      return { ok: false, code: 'NO_TENANT', message: 'Tenant ID를 찾을 수 없습니다.', useDefault: true };
    }

    const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];

    if (!TenantConfig) {
      return { ok: false, code: 'NO_ENTITY', message: 'TenantConfig 엔티티를 찾을 수 없습니다.', useDefault: true };
    }

    try {
      const tx = cds.transaction(req);
      const row = await tx.run(
        SELECT.from(TenantConfig)
          .columns('logoContent', 'logoContentType', 'logoFilename', 'modifiedAt')
          .where({ id: tenantId })
      );

      if (!row || !row[0]?.logoContent) {
        return { ok: false, code: 'NOT_FOUND', message: '로고를 찾을 수 없습니다.', useDefault: true };
      }

      // logoContent가 Buffer, Readable 스트림, 또는 다른 형식일 수 있으므로 처리
      let logoBuffer;
      const logoContent = row[0].logoContent;

      if (Buffer.isBuffer(logoContent)) {
        // 이미 Buffer인 경우
        logoBuffer = logoContent;
      } else if (typeof logoContent === 'string') {
        // 문자열인 경우 (base64 문자열일 수 있음)
        logoBuffer = Buffer.from(logoContent, 'base64');
      } else if (logoContent && typeof logoContent.pipe === 'function') {
        // Readable 스트림인 경우 Buffer로 변환
        const chunks = [];
        for await (const chunk of logoContent) {
          chunks.push(chunk);
        }
        logoBuffer = Buffer.concat(chunks);
      } else if (logoContent instanceof Uint8Array || Array.isArray(logoContent)) {
        // Uint8Array 또는 배열인 경우
        logoBuffer = Buffer.from(logoContent);
      } else {
        // 기타 경우: toString()으로 문자열로 변환 후 Buffer 생성 시도
        try {
          logoBuffer = Buffer.from(String(logoContent), 'base64');
        } catch (e) {
          logOneLine('GET_LOGO_BUFFER_CONVERSION_FAIL', {
            tenantId,
            logoContentType: typeof logoContent,
            error: e.message
          }, { level: 'error' });
          return { ok: false, code: 'CONVERSION_ERROR', message: `로고 데이터 변환 실패: ${e.message}`, useDefault: true };
        }
      }

      const logoBase64 = logoBuffer.toString('base64');
      const contentType = row[0].logoContentType || 'image/png';
      const dataUri = `data:${contentType};base64,${logoBase64}`;

      logOneLine('GET_LOGO', { tenantId, contentType, size: logoBase64.length });

      return {
        ok: true,
        logoBase64: dataUri,
        contentType,
        filename: row[0].logoFilename || 'logo.png',
        modifiedAt: row[0].modifiedAt ? new Date(row[0].modifiedAt).toISOString() : null,
        useDefault: false
      };
    } catch (e) {
      logOneLine('GET_LOGO_FAIL', { tenantId, error: e.message }, { level: 'error' });
      return { ok: false, code: 'ERROR', message: `로고 조회 실패: ${e.message}`, useDefault: true };
    }
  });

  // =====================================================
  // ApproveAccess (역할 부여 확인 및 USER_STATUS 변경)
  // =====================================================
  this.on('ApproveAccess', async (req) => {
    const { userId } = req.data || {};

    if (!userId) {
      return {
        ok: false,
        code: 'NO_USER_ID',
        message: '사용자 ID가 필요합니다.'
      };
    }

    logOneLine('APPROVE_ACCESS_START', {
      userId,
      approver: req.user?.id,
      tenant: req.tenant
    });

    try {
      const User = cds.entities['User'] || cds.entities['workhub.User'];
      if (!User) {
        return {
          ok: false,
          code: 'NO_ENTITY',
          message: 'User 엔티티를 찾을 수 없습니다.'
        };
      }

      const tx = cds.transaction(req);

      // 사용자 조회
      const user = await tx.run(
        SELECT.one.from(User).where({ id: userId })
      );

      if (!user) {
        return {
          ok: false,
          code: 'USER_NOT_FOUND',
          message: '사용자를 찾을 수 없습니다.'
        };
      }

      // 현재 상태 확인
      if (user.user_status !== 'REQUESTED') {
        return {
          ok: false,
          code: 'INVALID_STATUS',
          message: `현재 상태가 'REQUESTED'가 아닙니다. (현재: ${user.user_status})`
        };
      }

      // 사용자의 역할 확인 (XSUAA에서 실제로 역할이 부여되었는지 확인)
      // 여기서는 단순히 USER_STATUS만 변경하고, 실제 역할 확인은 BTP Cockpit에서 수동으로 수행되었다고 가정

      // USER_STATUS를 'ACTIVE'로 변경
      await tx.run(
        UPDATE(User)
          .set({ user_status: 'ACTIVE' })
          .where({ id: userId })
      );

      logOneLine('APPROVE_ACCESS_SUCCESS', {
        userId,
        oldStatus: 'REQUESTED',
        newStatus: 'ACTIVE',
        approver: req.user?.id
      });

      return {
        ok: true,
        code: 'OK',
        message: '사용자 권한이 승인되었습니다.'
      };
    } catch (e) {
      logOneLine('APPROVE_ACCESS_FAIL', {
        userId,
        error: e.message
      }, { level: 'error' });

      return {
        ok: false,
        code: 'ERROR',
        message: `권한 승인 처리 중 오류가 발생했습니다: ${e.message}`
      };
    }
  });

});
