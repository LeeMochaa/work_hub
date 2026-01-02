# WorkHub

고객사별 프로젝트 및 업무 관리 시스템

## 프로젝트 구조

```
work_hub/
├── app/
│   ├── work_hub_app/      # React 프론트엔드
│   └── router/            # AppRouter
├── db/                    # CDS 데이터 모델
├── srv/                   # 서비스 레이어
├── mta.yaml              # MTA 배포 설정
└── xs-security.json      # 보안 설정
```

## 주요 기능

- 프로젝트 관리
- 태스크/업무 관리
- 일별 스케줄 & 마감
- 월별 스케줄 & 마감
- 프로젝트 공지 & 알림
- 산출물 관리
- 대시보드 & 지표

## 로컬 개발 환경 설정

### 1. 의존성 설치

```bash
# 루트 디렉토리에서
npm install

# React 앱 디렉토리에서
cd app/work_hub_app
npm install
```

### 2. 로컬 개발 서버 실행

#### 옵션 1: CAP 서버만 실행 (백엔드만)

```bash
# 루트 디렉토리에서
cds watch
```

이 명령어는:
- SQLite 데이터베이스를 자동으로 생성/업데이트
- Mocked 인증 사용 (ADMIN/USER 계정)
- 서버가 `http://localhost:4004`에서 실행됨

#### 옵션 2: React 앱과 함께 실행 (프론트엔드 + 백엔드)

**터미널 1 - CAP 서버:**
```bash
cd work_hub
cds watch
```

**터미널 2 - React 앱:**
```bash
cd work_hub/app/work_hub_app
npm start
```

React 앱은 `http://localhost:3000`에서 실행됩니다.

### 3. 로컬 개발용 사용자 계정

package.json에 설정된 Mocked 사용자:

- **ADMIN 계정**
  - ID: `ADMIN`
  - Password: `ADMIN`
  - 권한: ADMIN, USER

- **USER 계정**
  - ID: `USER`
  - Password: `USER`
  - 권한: USER

### 4. API 엔드포인트

로컬 개발 시 다음 엔드포인트를 사용할 수 있습니다:

- **Auth Service**: `http://localhost:4004/odata/v4/auth`
- **Project Service**: `http://localhost:4004/odata/v4/project`
- **Task Service**: `http://localhost:4004/odata/v4/task`
- **Closing Service**: `http://localhost:4004/odata/v4/closing`
- **Code Service**: `http://localhost:4004/odata/v4/code`
- **User Service**: `http://localhost:4004/odata/v4/user`
- **Notification Service**: `http://localhost:4004/odata/v4/notification`

### 5. 데이터베이스

로컬 개발 시 SQLite 데이터베이스가 자동으로 생성됩니다:
- 파일 위치: `work_hub/db.sqlite`
- `cds watch` 실행 시 자동으로 스키마가 생성/업데이트됨

### 6. 개발 모드 설정

`.cdsrc.json` 파일이 로컬 개발을 위해 설정되어 있습니다:
- 데이터베이스: SQLite
- 인증: Mocked (개발용)

## 배포

### 로컬 빌드

```bash
# MTA 아카이브 생성 (CDS 빌드 + React 빌드 포함)
mbt build

# 생성된 .mtar 파일 확인
ls mta_archives/
```

### BTP 배포

#### 옵션 1: 로컬에서 빌드 후 배포

```bash
# 1. MTA 아카이브 생성
mbt build

# 2. BTP에 배포
cf deploy mta_archives/work_hub_1.0.0.mtar
```

#### 옵션 2: Git 연동 후 BTP에서 자동 빌드/배포

1. Git 저장소에 코드 푸시
2. BTP Cockpit에서 Git 저장소 연결
3. BTP가 자동으로 `mbt build` 실행 및 배포

**참고:**
- `mta.yaml`의 `before-all`에서 CDS 빌드가 자동 실행됩니다
- React 앱은 `work_hub-react-builder` 모듈에서 자동 빌드됩니다
- 모든 빌드 과정은 `mbt build` 하나의 명령으로 처리됩니다

## 문제 해결

### 포트 충돌
만약 4004 포트가 이미 사용 중이라면:
```bash
cds watch --port 4005
```

### 데이터베이스 초기화
SQLite 데이터베이스를 초기화하려면:
```bash
rm db.sqlite
cds watch
```
