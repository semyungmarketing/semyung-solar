"""
raw/ 폴더의 원본 파일을 지도 페이지가 읽는 data/*.json 으로 변환합니다.
 - raw/ 안의 조례 엑셀(파일명에 '조례' 포함, .xlsx)       → data/ordinances.json
GitHub Actions(convert.yml)가 raw/ 에 파일이 올라오면 자동으로 실행합니다.
"""
import glob, json, os, re, datetime
from openpyxl import load_workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, DATA = os.path.join(ROOT, "raw"), os.path.join(ROOT, "data")
NAMES = set(json.load(open(os.path.join(ROOT, "scripts", "sgg_names.json"), encoding="utf-8")))
CAP_DATE = "2026-09-18"   # 태양광 이격거리 국가 상한 시행일
ALIAS = {"전남광주통합특별시": ["전라남도", "광주광역시"], "전라북도": ["전북특별자치도"],
         "강원도": ["강원특별자치도"], "대구광역시": ["대구광역시"]}

def match_key(sido, sgg):
    sgg = re.sub(r"\s+", "", sgg)
    for s in ALIAS.get(sido, [sido]):
        if f"{s}|{sgg}" in NAMES:
            return f"{s}|{sgg}"
    return None

M = re.compile(r"(\d{1,2},\d{3}|\d+(?:\.\d+)?)\s*(?:m|ｍ|미터)(?![²㎡])")
def first_m(seg):
    m = M.search(seg)
    return int(float(m.group(1).replace(",", ""))) if m else None

def parse_dist(text):
    """현재 기준 문장에서 주거·도로 이격거리(m)를 뽑습니다.
    주거: '주택 5호↑ 반경 N m'(개정 법령 방식)이 있으면 그 값, 없으면 처음 나오는 주거 기준(대개 가장 엄격한 단계)."""
    t = re.split(r"풍력", str(text or "").replace("\n", " / "))[0]   # 풍력 기준은 제외
    segs = [x.strip() for x in re.split(r"\s/\s|\||;|,\s", t) if x.strip()]
    hs, r = [], None
    for seg in segs:
        if re.search(r"주거|주택|가옥|호\s*↑|호\s*이상|민가|마을", seg) and not ("자연취락" in seg and not re.search(r"5호", seg)):
            v = first_m(seg)
            if v is not None: hs.append((seg, v))
        if r is None and "도로" in seg and not re.search(r"삭제|없음|없어|제외|폐지|규정 없", seg):
            r = first_m(seg)
    law = [v for seg, v in hs if "반경" in seg and re.search(r"5\s*호\s*(↑|이상)", seg) and "미만" not in seg and "특례" not in seg]
    h = law[0] if law else (hs[0][1] if hs else None)
    return h, r

def ymd(s):
    s = str(s or "").strip().replace(".", "-")
    return s if re.match(r"\d{4}-\d{2}-\d{2}$", s) else ""

def convert_ordinances(path):
    wb = load_workbook(path)
    per, unmatched = {}, set()
    for sh in wb.sheetnames:
        if sh == "요약":
            continue
        ws, cur = wb[sh], None
        for row in ws.iter_rows(min_row=1):
            v = [c.value for c in row] + [None] * 10
            a = str(v[0] or "")
            if a.startswith("▶"):
                cur = re.sub(r"^▶\s*", "", a).split("(")[0].strip()
                continue
            cls = str(v[1] or "")
            if not cur or cur == "광역 본청" or not re.match(r"^[A-E]\s", cls):
                continue
            link = row[9].hyperlink.target if len(row) > 9 and row[9].hyperlink else ""
            rec = {"title": a, "cls": cls, "date": ymd(v[2]), "dept": v[3] or "",
                   "now": str(v[5] or ""), "change": str(v[7] or ""), "review": str(v[8] or ""), "url": link}
            k = match_key(sh, cur)
            if not k:
                unmatched.add(f"{sh} {cur}")
                continue
            per.setdefault(k, {"label": sh, "list": []})["list"].append(rec)
    items = {}
    for k, o in per.items():
        L = o["list"]
        noclause = lambda t: t.startswith("해당 없음") or re.search(r"확인되지 않음|(이격|입지)[^.]{0,20}기준\s*없음|이격거리 기준 없음", t[:160])
        has = [x for x in L if x["now"] and not noclause(x["now"])]
        rank = lambda x: (1 if "이격" in x["title"] else 0, 1 if re.search(r"계획\s*조례", x["title"]) else 0, x["date"])
        latest_a = max((x["date"] for x in L if x["cls"].startswith("A")), default="")
        if has:
            p = sorted(has, key=rank, reverse=True)[0]
            h, r = parse_dist(p["now"])
            if h is None and r is None:
                h, r = parse_dist(p["review"])
        else:
            p = sorted(L, key=lambda x: x["date"], reverse=True)[0]
            h, r = 0, 0
        it = {"title": p["title"], "cls": p["cls"], "d": p["date"], "dept": p["dept"], "now": p["now"],
              "review": p["review"], "change": p["change"] if p["cls"].startswith("A") else "",
              "url": p["url"], "label": o["label"], "others": [x["title"] for x in L if x is not p][:5]}
        it = {kk: vv for kk, vv in it.items() if vv not in ("", [], None)}
        if h is not None: it["h"] = h
        if r is not None: it["r"] = r
        if not has: it["note"] = "조례에 태양광 이격거리 조항 없음"
        if latest_a >= CAP_DATE and (h is None or h <= 200) and not (r and r > 0):
            it["p"] = "amended"
        items[k] = it
    out = {"updated": datetime.date.today().isoformat(), "source": os.path.basename(path), "count": len(items), "items": items}
    json.dump(out, open(os.path.join(DATA, "ordinances.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"조례: {len(items)}개 시·군 → data/ordinances.json")
    if unmatched:
        print("시·군 경계 이름과 맞지 않아 건너뜀:", ", ".join(sorted(unmatched)))

def newest(*patterns):
    fs = [f for p in patterns for f in glob.glob(os.path.join(RAW, p)) if not os.path.basename(f).startswith("~$")]
    return max(fs, key=os.path.getmtime) if fs else None

if __name__ == "__main__":
    os.makedirs(DATA, exist_ok=True)
    o = newest("*조례*.xlsx", "*ordinance*.xlsx")
    if o: convert_ordinances(o)
