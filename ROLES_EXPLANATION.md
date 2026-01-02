# WorkHub 권한 체계

## 권한 레벨 (계층 구조)

### 1. SYSADMIN (시스템 관리자)
- **설명**: 배포 관리자, 마스터 권한
- **권한 범위**:
  - 모든 테넌트 접근 가능
  - 시스템 설정 관리
  - 테넌트 구독/해제 관리
  - 모든 데이터 접근 및 수정
- **사용 예시**: SAP BTP 배포 관리자, 솔루션 제공자 관리자

### 2. Administrator (앱 관리자)
- **설명**: 고객사 내 관리자 (테넌트 관리자)
- **권한 범위**:
  - 자신의 테넌트 내 모든 데이터 접근
  - 코드 관리 (CodeGroup, CodeItem)
  - 사용자 관리 (User)
  - 프로젝트/태스크/마감 관리
  - 설정 관리
- **사용 예시**: A 고객사의 IT 관리자, B 고객사의 프로젝트 관리자

### 3. Leader (리더)
- **설명**: 프로젝트 리드, 팀 리더
- **권한 범위**:
  - 자신이 리드인 프로젝트 관리
  - 프로젝트 멤버 관리
  - 프로젝트 일정/공지 관리
  - 태스크 할당 및 관리
  - 마감 승인
- **사용 예시**: 프로젝트 매니저, 팀 리드

### 4. User (일반 사용자)
- **설명**: 일반 사용자
- **권한 범위**:
  - 자신이 멤버인 프로젝트 조회
  - 자신에게 할당된 태스크 관리
  - 일별/월별 마감 작성 및 제출
  - 프로젝트 공지 조회
- **사용 예시**: 개발자, 일반 직원

## 권한 상속 구조

```
SYSADMIN
  └─ Administrator
      └─ Leader
          └─ User
```

상위 권한은 하위 권한을 모두 포함합니다.

## XSUAA 설정

`xs-security.json`에서 정의된 역할:

- `WorkHub_SYSADMIN`: SYSADMIN + Administrator + Leader + User
- `WorkHub_Administrator`: Administrator + Leader + User
- `WorkHub_Leader`: Leader + User
- `WorkHub_User`: User

## 로컬 개발용 계정

`package.json`의 `[development]` 섹션에 정의된 Mocked 사용자:

- **SYSADMIN** / **SYSADMIN**: 시스템 관리자
- **ADMIN** / **ADMIN**: 앱 관리자
- **LEADER** / **LEADER**: 리더
- **USER** / **USER**: 일반 사용자

## 사용 예시

### SYSADMIN
- 모든 테넌트의 데이터 조회/수정 가능
- 테넌트 구독 관리
- 시스템 전역 설정

### Administrator (고객사 A 관리자)
- 고객사 A의 모든 프로젝트 관리
- 고객사 A의 사용자 관리
- 고객사 A의 코드 관리
- 고객사 B의 데이터는 접근 불가

### Leader (프로젝트 리드)
- 자신이 리드인 프로젝트만 관리
- 프로젝트 멤버 할당
- 마감 승인

### User (일반 사용자)
- 자신의 태스크만 관리
- 마감 작성 및 제출

