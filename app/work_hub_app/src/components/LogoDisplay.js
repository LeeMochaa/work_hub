import { useState, useEffect } from 'react';
import { FlexBox, FlexBoxDirection, FlexBoxJustifyContent, FlexBoxAlignItems } from '@ui5/webcomponents-react';

export default function LogoDisplay({ style = {} }) {
  const [logoUrl, setLogoUrl] = useState(null);
  const [hasLogo, setHasLogo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogo = async () => {
      try {
        setLoading(true);
        
        // 현재 URL에서 base URL 추출
        const baseUrl = window.location.origin;
        const logoApiUrl = `${baseUrl}/api/logo`;
        
        // 로고 존재 여부 확인
        const response = await fetch(logoApiUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'image/*'
          }
        });

        if (response.ok && response.status !== 404) {
          // 로고가 있으면 blob URL 생성
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          setLogoUrl(url);
          setHasLogo(true);
        } else {
          // 로고가 없음
          setHasLogo(false);
        }
      } catch (error) {
        console.warn('[LogoDisplay] 로고 로드 실패:', error);
        setHasLogo(false);
      } finally {
        setLoading(false);
      }
    };

    fetchLogo();

    // cleanup: blob URL 해제
    return () => {
      if (logoUrl) {
        URL.revokeObjectURL(logoUrl);
      }
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '1rem', textAlign: 'center', ...style }}>
        <p style={{ color: '#6a6d70' }}>로고 로딩 중...</p>
      </div>
    );
  }

  if (hasLogo && logoUrl) {
    return (
      <FlexBox
        direction={FlexBoxDirection.Column}
        justifyContent={FlexBoxJustifyContent.Center}
        alignItems={FlexBoxAlignItems.Center}
        style={{ padding: '1rem', ...style }}
      >
        <img
          src={logoUrl}
          alt="Company Logo"
          style={{
            maxWidth: '200px',
            maxHeight: '100px',
            objectFit: 'contain',
            borderRadius: '8px'
          }}
        />
      </FlexBox>
    );
  }

  // 로고 없음
  return (
    <FlexBox
      direction={FlexBoxDirection.Column}
      justifyContent={FlexBoxJustifyContent.Center}
      alignItems={FlexBoxAlignItems.Center}
      style={{
        padding: '2rem',
        border: '2px dashed #d3d7db',
        borderRadius: '8px',
        backgroundColor: '#f5f6f8',
        ...style
      }}
    >
      <p style={{ color: '#6a6d70', margin: 0, fontSize: '0.9rem' }}>
        로고 없음
      </p>
    </FlexBox>
  );
}

