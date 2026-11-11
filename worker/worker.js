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
    const reqOrigin = request.headers.get("Origin") || "";
    const origin = originAllowed(reqOrigin, env) ? reqOrigin : (env.ALLOW_ORIGIN || ORIGIN_DEFAULT);
    const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/lead") return await saveLead(request, env, cors);
      if (url.pathname === "/login") return await adminLogin(request, env, cors);
      if (url.pathname === "/bld") return await buildingRegister(url, env, cors);
      if (url.pathname === "/verify") return json({ ok: await verifyToken(url.searchParams.get("t") || "", env) }, 200, { ...cors, "Cache-Control": "no-store" });
      if (url.pathname.startsWith("/admin")) return await admin(request, env, url);
      return await kepco(url, env, cors);
    } catch (e) {
      return json({ error: "서버 오류: " + e.message }, 500, cors);
    }
  },
};

// 이용 신청을 받을 수 있는 사이트: 부지진단(GitHub Pages), 회사 홈페이지(smnsol.com), Wix의 HTML 삽입 영역(*.filesusr.com)
function originAllowed(o, env) {
  if (!o) return false;
  if (o === (env.ALLOW_ORIGIN || ORIGIN_DEFAULT)) return true;
  return /^https:\/\/(www\.)?smnsol\.com$/.test(o) || /^https:\/\/[a-z0-9-]+\.filesusr\.com$/.test(o) || /^https:\/\/[a-z0-9-]+\.wixsite\.com$/.test(o);
}
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

/* ---------- 건축물대장 표제부 (국토교통부 건축HUB, 공공데이터포털) ---------- */
// PNU 19자리 = 시군구(5) + 법정동(5) + 토지구분(1: 일반, 2: 산) + 본번(4) + 부번(4)
async function buildingRegister(url, env, cors) {
  const pnu = (url.searchParams.get("pnu") || "").replace(/[^0-9]/g, "");
  if (pnu.length !== 19) return json({ error: "pnu(19자리)가 필요합니다" }, 400, cors);
  if (!env.DATA_GO_KR_KEY) return json({ error: "Worker에 DATA_GO_KR_KEY 비밀값이 없습니다" }, 500, cors);
  const q = new URLSearchParams({
    // 공공데이터포털 Encoding/Decoding 어느 키를 넣어도 작동하도록 한 번만 풀어 씀
    serviceKey: /%[0-9A-Fa-f]{2}/.test(env.DATA_GO_KR_KEY) ? decodeURIComponent(env.DATA_GO_KR_KEY.trim()) : env.DATA_GO_KR_KEY.trim(), sigunguCd: pnu.slice(0, 5), bjdongCd: pnu.slice(5, 10),
    platGbCd: pnu[10] === "2" ? "1" : "0", bun: pnu.slice(11, 15), ji: pnu.slice(15, 19),
    numOfRows: "100", pageNo: "1", _type: "json",
  });
  const r = await fetch("https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?" + q.toString(), { cf: { cacheTtl: 86400, cacheEverything: true } });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch (e) { return json({ error: "건축물대장 응답 오류", detail: text.slice(0, 300) }, 502, cors); }
  const head = d.response && d.response.header;
  if (head && head.resultCode && head.resultCode !== "00") return json({ error: head.resultMsg || head.resultCode }, 502, cors);
  let items = d.response && d.response.body && d.response.body.items && d.response.body.items.item;
  items = !items ? [] : Array.isArray(items) ? items : [items];
  const pick = (o) => ({
    bldNm: o.bldNm || "", dongNm: o.dongNm || "", mainAtch: o.mainAtchGbCdNm || "", purpose: o.mainPurpsCdNm || "", etcPurpose: o.etcPurps || "",
    strct: o.strctCdNm || "", roof: o.roofCdNm || o.etcRoof || "", floors: Number(o.grndFlrCnt) || 0, bfloors: Number(o.ugrndFlrCnt) || 0,
    height: Number(o.heit) || 0, archArea: Number(o.archArea) || 0, totArea: Number(o.totArea) || 0, useAprDay: o.useAprDay || "",
    hhld: Number(o.hhldCnt) || 0, fmly: Number(o.fmlyCnt) || 0, ho: Number(o.hoCnt) || 0, addr: o.newPlatPlc || o.platPlc || "",
  });
  return json({ ok: true, count: items.length, items: items.map(pick) }, 200, { ...cors, "Cache-Control": "public, max-age=86400" });
}

/* ---------- 데이터베이스 ---------- */
async function ready(env) {
  if (!env.DB) throw new Error("D1 데이터베이스(DB) 바인딩이 없습니다");
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, purpose TEXT, region TEXT, agree_required INTEGER NOT NULL, agree_age INTEGER NOT NULL, agree_marketing INTEGER NOT NULL, policy_version TEXT, ip_hash TEXT, ua TEXT)"
  );
  try { await env.DB.exec("ALTER TABLE leads ADD COLUMN deleted_at TEXT"); } catch (e) { /* 이미 있음 */ }
  try { await env.DB.exec("ALTER TABLE leads ADD COLUMN struck_at TEXT"); } catch (e) { /* 이미 있음 */ }
  try { await env.DB.exec("ALTER TABLE leads ADD COLUMN source TEXT"); } catch (e) { /* 이미 있음 */ }
  // 보유기간이 지난 정보 자동 파기: 개인정보는 지우고 번호·등록일시만 "삭제" 기록으로 남김
  await env.DB.prepare(WIPE + " WHERE created < datetime('now', ?) AND deleted_at IS NULL").bind(`-${KEEP_DAYS} days`).run();
}

const WIPE = "UPDATE leads SET name='', phone='', purpose='', region='', ua='', ip_hash='', agree_marketing=0, deleted_at=datetime('now')";

async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* ---------- 이용자 정보 저장 ---------- */
async function saveLead(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST만 가능합니다" }, 405, cors);
  const reqOrigin = request.headers.get("Origin") || "";
  if (reqOrigin && !originAllowed(reqOrigin, env)) return json({ error: "허용되지 않은 주소" }, 403, cors);
  const b = await request.json().catch(() => ({}));
  if (b.website) return json({ ok: true }, 200, cors); // 자동입력 봇 함정 칸

  const name = String(b.name || "").trim().slice(0, 30);
  const phone = String(b.phone || "").replace(/[^0-9]/g, "");
  const purpose = String(b.purpose || "").slice(0, 30);
  const region = String(b.region || "").trim().slice(0, 40);
  const source = ["부지진단", "홈페이지"].includes(b.source) ? b.source : "부지진단";
  if (name.length < 2) return json({ error: "이름을 확인해 주세요" }, 400, cors);
  if (!/^01[016789]\d{7,8}$/.test(phone)) return json({ error: "휴대폰 번호를 확인해 주세요" }, 400, cors);
  if (!b.agreeRequired || !b.agreeAge) return json({ error: "필수 동의 항목에 체크해 주세요" }, 400, cors);

  await ready(env);
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipHash = (await sha256(ip + (env.ADMIN_PASSWORD || ""))).slice(0, 16); // 원래 IP는 저장하지 않음
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND created > datetime('now','-1 day')").bind(ipHash).first();
  if (recent && recent.n >= 20) return json({ error: "잠시 후 다시 시도해 주세요" }, 429, cors);

  await env.DB.prepare(
    "INSERT INTO leads (created, name, phone, purpose, region, agree_required, agree_age, agree_marketing, policy_version, ip_hash, ua, source) VALUES (datetime('now'), ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?)"
  ).bind(name, phone, purpose, region, b.agreeMarketing ? 1 : 0, String(b.policyVersion || "").slice(0, 20), ipHash, (request.headers.get("User-Agent") || "").slice(0, 120), source).run();
  return json({ ok: true }, 200, cors);
}

/* ---------- 관리자 로그인(부지진단 이용 신청 건너뛰기) ---------- */
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function verifyToken(t, env) {
  if (!env.ADMIN_PASSWORD || !t) return false;
  const [exp, sig] = t.split(".");
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  return sig === (await hmac(env.ADMIN_PASSWORD, "sms-admin." + exp));
}
async function adminLogin(request, env, cors) {
  if (request.method !== "POST") return json({ error: "POST만 가능합니다" }, 405, cors);
  const b = await request.json().catch(() => ({}));
  if (!env.ADMIN_PASSWORD || String(b.password || "") !== env.ADMIN_PASSWORD) {
    await new Promise((r) => setTimeout(r, 800)); // 비밀번호 대입 공격 지연
    return json({ error: "비밀번호가 맞지 않습니다" }, 401, cors);
  }
  const exp = Date.now() + 180 * 24 * 3600 * 1000; // 180일 유효
  return json({ ok: true, token: exp + "." + (await hmac(env.ADMIN_PASSWORD, "sms-admin." + exp)), exp }, 200, { ...cors, "Cache-Control": "no-store" });
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
    const { results } = await env.DB.prepare("SELECT id, datetime(created,'+9 hours') AS created, name, phone, purpose, region, agree_marketing, policy_version, datetime(deleted_at,'+9 hours') AS deleted_at, datetime(struck_at,'+9 hours') AS struck_at, COALESCE(source,'부지진단') AS source FROM leads ORDER BY id DESC").all();
    return json(results, 200, noStore);
  }
  if (url.pathname === "/admin/strike" && request.method === "POST") {
    const id = parseInt(url.searchParams.get("id"), 10);
    const phone = (url.searchParams.get("phone") || "").replace(/[^0-9]/g, "");
    const on = url.searchParams.get("on") === "1";
    const sql = "UPDATE leads SET struck_at = " + (on ? "datetime('now')" : "NULL") + " WHERE deleted_at IS NULL AND ";
    if (id) await env.DB.prepare(sql + "id = ?").bind(id).run();
    else if (phone) await env.DB.prepare(sql + "phone = ?").bind(phone).run();
    return json({ ok: true }, 200, noStore);
  }
  if (url.pathname === "/admin/delete" && request.method === "POST") {
    const id = parseInt(url.searchParams.get("id"), 10);
    const phone = (url.searchParams.get("phone") || "").replace(/[^0-9]/g, "");
    if (id) await env.DB.prepare(WIPE + " WHERE id = ? AND deleted_at IS NULL").bind(id).run();
    else if (phone) await env.DB.prepare(WIPE + " WHERE phone = ? AND deleted_at IS NULL").bind(phone).run();
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
<script src="https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js"></script></head><body>
<header><h1>세명 태양광 부지진단 · 이용자 명단</h1><span id="cnt"></span><button class="btn" id="xl">엑셀 다운로드</button></header>
<main><input type="search" id="q" placeholder="이름·연락처·지역 검색"> <label style="margin-left:12px;font-size:14px"><input type="checkbox" id="grp" checked> 같은 번호 묶어 보기</label>
<table><thead id="th"></thead><tbody id="tb"></tbody></table>
<p class="note">이 명단은 개인정보입니다. 화면 캡처·외부 공유를 하지 말고, 내려받은 엑셀은 업무 후 삭제하세요. 이용자는 하루에 한 번 다시 등록하므로 같은 번호가 여러 번 쌓입니다. "같은 번호 묶어 보기"를 켜면 한 사람당 한 줄로 보입니다. 등록 후 1년이 지난 기록은 자동 삭제됩니다. [취소선]은 상담 종료·중복·테스트 등 정리용으로, 정보는 그대로 두고 줄만 긋습니다(다시 해제 가능, 1년 보유기간이 지나면 자동 파기). [파기]는 이용자가 삭제를 요청했을 때만 쓰며, 이름·연락처를 완전히 지우고 번호와 등록일시만 남깁니다.</p></main>
<script>
let rows=[];const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=p=>p.length===11?p.replace(/(\\d{3})(\\d{4})(\\d{4})/,'$1-$2-$3'):p.replace(/(\\d{3})(\\d{3})(\\d{4})/,'$1-$2-$3');
const $=id=>document.getElementById(id);
async function load(){const d=await (await fetch('/admin/data',{cache:'no-store'})).json();const by=new Map(d.map(r=>[r.id,r]));const max=d.length?d[0].id:0;rows=[];
for(let i=max;i>=1;i--)rows.push(by.get(i)||{id:i,created:'',name:'',phone:'',deleted_at:'(기록 없음)'});draw()}
const live=()=>rows.filter(r=>!r.deleted_at);
const addU=(arr,v)=>{v=String(v||'').trim();if(v&&!arr.includes(v))arr.push(v)};
function grouped(){const m=new Map();for(const r of live()){let g=m.get(r.phone);if(!g){g={...r,count:0,first:r.created,last:r.created,regions:[],purposes:[],sources:[],allStruck:true};m.set(r.phone,g)}g.count++;if(!r.struck_at)g.allStruck=false;addU(g.sources,r.source);g.first=r.created;addU(g.regions,r.region);addU(g.purposes,r.purpose)}
  const gs=[...m.values()].map(g=>({...g,struck_at:g.allStruck?(g.struck_at||'취소선'):null,source:g.sources.join(', '),region:g.regions.join(', '),purpose:g.purposes.join(', ')}));
  return gs.concat(rows.filter(r=>r.deleted_at).map(r=>({...r,count:1,first:r.created,last:r.created}))).sort((a,b)=>b.id-a.id)}
function view(){const q=$('q').value.trim().replace(/-/g,'');const list=$('grp').checked?grouped():rows.map(r=>({...r,count:1,first:r.created,last:r.created}));return list.filter(r=>!q||(!r.deleted_at&&[r.name,r.phone,r.region,r.purpose].join(' ').includes(q)))}
const ST_DEL='color:#9aa5a0;background:#f0f0f0';const ST_STK='color:#8a8a8a;background:#f3f3f3;text-decoration:line-through';
function draw(){const g=$('grp').checked,list=view();const L=live();const del=rows.length-L.length;const gl=grouped().filter(r=>!r.deleted_at);
$('cnt').textContent=g?('총 '+gl.filter(r=>!r.struck_at).length+'명 (취소선 '+gl.filter(r=>r.struck_at).length+'명, 삭제 '+del+'건)'):('전체 '+rows.length+'건 (취소선 '+L.filter(r=>r.struck_at).length+'건, 삭제 '+del+'건)');
$('th').innerHTML='<tr>'+(g?'<th>최근 등록</th><th>이름</th><th>연락처</th><th>등록 횟수</th><th>최초 등록</th><th>이용 목적(최근순)</th><th>관심 지역(최근순)</th>':'<th>번호</th><th>등록일시</th><th>이름</th><th>연락처</th><th>이용 목적</th><th>관심 지역</th>')+'<th>유입</th><th>마케팅 수신</th><th>관리</th></tr>';
$('tb').innerHTML=list.map(r=>{
  if(r.deleted_at)return '<tr style="'+ST_DEL+'">'+(g?'<td>'+esc(r.created)+'</td><td>삭제됨(파기)</td><td></td><td></td><td></td><td></td><td></td>':'<td>'+r.id+'</td><td>'+esc(r.created)+'</td><td>삭제됨(파기)</td><td></td><td></td><td></td>')+'<td></td><td></td><td style="font-size:12px">파기 '+esc(r.deleted_at)+'</td></tr>';
  const key=g?'phone='+r.phone:'id='+r.id;const st=r.struck_at?' style="'+ST_STK+'"':'';
  return '<tr'+st+'>'+(g?'<td>'+esc(r.last)+'</td><td>'+esc(r.name)+'</td><td>'+fmt(r.phone)+'</td><td>'+r.count+'회</td><td>'+esc(r.first)+'</td>':'<td>'+r.id+'</td><td>'+esc(r.created)+'</td><td>'+esc(r.name)+'</td><td>'+fmt(r.phone)+'</td>')+'<td>'+esc(r.purpose)+'</td><td>'+esc(r.region)+'</td><td>'+esc(r.source||'')+'</td><td>'+(r.agree_marketing?'동의':'-')+'</td>'
   +'<td class="del" style="text-decoration:none;white-space:nowrap"><button data-k="'+key+'" data-on="'+(r.struck_at?0:1)+'" class="stk" style="border-color:#5B6B63;color:#5B6B63">'+(r.struck_at?'취소선 해제':'취소선')+'</button> <button data-k="'+key+'" class="wipe">파기</button></td></tr>'}).join('');
document.querySelectorAll('button.stk').forEach(b=>b.onclick=async()=>{await fetch('/admin/strike?'+b.dataset.k+'&on='+b.dataset.on,{method:'POST'});load()});
document.querySelectorAll('button.wipe').forEach(b=>b.onclick=async()=>{if(!confirm('이 이용자의 개인정보를 완전히 지웁니다(되돌릴 수 없음). 이용자가 삭제를 요청한 경우에만 사용하세요. 진행할까요?'))return;await fetch('/admin/delete?'+b.dataset.k,{method:'POST'});load()})}
$('q').oninput=draw;$('grp').onchange=draw;
$('xl').onclick=()=>{const g=$('grp').checked,list=view();
const head=g?['최근 등록','이름','연락처','등록 횟수','최초 등록','이용 목적(최근순)','관심 지역(최근순)','유입','마케팅 수신 동의(최근)','상태']:['번호','등록일시','이름','연락처','이용 목적','관심 지역','유입','마케팅 수신 동의','동의서 버전','상태'];
const stat=r=>r.deleted_at?'파기 '+r.deleted_at:r.struck_at?'취소선':'';
const body=list.map(r=>r.deleted_at?(g?[r.created,'삭제됨(파기)','','',r.created,'','','','',stat(r)]:[r.id,r.created,'삭제됨(파기)','','','','','','',stat(r)]):g?[r.last,r.name,fmt(r.phone),r.count,r.first,r.purpose,r.region,r.source,r.agree_marketing?'동의':'미동의',stat(r)]:[r.id,r.created,r.name,fmt(r.phone),r.purpose,r.region,r.source,r.agree_marketing?'동의':'미동의',r.policy_version,stat(r)]);
const ws=XLSX.utils.aoa_to_sheet([head,...body]);
const hs={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'0F3D2E'}},alignment:{horizontal:'center',vertical:'center'}};
const ss={font:{strike:true,color:{rgb:'8A8A8A'}},fill:{fgColor:{rgb:'E7E7E7'}}};
const ds={font:{color:{rgb:'9AA5A0'}},fill:{fgColor:{rgb:'F0F0F0'}}};
head.forEach((h,c)=>{const ref=XLSX.utils.encode_cell({r:0,c});if(ws[ref])ws[ref].s=hs});
list.forEach((r,i)=>{const sty=r.deleted_at?ds:r.struck_at?ss:null;if(!sty)return;head.forEach((h,c)=>{const ref=XLSX.utils.encode_cell({r:i+1,c});if(!ws[ref])ws[ref]={t:'s',v:''};ws[ref].s=(c===head.length-1&&r.struck_at)?{...sty,font:{color:{rgb:'8A8A8A'}}}:sty})});
ws['!cols']=head.map(h=>({wch:/관심|목적/.test(h)?28:/등록|일시|상태/.test(h)?20:/마케팅/.test(h)?22:/연락처/.test(h)?15:10}));ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:body.length,c:head.length-1}})};
const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,g?'이용자(묶음)':'등록기록');
const d=new Date();XLSX.writeFile(wb,'부지진단_이용자_'+(g?'묶음_':'전체기록_')+d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'.xlsx')};
load();
</script></body></html>`;
