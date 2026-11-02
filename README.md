# 세명 태양광 부지진단

https://semyungmarketing.github.io/semyung-solar/

## 폴더
- `index.html` 지도 페이지 (브이월드 키 포함, semyungmarketing.github.io 에서만 작동)
- `raw/` 원본 자료. 여기에 올리면 자동으로 data/ 가 갱신됩니다
  - 조례 모니터링 엑셀: 파일 이름에 **조례** 또는 ordinance가 들어간 .xlsx (가장 최근 파일 사용)
- `data/` 자동 생성 파일 (직접 수정하지 않음). 단, `prices.json`은 직접 숫자를 고쳐도 됩니다
- `scripts/convert_raw.py` 변환 프로그램
- `.github/workflows/convert.yml` raw/ 에 파일이 올라오면 변환 실행

## 조례 엑셀 바꾸는 법
raw 폴더 → Add file → Upload files → 새 조례 엑셀 올리기 → Commit changes.
1~2분 뒤 Actions 탭에 초록 체크가 뜨면 반영 완료.
같은 이름(`ordinance.xlsx`)으로 올리면 덮어쓰기 됩니다.

## 계통(한전 변전소·여유용량)
현재 버전은 판정에 포함하지 않습니다.

## Cloudflare Worker (worker/worker.js 한 파일)
- `/` 한전 분산전원연계 정보 중계 (키는 Worker 비밀값 KEPCO_KEY)
- `/lead` 이용 신청(이름·휴대폰·동의) 저장 → D1 데이터베이스
- `/admin` 이용자 명단 (관리자 비밀번호) · 엑셀 다운로드 · 삭제

### 설정 순서
1. 스토리지 및 데이터베이스 → D1 → 데이터베이스 생성 → 이름 `semyung-leads` (위치: 아시아 태평양 권장)
2. Workers 및 Pages → semyung-kepco → 설정 → 바인딩 → 추가 → D1 데이터베이스 → 변수 이름 `DB`, 데이터베이스 `semyung-leads` → 배포
3. 설정 → 변수 및 비밀 → 추가 → 비밀 `ADMIN_PASSWORD` (관리자 비밀번호, 12자 이상 권장) → 배포
4. 코드 편집 → 기존 코드 전부 지우고 `worker/worker.js` 붙여넣기 → 배포
5. 명단 보기: https://semyung-kepco.kmh09412.workers.dev/admin (아이디 칸은 아무거나, 비밀번호 칸에 ADMIN_PASSWORD)

표(테이블)는 첫 신청 때 자동으로 만들어지고, 1년 지난 정보는 자동 삭제됩니다.

## 개인정보 처리방침
`privacy.html` 의 【 】 칸(처리자 회사명, 보호책임자 이름·직책·연락처·이메일·주소)을 반드시 채운 뒤 공개하세요.
