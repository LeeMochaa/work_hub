import { useEffect, useState } from 'react';
import {
  FlexBox
} from '@ui5/webcomponents-react';
import { useModel } from '../model/ModelProvider';

export default function LogoDisplay({ style = {} }) {
  const Auth = useModel('Auth');
  const [logoUrl, setLogoUrl] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadLogo = async () => {
      try {
        const logoBase64 = await Auth.getLogo();
        if (logoBase64) {
          setLogoUrl(logoBase64);
          setError(false);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('[LogoDisplay] 로고 로드 실패:', err);
        setError(true);
      }
    };

    loadLogo();
  }, [Auth]);

  if (error || !logoUrl) {
    return null; // 로고가 없으면 아무것도 표시하지 않음
  }

  return (
    <FlexBox
      direction="Column"
      justifyContent="Center"
      alignItems="Center"
      style={{ padding: "1rem", ...style }}
    >
      <img
        src={logoUrl}
        alt="Company Logo"
        style={{ maxWidth: "200px", maxHeight: "100px", objectFit: "contain", borderRadius: "8px" }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
          setError(true);
        }}
      />
    </FlexBox>
  );
}