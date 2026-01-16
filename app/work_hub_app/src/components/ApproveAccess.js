// src/components/ApproveAccess.js
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessageBox, BusyIndicator } from '@ui5/webcomponents-react';
import { useModel } from '../model/ModelProvider';

export default function ApproveAccess() {
  const auth = useModel('Auth');
  const navigate = useNavigate();
  const location = useLocation();
  
  const [status, setStatus] = useState('processing'); // processing, success, error
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);

  // Hash router에서 쿼리 파라미터 파싱
  const getQueryParams = () => {
    const search = window.location.search || location.search;
    const params = new URLSearchParams(search);
    return {
      userId: params.get('userId'),
      tenant: params.get('tenant')
    };
  };

  useEffect(() => {
    const processApproval = async () => {
      const { userId, tenant } = getQueryParams();

      if (!userId) {
        setStatus('error');
        setError('사용자 ID가 필요합니다.');
        return;
      }

      try {
        // ApproveAccess CAP 액션 호출
        const res = await auth.base.call('ApproveAccess', {
          userId: userId
        }, 'POST');

        if (res && res.ok) {
          setStatus('success');
          setMessage(res.message || '권한 승인이 완료되었습니다.');
          
          // 3초 후 홈으로 리다이렉트
          setTimeout(() => {
            navigate('/home', { replace: true });
          }, 3000);
        } else {
          setStatus('error');
          setError(res?.message || '권한 승인 처리 중 오류가 발생했습니다.');
          
          // 오류 시 5초 후 홈으로 리다이렉트
          setTimeout(() => {
            navigate('/home', { replace: true });
          }, 5000);
        }
      } catch (err) {
        console.error('[ApproveAccess] 권한 승인 실패:', err);
        setStatus('error');
        setError(err.message || '권한 승인 처리 중 오류가 발생했습니다.');
        
        // 오류 시 5초 후 홈으로 리다이렉트
        setTimeout(() => {
          navigate('/home', { replace: true });
        }, 5000);
      }
    };

    processApproval();
  }, [auth, navigate, location]);

  return (
    <div
      style={{
        fontFamily: '"72", system-ui, -apple-system, BlinkMacSystemFont, "Seoge UI", sans-serif',
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
          maxWidth: '500px',
          position: 'relative'
        }}
      >
        {status === 'processing' && (
          <>
            <BusyIndicator active size="Large" style={{ marginBottom: '1.5rem' }} />
            <h1 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1.6rem' }}>
              권한 승인 처리 중...
            </h1>
            <p style={{ margin: 0, color: '#6a6d70', lineHeight: 1.5 }}>
              잠시만 기다려주세요.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <h1 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1.6rem', color: '#28a745' }}>
              ✅ 권한 승인 완료
            </h1>
            <p style={{ margin: 0, color: '#6a6d70', lineHeight: 1.5, marginBottom: '1rem' }}>
              {message || '권한 승인이 완료되었습니다.'}
            </p>
            <p style={{ margin: 0, color: '#a0a3a8', fontSize: '0.9rem' }}>
              잠시 후 홈으로 이동합니다...
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <h1 style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '1.6rem', color: '#d32f2f' }}>
              ❌ 오류 발생
            </h1>
            <p style={{ margin: 0, color: '#6a6d70', lineHeight: 1.5, marginBottom: '1rem' }}>
              {error || '권한 승인 처리 중 오류가 발생했습니다.'}
            </p>
            <p style={{ margin: 0, color: '#a0a3a8', fontSize: '0.9rem' }}>
              잠시 후 홈으로 이동합니다...
            </p>
          </>
        )}
      </div>
    </div>
  );
}

