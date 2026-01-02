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

process.env.PORT = process.env.PORT || '4004';  // ✅ 강제 덮어쓰기 X

// 정적 리소스 디렉토리 설정 (app/router/resources/images/)
const resourcesDir = path.resolve(__dirname, '..', 'app', 'router', 'resources');
const imagesDir = path.join(resourcesDir, 'images', 'logos');

// 디렉토리 생성 (없으면)
if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

// Multer 설정 (파일 업로드)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imagesDir);
  },
  filename: (req, file, cb) => {
    // 파일명: tenant-id.확장자 (테넌트별 하나만 저장)
    const tenant = req.tenant || req.user?.tenant || req.user?.attr?.zid || 'default';
    const ext = path.extname(file.originalname);
    const filename = `${tenant}${ext}`;
    
    // 기존 파일이 있으면 삭제
    const filePath = path.join(imagesDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️ [Upload] 기존 파일 삭제: ${filename}`);
      } catch (err) {
        console.warn(`⚠️ [Upload] 기존 파일 삭제 실패: ${err.message}`);
      }
    }
    
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
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

  // 파일 업로드 엔드포인트
  app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
    try {
      // CORS 헤더 설정
      const origin = req.headers.origin;
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }

      if (!req.file) {
        return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
      }

      // 파일 URL 생성 (xs-app.json의 localDir: "resources" 설정에 따라)
      const fileUrl = `/images/logos/${req.file.filename}`;
      
      console.log('✅ [Upload] 로고 파일 업로드 완료:', {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: fileUrl
      });

      res.json({
        success: true,
        url: fileUrl,
        filename: req.file.filename
      });
    } catch (error) {
      console.error('❌ [Upload] 파일 업로드 실패:', error);
      
      // CORS 헤더 설정 (에러 응답에도)
      const origin = req.headers.origin;
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
      }
      
      res.status(500).json({ error: error.message || '파일 업로드 중 오류가 발생했습니다.' });
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

