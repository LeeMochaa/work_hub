import { useState, useEffect } from 'react';
import { FlexBox, FlexBoxDirection, FlexBoxJustifyContent, FlexBoxAlignItems } from '@ui5/webcomponents-react';
import { useModel } from '../model/ModelProvider';

export default function LogoDisplay({ style = {} }) {
  const Auth = useModel('Auth');
  const [logoUrl, setLogoUrl] = useState(null);
  const [hasLogo, setHasLogo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogo = async () => {
      try {
        setLoading(true);
        
        // Auth.getLogo()를 통해 로고 가져오기
        const logoBase64 = await Auth.getLogo();
        
        if (logoBase64) {
          // base64 data URI를 그대로 사용
          setLogoUrl(logoBase64);
          setHasLogo(true);
        } else {
          // 로고가 없음
          setHasLogo(false);
        }
      } catch (error) {
        // 404나 다른 에러는 로고가 없는 것으로 처리
        console.warn('[LogoDisplay] 로고 로드 실패:', error);
        setHasLogo(false);
      } finally {
        setLoading(false);
      }
    };

    fetchLogo();
  }, [Auth]);

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

