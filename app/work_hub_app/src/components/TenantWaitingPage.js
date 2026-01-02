import {
  FlexBox,
  Title,
  Text,
  MessageStrip,
  BusyIndicator
} from '@ui5/webcomponents-react';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import './TenantWaitingPage.css';

export default function TenantWaitingPage({ Auth, onRefresh }) {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);

  const handleRefresh = async () => {
    setChecking(true);
    try {
      // Bootstrap을 다시 호출하여 envConfigured 상태 확인
      const data = await Auth.bootstrap({ force: true });
      if (data.envConfigured) {
        // 환경변수 설정이 완료되었으면 onRefresh 호출
        if (onRefresh) {
          onRefresh();
        }
      }
    } catch (err) {
      console.error('환경변수 설정 확인 실패:', err);
    } finally {
      setChecking(false);
    }
  };

  return (
    <FlexBox direction="Column" className="tenant-waiting-fullscreen">
      <FlexBox direction="Column" className="tenant-waiting-content">
        <FlexBox direction="Column" className="tenant-waiting-header">
          <Title level="H2" className="tenant-waiting-title">
            {t('waiting.title')}
          </Title>
          <Text className="tenant-waiting-subtitle">
            {t('waiting.subtitle')}
          </Text>
        </FlexBox>

        <FlexBox direction="Column" className="tenant-waiting-body">
          <MessageStrip design="Information" className="tenant-waiting-message">
            {t('waiting.message')}
          </MessageStrip>

          <FlexBox direction="Column" className="tenant-waiting-info">
            <Text className="tenant-waiting-info-text">
              {t('waiting.info1')}
            </Text>
            <Text className="tenant-waiting-info-text">
              {t('waiting.info2')}
            </Text>
            <Text className="tenant-waiting-info-text">
              {t('waiting.info3')}
            </Text>
          </FlexBox>

          <FlexBox direction="Column" className="tenant-waiting-actions">
            {checking ? (
              <BusyIndicator size="Medium" />
            ) : (
              <Text className="tenant-waiting-refresh-hint">
                {t('waiting.refreshHint')}
              </Text>
            )}
          </FlexBox>
        </FlexBox>
      </FlexBox>
    </FlexBox>
  );
}

