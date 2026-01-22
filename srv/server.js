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


});

module.exports = cds.server;
