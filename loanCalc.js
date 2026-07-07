// loanCalc.js — 다이아 대출 계산 엔진 v1.1 (스트레스 DSR 지역차등 반영)
// 금액: 원 / 금리: % / 기간: 년

/** 원리금균등 월 상환액 */
export function monthlyPayment(principal, annualRate, years) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

/** 연 상환액 → 대출가능 원금 역산 */
export function principalFromAnnualPayment(annualPay, annualRate, years) {
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) return (annualPay / 12) * n;
  return (annualPay / 12) * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
}

/** 지역별 스트레스 가산금리 결정 */
export function getStressAdd(input, rules) {
  const s = rules.bank_mortgage.stress_dsr;
  return (input.isMetro || input.isRegulated)
    ? s.수도권_규제지역_주담대   // 3.0
    : s.지방_비규제_주담대;      // 0.75 (2026.12.31까지)
}

/** DSR 기준 한도 */
export function dsrLimit({ annualIncome, existingAnnualDebt = 0, rate, years, dsrRatio, stressAdd = 0 }) {
  const allowance = annualIncome * dsrRatio - existingAnnualDebt;
  if (allowance <= 0) return 0;
  return principalFromAnnualPayment(allowance, rate + stressAdd, years);
}

/** LTV 기준 한도 */
export function ltvLimit({ housePrice, ltvRatio, seniorLien = 0, deposit = 0 }) {
  return Math.max(0, housePrice * ltvRatio - seniorLien - deposit);
}

/** 최종 한도 = min(LTV, 소득, 호당한도) + 걸린 기준 표시 */
export function finalLimit({ ltvAmt, incomeAmt, productCap = Infinity }) {
  const items = [
    { basis: "LTV(담보)", amt: ltvAmt },
    { basis: "DSR/DTI(소득)", amt: incomeAmt },
    { basis: "상품 호당한도", amt: productCap },
  ];
  const winner = items.reduce((a, b) => (a.amt <= b.amt ? a : b));
  return { limit: winner.amt, bindingBasis: winner.basis, detail: items };
}

/** 기존 신용대출 → 연 원리금 환산 (5년 만기 원리금균등, 스트레스 1.5% 가산, 잔액 1억 초과 시) */
export function creditLoanAnnualBurden(creditBalance, creditRate, rules) {
  if (!creditBalance || creditBalance <= 0) return 0;
  const stress = creditBalance > 100000000
    ? rules.bank_mortgage.stress_dsr.신용대출_기타 : 0;
  const years = rules.bank_mortgage.credit_loan_maturity_years;
  return monthlyPayment(creditBalance, creditRate + stress, years) * 12;
}

/** 통합 계산: 은행 주담대 */
export function calcBankMortgage(input, rules) {
  const b = rules.bank_mortgage;
  const ltvRatio = input.isRegulated ? b.ltv.규제지역
    : (input.isFirstHome ? b.ltv.생애최초 : b.ltv.비규제_무주택);
  const ltvAmt = ltvLimit({
    housePrice: input.housePrice, ltvRatio,
    seniorLien: input.seniorLien || 0, deposit: input.deposit || 0,
  });
  const stressAdd = getStressAdd(input, rules);
  const existingAnnualDebt =
    (input.existingAnnualDebt || 0) +
    creditLoanAnnualBurden(input.creditBalance, input.creditRate || 5.0, rules);
  const incomeAmt = dsrLimit({
    annualIncome: input.annualIncome, existingAnnualDebt,
    rate: input.rate, years: input.years,
    dsrRatio: b.dsr_limit, stressAdd,
  });
  const result = finalLimit({ ltvAmt, incomeAmt });
  return {
    ...result,
    stressAdd,
    dsrCalcRate: input.rate + stressAdd,
    monthly: monthlyPayment(result.limit, input.rate, input.years),
  };
}

/** 신생아특례 디딤돌 자격 판정 */
export function checkNewbornDidimdol(input, rules) {
  const e = rules.didimdol_newborn.eligibility;
  const fails = [];
  if (!input.birthWithin2yrs) fails.push("2년 내 출산 요건 미충족");
  const incomeCap = input.dualIncome ? e.소득상한_맞벌이 : e.소득상한;
  if (input.annualIncome > incomeCap) fails.push(`부부합산 소득 초과 (상한 ${incomeCap / 1e8}억)`);
  if (input.netAsset > e.순자산상한) fails.push("순자산 초과");
  if (input.housePrice > e.주택가상한) fails.push("주택가 9억 초과");
  if (input.areaM2 > e.면적상한_m2) fails.push("전용 85㎡ 초과");
  if (!input.noHouse && !input.isRefinance) fails.push("무주택 요건 미충족");
  return { eligible: fails.length === 0, fails };
}

/** 통합 계산: 신생아특례 디딤돌 (DSR 미적용, DTI 60%) */
export function calcNewbornDidimdol(input, rules) {
  const d = rules.didimdol_newborn;
  const elig = checkNewbornDidimdol(input, rules);
  if (!elig.eligible) return { eligible: false, fails: elig.fails };
  let ltvRatio = input.isFirstHome ? d.limit.ltv_생애최초 : d.limit.ltv_기본;
  if (input.isFirstHome && (input.isMetro || input.isRegulated))
    ltvRatio = d.limit.ltv_수도권규제_생애최초캡;
  const ltvAmt = ltvLimit({ housePrice: input.housePrice, ltvRatio });
  // DTI: 기타대출 이자만 반영, 스트레스 미적용 (기금대출)
  const allowance = input.annualIncome * d.limit.dti - (input.existingAnnualInterest || 0);
  const incomeAmt = allowance > 0
    ? principalFromAnnualPayment(allowance, input.rate, input.years) : 0;
  const result = finalLimit({ ltvAmt, incomeAmt, productCap: d.limit.호당한도 });
  return {
    eligible: true, ...result,
    monthly: monthlyPayment(result.limit, input.rate, input.years),
  };
}
