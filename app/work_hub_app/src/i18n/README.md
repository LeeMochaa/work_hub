# i18n 사용 가이드

## 기본 사용법

```javascript
import { useI18n } from '../i18n/useI18n';

function MyComponent() {
  const { t, language, setLanguage } = useI18n();
  
  return (
    <Label>{t('my.key')}</Label>
  );
}
```

## 번역 키 추가 방법

1. **`translations.js`에 번역 추가:**
   ```javascript
   export const translations = {
     ko: {
       'my.key': '내 텍스트',
       // ...
     },
     en: {
       'my.key': 'My Text',
       // ...
     },
     // ...
   };
   ```

2. **컴포넌트에서 사용:**
   ```javascript
   <Label>{t('my.key')}</Label>
   ```

## 번역 키 네이밍 규칙

- **컴포넌트별로 그룹화:** `componentName.fieldName`
- **계층 구조 사용:** `wizard.step1.title`
- **일관성 유지:** 동일한 의미는 동일한 키 사용

### 예시:
- `wizard.title` - 위저드 제목
- `wizard.button.next` - 다음 버튼
- `wizard.error.companyName` - 회사명 오류 메시지
- `common.button.save` - 공통 저장 버튼

## 개발 팁

1. **번역이 없을 때:**
   - 개발 모드에서 콘솔에 경고가 표시됩니다
   - 키 자체가 표시되어 빠르게 확인 가능

2. **Fallback 사용:**
   ```javascript
   t('my.key', '기본 텍스트') // 번역이 없으면 '기본 텍스트' 표시
   ```

3. **언어 변경:**
   ```javascript
   setLanguage('en'); // 영어로 변경
   ```

## UI5 WebComponents 자동 번역

UI5 WebComponents의 내부 텍스트는 `setLanguage()` 호출 시 자동으로 변경됩니다.
별도 번역 키가 필요하지 않습니다.

## 번역 추가 체크리스트

새로운 기능 개발 시:
- [ ] 모든 사용자에게 보이는 텍스트는 번역 키 사용
- [ ] `translations.js`에 모든 언어 번역 추가
- [ ] 개발 모드에서 콘솔 경고 확인 (누락된 번역 체크)

