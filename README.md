# 세명 태양광 부지진단

사이트: https://semyungmarketing.github.io/semyung-solar/

## 폴더 구성
| 경로 | 내용 |
|---|---|
| `index.html` | 부지진단 (브이월드 키 포함, semyungmarketing.github.io 에서만 작동). 배치설계 탭에 자체 배치 엔진·최대 배치 탐색·구조/부재 물량·지형 3D 음영·지형 분석 포함 |
| `calculator/` | 지붕 어레이 설계 계산기 v124 (v123 + 3D 보기). 따로 쓰는 도구, 없어도 부지진단은 작동 |
| `inquiry.html` | 홈페이지(Wix) 삽입용 상담 신청 폼 (웹사이트 삽입, 높이 650px) |
| `privacy.html` | 개인정보 처리방침 — 【 】 칸 채워서 공개 |
| `data/` | 페이지가 읽는 자료 (자동 생성). `prices.json`만 직접 숫자 수정 가능 |
| `raw/` | 원본 자료. 조례 엑셀(이름에 '조례' 또는 ordinance), 한전 공급변전소 CSV |
| `scripts/convert_raw.py` | raw → data 변환 |
| `.github/workflows/convert.yml` | raw 폴더에 파일을 올리면 자동 변환 |
| `worker/worker.js` | Cloudflare Worker 코드 (GitHub에 두는 건 보관용. 실제 적용은 Cloudflare 코드 편집에 붙여넣기) |

## Cloudflare Worker (semyung-kepco)
- `/` 한전 분산전원연계(계통 여유용량) 중계 — 비밀 `KEPCO_KEY`
- `/lead` 이용·상담 신청 저장(부지진단·홈페이지) — D1 바인딩 `DB`
- `/bld` 건축물대장 표제부 조회 — 비밀 `DATA_GO_KR_KEY` (공공데이터포털 건축HUB 건축물대장정보 서비스)
- `/login`, `/verify` 관리자 로그인(신청 창 건너뛰기, 180일) — 비밀 `ADMIN_PASSWORD`
- `/admin` 이용자 명단 · 엑셀 다운로드 · 취소선 · 파기

## 조례 엑셀 바꾸는 법
raw 폴더 → Add file → Upload files → 새 조례 엑셀(`ordinance.xlsx` 같은 이름이면 덮어쓰기) → Commit changes. 1~2분 뒤 반영.

## 배치 흐름 (토지)
필지 선정(검색 + ＋추가 / ✕) → 이격 확인(건축물대장으로 주택만 추림, 필지 경계 200m 안 주택 5호 이상인 필지 제외) → 남은 필지에 최대 배치(약 270가지 조합) → 방위각·피치·단수·열수·구조 값 수정 가능
