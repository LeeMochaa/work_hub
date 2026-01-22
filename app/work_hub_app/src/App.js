import { useEffect, useState, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useModel } from './model/ModelProvider';

import Welcomer from './components/Welcomer';
import AccessDenied from './components/AccessDenied';
import TenantSetupWizard from './components/TenantSetupWizard';
import LogoDisplay from './components/LogoDisplay';
import ApproveAccess from './components/ApproveAccess';

import './App.css';

const getWelcomerKey = (userId) =>
  `workhub.welcomer.shown.${userId || 'anonymous'}`;

export default function App() {
  const auth = useModel('Auth');

  const [boot, setBoot] = useState(null);
  const [ready, setReady] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [minDelayElapsed, setMinDelayElapsed] = useState(false);

  const [showWelcomer, setShowWelcomer] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);

  // ⏱ 최소 3.5초 보장
  useEffect(() => {
    const t = setTimeout(() => setMinDelayElapsed(true), 3500);
    return () => clearTimeout(t);
  }, []);

  // 🔹 최초 로드 시 /auth/Bootstrap 호출
  // bootstrap()의 기본값이 force: true이므로 항상 최신 사용자 정보를 가져옴
  useEffect(() => {
    (async () => {
      try {
        const data = await auth.bootstrap();
        setBoot(data);
        
        // 새 탭에서 인증을 받은 경우, 부모 창에 인증 완료 메시지 전송
        if (window.opener && !window.opener.closed) {
          try {
            window.opener.postMessage('auth-complete', window.location.origin);
            console.log('[App] 인증 완료 메시지를 부모 창에 전송했습니다.');
          } catch (e) {
            console.warn('[App] 부모 창에 메시지 전송 실패:', e);
          }
        }

        const flags = data.flags || {};
        // 디버깅용 로그
        console.log('[App] Bootstrap flags:', JSON.stringify(flags, null, 2));
        console.log('[App] User:', JSON.stringify(data.user, null, 2));
        console.log('[App] isConfigured:', data.isConfigured);
        
        // 역할 체크: SYSADMIN, ADMIN, LEADER, USER 중 하나라도 있어야 접근 가능
        // AUTHENTICATED만 있고 다른 역할이 없으면 AccessDenied로 보냄
        const hasAnyRole = 
          flags.SYSADMIN === true || 
          flags.ADMIN === true || 
          flags.LEADER === true || 
          flags.USER === true;

        console.log('[App] hasAnyRole:', hasAnyRole);
        console.log('[App] flags detail:', {
          SYSADMIN: flags.SYSADMIN,
          ADMIN: flags.ADMIN,
          LEADER: flags.LEADER,
          USER: flags.USER,
          AUTHENTICATED: flags.AUTHENTICATED
        });

        // 역할이 전혀 없으면 AccessDenied
        if (!hasAnyRole) {
          setAccessDenied(true);
          setShowSetupWizard(false);
        } else {
          setAccessDenied(false);
          setAccessDenied(false);
          
          // SYSADMIN 권한 O = 바로 웰컴페이지 및 메인페이지
          if (flags.SYSADMIN) {
            // 아무것도 설정하지 않음 (Welcomer 표시)
            setShowSetupWizard(false);
          }
          // ADMIN 권한 O 분기
          else if (flags.ADMIN) {
            const isConfigured = data.isConfigured === true;
            
            // ADMIN 권한 O 환경설정 X = 입력위저드
            if (!isConfigured) {
              setShowSetupWizard(true);
            }
            // ADMIN 권한 O 환경설정 O = 웰컴페이지 및 메인페이지
            else {
              setShowSetupWizard(false);
            }
          }
          // ADMIN 권한 X 일반 사용자권한 X = 권한요청 페이지 (이미 accessDenied로 처리됨)
          // ADMIN 권한 X 일반 사용자 권한 O = 웰컴페이지 및 메인페이지 (기본 동작)
        }
      } catch (err) {
        console.error('Auth Bootstrap error:', err);
        setAccessDenied(true);
      } finally {
        setDataReady(true);
      }
    })();
  }, [auth]);

  const me = boot?.user || null;

  // 🔹 Welcomer 보여줄지 결정 (Wizard가 아닐 때만)
  useEffect(() => {
    if (!me) return;
    
    // Wizard가 표시 중이면 Welcomer는 표시하지 않음
    if (showSetupWizard) {
      setShowWelcomer(false);
      return;
    }

    if (typeof window === 'undefined') {
      setShowWelcomer(true);
      return;
    }

    const key = getWelcomerKey(me.id);
    const alreadySeen = window.localStorage.getItem(key) === '1';

    if (alreadySeen) {
      setShowWelcomer(false);
      setReady(true);
    } else {
      setShowWelcomer(true);
    }
  }, [me, showSetupWizard]);

  // 🔹 Welcomer 안 쓰는 경우: 바로 Main (Wizard가 아닐 때만)
  useEffect(() => {
    if (showWelcomer === false && dataReady && !showSetupWizard) {
      setReady(true);
    } else if (showSetupWizard) {
      // Wizard가 표시 중이면 ready를 false로 유지
      setReady(false);
    }
  }, [showWelcomer, dataReady, showSetupWizard]);

  // 🔹 Welcomer 닫힘 처리 (애니메이션 끝난 후)
  const handleWelcomerClosed = () => {
    try {
      if (typeof window !== 'undefined' && me?.id) {
        const key = getWelcomerKey(me.id);
        window.localStorage.setItem(key, '1');
      }
    } catch (e) {
      console.warn('welcomer seen flag 저장 실패:', e);
    }
    setReady(true);
  };

  // 🔹 사용자가 "메인으로 가기" 버튼을 눌렀을 때
  const handleProceedFromWelcome = () => {
    if (!dataReady || !minDelayElapsed) return;
    setClosing(true);
  };

  const handleSetupComplete = useCallback(async () => {
    // 설정 완료 후 Bootstrap 다시 호출하여 isConfigured 업데이트
    try {
        const data = await auth.bootstrap();
      setBoot(data);
      setShowSetupWizard(false);
      // 설정이 완료되면 바로 웰컴페이지로 이동
    } catch (err) {
      console.error('Setup complete bootstrap error:', err);
      // 에러가 나도 Wizard는 닫기
      setShowSetupWizard(false);
    }
  }, [auth]);

  const handleLogout = useCallback(() => {
    // ✅ 앱 내 자체 로그아웃 기능 제거
    // BTP/XSUAA 로그아웃만 사용하도록 변경
    // AppRouter의 /logout 엔드포인트로 리다이렉트 (XSUAA가 자동으로 처리)
    if (typeof window !== 'undefined') {
      // BTP 로그아웃: AppRouter의 /logout 엔드포인트 사용
      // 이렇게 하면 XSUAA 세션이 완전히 종료되고 모든 앱에서 로그아웃됨
      window.location.href = '/logout';
    }
  }, []);

  // URL 해시에서 approve-access 경로 체크 (bootstrap 전에도 접근 가능)
  const [isApproveAccessPath, setIsApproveAccessPath] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('#/approve-access')) {
      setIsApproveAccessPath(true);
    } else {
      setIsApproveAccessPath(false);
    }

    // hash 변경 감지
    const handleHashChange = () => {
      const newHash = window.location.hash;
      setIsApproveAccessPath(newHash.includes('#/approve-access'));
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <HashRouter>
      {/* approve-access 경로는 bootstrap과 관계없이 접근 가능 */}
      {isApproveAccessPath && (
        <Routes>
          <Route path="/approve-access" element={<ApproveAccess />} />
        </Routes>
      )}

      {/* 아직 아무것도 준비 안됐으면 null */}
      {!dataReady && !isApproveAccessPath && null}

      {/* 🔒 권한이 없으면 AccessDenied */}
      {dataReady && accessDenied && (
        <AccessDenied 
          user={me} 
          Auth={auth} 
          adminEmail={boot?.adminEmail}
        />
      )}

      {/* 🔧 ADMIN이고 설정이 완료되지 않았으면 Setup Wizard */}
      {dataReady && !accessDenied && showSetupWizard && (
        <TenantSetupWizard
          onComplete={handleSetupComplete}
          Auth={auth}
          user={me}
          bootstrap={boot}
        />
      )}


      {/* 권한은 있는데 Welcomer 보여줄 케이스 (Wizard가 아닐 때만) */}
      {dataReady && !accessDenied && !showSetupWizard && showWelcomer && !ready && (
        <Welcomer
          user={me}
          fadeMs={1000}
          closing={closing}
          onClosed={handleWelcomerClosed}
          canProceed={dataReady && minDelayElapsed}
          onProceed={handleProceedFromWelcome}
        />
      )}

      {/* 정상 사용자 + 웰컴 끝난 후 메인 레이아웃 + 라우팅 (Wizard가 아닐 때만) */}
      {dataReady && !accessDenied && !showSetupWizard && ready && (
        <Routes>
          <Route path="/" element={<Navigate to="home" replace />} />
          <Route path="approve-access" element={<ApproveAccess />} />
          <Route path="home" element={
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100vh',
              flexDirection: 'column',
              gap: '2rem',
              padding: '2rem'
            }}>
              {/* 로고 표시 영역 */}
              <LogoDisplay style={{ marginBottom: '1rem' }} />
              
              <h1 style={{ margin: 0 }}>WorkHub Home</h1>
              <p style={{ margin: 0, color: '#6a6d70' }}>
                환영합니다, {me?.name || me?.id}님!
              </p>
              <button 
                onClick={handleLogout}
                style={{
                  padding: '0.5rem 1rem',
                  border: '1px solid #d3d7db',
                  borderRadius: '4px',
                  background: 'white',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
              >
                로그아웃
              </button>
            </div>
          } />
        </Routes>
      )}
    </HashRouter>
  );
}
