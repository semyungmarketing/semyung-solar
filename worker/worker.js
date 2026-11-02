/**
 * 세명 태양광 부지진단 — Cloudflare Worker (한 파일)
 *  /            한전 분산전원연계 정보 중계 (기존 기능 그대로)
 *  /lead        이용자 인적사항 저장 (POST)
 *  /admin       관리자 명단 화면 (비밀번호 필요) — 엑셀 다운로드, 삭제
 *
 * 필요한 설정 (Worker → 설정)
 *  - 비밀 KEPCO_KEY       : 한전 인증키
 *  - 비밀 ADMIN_PASSWORD  : 관리자 화면 비밀번호
 *  - 바인딩 D1 데이터베이스, 변수 이름 DB
 */
const ORIGIN_DEFAULT = "https://semyungmarketing.github.io";
const KEEP_DAYS = 365; // 보유기간: 1년 지나면 자동 삭제

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOW_ORIGIN || ORIGIN_DEFAULT;
    const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/lead") return await saveLead(request, env, cors);
      if (url.pathname.startsWith("/admin")) return await admin(request, env, url);
      return await kepco(url, env, cors);
    } catch (e) {
      return json({ error: "서버 오류: " + e.message }, 500, cors);
    }
  },
};

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

/* ---------- 한전 중계 ---------- */
async function kepco(url, env, cors) {
  const q = new URLSearchParams();
  for (const k of ["metroCd", "cityCd", "addrLidong", "addrLi", "addrJibun", "substCd"]) {
    const v = url.searchParams.get(k);
    if (v) q.set(k, v);
  }
  if (!q.get("metroCd") || !q.get("cityCd")) return json({ error: "metroCd와 cityCd가 필요합니다" }, 400, cors);
  if (!env.KEPCO_KEY) return json({ error: "Worker에 KEPCO_KEY 비밀값이 없습니다" }, 500, cors);
  q.set("apiKey", env.KEPCO_KEY);
  q.set("returnType", "json");
  const r = await fetch("https://bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do?" + q.toString(), { cf: { cacheTtl: 21600, cacheEverything: true } });
  return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=21600" } });
}

/* ---------- 데이터베이스 ---------- */
async function ready(env) {
  if (!env.DB) throw new Error("D1 데이터베이스(DB) 바인딩이 없습니다");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, purpose TEXT, region TEXT, agree_required INTEGER NOT NULL, agree_age INTEGER NOT NULL, agree_marketing INTEGER NOT NULL, policy_version TEXT, ip_hash TEXT, ua TEXT)"
  );
  // 보유기간이 지난 정보 자동 파기
  await env.DB.prepare("DELETE FROM leads WHERE created < datetime('now', ?)").bind(`-${KEEP_DAYS} days`).run();
}

async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------- 이용자 정보 저장 ---------- */
async function saveLead(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST만 가능합니다" }, 405, cors);
  const reqOrigin = request.headers.get("Origin") || "";
  if (reqOrigin && reqOrigin !== (env.ALLOW_ORIGIN || ORIGIN_DEFAULT)) return json({ error: "허용되지 않은 주소" }, 403, cors);
  const b = await request.json().catch(() => ({}));
  if (b.website) return json({ ok: true }, 200, cors); // 자동입력 봇 함정 칸

  const name = String(b.name || "").trim().slice(0, 30);
  const phone = String(b.phone || "").replace(/[^0-9]/g, "");
  const purpose = String(b.purpose || "").slice(0, 30);
  const region = String(b.region || "").trim().slice(0, 40);
  if (name.length < 2) return json({ error: "이름을 확인해 주세요" }, 400, cors);
  if (!/^01[016789]\d{7,8}$/.test(phone)) return json({ error: "휴대폰 번호를 확인해 주세요" }, 400, cors);
  if (!b.agreeRequired || !b.agreeAge) return json({ error: "필수 동의 항목에 체크해 주세요" }, 400, cors);

  await ready(env);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = (await sha256(ip + (env.ADMIN_PASSWORD || ""))).slice(0, 16); // 원래 IP는 저장하지 않음
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND created > datetime('now','-1 day')").bind(ipHash).first();
  if (recent && recent.n >= 20) return json({ error: "잠시 후 다시 시도해 주세요" }, 429, cors);

  await env.DB.prepare(
    "INSERT INTO leads (created, name, phone, purpose, region, agree_required, agree_age, agree_marketing, policy_version, ip_hash, ua) VALUES (datetime('now'), ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)"
  ).bind(name, phone, purpose, region, b.agreeMarketing ? 1 : 0, String(b.policyVersion || "").slice(0, 20), ipHash, (request.headers.get("User-Agent") || "").slice(0, 120)).run();
  return json({ ok: true }, 200, cors);
}

/* ---------- 관리자 ---------- */
function authed(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const h = request.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  const [, pw] = atob(h.slice(6)).split(":");
  return pw === env.ADMIN_PASSWORD;
}

async function admin(request, env, url) {
  if (!authed(request, env))
    return new Response("관리자 비밀번호가 필요합니다", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="semyung-admin", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" } });
  await ready(env);
  const noStore = { "Cache-Control": "no-store" };

  if (url.pathname === "/admin/data") {
    const { results } = await env.DB.prepare("SELECT id, datetime(created,'+9 hours') AS created, name, phone, purpose, region, agree_marketing, policy_version FROM leads ORDER BY id DESC").all();
    return json(results, 200, noStore);
  }
  if (url.pathname === "/admin/delete" && request.method === "POST") {
    const id = parseInt(url.searchParams.get("id"), 10);
    if (id) await env.DB.prepare("DELETE FROM leads WHERE id = ?").bind(id).run();
    return json({ ok: true }, 200, noStore);
  }
  return new Response(ADMIN_HTML, { headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" } });
}

const ADMIN_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>부지진단 이용자 명단</title>
<style>body{font-family:"Malgun Gothic",system-ui,sans-serif;margin:0;background:#F6F8F6;color:#18241F}
header{background:#0F3D2E;color:#fff;padding:14px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:17px;margin:0;flex:1}button,input{font:inherit}
.btn{border:0;border-radius:8px;padding:8px 14px;background:#F2A900;color:#0F3D2E;font-weight:700;cursor:pointer}
main{padding:16px 20px}input[type=search]{padding:8px 10px;border:1px solid #DCE3DE;border-radius:8px;width:260px}
table{border-collapse:collapse;width:100%;background:#fff;margin-top:12px;font-size:14px}th,td{border-bottom:1px solid #DCE3DE;padding:8px;text-align:left}
th{background:#EEF2EF}td.del button{border:1px solid #C8372D;color:#C8372D;background:#fff;border-radius:6px;padding:3px 8px;cursor:pointer}
.note{font-size:12.5px;color:#5B6B63;margin-top:10px;line-height:1.6}</style>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script></head><body>
<header><h1>세명 태양광 부지진단 · 이용자 명단</h1><span id="cnt"></span><button class="btn" id="xl">엑셀 다운로드</button></header>
<main><input type="search" id="q" placeholder="이름·연락처·지역 검색">
<table><thead><tr><th>번호</th><th>등록일시</th><th>이름</th><th>연락처</th><th>이용 목적</th><th>관심 지역</th><th>마케팅 수신</th><th></th></tr></thead><tbody id="tb"></tbody></table>
<p class="note">이 명단은 개인정보입니다. 화면 캡처·외부 공유를 하지 말고, 내려받은 엑셀은 업무 후 삭제하세요. 등록 후 1년이 지난 정보는 자동으로 삭제됩니다. 이용자가 삭제를 요청하면 해당 줄의 [삭제]를 누르세요.</p></main>
<script>
let rows=[];const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=p=>p.length===11?p.replace(/(\\d{3})(\\d{4})(\\d{4})/,'$1-$2-$3'):p.replace(/(\\d{3})(\\d{3})(\\d{4})/,'$1-$2-$3');
async function load(){rows=await (await fetch('/admin/data',{cache:'no-store'})).json();draw()}
function draw(){const q=document.getElementById('q').value.trim();const list=rows.filter(r=>!q||[r.name,r.phone,r.region,r.purpose].join(' ').includes(q.replace(/-/g,'')));
document.getElementById('cnt').textContent='총 '+rows.length+'명';
document.getElementById('tb').innerHTML=list.map(r=>'<tr><td>'+r.id+'</td><td>'+esc(r.created)+'</td><td>'+esc(r.name)+'</td><td>'+fmt(r.phone)+'</td><td>'+esc(r.purpose)+'</td><td>'+esc(r.region)+'</td><td>'+(r.agree_marketing?'동의':'-')+'</td><td class="del"><button data-id="'+r.id+'">삭제</button></td></tr>').join('');
document.querySelectorAll('td.del button').forEach(b=>b.onclick=async()=>{if(!confirm('이 이용자 정보를 영구 삭제할까요?'))return;await fetch('/admin/delete?id='+b.dataset.id,{method:'POST'});load()})}
document.getElementById('q').oninput=draw;
document.getElementById('xl').onclick=()=>{const data=rows.map(r=>({'번호':r.id,'등록일시':r.created,'이름':r.name,'연락처':fmt(r.phone),'이용 목적':r.purpose,'관심 지역':r.region,'마케팅 수신 동의':r.agree_marketing?'동의':'미동의','동의서 버전':r.policy_version}));
const ws=XLSX.utils.json_to_sheet(data);ws['!cols']=[{wch:6},{wch:19},{wch:10},{wch:15},{wch:16},{wch:18},{wch:14},{wch:12}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'이용자');
const d=new Date();XLSX.writeFile(wb,'부지진단_이용자_'+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'.xlsx')};
load();
</script></body></html>`;
