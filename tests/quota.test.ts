import {expect,test} from "bun:test";
import {quotaView} from "../dashboard/quota";

test("corporate credit entitlement wins over misleading flags and preserves fractional remaining",()=>{
  const q=quotaView("premium_interactions",{entitlement:1900,quota_remaining:1425.25,remaining:999,percent_remaining:75,unlimited:true,has_quota:false},true);
  expect(q.total).toBe(1900);expect(q.remaining).toBe(1425.25);expect(q.percent).toBeCloseTo(75.0131579);expect(q.unlimited).toBe(false);expect(q.unavailable).toBe(false);expect(q.unit).toBe("credits");
});
test("credit totals use provider values and never subtract aggregate credits used",()=>{
  const q=quotaView("premium_interactions",{entitlement:"3900",percent_remaining:50,credits_used:9999,remaining:0,has_quota:false},true);
  expect(q.total).toBe(3900);expect(q.remaining).toBe(1950);expect(q.estimated).toBe(true);expect(q.percent).toBe(50);
  expect(quotaView("chat",{entitlement:100,remaining:20,percent_remaining:20}).remaining).toBe(20);
});
test("zero remaining remains visible and missing org budgets are never fabricated",()=>{
  const depleted=quotaView("premium_interactions",{entitlement:1900,quota_remaining:0,has_quota:false},true);
  expect(depleted.percent).toBe(0);expect(depleted.remaining).toBe(0);expect(depleted.unavailable).toBe(false);
  const pooled=quotaView("premium_interactions",{entitlement:0,unlimited:true,credits_used:123.45,percent_remaining:100},true);
  expect(pooled.pooled).toBe(true);expect(pooled.percent).toBeNull();expect(pooled.total).toBeNull();expect(pooled.unlimited).toBe(false);
  expect(quotaView("premium_interactions",{entitlement:-1,unlimited:true,has_quota:false},true).blocked).toBe(true);
  expect(quotaView("completions",{entitlement:-1,unlimited:true},true).unlimited).toBe(true);
});
test("invalid quota values and legacy categories degrade without NaN or false ratios",()=>{
  for(const input of [null,[],{entitlement:"",percent_remaining:NaN},{entitlement:0,percent_remaining:-1},{entitlement:Infinity,percent_remaining:"bad"}]){
    expect(quotaView("chat",input).percent).toBeNull();
  }
  expect(quotaView("chat",{has_quota:false,percent_remaining:0}).unavailable).toBe(true);
});
