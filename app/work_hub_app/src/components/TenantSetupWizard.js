import {
  Wizard,
  WizardStep,
  Title,
  Text,
  Button,
  Input,
  Select,
  Option,
  Label,
  FlexBox,
  MessageStrip,
  BusyIndicator,
  TimePicker,
  FileUploader,
  MessageBox
} from '@ui5/webcomponents-react';
import { useState, useEffect } from 'react';
import { useI18n } from '../i18n/useI18n';
import Clock from 'react-clock';
import 'react-clock/dist/Clock.css';
import './TenantSetupWizard.css';

const TIMEZONE_OPTIONS = [
  { key: 'Asia/Seoul', label: 'Asia/Seoul (한국 표준시)' },
  { key: 'Asia/Tokyo', label: 'Asia/Tokyo (일본 표준시)' },
  { key: 'Asia/Shanghai', label: 'Asia/Shanghai (중국 표준시)' },
  { key: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (홍콩 표준시)' },
  { key: 'Asia/Singapore', label: 'Asia/Singapore (싱가포르 표준시)' },
  { key: 'UTC', label: 'UTC' },
  { key: 'America/New_York', label: 'America/New_York (미국 동부)' },
  { key: 'America/Los_Angeles', label: 'America/Los_Angeles (미국 서부)' },
  { key: 'Europe/London', label: 'Europe/London (영국)' },
  { key: 'Europe/Berlin', label: 'Europe/Berlin (독일)' }
];

export default function TenantSetupWizard({ onComplete, onCancel, Auth }) {
  const { t, language: currentLanguage, setLanguage: setI18nLanguage } = useI18n();

  // 언어 옵션 (동적)
  const LANGUAGE_OPTIONS = [
    { key: 'ko', label: t('language.ko') },
    { key: 'en', label: t('language.en') },
    { key: 'ja', label: t('language.ja') },
    { key: 'zh', label: t('language.zh') }
  ];

  const [currentStep, setCurrentStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  // Step 1: 기본 정보
  const [companyName, setCompanyName] = useState('');
  const [companyLogoUrl] = useState('');
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Seoul');
  const [language, setLanguageState] = useState(currentLanguage);
  const [clockTime, setClockTime] = useState(new Date()); // 시계용 Date 객체
  const [currentTime, setCurrentTime] = useState(''); // HH:mm:ss 형식

  // 언어 변경 시 즉시 적용
  useEffect(() => {
    setI18nLanguage(language);
  }, [language, setI18nLanguage]);

  // 타임존에 따른 현재 시각 표시 (TimePicker용 HH:mm:ss 형식 + 시계용 Date 객체)
  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Date();

        // 타임존에 맞는 시간을 가져와서 HH:mm:ss 형식으로 변환
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        const parts = formatter.formatToParts(now);
        const hour = parts.find(p => p.type === 'hour')?.value || '00';
        const minute = parts.find(p => p.type === 'minute')?.value || '00';
        const second = parts.find(p => p.type === 'second')?.value || '00';
        const timeStr = `${hour}:${minute}:${second}`;
        setCurrentTime(timeStr);

        // 시계용 Date 객체 생성 (타임존 적용)
        // 타임존의 시간을 로컬 시간으로 변환
        const timeStrInTimezone = now.toLocaleString('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });
        // "MM/DD/YYYY, HH:mm:ss" 형식을 파싱
        const [datePart, timePart] = timeStrInTimezone.split(', ');
        const [monthStr, dayStr, yearStr] = datePart.split('/');
        const [hourStr, minuteStr, secondStr] = timePart.split(':');
        const timeInTimezone = new Date(
          parseInt(yearStr),
          parseInt(monthStr) - 1,
          parseInt(dayStr),
          parseInt(hourStr),
          parseInt(minuteStr),
          parseInt(secondStr)
        );
        setClockTime(timeInTimezone);
      } catch (e) {
        console.warn('시간 표시 실패:', e);
        setCurrentTime('');
        setClockTime(new Date());
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  // ADMIN 권한 요청 수신 이메일
  const [adminEmail, setAdminEmail] = useState('');

  // 유효성 검사
  const validateStep1 = () => {
    return companyName.trim().length > 0 && adminEmail.trim().length > 0;
  };


  const handleBack = () => {
    setError(null);
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleWizardStepChange = (event) => {
    const stepEl = event.detail?.step;
    const idx = Number(stepEl?.dataset?.index);
    if (!Number.isNaN(idx) && idx < currentStep) {
      setCurrentStep(idx);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep1()) {
      if (!companyName.trim()) {
        setError(t('wizard.error.companyName'));
      } else if (!adminEmail.trim()) {
        setError('권한 요청 수신 이메일을 입력해주세요.');
      }
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // 로고 파일이 있으면 최종 제출 시점에 업로드 (DB에 BLOB으로 저장)
      if (logoFile) {
        setUploadingLogo(true);
        try {
          // 파일을 base64로 변환
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              // data:image/png;base64,xxx 형태에서 base64 부분만 추출
              const dataUrl = reader.result;
              const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
              resolve(base64Data);
            };
            reader.onerror = reject;
            reader.readAsDataURL(logoFile);
          });

          const result = await Auth.uploadLogo(
            base64,
            logoFile.type || 'image/png',
            logoFile.name || 'logo.png'
          );

          if (!result.ok) {
            throw new Error(result.message || '로고 업로드에 실패했습니다.');
          }

          console.log('로고 업로드 완료:', result.message);
        } catch (err) {
          console.error('로고 업로드 실패:', err);
          setError(err.message || err.data?.message || '로고 업로드 중 오류가 발생했습니다.');
          setUploadingLogo(false);
          setSubmitting(false);
          return;
        } finally {
          setUploadingLogo(false);
        }
      }

      const config = {
        companyName: companyName.trim(),
        companyLogoUrl: '/odata/v4/auth/GetLogo()',  // auth-service의 GetLogo 함수 사용
        timezone: timezone,
        language: language,
        adminEmail: adminEmail.trim()
      };

      const result = await Auth.submitTenantConfig(config);

      if (result.ok) {
        setShowSuccessDialog(true);
      } else {
        setError(result.message || '설정 저장 중 오류가 발생했습니다.');
      }
    } catch (err) {
      console.error('TenantSetupWizard submit error:', err);
      setError(err.message || '설정 저장 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuccessDialogClose = () => {
    setShowSuccessDialog(false);
    onComplete();
  };

  return (
    <FlexBox direction="Column" className="tenant-setup-wizard-fullscreen">
      {/* 성공 팝업 */}
      {showSuccessDialog && (
        <MessageBox
          open={showSuccessDialog}
          onClose={handleSuccessDialogClose}
          type="Success"
          titleText="설정 완료"
        >
          성공적으로 관리자 앱 설정이 완료되었습니다. 확인을 누르면 Work Hub로 이동합니다.
        </MessageBox>
      )}

      {(submitting || uploadingLogo) && (
        <BusyIndicator 
          size="Large" 
          active={true}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 10000,
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        />
      )}
      <FlexBox direction="Column" className="wizard-fullscreen-content">
        <FlexBox direction="Column" className="wizard-header">
          <Title level="H2" className="wizard-title">
            {t('wizard.title')}
          </Title>
          <Text className="wizard-subtitle">
            {t('wizard.subtitle')}
          </Text>
        </FlexBox>

        {error && (
          <MessageStrip design="Negative" className="wizard-error-message">
            {error}
          </MessageStrip>
        )}

        <FlexBox direction="Column" className="wizard-body">
          <Wizard
            contentLayout="SingleStep"
            onStepChange={handleWizardStepChange}
          >
            {/* Step 1: 기본 정보 */}
            <WizardStep
              data-index="0"
              titleText={t('wizard.step1.title')}
              subtitleText={t('wizard.step1.subtitle')}
              selected={currentStep === 0}
            >
              <div className="wizard-step-content">
                <FlexBox alignItems="Center" className="wizard-form-row">
                  <Label required showColon className="wizard-form-label">{t('wizard.companyName')}</Label>
                  <Input
                    value={companyName}
                    onInput={(e) => setCompanyName(e.target.value)}
                    placeholder={t('wizard.placeholder.companyName')}
                    className="wizard-form-input"
                  />
                </FlexBox>

                <FlexBox alignItems="Center" className="wizard-form-row">
                  <Label showColon className="wizard-form-label">{t('wizard.companyLogoUrl')}</Label>
                  <FlexBox className="wizard-logo-upload-section">
                    <FileUploader
                      accept="image/*"
                      onChange={(e) => {
                        const files = e.detail.files;
                        if (files && files.length > 0) {
                          const file = files[0];
                          setLogoFile(file);
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            setLogoPreview(event.target.result);
                          };
                          reader.readAsDataURL(file);
                        } else {
                          setLogoFile(null);
                          setLogoPreview(null);
                        }
                      }}
                      disabled={uploadingLogo || submitting}
                    />
                    {(logoPreview || companyLogoUrl) && (
                      <FlexBox direction="Column" className="wizard-logo-preview-section">
                        <img 
                          src={logoPreview || companyLogoUrl} 
                          alt="Logo preview" 
                          className="wizard-logo-preview" 
                        />
                        {logoFile && (
                          <Text className="wizard-logo-filename">{logoFile.name}</Text>
                        )}
                      </FlexBox>
                    )}
                  </FlexBox>
                </FlexBox>

                <FlexBox alignItems="Center" className="wizard-form-row">
                  <Label required showColon className="wizard-form-label">{t('wizard.timezone')}</Label>
                  <Select
                    value={timezone}
                    onChange={(e) => setTimezone(e.detail.selectedOption.value)}
                    className="wizard-form-input"
                  >
                    {TIMEZONE_OPTIONS.map((opt) => (
                      <Option key={opt.key} value={opt.key}>
                        {opt.label}
                      </Option>
                    ))}
                  </Select>
                </FlexBox>
                {currentTime && (
                  <div className="wizard-clock-container">
                    <Clock value={clockTime} size={150} renderNumbers={true} />
                    <TimePicker
                      value={currentTime}
                      onInput={(e) => {
                        const newTime = e.target.value;
                        if (newTime) {
                          setCurrentTime(newTime);
                          // TimePicker의 값을 Date 객체로 변환하여 시계에 반영
                          const [hours, minutes, seconds] = newTime.split(':').map(Number);
                          const newDate = new Date(clockTime);
                          newDate.setHours(hours, minutes, seconds || 0);
                          setClockTime(newDate);
                        }
                      }}
                      formatPattern="HH:mm:ss"
                      className="wizard-time-picker"
                    />
                  </div>
                )}

                <FlexBox alignItems="Center" className="wizard-form-row">
                  <Label required showColon className="wizard-form-label">{t('wizard.language')}</Label>
                  <FlexBox direction="Column" className="wizard-form-input">
                    <Select
                      value={language}
                      onChange={(e) => setLanguageState(e.detail.selectedOption.value)}
                    >
                      {LANGUAGE_OPTIONS.map((opt) => (
                        <Option key={opt.key} value={opt.key}>
                          {t(`language.${opt.key}`)}
                        </Option>
                      ))}
                    </Select>
                    <Text>{t('wizard.language.hint')}</Text>
                  </FlexBox>
                </FlexBox>

                <FlexBox alignItems="Center" className="wizard-form-row">
                  <Label required showColon className="wizard-form-label">권한 요청 수신 이메일</Label>
                  <FlexBox direction="Column" className="wizard-form-input">
                    <Input
                      value={adminEmail}
                      onInput={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@example.com"
                      type="Email"
                    />
                    <Text>일반 사용자의 권한 요청 메일을 수신받을 이메일 주소를 입력하세요.</Text>
                  </FlexBox>
                </FlexBox>
              </div>
            </WizardStep>
          </Wizard>
        </FlexBox>

        <FlexBox className="wizard-actions">
          <FlexBox justifyContent="FlexEnd" className="wizard-buttons" style={{ width: '100%', gap: '0.5rem' }}>
            {currentStep > 0 && (
              <Button design="Transparent" onClick={handleBack} disabled={submitting}>
                {t('wizard.button.back')}
              </Button>
            )}
            <Button
              design="Emphasized"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? <BusyIndicator size="Small" /> : t('wizard.button.submit')}
            </Button>
            {onCancel && (
              <Button design="Transparent" onClick={onCancel} disabled={submitting}>
                {t('wizard.button.cancel')}
              </Button>
            )}
          </FlexBox>
        </FlexBox>
      </FlexBox>
    </FlexBox>
  );
}

