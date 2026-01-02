// srv/server.js
const cds = require('@sap/cds');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

/* =========================================================
 * Email template helpers
 * ========================================================= */
const loadEmailTemplate = (templateName) => {
  const templatePath = path.resolve(__dirname, 'email', `${templateName}.html`);
  try {
    return fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    console.error(`❌ [Email] 템플릿 로드 실패: ${templateName}`, error);
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

/* =========================================================
 * Multer (memory storage for BLOB)
 * ========================================================= */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedExt = /\.(jpeg|jpg|png|gif|svg|webp)$/i;
    const allowedMime = /^(image\/jpeg|image\/jpg|image\/png|image\/gif|image\/svg\+xml|image\/webp)$/i;

    const extOk = allowedExt.test(path.extname(file.originalname || '').toLowerCase());
    const mimeOk = allowedMime.test(file.mimetype || '');

    if (extOk && mimeOk) return cb(null, true);
    return cb(new Error('이미지 파일만 업로드 가능합니다. (jpeg, jpg, png, gif, svg, webp)'));
  }
});

/* =========================================================
 * Tenant ID helper
 * ========================================================= */
const getTenantId = (req) => {
  // 1) CAP multi-tenant context (preferred)
  if (req.tenant) return req.tenant;
  if (cds.context?.tenant) return cds.context.tenant;

  // 2) xssec user info
  if (req.user?.tenant) return req.user.tenant;
  if (req.user?.attr?.zid) return req.user.attr.zid;

  // 3) authInfo identity zone (fallback)
  if (req.authInfo?.getIdentityZone && typeof req.authInfo.getIdentityZone === 'function') {
    return req.authInfo.getIdentityZone();
  }
  return null;
};

/* =========================================================
 * Auth / Role helpers (xs-security.json 기반)
 * - 필요한 권한: $XSAPPNAME.Administrator 또는 $XSAPPNAME.SYSADMIN
 * - 실제 토큰에는 <xsappname>.Administrator 형태로 들어옴
 * ========================================================= */
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

const extractUserScopes = (req) => {
  const scopes = new Set();

  // xssec user.scopes
  if (Array.isArray(req.user?.scopes)) {
    req.user.scopes.forEach((s) => scopes.add(String(s)));
  }

  // roles array
  if (Array.isArray(req.user?.roles)) {
    req.user.roles.forEach((s) => scopes.add(String(s)));
  }

  // roles object map
  if (req.user?.roles && typeof req.user.roles === 'object' && !Array.isArray(req.user.roles)) {
    Object.keys(req.user.roles).forEach((k) => scopes.add(String(k)));
  }

  return scopes;
};

const hasAnyAdminScope = (req) => {
  // 1) xssec의 req.user.is()가 있으면 최우선
  if (req.user?.is && typeof req.user.is === 'function') {
    // 환경에 따라 suffix만으로도 체크되는 케이스가 있어 우선 시도
    if (req.user.is('SYSADMIN') || req.user.is('Administrator')) return true;
  }

  const xsappname = getXsappnameFromEnv(); // 예: work_hub-IKD-Saas
  const scopes = extractUserScopes(req);

  const candidates = new Set([
    ...(xsappname ? [`${xsappname}.SYSADMIN`, `${xsappname}.Administrator`] : []),
    // fallback들
    'work_hub.SYSADMIN',
    'work_hub.Administrator',
    '$XSAPPNAME.SYSADMIN',
    '$XSAPPNAME.Administrator',
    'SYSADMIN',
    'Administrator'
  ]);

  for (const c of candidates) {
    if (scopes.has(c)) return true;
  }
  return false;
};

const checkAdminPermission = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: '인증이 필요합니다. 로그인 후 다시 시도해주세요.' });
    }
    if (!hasAnyAdminScope(req)) {
      return res.status(403).json({
        error: '권한이 없습니다. Administrator 또는 SYSADMIN 권한이 필요합니다.'
      });
    }
    return next();
  } catch (e) {
    console.error('[Auth] checkAdminPermission error:', e);
    return res.status(500).json({ error: '권한 체크 중 오류가 발생했습니다.' });
  }
};

/* =========================================================
 * CORS helper (dev only)
 * ========================================================= */
const applyDevCors = (req, res) => {
  const origin = req.headers.origin;
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
};

/* =========================================================
 * Bootstrap
 * ========================================================= */
cds.on('bootstrap', (app) => {
  app.use(bodyParser.json({ limit: '20mb' }));
  app.use(bodyParser.urlencoded({ limit: '20mb', extended: true }));

  // Dev CORS
  app.use((req, res, next) => {
    applyDevCors(req, res);
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });

  /* =======================================================
   * ConfirmEnvSetup (existing)
   * ======================================================= */
  app.get('/odata/v4/auth/ConfirmEnvSetup', async (req, res) => {
    try {
      const tenant = req.query.tenant;
      if (!tenant) {
        return res.status(400).send(`
          <html>
          <head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>테넌트 ID가 필요합니다.</p>
          </body>
          </html>
        `);
      }

      const { SELECT } = cds.ql;
      const TenantConfig = cds.entities['TenantConfig'];

      const tenantConfig = await cds.run(
        SELECT.one.from(TenantConfig).where({ id: tenant })
      );

      if (!tenantConfig) {
        return res.status(404).send(`
          <html>
          <head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>테넌트 설정을 찾을 수 없습니다.</p>
          </body>
          </html>
        `);
      }

      const baseUrl =
        process.env.APP_URL ||
        (process.env.VCAP_APPLICATION
          ? (() => {
              const v = JSON.parse(process.env.VCAP_APPLICATION);
              const uri = v.application_uris?.[0];
              return uri ? `https://${uri}` : 'http://localhost:4004';
            })()
          : 'http://localhost:4004');

      const completeUrl = `${baseUrl}/odata/v4/auth/SetEnvConfigured?tenant=${encodeURIComponent(tenant)}`;

      const confirmTemplate = loadEmailTemplate('confirm-env-setup');
      const confirmHtml = renderTemplate(confirmTemplate, {
        tenant,
        companyName: tenantConfig.companyName || '(없음)',
        mailSentAt: tenantConfig.mailSentAt
          ? new Date(tenantConfig.mailSentAt).toLocaleString('ko-KR')
          : '(없음)',
        completeUrl
      });

      res.send(confirmHtml);
    } catch (error) {
      console.error('❌ [ConfirmEnvSetup] 확인 페이지 로드 실패:', error);
      res.status(500).send(`
        <html>
        <head><meta charset="UTF-8"><title>오류</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #d32f2f;">오류</h2>
          <p>처리 중 오류가 발생했습니다: ${error.message}</p>
        </body>
        </html>
      `);
    }
  });

  /* =======================================================
   * SetEnvConfigured (existing)
   * ======================================================= */
  app.get('/odata/v4/auth/SetEnvConfigured', async (req, res) => {
    try {
      const tenant = req.query.tenant;
      if (!tenant) {
        return res.status(400).send(`
          <html>
          <head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>테넌트 ID가 필요합니다.</p>
          </body>
          </html>
        `);
      }

      const { SELECT, UPDATE } = cds.ql;
      const TenantConfig = cds.entities['TenantConfig'];

      const tenantConfig = await cds.run(
        SELECT.one.from(TenantConfig).where({ id: tenant })
      );

      if (!tenantConfig) {
        return res.status(404).send(`
          <html>
          <head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>테넌트 설정을 찾을 수 없습니다.</p>
          </body>
          </html>
        `);
      }

      await cds.run(
        UPDATE(TenantConfig).set({ envConfigured: true }).where({ id: tenant })
      );

      console.log(`✅ [SetEnvConfigured] 테넌트 ${tenant}의 환경변수 설정 완료 처리`);

      const completeTemplate = loadEmailTemplate('env-setup-complete');
      const completeHtml = renderTemplate(completeTemplate, {
        tenant,
        companyName: tenantConfig.companyName || '(없음)',
        completedAt: new Date().toLocaleString('ko-KR')
      });

      res.send(completeHtml);
    } catch (error) {
      console.error('❌ [SetEnvConfigured] 환경변수 설정 완료 처리 실패:', error);
      res.status(500).send(`
        <html>
        <head><meta charset="UTF-8"><title>오류</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #d32f2f;">오류</h2>
          <p>처리 중 오류가 발생했습니다: ${error.message}</p>
        </body>
        </html>
      `);
    }
  });

  /* =======================================================
   * Logo upload (ADMIN/SYSADMIN only) - BLOB 저장
   * ======================================================= */
  app.post('/api/logo', checkAdminPermission, upload.single('logo'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });

      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: '테넌트 ID를 확인할 수 없습니다.' });

      const { UPSERT } = cds.ql;
      const TenantLogo = cds.entities['TenantLogo'];
      if (!TenantLogo) return res.status(500).json({ error: 'TenantLogo 엔티티를 찾을 수 없습니다.' });

      // ✅ 멀티테넌트 컨텍스트 반영
      const tx = cds.transaction(req);

      await tx.run(
        UPSERT.into(TenantLogo).entries({
          id: tenantId,
          content: req.file.buffer,
          contentType: req.file.mimetype,
          filename: req.file.originalname,
          size: req.file.size
        })
      );

      console.log('✅ [Logo] 업로드 완료(DB 저장):', {
        tenantId,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size
      });

      return res.json({
        success: true,
        message: '로고가 성공적으로 업로드되었습니다.',
        url: '/api/logo'
      });
    } catch (error) {
      console.error('❌ [Logo] 업로드 실패:', error);
      return res.status(500).json({ error: error.message || '파일 업로드 중 오류가 발생했습니다.' });
    }
  });

  /* =======================================================
   * Logo get (tenant specific)
   * ======================================================= */
  app.get('/api/logo', async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: '테넌트 ID를 확인할 수 없습니다.' });

      const { SELECT } = cds.ql;
      const TenantLogo = cds.entities['TenantLogo'];
      if (!TenantLogo) return res.status(500).json({ error: 'TenantLogo 엔티티를 찾을 수 없습니다.' });

      const tx = cds.transaction(req);

      const logo = await tx.run(
        SELECT.one.from(TenantLogo).columns('content', 'contentType', 'modifiedAt').where({ id: tenantId })
      );

      if (!logo?.content) {
        return res.status(404).json({ error: '로고를 찾을 수 없습니다.', useDefault: true });
      }

      // 캐싱
      res.setHeader('Content-Type', logo.contentType || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      if (logo.modifiedAt) {
        const etag = `"${new Date(logo.modifiedAt).getTime()}"`;
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
      }

      return res.send(Buffer.from(logo.content));
    } catch (error) {
      console.error('❌ [Logo] 조회 실패:', error);
      return res.status(500).json({ error: error.message || '로고 조회 중 오류가 발생했습니다.' });
    }
  });

  /* =======================================================
   * Logout (existing)
   * ======================================================= */
  app.get('/logout', (req, res) => {
    try {
      res.clearCookie('connect.sid', { path: '/' });
    } catch {}

    if (req.session) {
      req.session.destroy(() => res.redirect('/auth/Me()'));
    } else {
      res.redirect('/auth/Me()');
    }
  });
});

module.exports = cds.server;
