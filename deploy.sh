#!/bin/bash

# WorkHub 배포 스크립트
# 사용법: ./deploy.sh [environment]
# environment: dev, prod (기본값: dev)

ENVIRONMENT=${1:-dev}

echo "=========================================="
echo "WorkHub 배포 시작"
echo "환경: $ENVIRONMENT"
echo "=========================================="

# 1. MTA 빌드
echo ""
echo "1단계: MTA 빌드 중..."
mbt build

if [ $? -ne 0 ]; then
    echo "❌ MTA 빌드 실패!"
    exit 1
fi

echo "✅ MTA 빌드 완료"

# 2. BTP 로그인 확인
echo ""
echo "2단계: BTP 로그인 상태 확인..."
cf target > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "⚠️  BTP에 로그인되지 않았습니다."
    echo "다음 명령어로 로그인하세요:"
    echo "cf login -a https://api.cf.us10-001.hana.ondemand.com"
    exit 1
fi

echo "✅ BTP 로그인 확인됨"

# 3. MTA 배포
echo ""
echo "3단계: BTP에 배포 중..."
cf deploy mta_archives/work_hub_1.0.0.mtar

if [ $? -ne 0 ]; then
    echo "❌ 배포 실패!"
    exit 1
fi

echo "✅ 배포 완료"

# 4. 배포 확인
echo ""
echo "4단계: 배포 상태 확인..."
echo ""
echo "애플리케이션 목록:"
cf apps | grep work_hub

echo ""
echo "서비스 인스턴스 목록:"
cf services | grep work_hub

echo ""
echo "=========================================="
echo "배포 완료!"
echo "=========================================="
echo ""
echo "다음 명령어로 애플리케이션 URL을 확인하세요:"
echo "cf app work_hub-router"
echo ""
echo "로그 확인:"
echo "cf logs work_hub-router --recent"
echo "cf logs work_hub-srv --recent"

