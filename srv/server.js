// srv/server.js
const cds = require('@sap/cds');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(regex, value || '');
  }
  return rendered;
};

// PORT는 배포 환경에서 자동으로 설정되므로 여기서 고정하지 않음

// Multer 설정 (메모리 스토리지 - BLOB 저장용)
const upload = multer({
  storage: multer.memoryStorage(),  // 메모리에 저장 후 DB에 BLOB으로 저장
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB 제한
  },
  fileFilter: (req, file, cb) => {
    // 이미지 파일만 허용
    const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다. (jpeg, jpg, png, gif, svg, webp)'));
    }
  }
});

// 테넌트 ID 추출 헬퍼 함수
const getTenantId = (req) => {
  // CAP 멀티테넌트에서 테넌트 ID 추출
  // 1. req.tenant (CAP가 자동으로 설정)
  if (req.tenant) {
    return req.tenant;
  }
  // 2. cds.context.tenant (현재 컨텍스트)
  if (cds.context?.tenant) {
    return cds.context.tenant;
  }
  // 3. req.user에서 추출
  if (req.user?.tenant) {
    return req.user.tenant;
  }
  if (req.user?.attr?.zid) {
    return req.user.attr.zid;
  }
  // 4. JWT 토큰에서 추출 시도
  if (req.authInfo?.getIdentityZone) {
    return req.authInfo.getIdentityZone();
  }
  return null;
};

cds.on('bootstrap', (app) => {
  app.use(bodyParser.json({ limit: '20mb' }));
  app.use(bodyParser.urlencoded({ limit: '20mb', extended: true }));

  // CORS 헤더 설정 (개발 환경)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    // 개발 환경에서 localhost 허용
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // 환경변수 설정 확인 페이지 (자동 실행 방지)
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

      const cds = require('@sap/cds');
      const { SELECT } = cds.ql;
      const TenantConfig = cds.entities['TenantConfig'];
      // 테넌트 설정 확인
      const tenantConfig = await cds.run(
        SELECT.one.from(TenantConfig)
        .where({ id: tenant })
      );
      
      console.log(`[ConfirmEnvSetup] 테넌트 ${tenant}의 환경변수 설정 확인 시도`);
      console.log(TenantConfig);
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

      const baseUrl = process.env.APP_URL || 
        (process.env.VCAP_APPLICATION 
          ? JSON.parse(process.env.VCAP_APPLICATION).application_uris?.[0] 
            ? `https://${JSON.parse(process.env.VCAP_APPLICATION).application_uris[0]}`
            : 'http://localhost:4004'
          : 'http://localhost:4004');
      const completeUrl = `${baseUrl}/odata/v4/auth/SetEnvConfigured?tenant=${encodeURIComponent(tenant)}`;

      // 템플릿 로드 및 변수 치환
      const confirmTemplate = loadEmailTemplate('confirm-env-setup');
      const confirmHtml = renderTemplate(confirmTemplate, {
        tenant: tenant,
        companyName: tenantConfig.companyName || '(없음)',
        mailSentAt: tenantConfig.mailSentAt ? new Date(tenantConfig.mailSentAt).toLocaleString('ko-KR') : '(없음)',
        completeUrl: completeUrl
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

  // 환경변수 설정 완료 처리 (확인 페이지에서 버튼 클릭 시)
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

      const cds = require('@sap/cds');
      const { SELECT, UPDATE } = cds.ql;
      const TenantConfig = cds.entities['TenantConfig'];
      
      // 테넌트 설정 확인
      const tenantConfig = await cds.run(
        SELECT.one.from(TenantConfig)
          .where({ id: tenant })
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

      // envConfigured를 true로 업데이트
      await cds.run(
        UPDATE(TenantConfig)
          .set({ envConfigured: true })
          .where({ id: tenant })
      );

      console.log(`✅ [SetEnvConfigured] 테넌트 ${tenant}의 환경변수 설정 완료 처리`);

      // 템플릿 로드 및 변수 치환
      const completeTemplate = loadEmailTemplate('env-setup-complete');
      const completeHtml = renderTemplate(completeTemplate, {
        tenant: tenant,
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

  // 로고 업로드 엔드포인트 (ADMIN만 가능)
  app.post('/api/logo', upload.single('logo'), async (req, res) => {
    try {
      // CORS 헤더 설정
      const origin = req.headers.origin;
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }

      // 권한 체크 (ADMIN만 업로드 가능)
      const userRoles = req.user?.roles || [];
      const isAdmin = userRoles.includes('ADMIN') || userRoles.includes('SYSADMIN');
      
      if (!isAdmin) {
        return res.status(403).json({ 
          error: '권한이 없습니다. ADMIN 권한이 필요합니다.' 
        });
      }

      if (!req.file) {
        return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
      }

      // 테넌트 ID 추출
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ error: '테넌트 ID를 확인할 수 없습니다.' });
      }

      const { SELECT, UPSERT } = cds.ql;
      const TenantLogo = cds.entities['TenantLogo'];

      // 테넌트 컨텍스트로 트랜잭션 생성 (테넌트별 DB 접근)
      const tx = cds.transaction(req);

      // 기존 로고가 있으면 업데이트, 없으면 생성
      await tx.run(
        UPSERT.into(TenantLogo).entries({
          id: tenantId,
          content: req.file.buffer,  // BLOB 데이터
          contentType: req.file.mimetype,
          filename: req.file.originalname,
          size: req.file.size
        })
      );

      console.log('✅ [Upload] 로고 업로드 완료 (DB 저장):', {
        tenantId: tenantId,
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size
      });
      
      res.json({
        success: true,
        message: '로고가 성공적으로 업로드되었습니다.',
        url: '/api/logo'  // 조회 URL
      });
    } catch (error) {
      console.error('❌ [Upload] 로고 업로드 실패:', error);
      
      // CORS 헤더 설정 (에러 응답에도)
      const origin = req.headers.origin;
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      
      res.status(500).json({ error: error.message || '파일 업로드 중 오류가 발생했습니다.' });
    }
  });

  // 로고 조회 엔드포인트 (테넌트별 동적 조회)
  app.get('/api/logo', async (req, res) => {
    try {
      // 테넌트 ID 추출
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ error: '테넌트 ID를 확인할 수 없습니다.' });
      }

      const { SELECT } = cds.ql;
      const TenantLogo = cds.entities['TenantLogo'];

      // 테넌트 컨텍스트로 트랜잭션 생성 (테넌트별 DB 접근)
      const tx = cds.transaction(req);

      // 테넌트별 로고 조회
      const logo = await tx.run(
        SELECT.one.from(TenantLogo)
          .where({ id: tenantId })
      );

      if (!logo || !logo.content) {
        // 기본 로고 반환 (없으면 404 또는 기본 이미지)
        // 여기서는 기본 로고가 없다고 가정하고 404 반환
        // 필요시 기본 로고 파일을 읽어서 반환할 수 있음
        return res.status(404).json({ 
          error: '로고를 찾을 수 없습니다.',
          useDefault: true
        });
      }

      // BLOB 데이터를 이미지로 반환
      res.setHeader('Content-Type', logo.contentType || 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');  // 1시간 캐시
      
      // updatedAt이 있으면 ETag로 사용
      if (logo.modifiedAt) {
        const etag = `"${logo.modifiedAt.getTime()}"`;
        res.setHeader('ETag', etag);
        
        // 클라이언트가 캐시된 버전을 가지고 있으면 304 반환
        if (req.headers['if-none-match'] === etag) {
          return res.status(304).end();
        }
      }

      res.send(Buffer.from(logo.content));
    } catch (error) {
      console.error('❌ [Logo] 로고 조회 실패:', error);
      res.status(500).json({ error: error.message || '로고 조회 중 오류가 발생했습니다.' });
    }
  });

  app.get('/logout', (req, res) => {
    try {
      res.clearCookie('connect.sid', { path: '/' });
    } catch {}

    if (req.session) {
      req.session.destroy(() => {
        res.redirect('/auth/Me()');
      });
    } else {
      res.redirect('/auth/Me()');
    }
  });
});

module.exports = cds.server;

