# 내부 CDS 엔드포인트 설명

## 개요

`/-/cds/`로 시작하는 엔드포인트들은 CAP 프레임워크와 멀티테넌시(MTX) 라이브러리가 제공하는 **내부 관리용 엔드포인트**입니다.

## 주요 내부 엔드포인트

### 1. `/-/cds/saas-provisioning`
**멀티테넌시 구독 관리**

- **용도**: 새로운 테넌트(고객사) 구독, 구독 해제, 테넌트 정보 조회
- **주요 엔드포인트**:
  - `POST /-/cds/saas-provisioning/tenant/{tenantId}` - 테넌트 구독
  - `DELETE /-/cds/saas-provisioning/tenant/{tenantId}` - 테넌트 구독 해제
  - `GET /-/cds/saas-provisioning/tenant/{tenantId}` - 테넌트 정보 조회
- **사용 예시**: 
  ```bash
  curl -X POST "http://localhost:4004/-/cds/saas-provisioning/tenant/t0" \
    -H "Content-Type: application/json" \
    -d '{"subscribedTenantId": "t0", "eventType": "CREATE"}'
  ```

### 2. `/-/cds/deployment`
**테넌트 배포 관리**

- **용도**: 각 테넌트의 데이터베이스 스키마 배포, 업데이트, 롤백
- **주요 엔드포인트**:
  - `GET /-/cds/deployment/tenants` - 모든 테넌트 목록
  - `POST /-/cds/deployment/tenant/{tenantId}/upgrade` - 테넌트 스키마 업그레이드
  - `GET /-/cds/deployment/tenant/{tenantId}/status` - 테넌트 배포 상태
- **사용 예시**:
  ```bash
  curl "http://localhost:4004/-/cds/deployment/tenants" -u ADMIN:ADMIN
  ```

### 3. `/-/cds/model-provider`
**CDS 모델 제공**

- **용도**: 런타임에 CDS 모델 정보를 제공 (메타데이터)
- **주요 엔드포인트**:
  - `GET /-/cds/model-provider/csns` - CSN (Common Schema Notation) 정보
  - `GET /-/cds/model-provider/services` - 서비스 목록
- **사용 예시**: 주로 내부적으로 사용되며, 개발/디버깅 목적으로 사용

### 4. `/-/cds/jobs`
**백그라운드 작업 관리**

- **용도**: 스케줄된 작업, 배치 작업 관리
- **주요 엔드포인트**:
  - `GET /-/cds/jobs/Jobs` - 작업 목록
  - `GET /-/cds/jobs/Tasks` - 작업 태스크 목록
- **사용 예시**: 데이터 정리, 주기적 백업 등의 작업 관리

## 중요 사항

### 보안
- 이 엔드포인트들은 **내부 관리용**이므로 프로덕션에서는 적절한 권한 제어가 필요합니다
- 일반 사용자는 접근할 수 없도록 설정되어 있습니다

### 로컬 개발
- 로컬 개발 환경에서는 모든 엔드포인트에 접근 가능합니다
- 멀티테넌시 테스트 시 `/-/cds/saas-provisioning`을 주로 사용합니다

### 프로덕션
- 프로덕션 환경에서는 SAP BTP의 SaaS Registry가 자동으로 `/-/cds/saas-provisioning`을 호출합니다
- 배포 관리자는 `/-/cds/deployment`를 통해 테넌트 스키마를 관리합니다

## 참고

이 엔드포인트들은 `@sap/cds-mtxs` 패키지가 자동으로 제공합니다. 별도로 구현할 필요는 없습니다.

