# 환경 변수 설정 가이드

## 개발 환경 설정

### 방법 1: default-env.json 사용 (권장)

`default-env.json` 파일을 사용하여 JSON 형태로 환경변수를 설정할 수 있습니다.

```json
{
  "SYSADMIN_SMTP_ENV": "{\n  \"SMTP_SERVICE\": \"gmail\",\n  \"SMTP_HOST\": \"smtp.gmail.com\",\n  \"SMTP_PORT\": 587,\n  \"SMTP_SECURE\": false,\n  \"SMTP_USER\": \"leemocha.aspn@gmail.com\",\n  \"SMTP_PASS\": \"내 앱 비밀번호\",\n  \"SMTP_FROM\": \"leemocha.aspn@gmail.com\"\n}",
  "ADMIN_SMTP_ENV": "{\n  \"SMTP_SERVICE\": \"\",\n  \"SMTP_HOST\": \"\",\n  \"SMTP_PORT\": \"\",\n  \"SMTP_SECURE\": \"\",\n  \"SMTP_USER\": \"\",\n  \"SMTP_PASS\": \"\",\n  \"SMTP_FROM\": \"\"\n}"
}
```

### 방법 2: .env 파일 사용 (하위 호환성)

1. `.env.example` 파일을 `.env`로 복사:
   ```bash
   cp .env.example .env
   ```

2. `.env` 파일을 열고 실제 값으로 수정:
   ```env
   # SYSADMIN 이메일 (권한 요청 및 테넌트 설정 알림 수신)
   SYSADMIN_EMAIL=leemocha@aspnc.com

   # SYSADMIN용 SMTP 설정 (dev-hub와 동일)
   # 이 계정은 ADMIN의 테넌트 설정 요청을 SYSADMIN에게 보낼 때 사용됩니다
   SYSADMIN_SMTP_SERVICE=gmail
   SYSADMIN_SMTP_HOST=smtp.gmail.com
   SYSADMIN_SMTP_PORT=587
   SYSADMIN_SMTP_SECURE=false
   SYSADMIN_SMTP_USER=leemocha.aspn@gmail.com
   SYSADMIN_SMTP_PASS=your-gmail-app-password
   SYSADMIN_SMTP_FROM=leemocha.aspn@gmail.com

   # ADMIN용 SMTP 설정 (SYSADMIN이 BTP에 환경변수로 설정한 후 사용)
   # 개발 환경에서는 빈값으로 두고, SYSADMIN이 BTP에 설정한 후 여기에 값을 넣어 테스트할 수 있습니다
   ADMIN_SMTP_SERVICE=
   ADMIN_SMTP_HOST=
   ADMIN_SMTP_PORT=
   ADMIN_SMTP_SECURE=
   ADMIN_SMTP_USER=
   ADMIN_SMTP_PASS=
   ADMIN_SMTP_FROM=
   ```

## Gmail App Password 생성 방법

1. Google 계정 설정으로 이동: https://myaccount.google.com/
2. 보안 → 2단계 인증 활성화
3. App Passwords로 이동: https://myaccount.google.com/apppasswords
4. "앱 선택" → "기타(맞춤 이름)" → "WorkHub" 입력
5. 생성된 16자리 비밀번호를 `SMTP_PASS`에 입력

## SMTP 설정 우선순위

### SYSADMIN SMTP 설정
1. **VCAP_SERVICES** (BTP 환경): user-provided service에서 읽기
2. **SYSADMIN_SMTP_ENV** (JSON 환경변수): `default-env.json` 또는 환경변수에서 JSON 형태로 읽기
3. **개별 환경변수** (하위 호환성): `SYSADMIN_SMTP_HOST`, `SYSADMIN_SMTP_USER` 등

### ADMIN SMTP 설정
1. **VCAP_SERVICES** (BTP 환경): user-provided service에서 읽기
2. **ADMIN_SMTP_ENV** (JSON 환경변수): `default-env.json` 또는 환경변수에서 JSON 형태로 읽기
3. **개별 환경변수** (하위 호환성): `ADMIN_SMTP_HOST`, `ADMIN_SMTP_USER` 등

## 주의사항

- `.env` 파일은 Git에 커밋하지 마세요 (`.gitignore`에 포함되어 있음)
- Gmail 사용 시 일반 비밀번호가 아닌 **App Password**를 사용해야 합니다
- 프로덕션 환경에서는 BTP user-provided service를 사용하세요

