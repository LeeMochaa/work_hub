const cds = require('@sap/cds');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { SELECT, UPDATE, INSERT, DELETE } = cds.ql;

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

// 개발 환경에서 .env 파일 로드
if (process.env.NODE_ENV !== 'production' && !process.env.VCAP_SERVICES) {
    try {
        const path = require('path');
        const dotenv = require('dotenv');
        // 프로젝트 루트의 .env 파일 로드 (srv/ 폴더에서 상위로 이동)
        const envPath = path.resolve(__dirname, '..', '.env');
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            console.warn('[Auth] .env 파일 로드 실패:', result.error.message);
        } else {
            console.log('[Auth] .env 파일 로드 완료:', envPath);
            // 로드된 환경변수 확인 (디버깅용)
            if (process.env.SYSADMIN_SMTP_USER) {
                console.log('[Auth] SYSADMIN_SMTP_USER:', process.env.SYSADMIN_SMTP_USER);
            }
            if (process.env.ADMIN_SMTP_USER) {
                console.log('[Auth] ADMIN_SMTP_USER:', process.env.ADMIN_SMTP_USER);
            }
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

    const userSrv = await cds.connect.to('UserService');

    // BTP Cockpit URL 자동 생성 함수 (VCAP에서만 정보 추출, 환경변수 사용 안함)
    const generateBtpCockpitUrl = (tenantId, req = null) => {
        // VCAP_APPLICATION과 VCAP_SERVICES에서 정보 추출 (BTP 운영 환경에서만 존재)
        let region = null;
        let subaccountId = null;

        try {
            // VCAP_APPLICATION에서 region 추출
            const vcapApp = process.env.VCAP_APPLICATION ? JSON.parse(process.env.VCAP_APPLICATION) : null;
            if (vcapApp) {
                // application_uris에서 region 추출
                if (vcapApp.application_uris && vcapApp.application_uris.length > 0) {
                    const appUri = vcapApp.application_uris[0];
                    const regionMatch = appUri.match(/\.(ap|eu|us)(\d+)\./);
                    if (regionMatch) {
                        region = regionMatch[1] + regionMatch[2]; // ap10, eu10, us10 등
                    }
                }
                console.log('[Auth] VCAP_APPLICATION:', {
                    space_id: vcapApp.space_id,
                    organization_id: vcapApp.organization_id,
                    application_uris: vcapApp.application_uris
                });
            }

            // VCAP_SERVICES에서 XSUAA 서비스 정보 추출
            const vcapServices = process.env.VCAP_SERVICES ? JSON.parse(process.env.VCAP_SERVICES) : null;
            if (vcapServices) {
                // XSUAA 서비스 찾기
                const xsuaaService = vcapServices['xsuaa'] || vcapServices['xsuaa-application'] || [];
                if (xsuaaService.length > 0 && xsuaaService[0].credentials) {
                    const creds = xsuaaService[0].credentials;
                    // subaccount ID는 보통 uaa domain에서 추출 가능
                    // 예: <subaccount-id>.authentication.<region>.hana.ondemand.com
                    if (creds.uaadomain) {
                        const uaaMatch = creds.uaadomain.match(/^([^.]+)\.authentication\./);
                        if (uaaMatch) {
                            subaccountId = uaaMatch[1];
                        }
                    }
                    // 또는 url에서 추출
                    if (creds.url) {
                        const urlMatch = creds.url.match(/https:\/\/([^.]+)\.authentication\.([^.]+)\.hana\.ondemand\.com/);
                        if (urlMatch) {
                            subaccountId = urlMatch[1];
                            if (!region) {
                                region = urlMatch[2];
                            }
                        }
                    }
                    console.log('[Auth] XSUAA credentials:', {
                        uaadomain: creds.uaadomain,
                        url: creds.url,
                        subaccountId: subaccountId
                    });
                }
            }

            // 운영 환경: region과 subaccountId가 있으면 정확한 URL 생성
            if (region && subaccountId) {
                // subaccount ID가 있으면 해당 고객사의 Cockpit으로 직접 이동
                return `https://cockpit.${region}.hana.ondemand.com/cockpit/#/subaccount/${subaccountId}/users`;
            } else if (region) {
                // region만 있으면 메인 Cockpit 페이지로 (사용자가 subaccount 선택)
                return `https://cockpit.${region}.hana.ondemand.com/cockpit/#/users`;
            }
        } catch (e) {
            console.warn('[Auth] VCAP 파싱 실패:', e.message);
        }

        // 개발 환경: VCAP이 없으면 null 반환 (이메일 템플릿에서 버튼 숨김)
        console.log('[Auth] BTP Cockpit URL 생성 실패: VCAP 정보 없음 (개발 환경일 가능성)');
        return null;
    };

    // SYSADMIN용 SMTP 설정 읽기 함수 (ADMIN의 테넌트 설정 요청을 SYSADMIN에게 보낼 때 사용)
    const getSysadminSmtpConfig = () => {
        // 방법 1: VCAP_SERVICES에서 user-provided service 읽기 (BTP 환경)
        // try {
        //     const vcapServices = JSON.parse(process.env.VCAP_SERVICES || '{}');
        //     const userProvided = vcapServices['user-provided'] || [];
        //     const smtpService = userProvided.find(s => s.name && s.name.includes('sysadmin-smtp'));
        //     if (smtpService && smtpService.credentials) {
        //         const creds = smtpService.credentials;
        //         return {
        //             service: creds.SMTP_SERVICE,
        //             host: creds.SMTP_HOST,
        //             port: parseInt(creds.SMTP_PORT || '587'),
        //             secure: creds.SMTP_SECURE === 'true' || creds.SMTP_SECURE === true,
        //             auth: {
        //                 user: creds.SMTP_USER,
        //                 pass: creds.SMTP_PASS
        //             },
        //             from: creds.SMTP_FROM || creds.SMTP_USER
        //         };
        //     }
        // } catch (e) {
        //     console.warn('[Auth] VCAP_SERVICES 파싱 실패:', e.message);
        // }

        // 방법 2: SYSADMIN_SMTP_ENV JSON 환경변수에서 읽기 (개발 환경)
        const sysadminEnvValue = process.env.SYSADMIN_SMTP_ENV;
        if (sysadminEnvValue) {
            try {
                const envData = typeof sysadminEnvValue === 'string' ? JSON.parse(sysadminEnvValue) : sysadminEnvValue;
                
                if (envData.SMTP_HOST || envData.SMTP_USER) {
                    const config = {
                        service: envData.SMTP_SERVICE || undefined,
                        host: envData.SMTP_HOST,
                        port: parseInt(envData.SMTP_PORT || '587'),
                        secure: envData.SMTP_SECURE === 'true' || envData.SMTP_SECURE === true || envData.SMTP_SECURE === true,
                        auth: {
                            user: envData.SMTP_USER,
                            pass: envData.SMTP_PASS
                        },
                        from: envData.SMTP_FROM || envData.SMTP_USER
                    };
                    console.log('[Auth] SYSADMIN SMTP 설정 (SYSADMIN_SMTP_ENV):', {
                        service: config.service,
                        host: config.host,
                        port: config.port,
                        secure: config.secure,
                        user: config.auth.user,
                        from: config.from
                    });
                    return config;
                }
            } catch (e) {
                console.warn('[Auth] SYSADMIN_SMTP_ENV JSON 파싱 실패:', e.message);
            }
        }

        // 방법 3: 하위 호환성 - 개별 환경변수에서 읽기 (기존 방식)
        if (process.env.SYSADMIN_SMTP_HOST || process.env.SYSADMIN_SMTP_USER) {
            return {
                service: process.env.SYSADMIN_SMTP_SERVICE || undefined,
                host: process.env.SYSADMIN_SMTP_HOST,
                port: parseInt(process.env.SYSADMIN_SMTP_PORT || '587'),
                secure: process.env.SYSADMIN_SMTP_SECURE === 'true' || process.env.SYSADMIN_SMTP_SECURE === true,
                auth: {
                    user: process.env.SYSADMIN_SMTP_USER,
                    pass: process.env.SYSADMIN_SMTP_PASS
                },
                from: process.env.SYSADMIN_SMTP_FROM || process.env.SYSADMIN_SMTP_USER
            };
        }

        return null;
    };


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
        const email = attr.email || id;  // 이메일 추가

        try {
            console.log('📥 [Auth.Bootstrap] Incoming user data --------------------');
            console.log('req.user:', JSON.stringify(u, null, 2));
            console.log('tenant:', tenant);
            console.log('-----------------------------------------------------------');
        } catch (e) {
            console.warn('⚠️ JSON.stringify(req.user) failed:', e.message);
        }

        let raw = undefined;
        try {
            raw = JSON.stringify(attr, null, 2);
        } catch (e) {
            console.warn('⚠️ JSON.stringify(u.attr) failed:', e.message);
        }

        return { id: safeId, name: safeName, tenant, email, raw };
    };

    const getRoles = (req) => {
        const roles = [];
        const userRoles = req.user?.roles || {};
        
        const hasScope = (scopeName) => {
            const xsappnameScope = `$XSAPPNAME.${scopeName}`;
            const appScope = `work_hub.${scopeName}`;
            return !!(userRoles[xsappnameScope] || userRoles[appScope] || userRoles[scopeName]);
        };

        // scope 이름으로 체크
        ['SYSADMIN', 'Administrator', 'Leader', 'User'].forEach(r => {
            if (hasScope(r)) roles.push(r);
        });
        if (userRoles['authenticated-user'] || (req.user?.is && req.user.is('authenticated-user'))) {
            roles.push('authenticated-user');
        }

        return roles;
    };

    const getRoleFlags = (req) => {
        // req.user.roles 객체에서 직접 체크
        const roles = req.user?.roles || {};
        
        // $XSAPPNAME이 실제로는 work_hub로 치환되지만, mocked-auth에서는 $XSAPPNAME 그대로 사용될 수 있음
        // 두 가지 형태 모두 체크
        const hasScope = (scopeName) => {
            // 1. $XSAPPNAME.Administrator 형태
            const xsappnameScope = `$XSAPPNAME.${scopeName}`;
            // 2. work_hub.Administrator 형태 (실제 앱 이름)
            const appScope = `work_hub.${scopeName}`;
            // 3. Administrator만 (fallback)
            return !!(roles[xsappnameScope] || roles[appScope] || roles[scopeName]);
        };
        
        const flags = {
            SYSADMIN: hasScope('SYSADMIN'),
            ADMIN: hasScope('Administrator'),
            LEADER: hasScope('Leader'),
            USER: hasScope('User'),
            AUTHENTICATED: !!(roles['authenticated-user'] || (req.user?.is && req.user.is('authenticated-user'))),
        };
        console.log('[Auth] Role flags:', JSON.stringify(flags, null, 2));
        console.log('[Auth] User roles:', JSON.stringify(roles, null, 2));
        return flags;
    };

    // 🔥 한 방에 다 주는 엔드포인트
    this.on('Bootstrap', async (req) => {
        const userSrv = await cds.connect.to('UserService');
        await userSrv.ensureUserFromReq(req);  // 여기서 upsert + status/role 관리

        const user = getUserProfile(req);
        const roles = getRoles(req);
        const flags = getRoleFlags(req);
        const now = new Date();

        // 테넌트 설정 확인 (설정 완료 여부)
        const tenant = req.tenant || req.user?.tenant || req.user?.attr?.zid || 'default';
        let isConfigured = false;
        let adminEmail = null;
        try {
            const tx = cds.transaction(req);
            const TenantConfig = cds.entities['TenantConfig'];
            const tenantConfig = await tx.run(
                SELECT.one.from(TenantConfig)
                    .where({ id: tenant })
            );
            if (tenantConfig) {
                isConfigured = tenantConfig.isConfigured || false;
                adminEmail = tenantConfig.adminEmail || null;
            }
        } catch (e) {
            console.warn('[Auth.Bootstrap] 테넌트 설정 조회 실패:', e.message);
        }

        // TenantConfig에 adminEmail이 없으면 User 테이블에서 Administrator 역할 사용자의 이메일 찾기
        if (!adminEmail) {
            try {
                const tx = cds.transaction(req);
                const User = cds.entities['User'];
                const adminUser = await tx.run(
                    SELECT.one.from(User)
                        .where({ role: 'Administrator' })
                        .orderBy('createdAt')
                );
                if (adminUser && adminUser.email) {
                    adminEmail = adminUser.email;
                }
            } catch (e) {
                console.warn('[Auth.Bootstrap] Administrator 이메일 조회 실패:', e.message);
            }
        }

        return {
            user,
            roles,
            flags,
            serverTime: {
                now: now,
                timezone: tz,
                iso: now.toISOString()
            },
            adminEmail: adminEmail || process.env.ADMIN_EMAIL || '',
            isConfigured  // 테넌트 설정 완료 여부
        };
    });

    // 필요하면 예전 것들도 남겨둬도 됨 (디버깅용)
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

    // 🔴 세션 초기화 / 로그아웃용 액션
    this.on('ResetSession', async (req) => {
        console.log('🔴 [/auth/ResetSession] called.');
        return true;
    });

    this.on('RequestAccessMail', async req => {
        const { email, name } = req.data;

        // 0) 이메일 필수 체크
        if (!email) {
            return {
                ok: false,
                code: 'NO_EMAIL',
                message: '이메일 정보가 없어 권한 요청을 처리할 수 없습니다.',
                retryAfterDays: 0
            };
        }

        // 1) UserService를 통해 유저 업서트 + 쿨다운 체크
        const userSrv = await cds.connect.to('UserService');
        const cooldown = await userSrv.checkAccessRequestCooldown(req, {
            cooldownDays: 30
        });

        // ⏰ 아직 30일 쿨다운 중인 경우
        if (!cooldown.ok) {
            return {
                ok: false,
                code: cooldown.code,
                message: cooldown.message,
                retryAfterDays: cooldown.retryAfterDays || 0
            };
        }

        // 2) ADMIN 이메일 및 테넌트 설정 조회 (TenantConfig에서)
        const tenant = req.tenant || req.user?.tenant || req.user?.attr?.zid || 'default';
        let adminEmail = null;
        let companyName = null;
        let btpCockpitUrl = null;
        try {
            const tx = cds.transaction(req);
            const TenantConfig = cds.entities['TenantConfig'];
            const tenantConfig = await tx.run(
                SELECT.one.from(TenantConfig)
                    .where({ id: tenant })
            );
            if (tenantConfig) {
                if (tenantConfig.adminEmail) {
                    adminEmail = tenantConfig.adminEmail;
                }
                if (tenantConfig.companyName) {
                    companyName = tenantConfig.companyName;
                }
                if (tenantConfig.btpCockpitUrl) {
                    btpCockpitUrl = tenantConfig.btpCockpitUrl;
                } else {
                    // btpCockpitUrl이 없으면 자동 생성
                    btpCockpitUrl = generateBtpCockpitUrl(tenant, req);
                    console.log('🔗 [Auth.RequestAccessMail] BTP Cockpit URL 자동 생성:', btpCockpitUrl);
                }
            } else {
                // TenantConfig가 없어도 BTP Cockpit URL은 생성 가능
                btpCockpitUrl = generateBtpCockpitUrl(tenant, req);
                console.log('🔗 [Auth.RequestAccessMail] BTP Cockpit URL 자동 생성 (TenantConfig 없음):', btpCockpitUrl);
            }
        } catch (e) {
            console.warn('[Auth.RequestAccessMail] 테넌트 설정 조회 실패:', e.message);
        }

        // ADMIN 이메일이 없으면 User 테이블에서 찾기
        if (!adminEmail) {
            try {
                const tx = cds.transaction(req);
                const User = cds.entities['User'];
                const adminUser = await tx.run(
                    SELECT.one.from(User)
                        .where({ role: 'Administrator' })
                        .orderBy('createdAt')
                );
                if (adminUser && adminUser.email) {
                    adminEmail = adminUser.email;
                }
            } catch (e) {
                console.warn('[Auth.RequestAccessMail] Administrator 이메일 조회 실패:', e.message);
            }
        }

        if (!adminEmail) {
            return {
                ok: false,
                code: 'NO_ADMIN_EMAIL',
                message: '관리자 이메일이 설정되지 않아 권한 요청을 처리할 수 없습니다.',
                retryAfterDays: 0
            };
        }

        console.log('📧 [Auth.RequestAccessMail] 권한 요청 메일 발송 정보:');
        console.log('  - 요청자 이름:', name);
        console.log('  - 요청자 이메일:', email);
        console.log('  - 수신자(ADMIN) 이메일:', adminEmail);

        // 3) SMTP 설정 읽기 (SYSADMIN SMTP 사용)
        const smtpConfig = getSysadminSmtpConfig();

        // 4) 메일 발송
        if (smtpConfig) {
            try {
                // SMTP 설정 구성
                const transporterConfig = {};
                
                // service가 있으면 사용 (Gmail, Naver 등)
                if (smtpConfig.service) {
                    transporterConfig.service = smtpConfig.service;
                } else {
                    // 일반 SMTP 서버 설정
                    transporterConfig.host = smtpConfig.host;
                    transporterConfig.port = smtpConfig.port;
                    transporterConfig.secure = smtpConfig.secure;  // true면 465, false면 587
                }
                
                transporterConfig.auth = smtpConfig.auth;

                const transporter = nodemailer.createTransport(transporterConfig);

                // 이메일 템플릿 로드 및 렌더링
                let emailHtml = '';
                let emailText = '';
                try {
                    const template = loadEmailTemplate('access-request');
                    const requestDate = new Date().toLocaleString('ko-KR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Seoul'
                    });
                    
                    // BTP Cockpit 버튼 HTML 생성 (btpCockpitUrl이 null이면 버튼 숨김)
                    let btpCockpitButton = '';
                    if (btpCockpitUrl) {
                        btpCockpitButton = `<a href="${btpCockpitUrl}" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); margin-bottom: 15px;">🚀 BTP Cockpit에서 역할 설정</a>`;
                    } else {
                        // 개발 환경에서는 버튼을 표시하지 않음
                        btpCockpitButton = '';
                    }
                    
                    // 템플릿 변수 준비
                    const templateVars = {
                        requestName: name || email,
                        requestEmail: email,
                        requestDate: requestDate,
                        tenant: tenant,
                        companyName: companyName || '(미설정)',
                        btpCockpitUrl: btpCockpitUrl || '',
                        btpCockpitButton: btpCockpitButton
                    };
                    
                    emailHtml = renderTemplate(template, templateVars);
                    
                    // 텍스트 버전 (간단한 폴백)
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
                    console.warn('⚠️ [Auth.RequestAccessMail] 이메일 템플릿 로드 실패, 기본 텍스트 사용:', templateError.message);
                    emailText = `
요청자 이름: ${name || email}
요청자 이메일: ${email}

WorkHub 애플리케이션에 대한 접근 권한을 신청합니다.
                    `.trim();
                }

                const mailOptions = {
                    from: `"WorkHub 자동메일" <${smtpConfig.from}>`,
                    to: adminEmail,
                    subject: '[WorkHub] 권한 요청',
                    text: emailText,
                    html: emailHtml || undefined
                };

                const info = await transporter.sendMail(mailOptions);
                console.log('✅ [Auth.RequestAccessMail] 메일 발송 성공!');
                console.log('  - 메시지 ID:', info.messageId);
                console.log('  - 수신자:', adminEmail);
                console.log('  - 발신자:', mailOptions.from);
                console.log('  - SMTP 서버:', smtpConfig.host || smtpConfig.service);
            } catch (error) {
                console.error('❌ [Auth.RequestAccessMail] 메일 발송 실패:', error);
                console.error('  - 수신자:', adminEmail);
                console.error('  - SMTP 설정:', JSON.stringify(smtpConfig, null, 2).replace(/("pass":\s*"[^"]*")/g, '"pass": "***"'));
            }
        } else {
            console.warn('⚠️ [Auth.RequestAccessMail] SMTP 설정이 없어 메일을 발송하지 않습니다.');
            console.log('  - (개발 환경에서는 메일 발송을 건너뜁니다)');
            console.log('  - SMTP 설정 방법:');
            console.log('    1. BTP user-provided service 생성 (이름에 "smtp" 포함)');
            console.log('    2. 환경변수 설정: SYSADMIN_SMTP_HOST, SYSADMIN_SMTP_PORT, SYSADMIN_SMTP_USER, SYSADMIN_SMTP_PASS 등');
        }

        // 4) 성공 응답
        return {
            ok: true,
            code: 'OK',
            message: '권한 요청 메일이 발송되었습니다.',
            retryAfterDays: 30
        };
    });

    // 테넌트 초기 설정 제출 (ADMIN이 처음 들어왔을 때)
    this.on('SubmitTenantConfig', async req => {
        const config = req.data.config;
        const tenant = req.tenant || req.user?.tenant || req.user?.attr?.zid || 'default';
        const user = req.user || {};
        const userEmail = user.attr?.email || user.id || 'unknown';
        const userName = user.attr?.givenName || user.id || 'Unknown';

        console.log('📋 [Auth.SubmitTenantConfig] 테넌트 설정 제출:', {
            tenant,
            user: userEmail,
            companyName: config.companyName
        });

        const fs = require('fs');
        const path = require('path');
        let uploadedLogoPath = null;  // 업로드된 로고 파일 경로 (롤백용)
        let configWasCreated = false;  // 설정이 새로 생성되었는지 (롤백용)
        
        try {
            const tx = cds.transaction(req);
            const TenantConfig = cds.entities['TenantConfig'];

            console.log('📋 [Auth.SubmitTenantConfig] 테넌트:', tenant);
            console.log('📋 [Auth.SubmitTenantConfig] req.tenant:', req.tenant);
            console.log('📋 [Auth.SubmitTenantConfig] req.user?.attr?.zid:', req.user?.attr?.zid);

            // 기존 설정 확인
            const existing = await tx.run(
                SELECT.one.from(TenantConfig)
                    .where({ id: tenant })
            );
            
            console.log('📋 [Auth.SubmitTenantConfig] 기존 설정:', existing ? '존재함' : '없음');

            // 로고 파일이 업로드되었는지 확인하고 파일 경로 저장 (롤백용)
            if (config.companyLogoUrl) {
                const resourcesDir = path.resolve(__dirname, '..', 'app', 'router', 'resources');
                const imagesDir = path.join(resourcesDir, 'images', 'logos');
                const logoUrl = config.companyLogoUrl;
                // URL에서 파일명 추출: /images/logos/default.png -> default.png
                const filename = logoUrl.split('/').pop();
                if (filename) {
                    uploadedLogoPath = path.join(imagesDir, filename);
                }
            }
            
            // BTP Cockpit URL 자동 생성 (config에 없거나 비어있으면 자동 생성)
            let btpCockpitUrl = config.btpCockpitUrl;
            if (!btpCockpitUrl || (typeof btpCockpitUrl === 'string' && btpCockpitUrl.trim().length === 0)) {
                btpCockpitUrl = generateBtpCockpitUrl(tenant, req);
                console.log('🔗 [Auth.SubmitTenantConfig] BTP Cockpit URL 자동 생성:', btpCockpitUrl);
            } else {
                console.log('🔗 [Auth.SubmitTenantConfig] BTP Cockpit URL 사용자 입력:', btpCockpitUrl);
            }

            // 설정 정보 저장
            const configData = {
                companyName: config.companyName,
                companyLogoUrl: config.companyLogoUrl || null,
                timezone: config.timezone || 'Asia/Seoul',
                language: config.language || 'ko',
                adminEmail: config.adminEmail,
                btpCockpitUrl: btpCockpitUrl,  // 자동 생성된 URL 또는 사용자 입력 URL
                isConfigured: true  // 설정 제출 완료
            };
            
            if (existing) {
                await tx.run(
                    UPDATE(TenantConfig)
                        .set(configData)
                        .where({ id: tenant })
                );
                console.log('✅ [Auth.SubmitTenantConfig] 기존 설정 업데이트 완료');
                console.log('✅ [Auth.SubmitTenantConfig] 업데이트된 설정:', { tenant, ...configData });
            } else {
                const newConfig = {
                    id: tenant,
                    ...configData
                };
                await tx.run(
                    INSERT.into(TenantConfig).entries(newConfig)
                );
                configWasCreated = true;
                console.log('✅ [Auth.SubmitTenantConfig] 새 설정 생성 완료');
                console.log('✅ [Auth.SubmitTenantConfig] 생성된 설정:', newConfig);
            }
            
            // 저장 확인
            const saved = await tx.run(
                SELECT.one.from(TenantConfig)
                    .where({ id: tenant })
            );
            console.log('✅ [Auth.SubmitTenantConfig] 저장 확인:', saved ? '성공' : '실패');
            if (saved) {
                console.log('✅ [Auth.SubmitTenantConfig] 저장된 데이터:', {
                    id: saved.id,
                    companyName: saved.companyName,
                    adminEmail: saved.adminEmail,
                    isConfigured: saved.isConfigured
                });
            }


            return {
                ok: true,
                code: 'OK',
                message: '테넌트 설정이 완료되었습니다.'
            };
        } catch (error) {
            console.error('❌ [Auth.SubmitTenantConfig] 설정 저장 실패:', error);
            
            // 롤백: 업로드된 로고 파일 삭제
            if (uploadedLogoPath && fs.existsSync(uploadedLogoPath)) {
                try {
                    fs.unlinkSync(uploadedLogoPath);
                    console.log('🔄 [Auth.SubmitTenantConfig] 롤백: 업로드된 로고 파일 삭제:', uploadedLogoPath);
                } catch (fileError) {
                    console.error('❌ [Auth.SubmitTenantConfig] 로고 파일 삭제 실패:', fileError);
                }
            }
            
            return {
                ok: false,
                code: 'ERROR',
                message: `설정 저장 중 오류가 발생했습니다: ${error.message}`
            };
        }
    });


});

