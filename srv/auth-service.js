const cds = require('@sap/cds');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { SELECT, UPDATE, INSERT, DELETE } = cds.ql;

// =====================================================
// Email Template Helpers
// =====================================================

// 이메일 템플릿 로더
const loadEmailTemplate = (templateName) => {
  const templatePath = path.resolve(__dirname, 'email', `${templateName}.html`);
  try {
    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    console.error(`❌ [Email] 템플릿 로드 실패: ${templateName}`, error);
    throw error;
  }
};

// 템플릿 변수 치환
const renderTemplate = (template, variables) => {
  let rendered = template;
  for (const [key, value] of Object.entries(variables || {})) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(regex, value ?? '');
  }
  return rendered;
};

// =====================================================
// Local dev .env loader (no VCAP_SERVICES, non-production)
// =====================================================
if (process.env.NODE_ENV !== 'production' && !process.env.VCAP_SERVICES) {
  try {
    const dotenv = require('dotenv');
    const envPath = path.resolve(__dirname, '..', '.env'); // srv/.. => project root
    const result = dotenv.config({ path: envPath });
    if (result.error) {
      console.warn('[Auth] .env 파일 로드 실패:', result.error.message);
    } else {
      console.log(`[Auth] .env 파일 로드 완료: ${envPath}`);
      // 디버깅용 (민감정보는 출력하지 말 것)
      if (process.env.SMTP_USER) console.log('[Auth] SMTP_USER: (loaded)');
      if (process.env.SMTP_ENV) console.log('[Auth] SMTP_ENV: (loaded)');
    }
  } catch (e) {
    console.warn('[Auth] dotenv 로드 실패 (선택사항):', e.message);
  }
}

module.exports = cds.service.impl(async function () {
  const tz =
    process.env.TZ ||
    (Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) ||
    'UTC';

  // =====================================================
  // Common Helpers (Logging / Safe JSON / Mask Secrets)
  // =====================================================

  const safeJson = (obj) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return '(unserializable)';
    }
  };

  // 민감정보 마스킹 (pass, secret, token 등)
  const maskSecrets = (obj) => {
    const SENSITIVE_KEYS = [
      'pass',
      'password',
      'clientsecret',
      'clientSecret',
      'secret',
      'token',
      'access_token',
      'refresh_token',
      'authorization',
      'verificationkey',
      'privateKey'
    ];

    const walk = (v) => {
      if (v === null || v === undefined) return v;
      if (typeof v === 'string') return v;
      if (typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(walk);

      const out = {};
      for (const [k, val] of Object.entries(v)) {
        const lk = String(k).toLowerCase();
        if (SENSITIVE_KEYS.includes(lk)) {
          out[k] = '***';
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    };

    return walk(obj);
  };

  // ✅ 블록 로그: 콘솔 1회 출력
  // - data: 문자열 / 객체 / 배열 모두 가능
  const logBlock = (title, data, opts = {}) => {
    const { level = 'log' } = opts;
    const now = new Date().toISOString();

    let body = '';
    if (typeof data === 'string') {
      body = data;
    } else {
      // 객체면 JSON으로
      body = safeJson(maskSecrets(data));
    }

    // 여러 줄을 하나의 문자열로 묶어서 한 번에 출력
    // BTP/CF 환경에서도 제대로 출력되도록 \n으로 줄바꿈
    const block = `==================== [${title}] ====================\ntime: ${now}\n${body}\n=====================================================\n`;

    // console[level] 사용 (log/warn/error)
    // BTP/CF 환경에서도 제대로 출력되도록 직접 호출
    if (level === 'warn') {
      console.warn(block);
    } else if (level === 'error') {
      console.error(block);
    } else {
      console.log(block);
    }
  };

  // base64url payload decode
  const decodeJwtPayload = (jwt) => {
    try {
      const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch (e) {
      return null;
    }
  };

  // =====================================================
  // BTP Cockpit URL Generator (VCAP only)
  // =====================================================
  const generateBtpCockpitUrl = (tenantId, req = null) => {
    let region = null;
    let subaccountId = null;

    try {
      const vcapApp = process.env.VCAP_APPLICATION ? JSON.parse(process.env.VCAP_APPLICATION) : null;
      if (vcapApp?.application_uris?.length) {
        const appUri = vcapApp.application_uris[0];
        const regionMatch = appUri.match(/\.(ap|eu|us)(\d+)\./);
        if (regionMatch) region = regionMatch[1] + regionMatch[2];
      }

      const vcapServices = process.env.VCAP_SERVICES ? JSON.parse(process.env.VCAP_SERVICES) : null;
      if (vcapServices) {
        const xsuaaService = vcapServices['xsuaa'] || vcapServices['xsuaa-application'] || [];
        if (xsuaaService.length > 0 && xsuaaService[0].credentials) {
          const creds = xsuaaService[0].credentials;

          if (creds.url) {
            const urlMatch = String(creds.url).match(/https:\/\/([^.]+)\.authentication\.([^.]+)\.hana\.ondemand\.com/);
            if (urlMatch) {
              subaccountId = urlMatch[1];
              if (!region) region = urlMatch[2];
            }
          }
        }
      }

      if (region && subaccountId) {
        return `https://cockpit.${region}.hana.ondemand.com/cockpit/#/subaccount/${subaccountId}/users`;
      } else if (region) {
        return `https://cockpit.${region}.hana.ondemand.com/cockpit/#/users`;
      }
    } catch (e) {
      logBlock('Auth/VCAP_PARSE_FAIL', { message: e.message }, { level: 'warn' });
    }

    return null;
  };

  // =====================================================
  // ✅ Single SMTP Config Loader
  //   - 운영: VCAP_SERVICES 전체 flatten 후 smtp 서비스 탐색
  //   - 개발: SMTP_ENV(JSON) 또는 SMTP_* 개별 env
  // =====================================================
  const getSmtpConfig = () => {
    // 1) 운영: VCAP_SERVICES 전체에서 SMTP credential 가진 서비스 찾기
    try {
      const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
      const all = Object.values(vcap).flatMap((v) => (Array.isArray(v) ? v : []));

      const smtpService =
        all.find((s) => ((s.name || '').toLowerCase().includes('smtp'))) ||
        all.find((s) => s?.credentials && (s.credentials.SMTP_USER || s.credentials.smtp_user)) ||
        null;

      if (smtpService?.credentials) {
        const c = smtpService.credentials;
        return {
          service: c.SMTP_SERVICE || undefined,
          host: c.SMTP_HOST,
          port: parseInt(c.SMTP_PORT || '587', 10),
          secure: c.SMTP_SECURE === true || c.SMTP_SECURE === 'true',
          auth: { user: c.SMTP_USER, pass: c.SMTP_PASS },
          from: c.SMTP_FROM || c.SMTP_USER,
          _source: 'VCAP_SERVICES'
        };
      }
    } catch (e) {
      logBlock('SMTP/VCAP_PARSE_FAIL', { message: e.message }, { level: 'warn' });
    }

    // 2) 개발/대체: SMTP_ENV(JSON)
    if (process.env.SMTP_ENV) {
      try {
        const c = typeof process.env.SMTP_ENV === 'string' ? JSON.parse(process.env.SMTP_ENV) : process.env.SMTP_ENV;
        if (c?.SMTP_HOST || c?.SMTP_USER) {
          return {
            service: c.SMTP_SERVICE || undefined,
            host: c.SMTP_HOST,
            port: parseInt(c.SMTP_PORT || '587', 10),
            secure: c.SMTP_SECURE === true || c.SMTP_SECURE === 'true',
            auth: { user: c.SMTP_USER, pass: c.SMTP_PASS },
            from: c.SMTP_FROM || c.SMTP_USER,
            _source: 'SMTP_ENV'
          };
        }
      } catch (e) {
        logBlock('SMTP/SMTP_ENV_PARSE_FAIL', { message: e.message }, { level: 'warn' });
      }
    }

    // 3) 최후: 개별 env
    if (process.env.SMTP_HOST || process.env.SMTP_USER) {
      return {
        service: process.env.SMTP_SERVICE || undefined,
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        _source: 'ENV'
      };
    }

    return null;
  };

  const createTransporter = (smtpConfig) => {
    const transporterConfig = smtpConfig.service
      ? { service: smtpConfig.service, auth: smtpConfig.auth }
      : {
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure, // true=465, false=587 STARTTLS
          auth: smtpConfig.auth,
        };

    return nodemailer.createTransport(transporterConfig);
  };

  // =====================================================
  // User Profile / Roles Helpers
  // =====================================================
  const getUserProfile = (req) => {
    const u = req.user || {};
    const attr = u.attr || {};

    const id = u.id || u.name || attr.user_name || attr.ID || 'anonymous';

    const gn = attr.givenName || attr.given_name;
    const fn = attr.familyName || attr.family_name;

    let display = (gn || fn) ? [fn, gn].filter(Boolean).join('') : null;
    if (!display) display = attr.display_name || attr.name || id;

    const safeId = String(id || 'anonymous');
    const safeName = String(display || safeId);
    const tenant = req.tenant || u.tenant || attr.zid || '';
    const email = attr.email || id;

    return { id: safeId, name: safeName, tenant, email, raw: safeJson(attr) };
  };

  const createRoleChecker = (req) => {
    const userRoles = req.user?.roles || {};

    // 실제 xsappname 가져오기
    let actualXsappname = null;
    try {
      if (req.user?.authInfo?.services?.[0]?.credentials?.xsappname) {
        actualXsappname = req.user.authInfo.services[0].credentials.xsappname;
      } else if (process.env.VCAP_SERVICES) {
        const vcapServices = JSON.parse(process.env.VCAP_SERVICES);
        const xsuaaService = vcapServices['xsuaa'] || vcapServices['xsuaa-application'] || [];
        if (xsuaaService.length > 0 && xsuaaService[0].credentials?.xsappname) {
          actualXsappname = xsuaaService[0].credentials.xsappname;
        }
      }
    } catch (e) {
      logBlock('Auth/XSAPPNAME_RESOLVE_FAIL', { message: e.message }, { level: 'warn' });
    }

    const hasRole = (roleName) => {
      if (req.user?.is && typeof req.user.is === 'function') return req.user.is(roleName);
      return false;
    };

    const hasScope = (scopeName) => {
      if (actualXsappname) {
        const actualScope = `${actualXsappname}.${scopeName}`;
        if (userRoles[actualScope]) return true;
      }
      if (userRoles[`$XSAPPNAME.${scopeName}`]) return true;
      if (userRoles[`work_hub.${scopeName}`]) return true;
      if (userRoles[scopeName]) return true;
      return false;
    };

    return { hasRole, hasScope, actualXsappname, userRoles };
  };

  const getRoles = (req) => {
    const roles = [];
    const userRoles = req.user?.roles || {};
    const { hasRole, hasScope } = createRoleChecker(req);

    ['SYSADMIN', 'Administrator', 'Leader', 'User'].forEach((r) => {
      if (hasRole(r) || hasScope(r)) roles.push(r);
    });

    if (hasRole('authenticated-user') || userRoles['authenticated-user']) roles.push('authenticated-user');
    return roles;
  };

  const getRoleFlags = (req) => {
    const rolesObject = req.user?.roles || {};
    const { hasRole, hasScope, actualXsappname } = createRoleChecker(req);

    const flags = {
      SYSADMIN: hasRole('SYSADMIN') || hasScope('SYSADMIN'),
      ADMIN: hasRole('Administrator') || hasScope('Administrator'),
      LEADER: hasRole('Leader') || hasScope('Leader'),
      USER: hasRole('User') || hasScope('User'),
      AUTHENTICATED: hasRole('authenticated-user') || !!rolesObject['authenticated-user'],
    };

    // ✅ 블록 로그로 보기 좋게
    logBlock('Auth/ROLE_DETECTION', {
      flags,
      actualXsappname: actualXsappname || 'N/A',
      reqUserIsExists: typeof req.user?.is === 'function',
      reqUserIsChecks: (typeof req.user?.is === 'function')
        ? {
            SYSADMIN: req.user.is('SYSADMIN'),
            Administrator: req.user.is('Administrator'),
            Leader: req.user.is('Leader'),
            User: req.user.is('User'),
            'authenticated-user': req.user.is('authenticated-user'),
          }
        : '(no req.user.is)',
      rolesObject,
    });

    return flags;
  };

  // =====================================================
  // Actions / Functions
  // =====================================================

  // 🔥 한 방에 다 주는 엔드포인트
  this.on('Bootstrap', async (req) => {
    // ✅ JWT/ROLE 디버그 블록 (최상단)
    const jwt = req.user?.authInfo?.jwt;
    const payload = jwt ? decodeJwtPayload(jwt) : null;

    logBlock('Auth/BOOTSTRAP_IN', {
      tenant: req.tenant || 'N/A',
      userId: req.user?.id || 'N/A',
      userName: req.user?.name || 'N/A',
      hasJwt: !!jwt,
      jwtInfo: payload
        ? {
            zid: payload.zid,
            subaccountid: payload.subaccountid,
            iss: payload.iss,
            aud: payload.aud,
            scope: payload.scope,
          }
        : '(no jwt payload)',
      // 여기서 roles도 같이 보여주면 “openid만 찍히는지” 확실히 보임
      reqUserRolesObject: req.user?.roles || {},
      reqUserIsExists: typeof req.user?.is === 'function',
    });

    // 유저 upsert + status/role 관리
    const userSrv = await cds.connect.to('UserService');
    await userSrv.ensureUserFromReq(req);

    const user = getUserProfile(req);
    const roles = getRoles(req);
    const flags = getRoleFlags(req);
    const now = new Date();

    const tenant = req.tenant || req.user?.tenant || req.user?.attr?.zid || 'default';
    let isConfigured = false;
    let adminEmail = null;

    try {
      const tx = cds.transaction(req);
      const TenantConfig = cds.entities['TenantConfig'];
      const tenantConfig = await tx.run(SELECT.one.from(TenantConfig).where({ id: tenant }));

      if (tenantConfig) {
        isConfigured = tenantConfig.isConfigured || false;
        adminEmail = tenantConfig.adminEmail || null;
      }
    } catch (e) {
      logBlock('Auth/BOOTSTRAP_TENANTCONFIG_READ_FAIL', { message: e.message }, { level: 'warn' });
    }

    if (!adminEmail) {
      try {
        const tx = cds.transaction(req);
        const User = cds.entities['User'];
        const adminUser = await tx.run(SELECT.one.from(User).where({ role: 'Administrator' }).orderBy('createdAt'));
        if (adminUser?.email) adminEmail = adminUser.email;
      } catch (e) {
        logBlock('Auth/BOOTSTRAP_ADMINEMAIL_FALLBACK_FAIL', { message: e.message }, { level: 'warn' });
      }
    }

    logBlock('Auth/BOOTSTRAP_OUT', {
      tenant,
      isConfigured,
      adminEmail: adminEmail || '(empty)',
      computedRoles: roles,
      computedFlags: flags,
      serverTime: { iso: now.toISOString(), timezone: tz },
    });

    return {
      user,
      roles,
      flags,
      serverTime: { now, timezone: tz, iso: now.toISOString() },
      adminEmail: adminEmail || process.env.ADMIN_EMAIL || '',
      isConfigured,
    };
  });

  this.on('Me', async (req) => {
    const profile = getUserProfile(req);
    const now = new Date();
    return { ...profile, tz, nowISO: now.toISOString() };
  });

  this.on('MyRoles', (req) => getRoles(req));
  this.on('WhoAmI', (req) => getRoleFlags(req));
  this.on('ServerTime', () => {
    const now = new Date();
    return { now, timezone: tz, iso: now.toISOString() };
  });
  this.on('Ping', () => 'pong');

  this.on('ResetSession', async (req) => {
    logBlock('Auth/RESET_SESSION', {
      userId: req.user?.id || 'N/A',
      tenant: req.tenant || 'N/A',
    });
    return true;
  });

  // =====================================================
  // ✅ 권한 요청 메일 (단일 SMTP / From 고정 / Reply-To 요청자)
  // =====================================================
  this.on('RequestAccessMail', async (req) => {
    const { email, name } = req.data;

    if (!email) {
      return { ok: false, code: 'NO_EMAIL', message: '이메일 정보가 없어 권한 요청을 처리할 수 없습니다.', retryAfterDays: 0 };
    }

    // 1) 업서트 + 쿨다운 체크
    const userSrv = await cds.connect.to('UserService');
    const cooldown = await userSrv.checkAccessRequestCooldown(req, { cooldownDays: 30 });
    if (!cooldown.ok) {
      return { ok: false, code: cooldown.code, message: cooldown.message, retryAfterDays: cooldown.retryAfterDays || 0 };
    }

    // 2) ADMIN 이메일 및 테넌트 설정 조회
    const tenant = req.tenant || req.user?.tenant || req.user?.attr?.zid || 'default';
    let adminEmail = null;
    let companyName = null;
    let btpCockpitUrl = null;

    try {
      const tx = cds.transaction(req);
      const TenantConfig = cds.entities['TenantConfig'];
      const tenantConfig = await tx.run(SELECT.one.from(TenantConfig).where({ id: tenant }));

      if (tenantConfig) {
        adminEmail = tenantConfig.adminEmail || null;
        companyName = tenantConfig.companyName || null;
        btpCockpitUrl = tenantConfig.btpCockpitUrl || generateBtpCockpitUrl(tenant, req);
      } else {
        btpCockpitUrl = generateBtpCockpitUrl(tenant, req);
      }
    } catch (e) {
      logBlock('Auth/REQUEST_ACCESS/TENANTCONFIG_READ_FAIL', { message: e.message }, { level: 'warn' });
    }

    if (!adminEmail) {
      try {
        const tx = cds.transaction(req);
        const User = cds.entities['User'];
        const adminUser = await tx.run(SELECT.one.from(User).where({ role: 'Administrator' }).orderBy('createdAt'));
        if (adminUser?.email) adminEmail = adminUser.email;
      } catch (e) {
        logBlock('Auth/REQUEST_ACCESS/ADMINEMAIL_FALLBACK_FAIL', { message: e.message }, { level: 'warn' });
      }
    }

    if (!adminEmail) {
      return { ok: false, code: 'NO_ADMIN_EMAIL', message: '관리자 이메일이 설정되지 않아 권한 요청을 처리할 수 없습니다.', retryAfterDays: 0 };
    }

    logBlock('Auth/REQUEST_ACCESS/MAIL_TARGET', {
      tenant,
      requestName: name || email,
      requestEmail: email,
      adminEmail,
      companyName: companyName || '(none)',
      btpCockpitUrl: btpCockpitUrl || '(none)',
    });

    // 3) SMTP 설정
    const smtpConfig = getSmtpConfig();

    logBlock('SMTP/RESOLVED', smtpConfig
      ? {
          source: smtpConfig._source,
          service: smtpConfig.service,
          host: smtpConfig.host,
          port: smtpConfig.port,
          secure: smtpConfig.secure,
          user: smtpConfig.auth?.user,
          from: smtpConfig.from,
          // pass는 maskSecrets가 *** 처리함
          pass: smtpConfig.auth?.pass
        }
      : { message: 'no smtp config' }
    );

    if (!smtpConfig) {
      return { ok: false, code: 'NO_SMTP_CONFIG', message: 'SMTP 설정이 없어 메일을 발송할 수 없습니다.', retryAfterDays: 0 };
    }

    // 4) 템플릿 렌더링
    let emailHtml = '';
    let emailText = '';

    const requestDate = new Date().toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Seoul',
    });

    try {
      const template = loadEmailTemplate('access-request');

      const btpCockpitButton = btpCockpitUrl
        ? `<a href="${btpCockpitUrl}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); margin-bottom: 15px;">🚀 BTP Cockpit에서 역할 설정</a>`
        : '';

      const templateVars = {
        requestName: name || email,
        requestEmail: email,
        requestDate,
        tenant,
        companyName: companyName || '(미설정)',
        btpCockpitUrl: btpCockpitUrl || '',
        btpCockpitButton,
      };

      emailHtml = renderTemplate(template, templateVars);

      emailText = `
요청자 이름: ${name || email}
요청자 이메일: ${email}
요청 일시: ${requestDate}
테넌트 ID: ${tenant}
${companyName ? `회사명: ${companyName}` : ''}

WorkHub 애플리케이션에 대한 접근 권한을 신청합니다.
${btpCockpitUrl ? `\nBTP Cockpit에서 역할 설정: ${btpCockpitUrl}` : ''}
      `.trim();
    } catch (templateError) {
      logBlock('Auth/REQUEST_ACCESS/TEMPLATE_FAIL', { message: templateError.message }, { level: 'warn' });
      emailText = `
요청자 이름: ${name || email}
요청자 이메일: ${email}

WorkHub 애플리케이션에 대한 접근 권한을 신청합니다.
      `.trim();
    }

    // 5) 메일 발송 (From 고정 / Reply-To 요청자)
    try {
      const transporter = createTransporter(smtpConfig);

      const mailOptions = {
        from: `"WorkHub 자동메일" <${smtpConfig.from}>`,
        to: adminEmail,
        replyTo: email,
        subject: '[WorkHub] 권한 요청',
        text: emailText,
        html: emailHtml || undefined,
      };

      const info = await transporter.sendMail(mailOptions);

      logBlock('Auth/REQUEST_ACCESS/SENT', {
        messageId: info.messageId,
        to: adminEmail,
        from: mailOptions.from,
        smtp: smtpConfig.host || smtpConfig.service,
      });

      return { ok: true, code: 'OK', message: '권한 요청 메일이 발송되었습니다.', retryAfterDays: 30 };
    } catch (error) {
      logBlock('Auth/REQUEST_ACCESS/SEND_FAIL', {
        message: error.message,
        to: adminEmail,
        smtpConfig,
      }, { level: 'error' });

      return { ok: false, code: 'MAIL_SEND_FAILED', message: `메일 발송 실패: ${error.message}`, retryAfterDays: 0 };
    }
  });

  // =====================================================
  // 테넌트 초기 설정 제출 (ADMIN)
  // =====================================================
  this.on('SubmitTenantConfig', async (req) => {
    const config = req.data.config;
    const tenant = req.tenant || req.user?.tenant || req.user?.attr?.zid || 'default';

    logBlock('Auth/SUBMIT_TENANT_CONFIG/IN', {
      tenant,
      companyName: config?.companyName,
      adminEmail: config?.adminEmail,
      companyLogoUrl: config?.companyLogoUrl,
      timezone: config?.timezone,
      language: config?.language,
      btpCockpitUrl: config?.btpCockpitUrl,
    });

    let uploadedLogoPath = null;

    try {
      const tx = cds.transaction(req);
      const TenantConfig = cds.entities['TenantConfig'];

      const existing = await tx.run(SELECT.one.from(TenantConfig).where({ id: tenant }));

      // 로고 파일 경로 저장 (롤백용)
      if (config.companyLogoUrl) {
        const resourcesDir = path.resolve(__dirname, '..', 'app', 'router', 'resources');
        const imagesDir = path.join(resourcesDir, 'images', 'logos');
        const filename = String(config.companyLogoUrl).split('/').pop();
        if (filename) uploadedLogoPath = path.join(imagesDir, filename);
      }

      // BTP Cockpit URL 자동 생성
      let btpCockpitUrl = config.btpCockpitUrl;
      if (!btpCockpitUrl || (typeof btpCockpitUrl === 'string' && btpCockpitUrl.trim().length === 0)) {
        btpCockpitUrl = generateBtpCockpitUrl(tenant, req);
      }

      const configData = {
        companyName: config.companyName,
        companyLogoUrl: config.companyLogoUrl || null,
        timezone: config.timezone || 'Asia/Seoul',
        language: config.language || 'ko',
        adminEmail: config.adminEmail,
        btpCockpitUrl: btpCockpitUrl,
        isConfigured: true,
      };

      if (existing) {
        await tx.run(UPDATE(TenantConfig).set(configData).where({ id: tenant }));
        logBlock('Auth/SUBMIT_TENANT_CONFIG/UPDATED', { tenant, ...configData });
      } else {
        await tx.run(INSERT.into(TenantConfig).entries({ id: tenant, ...configData }));
        logBlock('Auth/SUBMIT_TENANT_CONFIG/CREATED', { tenant, ...configData });
      }

      return { ok: true, code: 'OK', message: '테넌트 설정이 완료되었습니다.' };
    } catch (error) {
      logBlock('Auth/SUBMIT_TENANT_CONFIG/FAIL', { message: error.message, uploadedLogoPath }, { level: 'error' });

      // 롤백: 업로드된 로고 파일 삭제
      if (uploadedLogoPath && fs.existsSync(uploadedLogoPath)) {
        try {
          fs.unlinkSync(uploadedLogoPath);
          logBlock('Auth/SUBMIT_TENANT_CONFIG/ROLLBACK_LOGO_DELETED', { uploadedLogoPath });
        } catch (fileError) {
          logBlock('Auth/SUBMIT_TENANT_CONFIG/ROLLBACK_LOGO_DELETE_FAIL', { message: fileError.message, uploadedLogoPath }, { level: 'error' });
        }
      }

      return { ok: false, code: 'ERROR', message: `설정 저장 중 오류가 발생했습니다: ${error.message}` };
    }
  });
});
