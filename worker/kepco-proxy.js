/**
 * 한전 분산전원연계 정보 API 중계(프록시) — Cloudflare Workers 무료 플랜용
 * 한전 인증키를 공개 페이지에 넣지 않고, 이 Worker의 비밀값(KEPCO_KEY)에 둡니다.
 * 페이지 ⚙ 설정 → "프록시 주소"에 이 Worker 주소(https://...workers.dev)를 넣으면 됩니다.
 */
export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || "https://semyungmarketing.github.io";
    const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const json = (body, status = 200) => new Response(body, { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=21600" } });

    const url = new URL(request.url);
    const q = new URLSearchParams();
    for (const k of ["metroCd", "cityCd", "addrLidong", "addrLi", "addrJibun", "substCd"]) {
      const v = url.searchParams.get(k);
      if (v) q.set(k, v);
    }
    if (!q.get("metroCd") || !q.get("cityCd")) return json('{"error":"metroCd와 cityCd가 필요합니다"}', 400);
    if (!env.KEPCO_KEY) return json('{"error":"Worker에 KEPCO_KEY 비밀값이 없습니다"}', 500);
    q.set("apiKey", env.KEPCO_KEY);
    q.set("returnType", "json");

    const r = await fetch("https://bigdata.kepco.co.kr/openapi/v1/dispersedGeneration.do?" + q.toString(), {
      cf: { cacheTtl: 21600, cacheEverything: true },   // 같은 주소는 6시간 캐시
    });
    return json(await r.text(), r.status);
  },
};
