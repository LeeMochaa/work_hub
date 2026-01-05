import { useEffect, useState, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useModel } from './model/ModelProvider';

import Welcomer from './components/Welcomer';
import AccessDenied from './components/AccessDenied';
import TenantSetupWizard from './components/TenantSetupWizard';
import LogoDisplay from './components/LogoDisplay';

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
  useEffect(() => {
    (async () => {
      try {
        const data = await auth.bootstrap();
        setBoot(data);

        const flags = data.flags || {};
        // 디버깅용 로그
        console.log('[App] Bootstrap flags:', JSON.stringify(flags, null, 2));
        console.log('[App] User:', JSON.stringify(data.user, null, 2));
        console.log('[App] isConfigured:', data.isConfigured);
        
        // SYSADMIN은 항상 통과, 그 외는 ADMIN/LEADER/USER 중 하나가 있어야 함
        const hasAccess =
          flags.SYSADMIN || flags.ADMIN || flags.LEADER || flags.USER;

        console.log('[App] hasAccess:', hasAccess);

        if (!hasAccess) {
          setAccessDenied(true);
        } else {
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
      const data = await auth.bootstrap({ force: true });
      setBoot(data);
      setShowSetupWizard(false);
      // 설정이 완료되면 바로 웰컴페이지로 이동
    } catch (err) {
      console.error('Setup complete bootstrap error:', err);
      // 에러가 나도 Wizard는 닫기
      setShowSetupWizard(false);
    }
  }, [auth]);

  const handleLogout = useCallback(async () => {
    try {
      await auth.resetSession();
    } catch (e) {
      console.warn('[Auth] ResetSession 실패 (무시 가능):', e);
    }

    try {
      auth.clearCache?.();

      if (typeof window !== 'undefined') {
        const ss = window.sessionStorage;
        const ls = window.localStorage;

        if (me?.id) {
          const key = getWelcomerKey(me.id);
          ls.removeItem(key);
        }

        Object.keys(ss)
          .filter((k) => k.startsWith('workhub.'))
          .forEach((k) => ss.removeItem(k));

        Object.keys(ls)
          .filter((k) => k.startsWith('workhub.'))
          .forEach((k) => ls.removeItem(k));
      }
    } catch (e) {
      console.warn('[Auth] 스토리지 정리 중 오류:', e);
    }

    if (typeof window !== 'undefined') {
      window.location.href = '/logout.html';
    }
  }, [auth, me]);

  return (
    <HashRouter>
      {/* 아직 아무것도 준비 안됐으면 null */}
      {!dataReady && null}

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
