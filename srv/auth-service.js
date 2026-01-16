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
  this.on('Bootstrap', async (req) => {
    // 디버깅: 실제 전달되는 스코프 확인
    const userObj = req.user || {};
    const scopes = userObj.scopes || [];
    const scopeNames = Array.isArray(scopes) ? scopes.map(s => typeof s === 'string' ? s : s?.name || String(s)) : [];
    
    logOneLine('BOOTSTRAP_DEBUG_SCOPES', {
      userId: userObj.id || userObj.name,
      scopes: scopeNames,
      hasIsMethod: typeof userObj.is === 'function',
      isUser: userObj.is ? userObj.is('User') : null,
      isWorkHubUser: userObj.is ? userObj.is('work_hub.User') : null
    });
    
    const user = getUserProfile(req);
    const roles = getRoles(req);
    const flags = getRoleFlags(req);
    const now = new Date();

    const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;

    const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];

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
      user: { id: user.id, name: user.name },
      roles,
      flags,
      tenantConfigFound: !!tenantConfig,
      isConfigured,
      adminEmail
    });

    return {
      user,
      roles,
      flags,
      serverTime: {
        tz,
        iso: now.toISOString()
      },
      adminEmail,
      isConfigured
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
  this.on('RequestAccessMail', async (req) => {
    const { email, name } = req.data || {};

    // 0) 이메일 필수 체크
    if (!email) {
      return {
        ok: false,
        code: 'NO_EMAIL',
        message: '이메일 정보가 없어 권한 요청을 처리할 수 없습니다.',
        retryAfterDays: 0
      };
    }

    logOneLine('REQUEST_ACCESS_MAIL_START', {
      user: req.user?.id,
      tenant: req.tenant,
      email,
      name
    });

    try {
      // 1) UserService를 통해 유저 업서트 + 쿨다운 체크
      const userSrv = await cds.connect.to('UserService');
      const cooldown = await userSrv.checkAccessRequestCooldown(req, {
        cooldownDays: 30
      });

      // ⏰ 아직 30일 쿨다운 중인 경우 → 그대로 전달해서 200 + { ok:false } 구조로 반환
      if (!cooldown.ok) {
        logOneLine('REQUEST_ACCESS_MAIL_COOLDOWN', {
          user: req.user?.id,
          code: cooldown.code,
          retryAfterDays: cooldown.retryAfterDays
        });
        return {
          ok: false,
          code: cooldown.code,
          message: cooldown.message,
          retryAfterDays: cooldown.retryAfterDays || 0
        };
      }

      // 2) 테넌트 설정에서 관리자 이메일 가져오기
      const tenantId = req.tenant || req.user?.tenant || req.user?.attr?.zid || null;
      let adminEmail = null;

      if (tenantId) {
        const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];
        if (TenantConfig) {
          try {
            const tx = cds.transaction(req);
            const config = await tx.run(
              SELECT.one.from(TenantConfig).columns('adminEmail').where({ id: tenantId })
            );
            if (config?.adminEmail) {
              adminEmail = config.adminEmail;
            }
          } catch (e) {
            logOneLine('REQUEST_ACCESS_MAIL_ADMIN_EMAIL_FAIL', { tenantId, error: e.message }, { level: 'warn' });
          }
        }
      }

      // 관리자 이메일이 없으면 기본값 사용
      if (!adminEmail) {
        adminEmail = process.env.ADMIN_EMAIL || 'leemocha@aspnc.com';
        logOneLine('REQUEST_ACCESS_MAIL_DEFAULT_ADMIN', { adminEmail }, { level: 'warn' });
      }

      // 3) 테넌트 설정에서 회사명, BTP Cockpit URL, AppRouter URL 가져오기
      let companyName = 'WorkHub';
      let btpCockpitUrl = null;
      let savedAppRouterUrl = null;

      if (tenantId) {
        const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];
        if (TenantConfig) {
          try {
            const tx = cds.transaction(req);
            const config = await tx.run(
              SELECT.one.from(TenantConfig).columns('companyName', 'btpCockpitUrl', 'additionalConfig').where({ id: tenantId })
            );
            if (config?.companyName) {
              companyName = config.companyName;
            }
            if (config?.btpCockpitUrl) {
              btpCockpitUrl = config.btpCockpitUrl;
            }
            
            // additionalConfig에서 AppRouter URL 추출
            if (config?.additionalConfig) {
              try {
                const additionalConfigObj = JSON.parse(config.additionalConfig);
                if (additionalConfigObj?.appRouterUrl) {
                  savedAppRouterUrl = additionalConfigObj.appRouterUrl;
                }
              } catch (e) {
                // JSON 파싱 실패 시 무시
              }
            }
          } catch (e) {
            logOneLine('REQUEST_ACCESS_MAIL_TENANTCONFIG_FAIL', { tenantId, error: e.message }, { level: 'warn' });
          }
        }
      }

      // BTP Cockpit URL이 없으면 환경변수나 기본값 사용
      if (!btpCockpitUrl) {
        // 환경변수에서 BTP Cockpit URL 가져오기 (형식: https://emea.cockpit.btp.cloud.sap/cockpit/#/globalaccount/{globalaccountId}/subaccount/{subaccountId}/service-instances)
        // 또는 테넌트 ID를 기반으로 동적 생성
        const cockpitBaseUrl = process.env.BTP_COCKPIT_BASE_URL || 'https://emea.cockpit.btp.cloud.sap';
        const globalAccountId = process.env.BTP_GLOBAL_ACCOUNT_ID || '2fda4d86-31e5-48d8-979f-dabc0c506967';
        
        // 테넌트 ID를 subaccount ID로 사용 (실제로는 테넌트 ID가 subaccount ID일 수 있음)
        const subaccountId = tenantId || process.env.BTP_SUBACCOUNT_ID || '1c5002c7-4e64-492e-a642-190c096c038b';
        
        btpCockpitUrl = `${cockpitBaseUrl}/cockpit/#/globalaccount/${globalAccountId}/subaccount/${subaccountId}/service-instances`;
      }

      // 4) HTML 템플릿 로드 및 렌더링
      const template = loadEmailTemplate('access-request');
      const requestDate = new Date().toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      // BTP Cockpit 버튼 HTML 생성
      const btpCockpitButton = `<a href="${btpCockpitUrl}" target="_blank" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">BTP Cockpit 열기</a>`;

      // 권한 승인 버튼 URL 생성 (AppRouter URL 사용)
      // AppRouter URL을 사용해야 인증 없이 접근 가능
      // Consumer 계정에서 실행 중일 때는 Consumer AppRouter URL을 사용해야 함
      // 
      // 우선순위:
      // 1. TenantConfig.additionalConfig에 저장된 AppRouter URL (가장 확실)
      // 2. 환경변수 APPROUTER_URL
      // 3. 요청의 Host/Referer 헤더에서 추출
      // 4. VCAP_APPLICATION에서 추출 (fallback)
      
      // 1) TenantConfig.additionalConfig에서 저장된 AppRouter URL 사용 (최우선)
      let approveBaseUrl = savedAppRouterUrl;
      
      // 2) 없으면 환경변수에서 AppRouter URL 가져오기
      if (!approveBaseUrl) {
        approveBaseUrl = process.env.APPROUTER_URL;
      }
      
      // 3) 저장된 URL도 없고 환경변수도 없으면 요청의 Host 헤더 또는 Referer 헤더에서 추출
      // Consumer 계정에서 이메일 요청이 들어오면 Host 헤더가 Consumer AppRouter URL
      if (!approveBaseUrl && req) {
        // Host 헤더 확인
        let hostHeader = req.headers['host'] || req.headers['x-forwarded-host'];
        
        // Host 헤더가 없으면 Referer 헤더 확인
        // Referer는 이전 페이지 URL을 포함하므로 Consumer AppRouter URL을 포함할 수 있음
        if (!hostHeader && req.headers['referer']) {
          try {
            const refererUrl = new URL(req.headers['referer']);
            hostHeader = refererUrl.hostname;
          } catch (e) {
            // Referer 파싱 실패 시 무시
          }
        }
        
        if (hostHeader) {
          // Host 헤더에서 호스트명 추출
          const hostname = hostHeader.split(':')[0]; // 포트 제거
          
          // AppRouter 호스트인지 확인 (이미 AppRouter에서 온 요청이면 그대로 사용)
          // 서비스로 직접 온 요청이면 '-srv'를 '-router'로 치환
          let routerHost = hostname;
          
          // 서비스 호스트 패턴인지 확인 (-srv로 끝나는 경우)
          if (hostname.endsWith('-srv') || hostname.match(/-srv\./)) {
            routerHost = hostname.replace(/-srv(\.|$)/, '-router$1');
          }
          
          approveBaseUrl = `https://${routerHost}`;
          
          logOneLine('APPROUTER_URL_FROM_HOST', { 
            hostHeader,
            hostname,
            routerHost,
            approveBaseUrl,
            tenantId,
            referer: req.headers['referer']
          });
        }
      }
      
      // 3) Host 헤더에도 Consumer 패턴이 없으면 BTP Cockpit URL에서 subaccount ID 추출 후 패턴 구성 시도
      // BTP Cockpit URL: https://emea.cockpit.btp.cloud.sap/cockpit/#/globalaccount/{globalaccountId}/subaccount/{subaccountId}/service-instances
      // subaccount ID는 tenant ID와 같을 수 있지만, Consumer 서브도메인을 직접 추론하기는 어려움
      // 따라서 TenantConfig에 저장된 btpCockpitUrl에서 subaccount ID를 추출하고,
      // Provider URL 패턴에 tenant subdomain을 추가하는 방식으로 시도
      if (!approveBaseUrl && btpCockpitUrl && tenantId) {
        try {
          // BTP Cockpit URL에서 subaccount ID 추출
          const subaccountMatch = btpCockpitUrl.match(/\/subaccount\/([^\/]+)/);
          const subaccountId = subaccountMatch ? subaccountMatch[1] : tenantId;
          
          // VCAP_APPLICATION에서 도메인과 Provider URL 패턴 추출
          if (process.env.VCAP_APPLICATION) {
            const v = JSON.parse(process.env.VCAP_APPLICATION);
            const applicationUris = v.application_uris || [];
            
            if (applicationUris.length > 0) {
              const providerServiceUri = applicationUris[0];
              const domainMatch = providerServiceUri.match(/\.cfapps\.(.+)$/);
              
              if (domainMatch) {
                const domain = domainMatch[1]; // us10-001.hana.ondemand.com
                
                // Provider 서비스 호스트: ikd-saas-work-hub-srv
                const providerServiceHost = providerServiceUri.replace(/\.cfapps\..+$/, '');
                
                // Provider AppRouter 호스트: ikd-saas-work-hub-router
                const providerRouterHost = providerServiceHost.replace(/-srv$/, '-router');
                
                // Consumer 서브도메인을 추론할 수 없으므로,
                // 환경변수나 다른 방법을 통해 Consumer AppRouter URL을 구성해야 함
                // 하지만 패턴이 명확하지 않으므로, 일단 Provider URL 사용하고 로그 출력
                
                logOneLine('APPROVE_URL_CONSUMER_PATTERN_NOT_FOUND', {
                  subaccountId,
                  tenantId,
                  providerServiceUri,
                  providerRouterHost,
                  btpCockpitUrl,
                  note: 'Consumer 서브도메인을 추론할 수 없음. Provider URL 사용 또는 환경변수 APPROUTER_URL 설정 필요'
                }, { level: 'warn' });
                
                // 일단 Provider URL 사용 (더 나은 방법이 필요함)
                approveBaseUrl = `https://${providerRouterHost}.cfapps.${domain}`;
              }
            }
          }
        } catch (e) {
          logOneLine('APPROVE_URL_FROM_COCKPIT_FAIL', { error: e.message }, { level: 'warn' });
        }
      }
      
      // 4) 여전히 없으면 VCAP_APPLICATION에서 Provider AppRouter URL 추출 (fallback)
      if (!approveBaseUrl && process.env.VCAP_APPLICATION) {
        try {
          const v = JSON.parse(process.env.VCAP_APPLICATION);
          const applicationUris = v.application_uris || [];
          
          if (applicationUris.length > 0) {
            const serviceUri = applicationUris[0];
            const domainMatch = serviceUri.match(/\.cfapps\.(.+)$/);
            
            if (domainMatch) {
              const domain = domainMatch[1];
              const serviceHost = serviceUri.replace(/\.cfapps\..+$/, '');
              let routerHost = serviceHost.replace(/-srv$/, '-router');
              
              if (routerHost === serviceHost) {
                routerHost = serviceHost.replace(/[^-]+$/, 'router');
              }
              
              approveBaseUrl = `https://${routerHost}.cfapps.${domain}`;
              
              logOneLine('APPROUTER_URL_FROM_VCAP', {
                serviceUri,
                routerHost,
                approveBaseUrl,
                tenantId
              });
            }
          }
        } catch (e) {
          logOneLine('APPROVE_URL_GEN_FAIL', { error: e.message }, { level: 'warn' });
        }
      }
      
      // 4) 여전히 없으면 로컬 개발 환경 기본값
      if (!approveBaseUrl) {
        approveBaseUrl = 'http://localhost:4004';
        logOneLine('APPROUTER_URL_DEFAULT', { approveBaseUrl });
      }
      
      // 앱 URL로 변경 (앱 내에서 권한 승인 처리)
      // /index.html#/approve-access?userId=...&tenant=... 형식
      const approveUrl = `${approveBaseUrl}/index.html#/approve-access?userId=${encodeURIComponent(email)}&tenant=${encodeURIComponent(tenantId || '')}`;
      
      logOneLine('APPROVE_URL_GENERATED', { approveUrl, approveBaseUrl, tenantId });
      
      // 권한 승인 버튼 HTML 생성
      const approveButton = `<a href="${approveUrl}" style="display: inline-block; padding: 12px 30px; background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); transition: transform 0.2s; margin-top: 10px;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">✅ 권한 승인 완료</a>`;

      const htmlContent = renderTemplate(template, {
        requestName: name || '알 수 없음',
        requestEmail: email,
        requestDate,
        tenant: tenantId || '알 수 없음',
        companyName,
        btpCockpitButton,
        approveButton
      });

      // 5) 메일 발송
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: 'leemocha.aspn@gmail.com',
          pass: process.env.GMAIL_APP_PASS
        }
      });

      const mailOptions = {
        from: '"WorkHub 자동메일" <leemocha.aspn@gmail.com>',
        to: adminEmail,
        subject: '[WorkHub] 권한 요청',
        html: htmlContent,
        text: `
요청자 이름: ${name || '알 수 없음'}
요청자 이메일: ${email}
테넌트 ID: ${tenantId || '알 수 없음'}
회사명: ${companyName}

WorkHub 애플리케이션에 대한 접근 권한을 신청합니다.

요청 시각: ${requestDate}
BTP Cockpit: ${btpCockpitUrl}
        `.trim()
      };

      await transporter.sendMail(mailOptions);

      logOneLine('REQUEST_ACCESS_MAIL_SENT', {
        user: req.user?.id,
        tenant: tenantId,
        from: email,
        to: adminEmail,
        name
      });

      return {
        ok: true,
        code: 'OK',
        message: '권한 요청 메일이 발송되었습니다.',
        retryAfterDays: 30
      };
    } catch (e) {
      logOneLine('REQUEST_ACCESS_MAIL_FAIL', {
        user: req.user?.id,
        tenant: req.tenant,
        error: e.message
      }, { level: 'error' });

      return {
        ok: false,
        code: 'ERROR',
        message: `권한 요청 처리 중 오류가 발생했습니다: ${e.message}`,
        retryAfterDays: 0
      };
    }
  });

  // =====================================================
  // SetEnvConfigured (HTML 반환)
  // =====================================================
  this.on('SetEnvConfigured', async (req) => {
    const tenantId = req.data?.tenant || req.tenant || req.user?.tenant || req.user?.attr?.zid || null;

    if (!tenantId) {
      return req.reply(`<html><body><h1>Error</h1><p>Tenant ID not found</p></body></html>`).type('text/html').status(400);
    }

    const TenantConfig = cds.entities['TenantConfig'] || cds.entities['workhub.TenantConfig'];

    if (!TenantConfig) {
      return req.reply(`<html><body><h1>Error</h1><p>TenantConfig entity not found</p></body></html>`).type('text/html').status(500);
    }

    try {
      const tx = cds.transaction(req);
      const exists = await tx.run(SELECT.one.from(TenantConfig).columns('id').where({ id: tenantId }));

      if (exists) {
        await tx.run(UPDATE(TenantConfig).set({ isConfigured: true }).where({ id: tenantId }));
      } else {
        await tx.run(INSERT.into(TenantConfig).entries({ id: tenantId, isConfigured: true }));
      }

      await tx.commit();

      const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>환경 설정 완료</title>
</head>
<body>
  <h1>환경 설정이 완료되었습니다.</h1>
  <p>테넌트 ID: ${tenantId}</p>
  <p><a href="/">홈으로 돌아가기</a></p>
</body>
</html>`;

      logOneLine('SET_ENV_CONFIGURED', { tenantId });
      return req.reply(html).type('text/html');
    } catch (e) {
      logOneLine('SET_ENV_CONFIGURED_FAIL', { tenantId, error: e.message }, { level: 'error' });
      return req.reply(`<html><body><h1>Error</h1><p>${e.message}</p></body></html>`).type('text/html').status(500);
    }
  });

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
