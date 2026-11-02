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

## 한전 계통 여유용량 (분산전원연계 정보)
필지를 누르면 PNU(시도·시군구 코드)와 지번주소(읍면동·리·번지)로 한전 API를 조회해 변전소·변압기·선로(DL) 여유용량을 판정합니다.
한전 키를 페이지에 넣으면 누구나 볼 수 있으므로, 무료 Cloudflare Worker를 중계(프록시)로 씁니다.

1. https://dash.cloudflare.com 가입 → Workers & Pages → Create → Worker 만들기
2. 이름 예: `semyung-kepco` → Deploy → Edit code → `worker/kepco-proxy.js` 내용을 통째로 붙여넣고 Deploy
3. Worker의 Settings → Variables and Secrets → Add → Type: Secret, Name: `KEPCO_KEY`, Value: 한전 인증키 → Deploy
4. Worker 주소(예: `https://semyung-kepco.계정명.workers.dev`)를 복사
5. 사이트 ⚙ 설정 → "프록시 주소"에 붙여넣고 저장
   (모든 방문자에게 적용하려면 data/prices.json 에 `"kepcoProxy": "https://...workers.dev"` 한 줄 추가)

보조 자료: raw/substations_area.csv (한전 지역별 공급가능 변전소, 2024.5) → data/substations_area.json
