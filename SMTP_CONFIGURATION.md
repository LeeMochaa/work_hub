# WorkHub SMTP 설정 가이드

## 개요

WorkHub는 각 고객사(테넌트)마다 다른 SMTP 서버를 사용할 수 있습니다. 권한 요청 메일은 항상 SYSADMIN 이메일(`leemocha@aspnc.com`)로 발송됩니다.

## SMTP 설정 방법

### 방법 1: BTP User-Provided Service (권장)

BTP에서 각 고객사별로 user-provided service를 생성하여 SMTP 설정을 관리합니다.

#### 1. User-Provided Service 생성

```bash
cf create-user-provided-service work_hub-smtp-tenant-a \
  -p '{
    "SMTP_SERVICE": "",
    "SMTP_HOST": "smtp.gmail.com",
    "SMTP_PORT": "587",
    "SMTP_SECURE": "false",
    "SMTP_USER": "customer-a@example.com",
    "SMTP_PASS": "app-password",
    "SMTP_FROM": "customer-a@example.com"
  }'
```

#### 2. MTA에 Service 바인딩

`mta.yaml`에 추가:

```yaml
modules:
  - name: work_hub-srv
    requires:
      - name: work_hub-smtp-tenant-a
        parameters:
          service-name: work_hub-smtp-tenant-a
```

### 방법 2: 환경 변수 (로컬 개발 또는 간단한 설정)

#### Gmail 사용 예시

```env
SMTP_SERVICE=gmail
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

또는 (하위 호환성):

```env
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASS=your-app-password
```

#### Naver 사용 예시

```env
SMTP_HOST=smtp.naver.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@naver.com
SMTP_PASS=your-password
SMTP_FROM=your-email@naver.com
```

#### 회사 SMTP 서버 사용 예시

```env
SMTP_HOST=smtp.company.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=workhub@company.com
SMTP_PASS=your-password
SMTP_FROM=workhub@company.com
```

또는 TLS/SSL 사용:

```env
SMTP_HOST=smtp.company.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=workhub@company.com
SMTP_PASS=your-password
SMTP_FROM=workhub@company.com
```

## SMTP 설정 파라미터

| 파라미터 | 설명 | 필수 | 예시 |
|---------|------|------|------|
| `SMTP_SERVICE` | 서비스 이름 (gmail, naver 등) | 선택 | `gmail` |
| `SMTP_HOST` | SMTP 서버 주소 | 필수* | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP 포트 | 필수* | `587` (TLS) 또는 `465` (SSL) |
| `SMTP_SECURE` | TLS/SSL 사용 여부 | 선택 | `true` 또는 `false` |
| `SMTP_USER` | SMTP 사용자명 (이메일) | 필수 | `user@example.com` |
| `SMTP_PASS` | SMTP 비밀번호 | 필수 | `app-password` |
| `SMTP_FROM` | 발신자 이메일 | 선택 | `user@example.com` (기본값: SMTP_USER) |

* `SMTP_SERVICE`가 설정되지 않은 경우 필수

## 주요 SMTP 서버 설정

### Gmail

```json
{
  "SMTP_SERVICE": "gmail",
  "SMTP_USER": "your-email@gmail.com",
  "SMTP_PASS": "app-password",
  "SMTP_FROM": "your-email@gmail.com"
}
```

**참고:** Gmail App Password는 [Google 계정 설정](https://myaccount.google.com/apppasswords)에서 생성해야 합니다.

### Naver

```json
{
  "SMTP_HOST": "smtp.naver.com",
  "SMTP_PORT": "587",
  "SMTP_SECURE": "false",
  "SMTP_USER": "your-email@naver.com",
  "SMTP_PASS": "your-password",
  "SMTP_FROM": "your-email@naver.com"
}
```

### Outlook/Office 365

```json
{
  "SMTP_HOST": "smtp.office365.com",
  "SMTP_PORT": "587",
  "SMTP_SECURE": "false",
  "SMTP_USER": "your-email@outlook.com",
  "SMTP_PASS": "your-password",
  "SMTP_FROM": "your-email@outlook.com"
}
```

### 일반 회사 SMTP 서버

```json
{
  "SMTP_HOST": "smtp.company.com",
  "SMTP_PORT": "587",
  "SMTP_SECURE": "false",
  "SMTP_USER": "workhub@company.com",
  "SMTP_PASS": "your-password",
  "SMTP_FROM": "workhub@company.com"
}
```

## 메일 발송 흐름

1. 권한이 없는 사용자가 권한 요청 메일 발송
2. 시스템이 **SYSADMIN 이메일(`leemocha@aspnc.com`)**로 메일 발송
3. 메일 내용:
   - 제목: `[WorkHub] 권한 요청`
   - 요청자 이름 및 이메일
   - 권한 요청 메시지

## 테넌트별 SMTP 설정

멀티테넌시 환경에서는 각 테넌트마다 다른 SMTP 설정을 사용할 수 있습니다:

1. **BTP User-Provided Service**: 각 테넌트별로 별도의 service 생성
2. **환경 변수**: 테넌트별로 다른 환경 변수 설정 (BTP에서 지원)

## 개발 환경

개발 환경에서는 SMTP 설정이 없어도 동작합니다:
- 메일 발송은 건너뛰고 로그만 출력
- 실제 운영 환경에서는 반드시 SMTP 설정 필요

## 문제 해결

### 메일이 발송되지 않는 경우

1. 서버 콘솔 로그 확인:
   ```
   📧 [Auth.RequestAccessMail] 권한 요청 메일 발송 정보:
     - 수신자(SYSADMIN) 이메일: leemocha@aspnc.com
   ```

2. SMTP 설정 확인:
   - 환경 변수가 올바르게 설정되었는지 확인
   - SMTP 서버 접근 가능 여부 확인
   - 방화벽/보안 설정 확인

3. 에러 로그 확인:
   ```
   ❌ [Auth.RequestAccessMail] 메일 발송 실패: ...
   ```

