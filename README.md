# 세명 태양광 부지진단

https://semyungmarketing.github.io/semyung-solar/

## 폴더
- `index.html` 지도 페이지 (브이월드 키 포함, semyungmarketing.github.io 에서만 작동)
- `raw/` 원본 자료. 여기에 올리면 자동으로 data/ 가 갱신됩니다
  - 조례 모니터링 엑셀: 파일 이름에 **조례** 또는 ordinance가 들어간 .xlsx (가장 최근 파일 사용)
  - 시공지도 외부공유용 HTML: 파일 이름에 **시공** 또는 sites가 들어간 .html (또는 .xlsx)
- `data/` 자동 생성 파일 (직접 수정하지 않음). 단, `prices.json`은 직접 숫자를 고쳐도 됩니다
- `scripts/convert_raw.py` 변환 프로그램
- `.github/workflows/convert.yml` raw/ 에 파일이 올라오면 변환 실행

## 조례 엑셀 바꾸는 법
raw 폴더 → Add file → Upload files → 새 조례 엑셀 올리기 → Commit changes.
1~2분 뒤 Actions 탭에 초록 체크가 뜨면 반영 완료.
같은 이름(`ordinance.xlsx`)으로 올리면 덮어쓰기 됩니다.

## 계통(한전 변전소·여유용량)
현재 버전은 판정에 포함하지 않습니다.
