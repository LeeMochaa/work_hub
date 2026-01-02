import { useState, useEffect, createContext, useContext } from 'react';
import { setLanguage as setUI5Language } from '@ui5/webcomponents-base/dist/config/Language.js';
import { translations } from './translations';

// i18n Context
const I18nContext = createContext({
  language: 'ko',
  t: (key) => key,
  setLanguage: () => {}
});

// i18n Provider
export function I18nProvider({ children, defaultLanguage = 'ko' }) {
  const [language, setLanguageState] = useState(defaultLanguage);

  // 언어 변경 시 UI5 언어도 변경
  useEffect(() => {
    try {
      setUI5Language(language);
      if (typeof document !== 'undefined') {
        document.documentElement.lang = language;
      }
    } catch (e) {
      console.warn('언어 설정 실패:', e);
    }
  }, [language]);

  // 번역 함수
  const t = (key, fallback = null) => {
    const langTranslations = translations[language] || translations['ko'];
    const translation = langTranslations[key];
    
    // 번역이 없으면 fallback 사용, 없으면 키 자체를 반환 (개발 중 편의)
    if (!translation) {
      if (fallback !== null) {
        return fallback;
      }
      // 개발 모드에서 경고 표시
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[i18n] Missing translation for key: "${key}" (language: ${language})`);
      }
      return key;
    }
    
    return translation;
  };

  const setLanguage = (lang) => {
    if (translations[lang]) {
      setLanguageState(lang);
    } else {
      console.warn(`언어 '${lang}'는 지원되지 않습니다.`);
    }
  };

  return (
    <I18nContext.Provider value={{ language, t, setLanguage }}>
      {children}
    </I18nContext.Provider>
  );
}

// i18n Hook
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}

