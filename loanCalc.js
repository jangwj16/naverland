// loanCalc.js — 다이아 대출 계산 엔진 v2.0 (최종)
// 금액: 원 / 금리: % / 기간: 년

export function monthlyPayment(principal, annualRate, years) {
  const r = annualRate / 100 / 12, n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export function principalFromAnnualPayment(annualPay, annualRate, years) {
  const r = annualRate / 100 / 12, n = years * 12;
  if (r === 0) return (annualPay / 12) * n;
  return (annualPay / 12) * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
}

/** 지역·금리유형별 실효 스트레스 금리 */
export function effectiveStress({ isMetro, isRegulated, rateType = "변동형", fixedRatio = 0 }, rules) {
  const base = (isMetro || isRegulated)
    ? rules.bank_mortgage.stress_dsr.수도권_규제지역_주담대
    : rules.bank_mortgage.stress_dsr.지방_비규제_주담대;
  if (rateType === "변동형") return base;
  const region = (isMetro || isRegulated) ? "수도권" : "비수도권";
  const t = rules.stress_rate_detail[`${rateType}_${region}`];
  if (fixedRatio >= 0.7) return t.over70;
  if (fixedRatio >= 0.5) return t.b70;
  if (fixedRatio >= 0.3) return t.b50;
  return t.b30;
}

/** 대출 종류별 연간 원리금 환산 (DSR용) */
export function annualBurdenByType(loan, rules) {
  const P = loan.amountRemain || loan.amountTotal || 0;
  let rate = loan.rate || 0;
  // 신용대출 스트레스: 잔액 합산 1억 초과 여부는 호출부에서 creditOver100m 플래그로 전달
  if (loan.type === "credit_loan" && loan.creditOver100m)
    rate += rules.bank_mortgage.stress_dsr.신용대출_기타;
  const interest = P * (rate / 100);
  switch (loan.type) {
    case "mortgage":
      return monthlyPayment(P, rate, (loan.periodRemainMonths || 360) / 12) * 12;
    case "mortgage_bullet":
      return P / Math.min((loan.periodTotalMonths || 120) / 12, 10) + interest;
    case "middle_loan":     return P / 25 + interest;
    case "deposit_loan":    return P / 4 + interest;
    case "credit_loan":     return P / 5 + interest;
    case "estate_loan":     return P / 8 + interest;
    case "collateral_loan": return P / 10 + interest;
    case "security_loan":   return P / 8 + interest;
    case "card_loan":       return P / (loan.installment ? 5 : 3) + interest;
    case "lease_loan":
    case "saving_loan":     return interest;
    case "etc_loan":        return loan.actualAnnual || interest;
    default:                return interest;
  }
}

export function totalExistingBurden(loans, rules) {
  const creditSum = loans.filter(l => l.type === "credit_loan")
    .reduce((s, l) => s + (l.amountRemain || l.amountTotal || 0), 0);
  const over = creditSum > 100000000;
  return loans.reduce((sum, l) =>
    sum + annualBurdenByType({ ...l, creditOver100m: over }, rules), 0);
}

export function dsrLimit({ annualIncome, existingAnnualDebt = 0, rate, years, dsrRatio, stressAdd = 0 }) {
  const allowance = annualIncome * dsrRatio - existingAnnualDebt;
  if (allowance <= 0) return 0;
  return principalFromAnnualPayment(allowance, rate + stressAdd, years);
}

export function ltvLimit({ housePrice, ltvRatio, seniorLien = 0, deposit = 0 }) {
  return Math.max(0, housePrice * ltvRatio - seniorLien - deposit);
}

export function finalLimit({ ltvAmt, incomeAmt, productCap = Infinity }) {
  const items = [
    { basis: "LTV(담보)", amt: ltvAmt },
    { basis: "DSR/DTI(소득)", amt: incomeAmt },
    { basis: "상품 호당한도", amt: productCap },
  ];
  const winner = items.reduce((a, b) => (a.amt <= b.amt ? a : b));
  return { limit: winner.amt, bindingBasis: winner.basis, detail: items };
}

/** 지역·자격별 LTV 비율 (단일표 ltv_table_2026). 생애최초 80%=지방(비수도권·비규제)만, 수도권·규제는 70% 캡. */
export function bankLtvRatio(input, rules) {
  const t = rules.ltv_table_2026;
  if (input.isRegulated) return t.규제지역;
  if (input.isFirstHome) return (input.isMetro || input.isRegulated) ? t.생애최초_수도권규제캡 : t.생애최초_지방;
  return t.비규제_무주택;
}
/** 수도권·규제지역 주담대 LTV 한도캡(6억) 적용 */
function applyMetroLtvCap(amt, input, rules) {
  const cap = rules.ltv_table_2026 && rules.ltv_table_2026.수도권규제_주담대_한도캡;
  if (cap && (input.isMetro || input.isRegulated)) return Math.min(amt, cap);
  return amt;
}

/** 탭1: 은행 주담대 통합 계산 */
export function calcBankMortgage(input, rules) {
  const b = rules.bank_mortgage;
  const ltvRatio = bankLtvRatio(input, rules);
  let ltvAmt = ltvLimit({
    housePrice: input.housePrice, ltvRatio,
    seniorLien: input.seniorLien || 0, deposit: input.deposit || 0,
  });
  ltvAmt = applyMetroLtvCap(ltvAmt, input, rules);
  const stressAdd = effectiveStress(input, rules);
  const existingAnnualDebt = totalExistingBurden(input.existingLoans || [], rules);
  const incomeAmt = dsrLimit({
    annualIncome: input.annualIncome, existingAnnualDebt,
    rate: input.rate, years: input.years,
    dsrRatio: input.tier2 ? b.dsr_limit_2nd_tier : b.dsr_limit,
    stressAdd,
  });
  const result = finalLimit({ ltvAmt, incomeAmt });
  return {
    ...result, stressAdd, existingAnnualDebt,
    dsrCalcRate: input.rate + stressAdd,
    ltvRatio,
    monthly: monthlyPayment(result.limit, input.rate, input.years),
  };
}

/** 탭4: 신생아특례 디딤돌 */
export function checkNewbornDidimdol(input, rules) {
  const e = rules.didimdol_newborn.eligibility;
  const fails = [];
  if (!input.birthWithin2yrs) fails.push("2년 내 출산 요건 미충족");
  const cap = input.dualIncome ? e.소득상한_맞벌이 : e.소득상한;
  if (input.annualIncome > cap) fails.push(`부부합산 소득 초과 (상한 ${cap / 1e8}억)`);
  if (input.netAsset > e.순자산상한) fails.push("순자산 초과 (4.88억)");
  if (input.housePrice > e.주택가상한) fails.push("주택가 9억 초과");
  if (input.areaM2 > e.면적상한_m2) fails.push("전용 85㎡ 초과");
  if (!input.noHouse && !input.isRefinance) fails.push("무주택 요건 미충족");
  return { eligible: fails.length === 0, fails };
}

export function calcNewbornDidimdol(input, rules) {
  const d = rules.didimdol_newborn;
  const elig = checkNewbornDidimdol(input, rules);
  if (!elig.eligible) return { eligible: false, fails: elig.fails };
  let ltvRatio = input.isFirstHome ? d.limit.ltv_생애최초 : d.limit.ltv_기본;
  if (input.isFirstHome && (input.isMetro || input.isRegulated))
    ltvRatio = d.limit.ltv_수도권규제_생애최초캡;
  const ltvAmt = ltvLimit({ housePrice: input.housePrice, ltvRatio });
  const allowance = input.annualIncome * d.limit.dti - (input.existingAnnualInterest || 0);
  const incomeAmt = allowance > 0
    ? principalFromAnnualPayment(allowance, input.rate, input.years) : 0;
  const result = finalLimit({ ltvAmt, incomeAmt, productCap: d.limit.호당한도 });
  return { eligible: true, ...result, ltvRatio,
    monthly: monthlyPayment(result.limit, input.rate, input.years) };
}

/** 탭5: 필요소득 역산 — "이 매물 사려면 연소득 얼마?" */
export function requiredIncome(input, rules) {
  // input: housePrice, ownCash(자기자본), rate, years, isMetro, isRegulated, isFirstHome, rateType, fixedRatio
  const b = rules.bank_mortgage;
  const ltvRatio = bankLtvRatio(input, rules);
  const needLoan = Math.max(0, input.housePrice - (input.ownCash || 0));
  const ltvMax = applyMetroLtvCap(input.housePrice * ltvRatio, input, rules);
  const ltvOk = needLoan <= ltvMax;
  const stressAdd = effectiveStress(input, rules);
  const annualPay = monthlyPayment(needLoan, input.rate + stressAdd, input.years) * 12;
  const income = annualPay / b.dsr_limit;
  return {
    needLoan, ltvOk, ltvMax,
    requiredAnnualIncome: income,
    dsrCalcRate: input.rate + stressAdd,
    monthly: monthlyPayment(needLoan, input.rate, input.years),
    note: ltvOk ? null : `자기자본 부족: LTV 한도(${Math.round(ltvMax / 1e8 * 10) / 10}억) 초과분은 소득과 무관하게 대출 불가`,
  };
}

/** 생애최초 혜택 카드: 취득세 감면액 */
export function firstHomeAcqTaxBenefit(input, rules) {
  // input: housePrice, isApartment, areaM2, isMetro, isPopDeclineArea
  const f = rules.first_home_benefits.취득세감면;
  if (input.housePrice > f.주택가상한)
    return { eligible: false, reason: "실거래가 12억 초과" };
  const p = input.housePrice;
  let taxRate;
  if (p <= 600000000) taxRate = 0.01;
  else if (p <= 900000000) taxRate = ((p / 100000000) * 2 / 3 - 3) / 100;
  else taxRate = 0.03;
  const acqTax = p * taxRate;
  const smallCap = input.isMetro ? 600000000 : 300000000;
  const isSmall = !input.isApartment && input.areaM2 <= 60 && p <= smallCap;
  const limit = (isSmall || input.isPopDeclineArea) ? f.감면한도_소형 : f.감면한도_일반;
  const benefit = Math.min(acqTax, limit);
  return {
    eligible: true, acqTax, taxRate, limit, benefit, isSmall,
    payAfter: acqTax - benefit,
    notes: [f.신청, f.사후관리, "지방교육세·농특세는 별도"],
  };
}
