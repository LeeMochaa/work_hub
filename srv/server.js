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
