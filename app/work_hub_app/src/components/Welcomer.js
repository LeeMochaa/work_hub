import { useEffect, useRef } from 'react';
import Typed from 'typed.js';
import { BusyIndicator, Text } from '@ui5/webcomponents-react';
import './Welcomer.css';

export default function Welcomer({
  user,
  fadeMs = 600,
  closing = false,
  onClosed,
  canProceed = false,
  onProceed
}) {
  const titleRef = useRef(null);
  const typedRef = useRef(null);

  useEffect(() => {
    typedRef.current = new Typed(titleRef.current, {
      strings: ['Work Hub'],
      typeSpeed: 100,
      backSpeed: 0,
      showCursor: true,
      cursorChar: '_',
      cursorBlink: true,
      cursorBlinkInterval: 2000
    });

    return () => {
      if (typedRef.current) {
        typedRef.current.destroy();
        typedRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => {
      onClosed && onClosed();
    }, 1000 + 20);
    return () => clearTimeout(t);
  }, [closing, onClosed]);

  const displayName = (user && (user.name || user.id)) || null;

  return (
    <div
      className={`welcomer ${closing ? 'welcomer--closing' : ''}`}
      style={{ transition: `opacity ${fadeMs}ms ease` }}
    >
      {/* 배경 애니메이션 요소들 */}
      <div className="welcomer-background">
        <div className="welcomer-particle welcomer-particle-1"></div>
        <div className="welcomer-particle welcomer-particle-2"></div>
        <div className="welcomer-particle welcomer-particle-3"></div>
        <div className="welcomer-particle welcomer-particle-4"></div>
        <div className="welcomer-particle welcomer-particle-5"></div>
      </div>

      <div className={`welcomer-inner ${closing ? 'welcomer-inner--closing' : ''}`}>
        <div className="welcomer-content">

          {/* 타이핑 타이틀 */}
          <h1 ref={titleRef} className="welcomer-title"></h1>

          {/* 환영 문구 */}
          {displayName && (
            <div className="welcomer-greeting">
              <Text className="welcomer-greeting-text">
                <strong style={{ fontSize: '2rem', color: '#fff' }}>
                  {displayName}
                </strong>{' '}
                님 환영합니다.
              </Text>
            </div>
          )}

          {/* 로딩 상태 */}
          {!displayName && !closing && (
            <div className="welcomer-status">
              <BusyIndicator active delay={1000} style={{ color: '#ffffffb4' }} size="S" />
              <Text
                style={{
                  marginLeft: '0.5rem',
                  fontSize: '1.1rem',
                  color: '#ffffffb4'
                }}
              >
                사용자 정보를 가져오고 있습니다.
              </Text>
            </div>
          )}

          {/* 메인으로 가기 버튼 */}
          <div className="welcomer-actions">
            {
              (!canProceed && !closing) ? (
                <Text
                  style={{
                    marginTop: '0.5rem',
                    display: 'block',
                    fontSize: '0.9rem',
                    color: '#ffffffb4'
                  }}
                >
                  초기 설정을 준비 중입니다...
                </Text>
              ) : (
                <Text
                  design="Transparent"
                  disabled={!canProceed || closing}
                  className={
                    'welcomer-main-link' +
                    ((!canProceed || closing) ? ' welcomer-main-link--disabled' : '')
                  }
                  style={{
                    color: '#fff',
                    fontSize: '1.1rem',
                    textUnderlineOffset: '6px',
                    padding: '1rem',
                    cursor: 'default'
                  }}
                >
                  <span className="welcomer-main-link-inner" onClick={onProceed}>홈으로 이동</span>
                </Text>
              )
            }
          </div>

          {/* 하단 문구/로고 */}
          <div className="welcomer-sub">
            <Text
              style={{
                fontWeight: 'bold',
                fontSize: '2.5rem',
                color: '#fff'
              }}
            >
              Public Cloud in{' '}
            </Text>
            <img
              src="images/ASPN_CI_login.png"
              alt="ASPN Logo"
              className="welcomer-logo"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

