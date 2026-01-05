// src/components/AccessDenied.js
import React, { useState, useEffect } from 'react';
import { MessageBox, BusyIndicator } from '@ui5/webcomponents-react';

function getSessionStorageSafe() {
  if (typeof window === 'undefined') return null;
  try {
    return window.top?.sessionStorage || window.sessionStorage;
  } catch (e) {
    return window.sessionStorage;
  }
}

export default function AccessDenied({ user, Auth, adminEmail }) {
  const [showModal, setShowModal] = useState(false);
  const [showSuccessBox, setShowSuccessBox] = useState(false);
  const [alreadyRequested, setAlreadyRequested] = useState(false);

  // 🔐 개인정보 처리방침 모달
  const [showPrivacyBox, setShowPrivacyBox] = useState(false);
  const [consent, setConsent] = useState(false);

  const [errorBox, setErrorBox] = useState({ open: false, message: '' });
  const [cooldownBox, setCooldownBox] = useState({ open: false, message: '' });

  // 🔄 메일 전송 중 Busy Indicator
  const [sending, setSending] = useState(false);

  const name = user?.name || '';
  const email = user?.email || user?.id || '';

  // 🔑 이 세션에서 "이 이메일로 권한 요청 보냈는지" 저장할 키
  const storageKey = email ? `workhub.noauth.requested.${email}` : null;

  // 🔹 마운트 시, 이번 세션에서 이미 요청한 적 있는지 체크
  useEffect(() => {
    if (!storageKey) return;
    const ss = getSessionStorageSafe();
    if (!ss) return;

    try {
      const flag = ss.getItem(storageKey);
      if (flag === '1') {
        setAlreadyRequested(true);
      }
    } catch (e) {
      console.warn('[AccessDenied] sessionStorage 읽기 실패:', e);
    }
  }, [storageKey]);

  const handleOpenModal = () => {
    if (alreadyRequested) return;
    setShowModal(true);
  };

  const handleCloseModal = () => {
    if (sending) return;
    setShowModal(false);
  };

  // ✅ 메일 전송 + 서버 쿨다운/머지 처리 호출
  async function sendRequest() {
    if (!email) {
      setErrorBox({
        open: true,
        message: '이메일 정보를 확인할 수 없어서 권한 요청 메일을 보낼 수 없습니다.'
      });
      return;
    }

    if (!consent) {
      setErrorBox({
        open: true,
        message: '개인정보 처리방침에 동의해야 권한 요청 메일을 보낼 수 있습니다.'
      });
      return;
    }

    // 🔄 실제 호출 전에 Busy 시작
    setSending(true);
    try {
      const res = await Auth.base.call('RequestAccessMail', {
        email: email, // user.email || user.id (이미 위에서 추출됨)
        name: name
      });

      // 정상 성공
      if (res && res.ok) {
        if (storageKey) {
          const ss = getSessionStorageSafe();
          ss?.setItem(storageKey, '1');
        }

        setAlreadyRequested(true);
        setShowModal(false);
        setShowSuccessBox(true);
        return;
      }

      // COOLDOWN
      if (res && res.code === 'COOLDOWN') {
        setAlreadyRequested(true);
        setShowModal(false);
        setCooldownBox({
          open: true,
          message: res.message || '이미 권한을 요청한 계정입니다.'
        });
        return;
      }

      // 그 외 서버 오류
      setShowModal(false);
      setErrorBox({
        open: true,
        message: res?.message || '권한 요청 중 오류가 발생했습니다.'
      });
    } catch (e) {
      console.error('권한 요청 실패:', e);
      setErrorBox({
        open: true,
        message: '권한 요청 메일 발송 중 오류가 발생했습니다.'
      });
    } finally {
      setSending(false);
    }
  }

  const handleSuccessClose = () => {
    setShowSuccessBox(false);
  };

  // 메인 버튼 disabled 조건: 이미 요청했거나, 동의 안 했거나, 전송 중일 때
  const disabled = alreadyRequested || !consent || sending;
  const sendButtonStyle = {
    border: 'none',
    borderRadius: '8px',
    padding: '0.6rem 1.4rem',
    fontSize: '0.95rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: '#0a6ed1',
    color: 'white',
    opacity: disabled ? 0.5 : 1
  };

  return (
    <>
      {/* 권한 요청 성공 */}
      {showSuccessBox && (
        <MessageBox
          open={showSuccessBox}
          onClose={handleSuccessClose}
          type="Success"
          titleText="권한 요청 완료"
        >
          WorkHub 권한 요청 메일이 정상적으로 발신되었습니다.
        </MessageBox>
      )}

      {/* 일반 오류 */}
      {errorBox.open && (
        <MessageBox
          open={errorBox.open}
          type="Error"
          titleText="오류 발생"
          onClose={() => setErrorBox({ open: false, message: '' })}
        >
          {errorBox.message}
        </MessageBox>
      )}

      {/* COOLDOWN 경고 */}
      {cooldownBox.open && (
        <MessageBox
          open={cooldownBox.open}
          type="Warning"
          titleText="요청 제한"
          onClose={() => setCooldownBox({ open: false, message: '' })}
        >
          {cooldownBox.message}
        </MessageBox>
      )}

      {/* 🔐 개인정보 처리방침 모달 */}
      {showPrivacyBox && (
        <MessageBox
          open={showPrivacyBox}
          type="Information"
          titleText="개인정보 처리방침"
          onClose={() => setShowPrivacyBox(false)}
        >
          <div style={{ textAlign: 'left', lineHeight: 1.5, fontSize: '0.9rem' }}>
            <p>
              WorkHub는 권한 요청 메일 발송을 위해 다음 개인정보를 수집·이용합니다.
            </p>
            <ul style={{ paddingLeft: '1.2rem' }}>
              <li>수집 항목: 이름, 이메일 주소</li>
              <li>수집 목적: WorkHub 접근 권한 요청 및 관리자 확인</li>
              <li>보유 기간: 권한 요청 이력 관리 목적 달성 시까지 또는 관련 법령에 따른 기간</li>
            </ul>
            <p>
              위 개인정보 수집·이용에 동의하지 않으실 수 있으며,
              이 경우 권한 요청 메일 발송이 제한될 수 있습니다.
            </p>
          </div>
        </MessageBox>
      )}

      <div
        style={{
          fontFamily:
            '"72", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: '#f5f6f8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          margin: 0
        }}
      >
        <div
          style={{
            background: 'white',
            padding: '2rem 3rem',
            borderRadius: '12px',
            boxShadow: '0 4px 18px rgba(0, 0, 0, 0.08)',
            textAlign: 'center',
            maxWidth: '420px',
            position: 'relative'
          }}
        >
          <h1 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1.6rem' }}>
            접근 권한이 없습니다
          </h1>
          <p style={{ margin: '0 0 1.5rem', color: '#6a6d70', lineHeight: 1.5 }}>
            현재 계정은 WorkHub 어플리케이션에
            <br />
            <b>접근 권한</b>이 없거나
            <br />
            <b>권한 설정</b>이 완료되지 않았습니다.
          </p>
          <p style={{ margin: '0 0 2rem', color: '#6a6d70', lineHeight: 1.5 }}>
            관리자에게 권한 요청 메일을 보내주세요.
          </p>

          {email && (
            <p style={{ margin: '0 0 0.5rem', color: '#6a6d70' }}>
              현재 로그인 계정: <b>{email}</b>
            </p>
          )}

          {adminEmail && (
            <p style={{ margin: '0 0 2rem', color: '#6a6d70' }}>
              관리자 메일 : <b>{adminEmail}</b>
            </p>
          )}

          {alreadyRequested && (
            <p
              style={{
                margin: '0 0 0.8rem',
                color: '#bb0000',
                fontSize: '0.85rem'
              }}
            >
              이 계정으로 이미 권한 요청 메일을 발신했습니다.
            </p>
          )}

          {/* 🔐 개인정보 처리방침 + 동의 체크 */}
          <div
            style={{
              marginTop: '1rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: '#6a6d70',
              textAlign: 'left'
            }}
          >
            <div style={{ margin: '1.5rem 0 0.5rem' }}>
              <span
                style={{
                  textDecoration: 'underline',
                  color: '#0a6ed1',
                  cursor: 'pointer'
                }}
                onClick={() => setShowPrivacyBox(true)}
              >
                개인정보 처리방침
              </span>{' '}
              에 따라, 사용자 정보를 수집·이용합니다.
            </div>
            <label
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '0.4rem'
              }}
            >
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={sending}
              />
              <span>개인정보 수집·이용에 동의합니다.</span>
            </label>
          </div>

          <button
            style={sendButtonStyle}
            onClick={handleOpenModal}
            disabled={disabled}
          >
            관리자에게 메일 보내기
          </button>

          {/* 🔹 확인/전송 모달 */}
          {showModal && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999
              }}
            >
              <div
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '1.5rem 2rem',
                  maxWidth: '420px',
                  width: '90%',
                  boxShadow: '0 4px 18px rgba(0, 0, 0, 0.18)',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {/* 🔄 메일 전송 중이면 모달 위에 반투명 오버레이 + BusyIndicator */}
                {sending && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(255, 255, 255, 0.7)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 10
                    }}
                  >
                    <BusyIndicator active size="Medium" />
                  </div>
                )}

                <h2
                  style={{
                    marginTop: 0,
                    marginBottom: '0.75rem',
                    fontSize: '1.3rem'
                  }}
                >
                  권한 요청 메일 보내기
                </h2>
                <p
                  style={{
                    margin: '0 0 1rem',
                    color: '#6a6d70',
                    lineHeight: 1.5
                  }}
                >
                  다음 정보로 관리자에게 권한 요청 메일을 보내시겠습니까?
                </p>

                <div
                  style={{
                    background: '#f5f6f8',
                    borderRadius: '8px',
                    padding: '0.8rem 1rem',
                    textAlign: 'left',
                    fontSize: '0.9rem',
                    marginBottom: '1.2rem'
                  }}
                >
                  <div style={{ marginBottom: '0.35rem' }}>
                    <strong>발신자 이름 :</strong>{' '}
                    {name || <span style={{ color: '#a0a3a8' }}>알 수 없음</span>}
                  </div>
                  <div>
                    <strong>발신자 이메일 :</strong>{' '}
                    {email || <span style={{ color: '#a0a3a8' }}>알 수 없음</span>}
                  </div>
                </div>

                <p
                  style={{
                    margin: '0 0 1.2rem',
                    color: '#6a6d70',
                    fontSize: '0.9rem',
                    lineHeight: 1.5
                  }}
                >
                  메일 제목: <b>[WorkHub] 권한 요청</b>
                  <br />
                  메일 본문에 위 정보와 함께
                  <br />
                  <code>WorkHub 에 대한 접근 권한을 신청합니다.</code> 문구가 포함됩니다.
                </p>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '0.5rem',
                    marginTop: '1rem'
                  }}
                >
                  <button
                    style={{
                      border: '1px solid #d3d7db',
                      background: 'white',
                      borderRadius: '8px',
                      padding: '0.45rem 1.1rem',
                      fontSize: '0.9rem',
                      cursor: sending ? 'not-allowed' : 'pointer'
                    }}
                    onClick={handleCloseModal}
                    disabled={sending}
                  >
                    취소
                  </button>
                  <button
                    style={{
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.45rem 1.1rem',
                      fontSize: '0.9rem',
                      cursor: sending ? 'not-allowed' : 'pointer',
                      background: '#0a6ed1',
                      color: 'white',
                      opacity: sending ? 0.7 : 1
                    }}
                    onClick={sendRequest}
                    disabled={sending}
                  >
                    {sending ? '보내는 중...' : '메일 보내기'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

