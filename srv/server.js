// srv/server.js
const cds = require('@sap/cds');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

/* =========================================================
 * Email template helpers (ConfirmEnvSetup용)
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
 * Bootstrap
 * ========================================================= */
cds.on('bootstrap', (app) => {
  app.use(bodyParser.json({ limit: '20mb' }));
  app.use(bodyParser.urlencoded({ limit: '20mb', extended: true }));

  // Dev CORS
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
});

/* =========================================================
 * Served - 이메일 확인 페이지 라우트
 * ========================================================= */
cds.on('served', () => {
  const app = cds.app;

  // ✅ Entity helper (namespace 포함 안전하게 찾기)
  const getTenantConfigEntity = () => {
    return (
      cds.entities['workhub.TenantConfig'] ||
      cds.entities['TenantConfig'] ||
      cds.entities?.workhub?.TenantConfig ||
      null
    );
  };

 
  // ✅ tenantId 추출: CAP 멀티테넌트에서 req.tenant가 가장 우선
  const getTenantId = (req) =>
    req.tenant ||
    req.user?.tenant ||
    req.user?.attr?.zid ||
    req.headers['x-tenant-id'] || // 혹시 프론트에서 커스텀 헤더로 보낸다면
    req.query?.tenant ||          // 디버깅/테스트용
    null;

  // =======================================================
  // ✅ Company Logo - "정적 리소스처럼" 바이너리 서빙
  //   GET /assets/logo
  // =======================================================
  app.get('/assets/logo', async (req, res) => {
    try {
      // tenant ID 추출 (여러 소스에서 시도)
      let tenantId = getTenantId(req);
      
      // tenant ID를 찾지 못한 경우 디버깅 정보 출력
      if (!tenantId) {
        console.error('❌ [/assets/logo] Tenant ID not found', {
          hasTenant: !!req.tenant,
          hasUser: !!req.user,
          userTenant: req.user?.tenant,
          userAttrZid: req.user?.attr?.zid,
          headerTenant: req.headers['x-tenant-id'],
          queryTenant: req.query?.tenant,
          userId: req.user?.id
        });
        return res.status(400).send('Tenant ID not found');
      }

      const { SELECT } = cds.ql;
      const TenantConfig = getTenantConfigEntity();
      if (!TenantConfig) return res.status(500).send('TenantConfig entity not found');

      // 같은 방식으로 DB 조회
      const row = await cds.run(
        SELECT.one
          .from(TenantConfig)
          .columns('logoContent', 'logoContentType', 'logoFilename', 'modifiedAt')
          .where({ id: tenantId })
      );

      if (!row?.logoContent) {
        // ✅ (선택) 기본 로고 파일로 fallback 하고 싶으면 여기에 구현
        // return res.sendFile(path.resolve(__dirname, '../app/.../default-logo.png'));
        return res.status(404).send('Logo not found');
      }

      const contentType = row.logoContentType || 'image/png';
      const buf = Buffer.isBuffer(row.logoContent)
        ? row.logoContent
        : Buffer.from(row.logoContent);

      // ✅ ETag: tenant + modifiedAt + size 기준(충분히 안정적)
      const m = row.modifiedAt ? new Date(row.modifiedAt).getTime() : Date.now();
      const etag = `"${tenantId}:${m}:${buf.length}"`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1일 캐시 (원하면 더 늘려도 됨)
      res.setHeader('ETag', etag);

      // If-None-Match → 304
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      return res.status(200).send(buf);
    } catch (e) {
      console.error('❌ [/assets/logo] fail:', e);
      return res.status(500).send('Internal error');
    }
  });
  
  /* =======================================================
   * ApproveAccess (이메일 링크 클릭 시 권한 승인 처리)
   * 인증 없이 접근 가능하도록 /api/ 접두사 사용
   * ======================================================= */
  app.get('/api/approve-access', async (req, res) => {
    try {
      // 쿼리 파라미터에서 userId와 tenant 추출 (대소문자 구분 없이)
      const userId = req.query.userId || req.query.userid;
      const tenant = req.query.tenant;
      
      if (!userId) {
        return res.status(400).send(`
          <html><head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>사용자 ID가 필요합니다.</p>
          </body></html>
        `);
      }

      // ApproveAccess 액션 호출 (간단한 GET으로 처리하기 어려우므로 직접 처리)
      // 실제로는 POST 액션이지만 GET으로 처리하기 위해 직접 구현
      const { SELECT, UPDATE } = cds.ql;
      const User = cds.entities['User'] || cds.entities['workhub.User'];
      
      if (!User) {
        return res.status(500).send('User 엔티티를 찾을 수 없습니다.');
      }

      const user = await cds.run(SELECT.one.from(User).where({ id: userId }));

      if (!user) {
        return res.status(404).send(`
          <html><head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>사용자를 찾을 수 없습니다.</p>
          </body></html>
        `);
      }

      if (user.user_status !== 'REQUESTED') {
        return res.status(400).send(`
          <html><head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>현재 상태가 'REQUESTED'가 아닙니다. (현재: ${user.user_status})</p>
          </body></html>
        `);
      }

      // USER_STATUS를 'ACTIVE'로 변경
      await cds.run(
        UPDATE(User)
          .set({ user_status: 'ACTIVE' })
          .where({ id: userId })
      );

      return res.send(`
        <html><head><meta charset="UTF-8"><title>승인 완료</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center; background: #f5f5f5;">
          <div style="max-width: 600px; margin: 50px auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1 style="color: #28a745; margin-bottom: 20px;">✅ 권한 승인 완료</h1>
            <p style="font-size: 16px; color: #495057; margin-bottom: 30px;">
              <strong>${userId}</strong> 사용자의 권한이 성공적으로 승인되었습니다.
            </p>
            <p style="color: #6c757d; font-size: 14px;">
              이제 해당 사용자는 WorkHub 애플리케이션에 접근할 수 있습니다.
            </p>
          </div>
        </body></html>
      `);
    } catch (error) {
      console.error('❌ [ApproveAccess] 처리 실패:', error);
      res.status(500).send(`
        <html><head><meta charset="UTF-8"><title>오류</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #d32f2f;">오류</h2>
          <p>처리 중 오류가 발생했습니다: ${error.message}</p>
        </body></html>
      `);
    }
  });

  /* =======================================================
   * ConfirmEnvSetup (이메일 링크 클릭 시 확인 페이지)
   * ======================================================= */
  app.get('/odata/v4/auth/ConfirmEnvSetup', async (req, res) => {
    try {
      const tenant = req.query.tenant;
      if (!tenant) {
        return res.status(400).send(`
          <html><head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>테넌트 ID가 필요합니다.</p>
          </body></html>
        `);
      }

      const { SELECT } = cds.ql;
      const TenantConfig = getTenantConfigEntity();
      if (!TenantConfig) return res.status(500).send('TenantConfig 엔티티를 찾을 수 없습니다.');

      const tenantConfig = await cds.run(
        SELECT.one.from(TenantConfig).where({ id: tenant })
      );

      if (!tenantConfig) {
        return res.status(404).send(`
          <html><head><meta charset="UTF-8"><title>오류</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2 style="color: #d32f2f;">오류</h2>
            <p>테넌트 설정을 찾을 수 없습니다.</p>
          </body></html>
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
        <html><head><meta charset="UTF-8"><title>오류</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
          <h2 style="color: #d32f2f;">오류</h2>
          <p>처리 중 오류가 발생했습니다: ${error.message}</p>
        </body></html>
      `);
    }
  });
});

module.exports = cds.server;
